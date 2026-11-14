import { defineStore, acceptHMRUpdate  } from "pinia";
import { ref, computed } from "vue";
import { TaskStatus } from "~/types/taskStatus";
import type { Task } from "@/types/task";
import type { IColumn, IBoardConfig, SortField, SortDirection } from "~/types/state";
import type { BoardGroupingState, GroupKey } from "~/types/boardGrouping";
import { POSITION_GAP, getPositionBetween, needsRebalancing, rebalancePositions } from "@/types/taskPosition";
import { mapHelpers } from "~/utils/mapHelpers";
import { dayKey, isValidDayKey } from "~/utils/recapDay";
import { useToday } from "~/composables/useToday";
import { persistOmitFor } from "~/lib/secrets";
import { useTasksStore } from "~/store/tasks";
import { normalizeBoardConfig, singleSource } from "~/lib/taskSources";
import type { SourceId, IntegrationSourceId, TaskSourcesConfig } from "~/types/taskSource";

export interface IUpdateTaskOrderPayload {
  taskStatus: TaskStatus;
  taskOrder: Array<string>;
}

/**
 * Length of the in-card done confirmation (#124, #295): 180ms in, 900ms hold, 220ms out. Single source:
 * TaskCard sets `--done-confirm-duration` on the layer from it, so the animation and the flag end together.
 */
export const DONE_CONFIRMATION_MS = 1300;

/**
 * Length of the confirmation that carries the "faster than planned" message (#295): the same 180ms in and 220ms out,
 * a 1800ms hold so the sentence can be read. TaskCard picks this one for a card in `fasterThanPlanTaskIds`.
 */
export const FASTER_CONFIRMATION_MS = 2200;

/**
 * Length of the timebox nudge's countdown (#389): the hairline drains over this long, then the layer
 * leaves. Single source: TaskTimeboxNudge sets `--nudge-duration` from it.
 */
export const TIMEBOX_NUDGE_MS = 8000;

/**
 * Normalises a persisted board config on hydration: maps the old `taskService` to `sources`
 * (`lib/taskSources`) and drops state left behind by the removed Linear integration, so returning
 * users with it fall back to the setup flow.
 */
export function sanitizeBoardConfig(raw: unknown): IBoardConfig {
  return normalizeBoardConfig(raw);
}

/**
 * The board's topic focus (#161): hides the cards of every other topic in Offen, Wartet and Erledigt (Jetzt is never
 * filtered). It belongs to one local day: `day` is when it was set, and it ends with that day (`activeFocusTopic`).
 */
export interface BoardFocus {
  topic: string;
  /** Local day (`YYYY-MM-DD`) the focus was set on */
  day: string;
}

/** A persisted `focus` that is not a well-formed `{ topic, day }` reads as no focus (old data has none). */
export function sanitizeFocus(raw: unknown): BoardFocus | null {
  if (!raw || typeof raw !== 'object') return null;
  const { topic, day } = raw as Record<string, unknown>;
  if (typeof topic !== 'string' || topic.trim() === '' || !isValidDayKey(day)) return null;
  return { topic, day };
}

