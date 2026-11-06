/**
 * @composable useSourceConnections
 * @description Connect and disconnect task sources (#320, epic #264 section 1). The one place that mutates
 * `boardConfig.sources`, the source's tasks and its credentials together; the settings page (#324) and the
 * disconnect dialog only call it.
 * @responsibility
 * - `connectSource`: adds an integration on top of the board (Local tasks stay, no prompt, no reorder, the
 *   default stays) and fetches that source alone. Never a source switch (ADR 015, `pendingSourceSwitch`).
 * - `disconnectPlan`: what a disconnect would take off the board and what it would discard (reactive).
 * - `disconnectSource`: stops the source's timers, optionally pushes its unsynced work first, resets the
 *   credentials (Keychain first, ADR 007) and only then takes the tasks off the board.
 * - Local is not an integration: there is no API to disconnect it. A broken or offline source is never
 *   disconnected by this module on its own.
 */
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { usePropertyOptionsStore } from '~/store/propertyOptions'
import { useErrorHandler } from '~/composables/useErrorHandler'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useSecrets } from '~/composables/useSecrets'
import { useTaskSources } from '~/composables/useTaskSources'
import { useTaskSync } from '~/composables/useTaskSync'
import { resumeTaskTimer, stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { mapHelpers } from '~/utils/mapHelpers'
import type { IntegrationSourceId } from '~/types/taskSource'

export type ConnectResult =
  | { ok: true; fetched: boolean }
  | { ok: false; reason: 'not-onboarded' | 'already-connected' | 'not-configured' | 'busy' }

export type DisconnectResult =
  | { ok: true; removedTaskCount: number }
  | { ok: false; reason: 'not-connected' | 'busy' | 'sync-incomplete' | 'credentials' }

/** What the disconnect dialog states (all counts are live while the dialog is open). */
export interface DisconnectPlan {
  source: IntegrationSourceId
  /** Tasks that leave the board (archived ones are not on it). */
  taskCount: number
  /** Tasks with changes the source does not hold, plus deletes that never reached it. */
  unsyncedCount: number
  /** The source is the default: new tasks fall back to Local. */
  isDefault: boolean
  /** The source can be reached now; when it cannot, "sync first" is not offered. */
  reachable: boolean
}

export interface DisconnectOptions {
  /** Push the unsynced work to the source before it is discarded ("Erst synchronisieren, dann trennen"). */
  syncFirst: boolean
}

/** Sources with a connect or disconnect running, per Pinia app (a double click must not run it twice). */
const busyByStore = new WeakMap<object, Set<IntegrationSourceId>>()

/** Pushes that were skipped because a push of the same task was in flight get one more pass. */
const SYNC_PASSES = 2

export const useSourceConnections = () => {
  const boardStore = useBoardStore()
  const tasksStore = useTasksStore()
  const health = useIntegrationHealthStore()
  const { adapterFor } = useTaskSources()
  const { fetchSource } = useIntegrationManager()
  const { syncPendingChanges, commitTaskDelete } = useTaskSync()
  const busy = busyByStore.get(tasksStore) ?? new Set<IntegrationSourceId>()
  busyByStore.set(tasksStore, busy)

  const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false

  /**
   * Adds the integration to the board. Existing tasks, their order and the default stay as they are; the
   * source's tasks join through the per-source merge, in the columns their status maps to. The connection
   * stays when the first fetch fails (the source then needs attention and the sync popover offers the repair).
   */
  const connectSource = async (source: IntegrationSourceId): Promise<ConnectResult> => {
    if (busy.has(source)) return { ok: false, reason: 'busy' }
    if (!boardStore.isOnboarded) return { ok: false, reason: 'not-onboarded' }
    if (boardStore.isIntegrationConnected(source)) return { ok: false, reason: 'already-connected' }
    if (!adapterFor(source).isConfigured()) return { ok: false, reason: 'not-configured' }

    busy.add(source)
    try {
      health.resetSource(source)
      boardStore.connectIntegration(source)
      await fetchSource(source)
      return { ok: true, fetched: !health.needsAttention(source) }
    } finally {
      busy.delete(source)
    }
  }

  /** Reactive: call it inside a `computed`. `null` when the source is not connected. */
  const disconnectPlan = (source: IntegrationSourceId): DisconnectPlan | null => {
    if (!boardStore.isIntegrationConnected(source)) return null
    const archived = new Set(tasksStore.archivedTaskIds)
    const unsynced = tasksStore.unsyncedOf(source)
    return {
      source,
      taskCount: tasksStore.tasks.filter((task) => task.source === source && !archived.has(task.id)).length,
      unsyncedCount: unsynced.taskIds.length + unsynced.pendingDeleteIds.length,
      isDefault: boardStore.defaultSource === source,
      reachable: !isOffline() && !health.needsAttention(source),
    }
  }

  /**
   * Stops the running timers of the source's tasks. Their tracked time is already queued tick by tick, so
   * from here on it counts as an unsynced change like any other, before anything is discarded.
   */
  const stopTimers = (source: IntegrationSourceId): void => {
    for (const task of tasksStore.tasks) {
      if (task.source === source) stopTaskTimer(task.id)
    }
  }

  /** Undoes `stopTimers` for the tasks still in Jetzt, when the disconnect ended with the source connected. */
  const resumeTimers = (source: IntegrationSourceId): void => {
    for (const task of tasksStore.tasks) {
      if (task.source === source) resumeTaskTimer(task.id)
    }
  }

  /** Pushes everything the source has not got: queued deletes first, then every task with a marker or queued time. */
  const pushUnsyncedWork = async (source: IntegrationSourceId): Promise<void> => {
    for (const taskId of tasksStore.unsyncedOf(source).pendingDeleteIds) {
      if (mapHelpers.has(tasksStore.pendingDeletes, taskId)) await commitTaskDelete(taskId)
    }
    for (let pass = 0; pass < SYNC_PASSES; pass++) {
      await syncPendingChanges(source)
      if (tasksStore.unsyncedOf(source).taskIds.length === 0) break
    }
  }

  /**
   * Resets the credentials of the source. The Keychain delete is awaited first: if it fails the connection
   * stays as it was (reported by `clearConfig` / here as `secrets_reset`), so the app never shows
   * "disconnected" while the token is still stored.
   */
  const clearCredentials = async (source: IntegrationSourceId): Promise<boolean> => {
    if (source === 'notion') return useNotionConfigStore().clearConfig()
    const secrets = useSecrets()
    if (secrets.available) {
      try {
        await secrets.remove('todoist-token')
      } catch (error) {
        useErrorHandler().handleError(error as Error, 'secrets_reset')
        return false
      }
    }
    boardStore.clearTodoistApiToken()
    return true
  }

  /**
   * Takes the integration off the board. Order: timers stop (their time becomes an unsynced change) ->
   * optional push of the unsynced work (any leftover keeps the source connected: nothing is discarded behind
   * the user's back) -> credentials reset (Keychain first) -> the tasks and everything keyed by them go and the
   * default falls back to Local. Fails closed: whatever fails before the last step leaves the source connected
   * with its tasks, and their Jetzt timers running again.
   */
  const disconnectSource = async (source: IntegrationSourceId, options: DisconnectOptions = { syncFirst: false }): Promise<DisconnectResult> => {
    if (busy.has(source)) return { ok: false, reason: 'busy' }
    if (!boardStore.isIntegrationConnected(source)) return { ok: false, reason: 'not-connected' }

    busy.add(source)
    try {
      stopTimers(source)

      if (options.syncFirst) {
        await pushUnsyncedWork(source)
        const left = tasksStore.unsyncedOf(source)
        if (left.taskIds.length > 0 || left.pendingDeleteIds.length > 0) return { ok: false, reason: 'sync-incomplete' }
      }

      if (!(await clearCredentials(source))) return { ok: false, reason: 'credentials' }

      const removed = tasksStore.disconnectSource(source)
      health.markUnconfigured(source)
      if (source === 'notion') {
        // The Notion schema's options and the topics of its tasks went with the source
        const options = usePropertyOptionsStore()
        options.clearAllOptions()
        options.extractOptionsFromTasks(tasksStore.tasks)
      }
      return { ok: true, removedTaskCount: removed.length }
    } finally {
      // Fail-closed (or thrown): the source and its Jetzt task stay, so the task keeps counting
      if (boardStore.isIntegrationConnected(source)) resumeTimers(source)
      busy.delete(source)
    }
  }

  return { connectSource, disconnectPlan, disconnectSource }
}
