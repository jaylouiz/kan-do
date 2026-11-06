import type { Task } from "@/types/task";
import { useTasksStore } from "~/store/tasks";

import { useBoardStore } from "~/store/board";
import { useIntegrationHealthStore } from "~/store/integrationHealth";
import { useErrorHandler } from '~/composables/useErrorHandler';
import { useSyncValidation } from '~/composables/useSyncValidation';
import { useTaskSources } from '~/composables/useTaskSources';
import { useTaskSync } from '~/composables/useTaskSync';
import { isIntegrationSourceId } from '~/lib/taskSources';
import { translate } from '~/lib/i18n';
import type { IntegrationSourceId, SourceId } from '~/types/taskSource';

/**
 * Fetches in flight per source, one generation counter each, shared by every composable instance of a
 * Pinia app (keyed by its tasks store). A fetch that finds a newer one of its source started, or the
 * board's sources changed meanwhile, is stale and merges nothing (#326 N6).
 */
const fetchGenerationsByStore = new WeakMap<object, Map<SourceId, number>>();

/**
 * Integration Manager Composable
 * 
 * Manages external integrations and data fetching for tasks.
 * Fetches every connected source through its adapter (#318).
 */
export const useIntegrationManager = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const tasksStore = useTasksStore();
  const boardStore = useBoardStore();
  const { handleSuccess } = useErrorHandler();
  const { validateAndConfirm } = useSyncValidation();
  const { adapterFor } = useTaskSources();
  const { syncPendingChanges } = useTaskSync();
  const fetchGenerations = fetchGenerationsByStore.get(tasksStore) ?? new Map<SourceId, number>();
  fetchGenerationsByStore.set(tasksStore, fetchGenerations);

  /**
   * The sources a refresh fetches: every connected integration, or Local alone on a board without one;
   * nothing before the user has onboarded. A mixed board does not refresh Local: it has no upstream.
   */
  const sourcesToFetch = (): SourceId[] => {
    const config = boardStore.boardConfig.sources;
    if (!config) return [];
    return config.connected.length > 0 ? [...config.connected] : ['local'];
  };

  /**
   * Opens a fetch of `source`. The ticket goes stale when a newer fetch of the same source starts or the
   * board's sources change (a disconnect or a switch, also from one source to the same one).
   */
  const beginFetch = (source: SourceId) => {
    const generation = (fetchGenerations.get(source) ?? 0) + 1;
    fetchGenerations.set(source, generation);
    const sourcesAtStart = boardStore.boardConfig.sources;
    return {
      isStale: () => fetchGenerations.get(source) !== generation || boardStore.boardConfig.sources !== sourcesAtStart,
    };
  };

  /**
   * Fetches one source and merges the result into the board. Never rejects and never reports: a failing
   * source is marked in the health store and skipped, its tasks stay where they are, and the others go on
   * (no toast, no setup dialog, also for a source that is not configured; the way back to a working source is
   * the repair entry of the sync popover, #319).
   * `onFetched` is called once the fetch is in, whatever its outcome. Resolves to the fetched tasks, `[]`
   * when the fetch failed, went stale or the user cancelled it.
   */
  const syncSource = async (source: SourceId, onFetched: () => void): Promise<Task[]> => {
    const ticket = beginFetch(source);
    const health = useIntegrationHealthStore();
    const adapter = adapterFor(source);
    const integration: IntegrationSourceId | null = isIntegrationSourceId(source) ? source : null;

    let tasks: Task[];
    try {
      tasks = await adapter.fetchActive();
    } catch (error) {
      console.error(`[IntegrationManager] Fetching ${source} failed:`, error);
      if (!ticket.isStale() && integration) {
        health.recordFailure(integration, error);
      }
      return [];
    } finally {
      onFetched();
    }
    if (ticket.isStale()) return [];

    // A source that answered again after being offline or broken is back
    if (integration) {
      const wasRecovering = health.isOffline(integration) || health.isBroken(integration);
      health.markHealthy(integration);
      if (wasRecovering && integration === 'notion') {
        handleSuccess(translate('notion.integration.reconnected'));
      }
    }

    // Validate this source's result before merging (may show the warning and wait for the user)
    const shouldProceed = await validateAndConfirm(source, tasks);
    if (!shouldProceed) {
      if (import.meta.dev) {
        console.log(`[IntegrationManager] ${source} sync cancelled by user due to validation warning`);
      }
      return [];
    }
    // The user may have taken a while: the board can have moved on
    if (ticket.isStale()) return [];

    // An empty result of a pending switch's source may be a failed fetch: never replace the board with it
    // Only the switch's own source completes it: a source connected meanwhile (#320) must not replace the Local tasks
    const completesSwitch = boardStore.isSourceSwitchPending && source !== 'local' && source === boardStore.defaultSource && tasks.length > 0;
    tasksStore.mergeTasks(source, tasks, { replaceOthers: completesSwitch });
    if (completesSwitch) boardStore.clearSourceSwitchPending();
    if (integration) health.recordSuccessfulSync(integration);

    // The source answered, so what it was missing can go now (#319): the merge kept those tasks as they are
    // (also the moves into or out of it: a create that waited for it, an origin copy still to be removed, #322)
    if (integration && tasksStore.tasks.some((el) => (el.source === source && tasksStore.isSyncPending(el.id)) || el.pendingMove?.fromSource === source)) {
      await syncPendingChanges(source);
    }
    return tasks;
  };

  /**
   * The board's last sync is the oldest successful sync among its connected integrations (the per-source
   * times stay in the health store for the settings page); a board without one has just synced Local.
   */
  const updateBoardSyncTimestamp = (localSynced: boolean) => {
    const health = useIntegrationHealthStore();
    const connected = boardStore.connectedIntegrations;
    if (connected.length === 0) {
      if (localSynced) tasksStore.setLastSyncTimestamp(new Date());
      return;
    }
    const times = connected
      .map((source) => health.healthOf(source).lastSuccessfulSync)
      .filter((time): time is number => time !== null);
    if (times.length > 0) tasksStore.setLastSyncTimestamp(new Date(Math.min(...times)));
  };

  /**
   * Fetch tasks from all connected sources in parallel, each through its adapter, and merge them per
   * source: one failing source neither blocks nor empties the others. While the board has a pending
   * source switch (welcome, Notion setup, Todoist OAuth), the first non-empty fetch of the new source
   * replaces the other sources' tasks, as before #326, and ends the switch; an empty or failed fetch
   * leaves it pending for the next refresh.
   */
  const fetchTasks = async (): Promise<Task[]> => {
    const sources = sourcesToFetch();
    if (sources.length === 0) return [];

    try {
      tasksStore.setLoading(true);

      // Loading ends once every fetch is in, BEFORE a validation modal blocks on the user
      let fetching = sources.length;
      const onFetched = () => {
        fetching -= 1;
        if (fetching === 0) tasksStore.setLoading(false);
      };

      // Every source runs its own fetch, validation and merge; none of them rejects
      const results = await Promise.all(sources.map((source) => syncSource(source, onFetched)));

      updateBoardSyncTimestamp(sources.includes('local'));
      return results.flat();
    } catch (error) {
      console.error('Error fetching tasks:', error);
      return [];
    } finally {
      tasksStore.setLoading(false);
    }
  };

  /**
   * Fetches and merges one source only, e.g. the first fetch of a fresh connect (#320): the other sources
   * are not touched and show no validation warning. Resolves to the fetched tasks (`[]` on failure, see `syncSource`).
   */
  const fetchSource = async (source: SourceId): Promise<Task[]> => {
    try {
      tasksStore.setLoading(true);
      const tasks = await syncSource(source, () => tasksStore.setLoading(false));
      updateBoardSyncTimestamp(false);
      return tasks;
    } finally {
      tasksStore.setLoading(false);
    }
  };

  /**
   * Whether the board has a usable default source, i.e. whether the tasks page can open (otherwise it sends
   * the user to the welcome flow). Notion counts as soon as it is chosen: a missing configuration marks the
   * source as needing attention on the fetch (the sync popover offers the repair, #319) instead of leaving the board.
   */
  const isIntegrationConfigured = (): boolean => {
    const source = boardStore.defaultSource;
    return source !== null && (source === 'notion' || adapterFor(source).isConfigured());
  };

  /**
   * Gets configuration status and details for the current integration
   */
  const getIntegrationStatus = () => {
    const source = boardStore.defaultSource;
    const isConfigured = isIntegrationConfigured();
    
    return {
      service: source,
      isConfigured,
      lastSync: tasksStore.lastSyncTimestamp,
      isLoading: tasksStore.isLoading,
      taskCount: tasksStore.tasks.length,
    };
  };

  return {
    fetchTasks,
    fetchSource,
    isIntegrationConfigured,
    getIntegrationStatus,
  } as const;
};