/** Key-order-insensitive JSON form, so two structurally equal configs compare equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

export const useBoardStore = defineStore("board", () => {
  // State
  const boardConfig = ref<IBoardConfig>({ sources: null });
  const columns = ref<Array<IColumn>>([
    {
      idClassSuffix: "open",
      taskStatus: TaskStatus.Open,
      taskOrder: [],
      taskPositions: {}, 
      sorting: { field: 'manual', direction: 'asc' },
    },
    {
      idClassSuffix: "progress",
      taskStatus: TaskStatus.Progress,
      taskOrder: [],
      taskPositions: {}, 
      sorting: { field: 'manual', direction: 'asc' },
    },
    {
      idClassSuffix: "waiting",
      taskStatus: TaskStatus.Waiting,
      taskOrder: [],
      taskPositions: {}, 
      sorting: { field: 'dateUpdated', direction: 'asc' }, // Longest waiting (oldest update) on top
    },
    {
      idClassSuffix: "done",
      taskStatus: TaskStatus.Done,
      taskOrder: [],
      taskPositions: {}, 
      sorting: { field: 'dateCompleted', direction: 'asc' }, // First completed (oldest) on top
    },
  ]);
  const grouping = ref<BoardGroupingState>({
    enabled: false,
    key: null,
  });
  
  /** The topic focus (#161), persisted; null = no focus. Read it through `activeFocusTopic`, which ends it with its day. */
  const focus = ref<BoardFocus | null>(null);

  // Transient state for scroll persistence
  const scrollPosition = ref({ top: 0, left: 0 });

  /**
   * Done confirmation (#124): ids of cards that play the short in-card check after a drop into
   * Erledigt. Transient and client-only: not in the persist `pick` list. One timer per id.
   */
  const confirmingTaskIds = ref<string[]>([]);
  /**
   * Faster than planned (#295): the subset of `confirmingTaskIds` whose layer shows the message instead of the check
   * (`lib/completionPace`). Transient like `confirmingTaskIds`; cleared together with it.
   */
  const fasterThanPlanTaskIds = ref<string[]>([]);
  const confirmationTimers: Record<string, number> = {};

  /**
   * Day close (#292): true while the Erledigt list fades out before its tasks are archived. Transient and
   * client-only like `confirmingTaskIds`: not persisted; `useDayClose().finish` sets and clears it.
   */
  const doneLeaving = ref(false);

  /**
   * Timebox nudge (#389): id of the Jetzt card that currently asks for a timebox, or null. One at a
   * time (Jetzt holds one card). Transient like `confirmingTaskIds`: not persisted, and it lives here
   * because a cross-column move mounts the card fresh in Jetzt.
   */
  const timeboxNudgeTaskId = ref<string | null>(null);

  // Getters
  const columnByTaskStatus = computed(() => (taskStatus: TaskStatus) => {
    return columns.value.find((el) => el.taskStatus === taskStatus) ?? null;
  });

  /** Where new tasks go; `null` while the user has never onboarded. */
  const defaultSource = computed<SourceId | null>(() => boardConfig.value.sources?.default ?? null);

  /** Whether the user finished onboarding (picked a first source). */
  const isOnboarded = computed(() => boardConfig.value.sources !== null);

  /** A switch to an integration is waiting for its first non-empty fetch (see `markSourceSwitchPending`). */
  const isSourceSwitchPending = computed(() => boardConfig.value.pendingSourceSwitch === true);

  /** The connected integrations, in connection order (Local is implicit and not listed). */
  const connectedIntegrations = computed<IntegrationSourceId[]>(() => boardConfig.value.sources?.connected ?? []);

  /** Whether an integration is connected as a task source. Local is always available, so it is not asked here. */
  const isIntegrationConnected = computed(
    () => (id: IntegrationSourceId) => boardConfig.value.sources?.connected.includes(id) ?? false,
  );

  /** The topic the board is focused on right now: null when there is none or it was set on an earlier day. */
  const { today } = useToday();
  const activeFocusTopic = computed<string | null>(() => {
    const current = focus.value;
    // `today` is reactive across midnight, so a window left open overnight drops the focus without a reload.
    return current && current.day === dayKey(today.value) ? current.topic : null;
  });

  // Actions
  function updateTaskPosition(taskId: string, newStatus: TaskStatus, oldStatus?: TaskStatus) {
    // `TaskStatus.Open` is 0: test for undefined, not truthiness, or Offen is never cleaned up
    if (oldStatus !== undefined) {
      const oldColumn = columns.value.find(c => c.taskStatus === oldStatus);
      if (oldColumn) {
        oldColumn.taskOrder = oldColumn.taskOrder.filter(id => id !== taskId);
        if (oldColumn.taskPositions) {
          mapHelpers.delete(oldColumn.taskPositions, taskId);
        }
      }
    }

    const newColumn = columns.value.find(c => c.taskStatus === newStatus);
    if (newColumn && !newColumn.taskOrder.includes(taskId)) {
      newColumn.taskOrder.push(taskId);
    }
  }

  /**
   * Moves a task between columns and places it at a specific index of the
   * destination column's manual order (used by undo to restore a card's
   * previous position). `index: null` appends, like `updateTaskPosition`.
   */
  function moveTaskToIndex(taskId: string, newStatus: TaskStatus, oldStatus: TaskStatus, index: number | null) {
    updateTaskPosition(taskId, newStatus, oldStatus);
    if (index === null) return;
    const column = columns.value.find(c => c.taskStatus === newStatus);
    if (!column) return;
    if (column.sorting && column.sorting.field !== 'manual') return; // sort decides the position
    const rest = column.taskOrder.filter(id => id !== taskId);
    rest.splice(Math.max(0, Math.min(index, rest.length)), 0, taskId);
    column.taskOrder = rest;
  }

  function setBoardConfig(config: IBoardConfig) {
    boardConfig.value = config;
  }

  function setColumnSorting(taskStatus: TaskStatus, field: SortField, direction: SortDirection) {
    const columnIndex = columns.value.findIndex((el) => el.taskStatus === taskStatus);
    if (columnIndex !== -1) {
      const column = columns.value[columnIndex];
      // Replace the column object to ensure reactivity triggers
      columns.value[columnIndex] = {
        ...column!,
        sorting: { field, direction },
      };
    }
  }

  function saveTaskOrder(payload: IUpdateTaskOrderPayload) {
    const column = columns.value.find((el) => el.taskStatus === payload.taskStatus);
    if (column) {
      column.taskOrder = payload.taskOrder;
      
      // If manually reordering, switch to manual sorting mode
      // Exception: if it's already manual, no change needed
      if (column.sorting && column.sorting.field !== 'manual') {
        column.sorting = { field: 'manual', direction: 'asc' };
      }
    }
  }

  /** Sets the connected integrations and the default source; `null` resets to "never onboarded". */
  function setSources(sources: TaskSourcesConfig | null) {
    // Any change of sources ends a pending switch; `markSourceSwitchPending` sets it again afterwards
    const { pendingSourceSwitch: _ended, ...rest } = boardConfig.value;
    boardConfig.value = { ...rest, sources };
  }

  /**
   * Flags that the board switched to an integration whose tasks have not arrived yet: the first non-empty
   * fetch replaces the other sources' tasks and clears the flag. Persisted, so a failed or empty fetch
   * (or a restart) does not turn the switch into a mixed board on a later refresh.
   */
  function markSourceSwitchPending() {
    boardConfig.value = { ...boardConfig.value, pendingSourceSwitch: true };
  }

  function clearSourceSwitchPending() {
    const { pendingSourceSwitch: _done, ...rest } = boardConfig.value;
    boardConfig.value = rest;
  }

  /**
   * Adds an integration to the connected sources (#320). Only adds: the default stays, and a pending
   * source switch stays pending (a connect is not a switch, ADR 015). A board that never onboarded has no
   * sources to add to (the welcome flow picks the first one), and an already connected source is a no-op.
   * @returns whether the source was added
   */
  function connectIntegration(id: IntegrationSourceId): boolean {
    const sources = boardConfig.value.sources;
    if (!sources || sources.connected.includes(id)) return false;
    boardConfig.value = { ...boardConfig.value, sources: { ...sources, connected: [...sources.connected, id] } };
    return true;
  }

  /**
   * Removes an integration from the connected sources (#320). Local is not an integration and cannot be
   * removed. A default that pointed at it falls back to Local; a pending source switch survives only while
   * the default is still an integration (it was waiting for that source's first fetch, which will not come).
   * @returns whether the source was removed
   */
  function disconnectIntegration(id: IntegrationSourceId): boolean {
    const sources = boardConfig.value.sources;
    if (!sources || !sources.connected.includes(id)) return false;
    const next: TaskSourcesConfig = {
      connected: sources.connected.filter((connected) => connected !== id),
      default: sources.default === id ? 'local' : sources.default,
    };
    const { pendingSourceSwitch, ...rest } = boardConfig.value;
    const keepSwitch = pendingSourceSwitch === true && next.default !== 'local';
    boardConfig.value = { ...rest, sources: next, ...(keepSwitch ? { pendingSourceSwitch: true } : {}) };
    return true;
  }

  /**
   * Makes a connected source the default for new tasks (#324). Local is always allowed; an integration only
   * while it is connected. A pending source switch survives only next to an integration default (as in
   * `disconnectIntegration`).
   * @returns whether the default changed
   */
  function setDefaultSource(id: SourceId): boolean {
    const sources = boardConfig.value.sources;
    if (!sources || sources.default === id) return false;
    if (id !== 'local' && !sources.connected.includes(id)) return false;
    const { pendingSourceSwitch, ...rest } = boardConfig.value;
    const keepSwitch = pendingSourceSwitch === true && id !== 'local';
    boardConfig.value = { ...rest, sources: { ...sources, default: id }, ...(keepSwitch ? { pendingSourceSwitch: true } : {}) };
    return true;
  }

  /**
   * The one-source flows (welcome, Notion setup, Todoist OAuth) set exactly one source as connected
   * and default; `null` resets to "never onboarded". Several sources: `connectIntegration` / `disconnectIntegration`.
   */
  function setSingleSource(source: SourceId | null) {
    setSources(source === null ? null : singleSource(source));
  }

  function setTodoistApiToken(token: string) {
    boardConfig.value.todoistApiToken = token;
  }

  function clearTodoistApiToken() {
    const { todoistApiToken: _token, ...rest } = boardConfig.value;
    boardConfig.value = rest;
  }

  function setGroupingEnabled(enabled: boolean) {
    grouping.value.enabled = enabled;
  }

  function setGroupingKey(key: GroupKey | null) {
    grouping.value.key = key;
  }

  /** Focuses the board on one topic for today (#161). */
  function setFocus(topic: string) {
    focus.value = { topic, day: dayKey(new Date()) };
  }

  function clearFocus() {
    focus.value = null;
  }

  /** A topic rename or merge (`useTopicManagement`) carries an active focus on `from` over to `to`. */
  function renameFocusTopic(from: string, to: string) {
    if (focus.value?.topic === from) focus.value = { ...focus.value, topic: to };
  }

  function saveScrollPosition(pos: { top: number; left: number }) {
    scrollPosition.value = pos;
  }

  /**
   * Flags `taskId` for the in-card done confirmation; it clears itself when the layer ends. `fasterThanPlan` (#295)
   * swaps the check for the message and lengthens the layer to `FASTER_CONFIRMATION_MS`.
   */
  function startConfirmation(taskId: string, fasterThanPlan = false) {
    const running = mapHelpers.get(confirmationTimers, taskId);
    if (running !== undefined) window.clearTimeout(running);
    if (!confirmingTaskIds.value.includes(taskId)) {
      confirmingTaskIds.value = [...confirmingTaskIds.value, taskId];
    }
    const isFaster = fasterThanPlanTaskIds.value.includes(taskId);
    if (fasterThanPlan && !isFaster) fasterThanPlanTaskIds.value = [...fasterThanPlanTaskIds.value, taskId];
    if (!fasterThanPlan && isFaster) fasterThanPlanTaskIds.value = fasterThanPlanTaskIds.value.filter(id => id !== taskId);
    const durationMs = fasterThanPlan ? FASTER_CONFIRMATION_MS : DONE_CONFIRMATION_MS;
    mapHelpers.set(confirmationTimers, taskId, window.setTimeout(() => clearConfirmation(taskId), durationMs));
  }

  /** Ends the confirmation for `taskId` early (e.g. undo). No-op when it is not playing. */
  function clearConfirmation(taskId: string) {
    const running = mapHelpers.get(confirmationTimers, taskId);
    if (running !== undefined) window.clearTimeout(running);
    mapHelpers.delete(confirmationTimers, taskId);
    if (confirmingTaskIds.value.includes(taskId)) {
      confirmingTaskIds.value = confirmingTaskIds.value.filter(id => id !== taskId);
    }
    if (fasterThanPlanTaskIds.value.includes(taskId)) {
      fasterThanPlanTaskIds.value = fasterThanPlanTaskIds.value.filter(id => id !== taskId);
    }
  }

  /**
   * Asks for a timebox on `taskId` (#389), replacing any other nudge. Only for an existing Jetzt card
   * without a timebox; called by the user-driven moves into Jetzt, never by undo, sync or hydration.
   * @returns whether the nudge started
   */
  function startTimeboxNudge(taskId: string): boolean {
    const task = useTasksStore().task(taskId);
    if (!task || task.status !== TaskStatus.Progress || task.timeBoxSeconds) return false;
    timeboxNudgeTaskId.value = taskId;
    return true;
  }

  /** Ends the nudge: for `taskId` only when given (a stale card must not end another card's nudge), else any. */
  function endTimeboxNudge(taskId?: string) {
    if (taskId !== undefined && timeboxNudgeTaskId.value !== taskId) return;
    timeboxNudgeTaskId.value = null;
  }

  /**
   * Rebuild task positions from taskOrder array
   * Useful for migrating from old array-based ordering
   */
  function rebuildTaskPositions() {
    columns.value.forEach(column => {
      if (!column.taskPositions) {
        column.taskPositions = {};
      }
      column.taskOrder.forEach((taskId, index) => {
        column.taskPositions![taskId] = index * POSITION_GAP;
      });
    });
    
    if (import.meta.dev) {
      console.log('Rebuilt task positions for all columns');
    }
  }

  /**
   * Set task position explicitly (for drag-drop)
   */
  function setTaskPosition(taskStatus: TaskStatus, taskId: string, position: number) {
    const column = columns.value.find(c => c.taskStatus === taskStatus);
    if (!column) return;
    
    if (!column.taskPositions) {
      column.taskPositions = {};
    }
    
    column.taskPositions[taskId] = position; // Simple Record assignment
    
    // Switch to manual sorting if not already
    if (column.sorting && column.sorting.field !== 'manual') {
      column.sorting = { field: 'manual', direction: 'asc' };
    }

    // Also update taskOrder for backward compatibility
    if (!column.taskOrder.includes(taskId)) {
      column.taskOrder.push(taskId);
    }
    
    // Check if rebalancing is needed
    if (needsRebalancing(column.taskPositions)) {
      rebalanceColumnPositions(taskStatus);
    }
  }

  /**
   * Insert task between two positions
   */
  function insertTaskBetween(
    taskStatus: TaskStatus,
    taskId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) {
    const column = columns.value.find(c => c.taskStatus === taskStatus);
    if (!column) return;
    
    if (!column.taskPositions) {
      column.taskPositions = {};
    }
    
    const beforePos = beforeTaskId ? column.taskPositions[beforeTaskId] ?? null : null;
    const afterPos = afterTaskId ? column.taskPositions[afterTaskId] ?? null : null;
    
    const newPosition = getPositionBetween(beforePos, afterPos);
    column.taskPositions[taskId] = newPosition;
    
    // Switch to manual sorting if not already
    if (column.sorting && column.sorting.field !== 'manual') {
      column.sorting = { field: 'manual', direction: 'asc' };
    }
    
    // Update taskOrder for backward compatibility
    if (!column.taskOrder.includes(taskId)) {
      column.taskOrder.push(taskId);
    }
    
    // Check if rebalancing is needed
    if (needsRebalancing(column.taskPositions)) {
      rebalanceColumnPositions(taskStatus);
    }
  }

  /**
   * Rebalance positions in a column to restore gaps
   */
  function rebalanceColumnPositions(taskStatus: TaskStatus) {
    const column = columns.value.find(c => c.taskStatus === taskStatus);
    if (!column || !column.taskPositions) return;
    
    // Get sorted task IDs by current position
    const sortedTaskIds = Object.entries(column.taskPositions)
      .sort(([, posA], [, posB]) => posA - posB)
      .map(([taskId]) => taskId);
    
    // Rebuild with proper gaps
    column.taskPositions = rebalancePositions(sortedTaskIds);
    
    if (import.meta.dev) {
      console.log(`Rebalanced positions for column: ${taskStatus}`);
    }
  }

  function reconcileColumnsWithTasks(tasks: Task[]): boolean {
    const taskIdsByStatus = new Map<TaskStatus, string[]>();

    tasks.forEach((task) => {
      const existing = taskIdsByStatus.get(task.status) ?? [];
      existing.push(task.id);
      taskIdsByStatus.set(task.status, existing);
    });

    let hasChanges = false;

    columns.value = columns.value.map((column) => {
      const validTaskIds = taskIdsByStatus.get(column.taskStatus) ?? [];
      const validTaskIdSet = new Set(validTaskIds);
      const dedupedTaskOrder: string[] = [];

      column.taskOrder.forEach((taskId) => {
        if (!validTaskIdSet.has(taskId) || dedupedTaskOrder.includes(taskId)) {
          hasChanges = true;
          return;
        }

        dedupedTaskOrder.push(taskId);
      });

      validTaskIds.forEach((taskId) => {
        if (!dedupedTaskOrder.includes(taskId)) {
          dedupedTaskOrder.push(taskId);
          hasChanges = true;
        }
      });

      const nextTaskPositions = Object.fromEntries(
        Object.entries(column.taskPositions ?? {}).filter(([taskId]) => validTaskIdSet.has(taskId))
      );

      if (Object.keys(nextTaskPositions).length !== Object.keys(column.taskPositions ?? {}).length) {
        hasChanges = true;
      }

      if (
        dedupedTaskOrder.length === column.taskOrder.length
        && dedupedTaskOrder.every((taskId, index) => taskId === column.taskOrder[index])
        && Object.keys(nextTaskPositions).length === Object.keys(column.taskPositions ?? {}).length
      ) {
        return column;
      }

      return {
        ...column,
        taskOrder: dedupedTaskOrder,
        taskPositions: nextTaskPositions,
      };
    });

    return hasChanges;
  }

  return {
    // State
    boardConfig,
    columns,
    grouping,
    focus,
    activeFocusTopic,
    setFocus,
    clearFocus,
    renameFocusTopic,
    scrollPosition,
    confirmingTaskIds,
    fasterThanPlanTaskIds,
    doneLeaving,
    timeboxNudgeTaskId,
    
    // Getters
    columnByTaskStatus,
    defaultSource,
    isOnboarded,
    isSourceSwitchPending,
    connectedIntegrations,
    isIntegrationConnected,
    
    // Actions
    updateTaskPosition,
    moveTaskToIndex,
    setBoardConfig,
    saveTaskOrder,
    setColumnSorting,
    setSources,
    markSourceSwitchPending,
    clearSourceSwitchPending,
    setSingleSource,
    setDefaultSource,
    connectIntegration,
    disconnectIntegration,
    setTodoistApiToken,
    clearTodoistApiToken,
    setGroupingEnabled,
    setGroupingKey,
    saveScrollPosition,
    startConfirmation,
    clearConfirmation,
    startTimeboxNudge,
    endTimeboxNudge,
    rebuildTaskPositions,
    setTaskPosition,
    insertTaskBetween,
    rebalanceColumnPositions,
    reconcileColumnsWithTasks,
  };
}, {
  persist: {
    key: 'board-store',
    pick: ['boardConfig', 'columns', 'grouping', 'focus'],
    // The Todoist token lives in the Keychain on desktop (ADR 007).
    omit: persistOmitFor('board-store'),
    afterHydrate: (ctx: { store: { boardConfig: IBoardConfig; focus: unknown; $persist: () => void } }) => {
      // The focus (#161) of older data is missing; a malformed one reads as none. In memory only: the next
      // mutation persists it (hydration must not write by itself, below). An earlier day's focus stays until then
      // and `activeFocusTopic` ignores it.
      ctx.store.focus = sanitizeFocus(ctx.store.focus);
      const hydrated = ctx.store.boardConfig;
      const sanitised = sanitizeBoardConfig(hydrated);
      ctx.store.boardConfig = sanitised;
      // typeof check (not import.meta.client) so the hook also runs under Vitest/jsdom.
      if (typeof localStorage === 'undefined') return;
      try {
        // Legacy Linear credentials: the integration was removed, drop the stored key.
        localStorage.removeItem('linearConfig');
      } catch {
        // Storage unavailable - nothing to purge.
      }
      // Hydration must not write on its own (an empty mirror would send defaults, ADR 011): write back
      // only when sanitising changed the stored blob. $subscribe is registered after this hook, so the
      // write-back has to be an explicit $persist().
      if (stableJson(hydrated) === stableJson(sanitised)) return;
      try {
        ctx.store.$persist();
      } catch {
        // Storage unavailable - sanitised value is persisted on the next mutation instead.
      }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useBoardStore, import.meta.hot));
}
