import { TaskStatus } from "~/types/taskStatus";
import type { Task } from "@/types/task";
import { useTaskSources } from '~/composables/useTaskSources';
import { SourceNotConfiguredError } from '~/integrations/sources/types';
import { useTasksStore } from "~/store/tasks";
import { useIntegrationHealthStore } from "~/store/integrationHealth";
import { useTaskStatisticsStore } from "~/store/taskStatistics";
import { useErrorHandler } from '~/composables/useErrorHandler';
import { isNetworkError } from '~/lib/errorMessages';
import { mapHelpers } from '~/utils/mapHelpers';
import type { PendingTaskDelete } from '~/store/tasks';
import { isIntegrationSourceId, sourceSyncsTime } from '~/lib/taskSources';
import { classifySyncFailure, createFailureKind, pushFailureScope } from '~/lib/integrationHealth';
import { useBoardStore } from '~/store/board';
import type { SourceId } from '~/types/taskSource';
import { notifyTaskMoveRejected } from '~/lib/taskMoveEvents';
import { useTrashStore } from '~/store/trash';
import type { TrashEntry } from '~/types/trash';
import { completedAtForDay } from '~/lib/doneDay';

/** Where a source's setup problems are reported (the context picks the localized message). */
const setupContextOf = (source: SourceId) => (source === 'todoist' ? 'todoist_setup' : 'notion_setup') as 'todoist_setup' | 'notion_setup';

/** Outcome of committing a pending delete upstream (#99). */
export type DeleteCommitResult = 'committed' | 'queued' | 'restored' | 'skipped';

/** How a commit of a pending move ended (#322). */
export type MoveCommitResult = 'committed' | 'queued' | 'reverted' | 'skipped';

/** Pending deletes whose upstream call is in flight (one per task, across composable instances). */
const deletesInFlight = new Set<string>();

/** Pending moves whose upstream calls are in flight (one per task, across composable instances). */
const movesInFlight = new Set<string>();

/**
 * Upstream status writes in flight, one chain per task, shared by every composable instance of a
 * Pinia app (keyed by its tasks store). A write waits for the previous one of the same task, so an
 * undo can never reach upstream before the completion it reverts (#150: a stack's writes are queued
 * for seconds).
 */
const statusWritesByStore = new WeakMap<object, Map<string, StatusWrite>>();

/**
 * Upstream pushes (`runSync`) in flight, one chain per task, per Pinia app. A push waits for the one before
 * it and sends the task as it is by then, so two overlapping triggers (the periodic retry and a refresh, a
 * reconnect and a manual sync) never create an offline-made task twice: the second sees its id and updates.
 */
const pushesByStore = new WeakMap<object, Map<string, Promise<boolean>>>();

/**
 * One queued or running status write. `upstream` is the status the task's source holds once the
 * write has run (what it sent, or what it held before when the write sent nothing or failed); the
 * next write of the task derives "was it Done upstream?" from it, not from the local status.
 */
interface StatusWrite {
  promise: Promise<void>;
  upstream: TaskStatus | undefined;
}

/**
 * Network failures queue the delete instead of restoring the task. NotionClientAPI wraps fetch
 * failures and timeouts as NotionAPIError with statusCode 0 ("Network error"), which the generic
 * message matcher does not recognise.
 */
const isDeleteNetworkFailure = (error: unknown): boolean =>
  isNetworkError(error) || (error as { statusCode?: number } | null)?.statusCode === 0;

/** "Not found" upstream means the task is already gone: the delete has reached its goal. */
const isAlreadyGone = (error: unknown): boolean => {
  const status = (error as { statusCode?: number; httpStatusCode?: number } | null);
  return status?.statusCode === 404 || status?.httpStatusCode === 404;
};

/**
 * Composable for handling task synchronization with external integrations
 */
export interface IUpdateStatusPayload {
  taskId: string;
  status: TaskStatus;
  operationVersion?: number;
  skipLocalUpdate?: boolean;
  /** The local change applies at once; the upstream write waits until this has settled (#150) */
  after?: Promise<unknown>;
}

export const useTaskSync = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const tasksStore = useTasksStore();
  const { adapterFor } = useTaskSources();
  const statisticsStore = useTaskStatisticsStore();
  const { handleError } = useErrorHandler();
  const health = useIntegrationHealthStore();
  const boardStore = useBoardStore();
  const statusWritesInFlight = statusWritesByStore.get(tasksStore) ?? new Map<string, StatusWrite>();
  statusWritesByStore.set(tasksStore, statusWritesInFlight);
  const pushesInFlight = pushesByStore.get(tasksStore) ?? new Map<string, Promise<boolean>>();
  pushesByStore.set(tasksStore, pushesInFlight);

  /**
   * Updates a task's status and syncs with the appropriate integration
   */
  const updateTaskStatus = async (payload: IUpdateStatusPayload): Promise<void> => {
    const taskToUpdate = tasksStore.task(payload.taskId);
    if (!taskToUpdate) {
      handleError(`Task with id ${payload.taskId} not found`, 'task_sync');
      return;
    }

    const previousState = taskToUpdate.status;
    // Every status write bumps the version, so the response of an older write of this task counts
    // as stale and cannot flip a newer status back (#150). Callers that bumped it pass theirs.
    const operationVersion = payload.operationVersion ?? tasksStore.incrementTaskOperationVersion(payload.taskId);

    // Skip local update if requested (e.g., for batch operations)
    if (!payload.skipLocalUpdate) {
      // Prepare updates object
      const updates: Partial<Task> = {
        status: payload.status,
        title: taskToUpdate.title || "",
      };

      // Track completion timestamp when moved to Done
      if (payload.status === TaskStatus.Done && previousState !== TaskStatus.Done) {
        updates.completedAt = new Date();
        if (import.meta.dev) {
          console.log(`Task ${payload.taskId} marked done at ${updates.completedAt.toISOString()}`);
        }
      }

      // Clear completion timestamp if moved out of Done
      if (payload.status !== TaskStatus.Done && previousState === TaskStatus.Done) {
        updates.completedAt = null;
        if (import.meta.dev) {
          console.log(`Task ${payload.taskId} moved out of done, cleared completedAt`);
        }
      }

      // Update task in store using proper action
      tasksStore.updateTask(payload.taskId, updates);
    }

    // The source does not hold the new status yet: the task carries the marker until a write went through,
    // also while this write waits for an earlier one (#319). The marker notes whether the source holds the task
    // as completed (the status before this change), so a replay after a restart can still reopen it (#344).
    tasksStore.markPendingSync(payload.taskId, previousState === TaskStatus.Done);

    // Get updated task for sync and statistics
    const updatedTask: Task = tasksStore.task(payload.taskId)!;

    // Handle statistics recording/updating/removal based on status changes
    const isArchived = tasksStore.archivedTaskIds.includes(payload.taskId);
    
    if (!isArchived) {
      // Only update statistics for non-archived tasks
      if (payload.status === TaskStatus.Done && previousState !== TaskStatus.Done) {
        // Task moved TO Done: record completion
        try {
          statisticsStore.recordTaskCompletion(updatedTask);
        } catch (error) {
          console.warn('Failed to record task completion statistics:', error);
        }
      } else if (payload.status !== TaskStatus.Done && previousState === TaskStatus.Done) {
        // Task moved OUT of Done: remove from statistics
        try {
          statisticsStore.removeTaskRecord(payload.taskId);
          if (import.meta.dev) {
            console.log(`Removed task ${payload.taskId} from statistics (moved out of Done)`);
          }
        } catch (error) {
          console.warn('Failed to remove task from statistics:', error);
        }
      } else if (payload.status === TaskStatus.Done && previousState === TaskStatus.Done) {
        // Task still in Done but status changed (e.g., dragged within Done column): update record
        try {
          statisticsStore.updateTaskRecord(updatedTask);
          if (import.meta.dev) {
            console.log(`Updated statistics for task ${payload.taskId} (still in Done)`);
          }
        } catch (error) {
          console.warn('Failed to update task statistics:', error);
        }
      }
    }

    // Sync with external integration (pass operation version to prevent stale updates). The write
    // waits for `after` and for an earlier write of the same task, then sends the task as it is by
    // then: a snapshot taken before the wait would overwrite edits made meanwhile, and a status that
    // was changed again (an undone completion) is sent as that newer status.
    // Pin the new status against refresh merges until its write is done. A new token supersedes an
    // older pin (an earlier stack drop or undo), so a merge cannot revert to the old status.
    const lock = tasksStore.lockTaskStatus(payload.taskId);
    const earlier = statusWritesInFlight.get(payload.taskId);
    const waitFor = [payload.after, earlier?.promise].filter((p) => p !== undefined);
    const entry: StatusWrite = { promise: Promise.resolve(), upstream: undefined };
    entry.promise = (async () => {
      if (waitFor.length > 0) await Promise.allSettled(waitFor);
      // What the source holds now: after the earlier write of this task, else the status before this move
      const upstreamBefore = earlier ? earlier.upstream ?? previousState : previousState;
      entry.upstream = upstreamBefore;
      const current = tasksStore.task(payload.taskId);
      if (!current) return;
      const sentStatus = current.status; // `current` is live: read before the await
      const synced = await runSync(current, upstreamBefore, operationVersion);
      if (synced) entry.upstream = sentStatus;
    })();
    statusWritesInFlight.set(payload.taskId, entry);
    try {
      await entry.promise;
    } finally {
      if (statusWritesInFlight.get(payload.taskId) === entry) statusWritesInFlight.delete(payload.taskId);
      tasksStore.unlockTaskStatus(payload.taskId, lock);
    }
  };

  /**
   * Sets the done day of a done task (kd#131: it was marked done a day or more late). `day` is a local
   * `YYYY-MM-DD`; the limits and the stored time of day are `lib/doneDay` (not in the future, not before the
   * task was created, the completion's own time of day kept). The task, its completion record and so every
   * reader (statistics, done today / before today, the yesterday note, the recap, the Erledigt order) move at
   * once; time spent and work sessions stay as recorded. The task is then pushed like any edit: a source that
   * stores a completion date receives it through its adapter, and the `completedAtCorrected` marker keeps the
   * day locally over whatever a source returns.
   * @returns the stored completion time, or null when nothing changed (unknown or not done task, a day outside the limits)
   */
  const setCompletedDay = (taskId: string, day: string, now: Date = new Date()): Date | null => {
    const task = tasksStore.task(taskId);
    if (!task || task.status !== TaskStatus.Done) return null;
    const completedAt = completedAtForDay(task, day, now);
    if (!completedAt) return null;

    const operationVersion = tasksStore.incrementTaskOperationVersion(taskId);
    if (!tasksStore.setCompletedAt(taskId, completedAt)) return null;
    const updated = tasksStore.task(taskId)!;
    // An existing record moves, archived or not; a done task without one gets it by the backfill rules
    if (!statisticsStore.setCompletionDate(taskId, completedAt)) {
      statisticsStore.syncExistingDoneTasks([updated], tasksStore.archivedTaskIds);
    }
    void runSync(updated, undefined, operationVersion);
    return completedAt;
  };

  /**
   * Moves several tasks to `status` (a whole stack dropped in a column, #150). Every task changes
   * locally at once, synchronously, so the board settles in one render; the upstream writes then run
   * one after another (Notion rate limits), and one failing write does not stop the others (it goes
   * through the per-task error path). Unknown ids are skipped.
   */
  const updateTaskStatuses = async (taskIds: readonly string[], status: TaskStatus): Promise<void> => {
    let previous: Promise<void> = Promise.resolve();
    const writes: Array<Promise<void>> = [];
    for (const taskId of taskIds) {
      if (!tasksStore.task(taskId)) continue;
      // updateTaskStatus pins the status against merges until its own write is done
      previous = updateTaskStatus({ taskId, status, after: previous });
      writes.push(previous);
    }
    // Every write has finished before this resolves; a failure that escaped one of them (the
    // per-task error path handles the usual ones) is rethrown for the caller to report
    const failed = (await Promise.allSettled(writes)).find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  };

  /**
   * Creates a task in `source` and puts it on the board (#321): the add form's only way to make a task.
   * Local gets a generated `local_…` id and no `externalId`; an integration creates it through its adapter and
   * the task keeps the id the integration returns. When the source needs attention or the browser is offline
   * the adapter is not called: the task is made here with a generated `id`, no `externalId` and the
   * `pendingSync` marker, and the next push creates it upstream (`pushTask`), which gives it its `externalId`
   * and never changes the `id`. A create that fails for transient reasons (no connection, a rejected token, 403,
   * a 5xx; `createFailureKind`) takes the same path, by the push rules (`reportPushFailure`): a source fault (no
   * connection, a missing setup, 401) is recorded in the source's health, anything else (403, 5xx) only in the
   * task's marker, and the first failure that is not plain offline is reported once. A rejected create (400, 409,
   * 404, any other 4xx: the source refuses this task) throws, the caller keeps the form open and reports it.
   * @returns the task as it was added to the store
   */
  const createTask = async (draft: Partial<Task>, source: SourceId): Promise<Task> => {
    let created: Task;
    let deferredReason: string | null = null;
    let deferredError: unknown = null;

    if (source === 'local') {
      created = await adapterFor('local').create(draft);
    } else if (health.needsAttention(source)) {
      deferredReason = health.healthOf(source).lastError ?? 'Source needs attention';
      created = { ...(await adapterFor('local').create(draft)), source };
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      deferredReason = 'Offline';
      created = { ...(await adapterFor('local').create(draft)), source };
    } else {
      try {
        created = await adapterFor(source).create(draft);
      } catch (error) {
        if (!isIntegrationSourceId(source) || createFailureKind(error) !== 'transient') throw error;
        deferredError = error;
        deferredReason = error instanceof Error ? error.message : String(error);
        created = { ...(await adapterFor('local').create(draft)), source };
      }
    }

    tasksStore.addTask(created);
    if (created.status !== undefined) boardStore.updateTaskPosition(created.id, created.status);
    if (deferredReason !== null) {
      tasksStore.markPendingSync(created.id);
      if (deferredError === null || !isIntegrationSourceId(source)) tasksStore.recordPendingSyncFailure(created.id, deferredReason);
      else if (classifySyncFailure(deferredError) === 'offline') {
        // Plain offline stays quiet: the cloud and the sync button show it
        tasksStore.recordPendingSyncFailure(created.id, deferredReason);
        health.recordFailure(source, deferredError);
      } else {
        // The form closes as on success, so a failure the user could not otherwise see is reported once
        // (the marker holds no failure yet, so this counts as the first); it records the marker's reason
        reportPushFailure(created, deferredError, 'task_create');
      }
    }
    return created;
  };

  /**
   * Syncs a task to the adapter of its own source
   * Local tasks have no upstream - they are already persisted via Pinia
   */
  const syncTaskToIntegration = async (task: Task, previousStatus?: TaskStatus, operationVersion?: number): Promise<void> => {
    await runSync(task, previousStatus, operationVersion);
  };

  /**
   * Same as `syncTaskToIntegration`; resolves to whether the source now holds the task: false when the
   * write failed or was not sent because the integration is not set up, true when it went through or the
   * task is Local. The task carries `pendingSync` from before the write until it succeeded (#319); a change
   * made while the write is in flight keeps the marker.
   */
  const runSync = async (task: Task, previousStatus?: TaskStatus, operationVersion?: number): Promise<boolean> => {
    // Local tasks: no external sync needed, they are persisted via Pinia
    if (task.source === "local") {
      return true;
    }

    // Inside its undo window a move creates nothing upstream (#322); the commit after the window sends the
    // task as it is by then, so the change that triggered this push is not lost
    if (tasksStore.isMoveHeld(task.id)) return false;

    // One push per task at a time: a later one waits and then sends the task as it is, with the id a
    // create that just finished gave it (updates are idempotent, creates are not)
    const earlier = pushesInFlight.get(task.id);
    const push = (async (): Promise<boolean> => {
      let target = task;
      if (earlier) {
        await earlier.catch(() => undefined);
        const live = tasksStore.task(task.id);
        // Deleted while the earlier push ran: nothing left to push
        if (!live) return true;
        target = live;
      }
      // A moved task whose page is not created yet is created by the move, which also removes the origin copy
      if (target.pendingMove && target.externalId === null) {
        tasksStore.markPendingSync(target.id);
        return (await commitTaskMove(target.id)) === 'committed';
      }
      return pushTask(target, previousStatus, operationVersion);
    })();
    pushesInFlight.set(task.id, push);
    try {
      return await push;
    } finally {
      if (pushesInFlight.get(task.id) === push) pushesInFlight.delete(task.id);
    }
  };

  /** `timeEdited` for a write that carries a total the user set (kd#4), even at 0; empty otherwise. */
  const timeEditFlag = (taskId: string): { timeEdited?: true } =>
    tasksStore.pendingTimeUpdates[taskId]?.absolute === true ? { timeEdited: true } : {};

  /** One write of a non-Local task; never rejects, a failure goes to `reportPushFailure`. */
  const pushTask = async (task: Task, previousStatus?: TaskStatus, operationVersion?: number): Promise<boolean> => {
    const revision = tasksStore.markPendingSync(task.id, previousStatus === undefined ? undefined : previousStatus === TaskStatus.Done);
    const queuedTime = mapHelpers.has(tasksStore.pendingTimeUpdates, task.id);
    if (queuedTime) tasksStore.markPendingUpdateSyncing(task.id);

    try {
      const adapter = adapterFor(task.source);
      if (task.externalId === null) {
        // Made while the source was unreachable: it creates the task now and gives it its id
        const created = await adapter.create(task);
        tasksStore.completeCreate(task.id, created, revision);
        applySyncedTask(task.id, created, operationVersion);
      } else {
        // What the source holds comes from the marker (it survives a restart), else from the caller (#344).
        // `Open` only stands for "not completed" here.
        const heldDone = tasksStore.task(task.id)?.pendingSync?.upstreamDone;
        const sentDone = task.status === TaskStatus.Done;
        const synced = await adapter.update(task, {
          previousStatus: heldDone === undefined ? previousStatus : heldDone ? TaskStatus.Done : TaskStatus.Open,
          // A total the user set (kd#4) is written even at 0; the entry lives until the push carried it
          ...timeEditFlag(task.id),
        });
        if (synced) applySyncedTask(task.id, synced, operationVersion);
        tasksStore.clearPendingSync(task.id, revision, sentDone);
      }
      restoreSourceAfterPush(task.source);
      return true;
    } catch (error) {
      if (queuedTime) tasksStore.markPendingUpdateFailed(task.id, error instanceof Error ? error.message : String(error));
      reportPushFailure(task, error, `Failed to sync task ${task.id} to ${task.source}`);
      return false;
    }
  };

  /** Whether an integration was taken off an onboarded board; a board without sources (tests, never onboarded) has none to miss. */
  const isDisconnected = (source: SourceId): boolean =>
    isIntegrationSourceId(source) && boardStore.boardConfig.sources !== null && !boardStore.isIntegrationConnected(source);

  /** A write went through, so the source is reachable again: a push-only recovery needs no fetch to show it (#319). */
  const restoreSourceAfterPush = (source: SourceId): void => {
    if (isDisconnected(source)) return;
    if (isIntegrationSourceId(source) && health.needsAttention(source)) health.markHealthy(source);
  };

  /**
   * A write failed: the task keeps its marker (with the reason). Only a failure that is the source's own (no
   * connection, not set up, a rejected token) is recorded in the source's health; a page the source refuses
   * (400, 403, 404, a 5xx on that request) stays the task's problem (#319). The user hears about it once: a
   * task whose marker already holds a failure is a retry and stays quiet, and so does a source that is already
   * known to be down, however often a refresh resets its health in between. No setup dialog opens by itself:
   * the sync button's popover offers the repair.
   */
  const reportPushFailure = (task: Task, error: unknown, syncContext: string): void => {
    // The source was disconnected while the push was in flight (#320): nobody is waiting for its health or a toast
    if (isDisconnected(task.source)) {
      console.error(`[TaskSync] ${syncContext} (source disconnected meanwhile):`, error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const retry = (tasksStore.task(task.id)?.pendingSync?.attempts ?? 0) > 0;
    tasksStore.recordPendingSyncFailure(task.id, message);
    if (!isIntegrationSourceId(task.source)) return;
    const sourceFault = pushFailureScope(error) === 'source';
    const alreadyKnown = retry || (sourceFault && health.needsAttention(task.source));
    if (!alreadyKnown) {
      if (error instanceof SourceNotConfiguredError) handleError(error.message, setupContextOf(error.source));
      else handleSyncError(error, syncContext, task.source);
    } else {
      console.error(`[TaskSync] ${syncContext}:`, error);
    }
    if (sourceFault) health.recordFailure(task.source, error);
  };

  /**
   * Merges what the source holds after a write (bidirectional sync: changes made directly in Notion,
   * e.g. adding tags, are preserved locally) unless a newer local write superseded this one.
   * `timerId` is preserved locally, never taken from the source.
   */
  const applySyncedTask = (taskId: string, synced: Task, operationVersion?: number): void => {
    const currentVersion = tasksStore.getTaskOperationVersion(taskId);
    if (operationVersion !== undefined && currentVersion !== operationVersion) {
      if (import.meta.dev) {
        console.log(`[TaskSync] Skipping stale update for task ${taskId}. Expected version ${operationVersion}, current is ${currentVersion}`);
      }
      return;
    }

    // A total the user set after this write started (kd#4) is not yet in the source: keep it over the echo
    const timeKept = tasksStore.pendingTimeUpdates[taskId]?.absolute === true;
    // A done day the user corrected (kd#131) stays while the source still holds the task as done: a source
    // without a completion date echoes "now"
    const live = tasksStore.task(taskId);
    const doneDayKept = live?.completedAtCorrected === true && live.status === TaskStatus.Done && synced.status === TaskStatus.Done;
    tasksStore.updateTask(taskId, {
      isUnplanned: synced.isUnplanned,
      ...(timeKept ? {} : { timeSpentSeconds: synced.timeSpentSeconds }),
      status: synced.status,
      priority: synced.priority,
      timeBoxSeconds: synced.timeBoxSeconds,
      topic: synced.topic,
      topicColorCode: synced.topicColorCode,
      activity: synced.activity,
      ...(doneDayKept ? {} : { completedAt: synced.completedAt }),
      custom: synced.custom,
    });

    if (import.meta.dev) {
      console.log('[TaskSync] Updated local task with synced values:', taskId);
    }
  };

  const syncArchiveStatusForTasks = async (taskIds: string[]): Promise<void> => {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return;
    }

    const idsBySource = new Map<SourceId, string[]>();
    for (const taskId of taskIds) {
      const source = tasksStore.task(taskId)?.source;
      if (!source || source === "local") continue;
      idsBySource.set(source, [...(idsBySource.get(source) ?? []), taskId]);
    }

    for (const [source, sourceTaskIds] of idsBySource) {
      const adapter = adapterFor(source);
      if (!adapter.archivesAsStatus()) {
        continue;
      }

      for (const taskId of sourceTaskIds) {
        const task = tasksStore.task(taskId);
        if (!task) {
          continue;
        }

        // Never created upstream (made while the source was unreachable): the push creates it first
        if (task.externalId === null) {
          const pushed = await runSync(task);
          if (!pushed && health.needsAttention(source)) break;
          continue;
        }

        // Get current operation version to track this sync
        const operationVersion = tasksStore.getTaskOperationVersion(taskId);
        const revision = tasksStore.markPendingSync(taskId);

        try {
          // update returns the synced task with the source's current state
          // The write drops the queued time entry, so it has to carry a user-set total (kd#4)
          const syncedTask = await adapter.update(task, timeEditFlag(taskId));
          tasksStore.clearPendingSync(taskId, revision);
          restoreSourceAfterPush(source);
          if (!syncedTask) continue;

          // Check if this response is stale before applying updates
          const currentVersion = tasksStore.getTaskOperationVersion(taskId);
          if (currentVersion !== operationVersion) {
            if (import.meta.dev) {
              console.log(`[TaskSync] Skipping stale archive sync update for task ${taskId}. Expected version ${operationVersion}, current is ${currentVersion}`);
            }
            continue;
          }

          // Update local store with synced values
          tasksStore.updateTask(taskId, {
            isUnplanned: syncedTask.isUnplanned,
            status: syncedTask.status,
            custom: syncedTask.custom,
          });
        } catch (error) {
          reportPushFailure(task, error, `Failed to sync archived task ${taskId}`);
          // A source that is down or not set up fails the same way for every other task
          if (pushFailureScope(error) === 'source') break;
        }
      }
    }
  };

  /**
   * Pushes every task that carries `pendingSync` to its source (#319), the successor of the time-only
   * `syncPendingTimeUpdates`: a status change, notes, a new task and tracked time all wait behind the same
   * marker, and the adapter sends the task as it is now. Runs on a timer, on reconnect, on a manual refresh,
   * when a timer stops and after a fetch of a recovered source (`only` limits it to one source). A task whose
   * write is already in flight is left to that write. Local tasks need no push: they are persisted via Pinia.
   */
  const syncPendingChanges = async (only?: SourceId): Promise<void> => {
    // Time queued for a source that stores none (Local, Todoist) has nothing to push: it only lingered
    // until the stale cleanup (#336). New ticks of such tasks are not queued at all.
    for (const taskId of Object.keys(tasksStore.pendingTimeUpdates)) {
      const owner = tasksStore.task(taskId);
      if (owner && !sourceSyncsTime(owner.source)) tasksStore.clearPendingTimeUpdate(taskId);
    }

    // Moves first: a moved task is created in its target before anything else is pushed for it
    await commitPendingMoves(only);

    const bySource = new Map<SourceId, Task[]>();
    for (const task of tasksStore.pendingSyncTasks) {
      if (task.source === "local" || (only && task.source !== only)) continue;
      if (statusWritesInFlight.has(task.id) || deletesInFlight.has(task.id) || pushesInFlight.has(task.id)) continue;
      bySource.set(task.source, [...(bySource.get(task.source) ?? []), task]);
    }

    for (const [source, sourceTasks] of bySource) {
      for (const task of sourceTasks) {
        const live = tasksStore.task(task.id);
        if (!live || !tasksStore.isSyncPending(live.id) || pushesInFlight.has(live.id)) continue;
        const pushed = await runSync(live);
        // A source that is down, rejects us or is failing fails the same way for every other task: try again
        // next time. A page the source refuses (the task's own failure) does not stop the others.
        if (!pushed && health.needsAttention(source)) break;
      }
    }

    // Clean up stale pending updates
    tasksStore.cleanupStalePendingUpdates();
  };

  /**
   * Sends a delete to the task's source through its adapter. Notion: archive the page (restorable in
   * Notion's trash). Todoist: delete the task (not recoverable). Local, or a task its source never got to create: nothing upstream. Throws on failure.
   */
  const deleteTaskUpstream = async (pending: PendingTaskDelete): Promise<void> => {
    // Made while its source was unreachable and never created there (#319): nothing upstream to remove
    if (pending.task.externalId !== null) {
      try {
        await adapterFor(pending.task.source).remove(pending.task);
      } catch (error) {
        if (!isAlreadyGone(error)) throw error;
      }
    }
    // Deleted while a move was outstanding (#322): the origin copy goes too, or the next fetch of the origin
    // would bring the task back
    const origin = originToRemove(pending.task);
    if (origin) {
      try {
        await adapterFor(origin.source).remove(origin);
      } catch (error) {
        if (!isAlreadyGone(error)) throw error;
      }
    }
  };

  /** The origin copy of a task with an outstanding move, as a task its adapter can remove; null when there is none. */
  const originToRemove = (task: Task): Task | null => {
    const move = task.pendingMove;
    if (!move || move.fromExternalId === null || move.fromSource === 'local' || isDisconnected(move.fromSource)) return null;
    return { ...task, source: move.fromSource, externalId: move.fromExternalId };
  };

  /**
   * Commits a pending delete after its undo window (#99). Offline or on a network error the delete
   * stays queued for the next reconnect or start; any other failure restores the task locally and
   * reports through useErrorHandler.
   */
  const commitTaskDelete = async (taskId: string): Promise<DeleteCommitResult> => {
    const pending = mapHelpers.get(tasksStore.pendingDeletes, taskId);
    if (!pending || deletesInFlight.has(taskId)) return 'skipped';

    const hasUpstream = pending.task.source !== 'local' || originToRemove(pending.task) !== null;
    if (hasUpstream && typeof navigator !== 'undefined' && navigator.onLine === false) {
      tasksStore.markPendingDeleteQueued(taskId);
      return 'queued';
    }

    deletesInFlight.add(taskId);
    try {
      await deleteTaskUpstream(pending);
    } catch (error) {
      if (!isAlreadyGone(error)) {
        if (isDeleteNetworkFailure(error)) {
          tasksStore.markPendingDeleteQueued(taskId);
          return 'queued';
        }
        tasksStore.removePendingDelete(taskId);
        tasksStore.undeleteTask(taskId, pending.task.externalId, pending.task.pendingMove?.fromExternalId);
        if (!tasksStore.task(taskId)) tasksStore.addTask(pending.task);
        tasksStore.restoreCarryOver(taskId, pending.carryOver);
        handleError(error instanceof Error ? error : String(error), 'task_delete');
        return 'restored';
      }
    } finally {
      deletesInFlight.delete(taskId);
    }

    tasksStore.removePendingDelete(taskId);
    return 'committed';
  };

  /**
   * Brings a trashed task back (#422, D5). Rejects on failure and then changes nothing: no half-restored task on
   * the board, the entry stays in the trash (the caller reports it).
   * - the delete has not reached the source yet (queued offline): the delete is cancelled, nothing is called;
   * - otherwise the source restores first (`adapter.restore`: Local re-adds, Notion un-archives the page or
   *   creates a new one, Todoist creates a new task), a source that is not connected or offline rejects;
   * - then, in one synchronous step: `undeleteTask`, add to the board, the restore guard (a fetch that started
   *   before does not drop the task), carry-over, and the trash entry goes.
   * A task from Jetzt returns to Offen (WIP limit), every other task to its old column, at its end.
   */
  const restoreTask = async (entry: TrashEntry): Promise<void> => {
    const trashStore = useTrashStore();
    const taskId = entry.taskId;
    if (deletesInFlight.has(taskId)) throw new Error('The delete is still being sent to the source, try again in a moment');

    const status = entry.fromStatus === TaskStatus.Progress ? TaskStatus.Open : entry.fromStatus;
    const base: Task = { ...entry.task, status, timerId: null };
    const queued = mapHelpers.get(tasksStore.pendingDeletes, taskId);

    let restored: Task;
    if (queued) {
      // The source still holds the task: cancelling the queued delete is the whole upstream part
      restored = base;
    } else if (base.source === 'local') {
      restored = await adapterFor('local').restore(base);
    } else {
      if (isDisconnected(base.source)) throw new Error(`${base.source} is not connected`);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Network error: you are offline');
      const { pendingSync: _sync, pendingMove: _move, ...clean } = base;
      restored = await adapterFor(base.source).restore(clean);
    }

    // One synchronous step from here: nothing may interleave between the guard release and the board
    tasksStore.removePendingDelete(taskId);
    tasksStore.undeleteTask(taskId, restored.externalId, entry.task.externalId);
    if (!tasksStore.task(taskId)) tasksStore.addTask({ ...restored, id: taskId, status, timerId: null });
    tasksStore.guardRestoredTask(taskId);
    // The column's order still names the task where it stood: take it out there, then it goes to the end
    boardStore.updateTaskPosition(taskId, status, entry.fromStatus);
    tasksStore.restoreCarryOver(taskId, entry.carryOver);
    trashStore.remove(taskId);
    // The time lives on the task again (#537)
    statisticsStore.removeDiscardedTime(taskId);
    // A cancelled queued delete leaves the source with the Jetzt status it held: tell it (a no-op write for Local)
    if (queued && status !== entry.task.status && restored.source !== 'local') {
      void updateTaskStatus({ taskId, status, skipLocalUpdate: true });
    }
  };

  /**
   * Commits a move after its undo window (#322, phase 2): creates the task in its target source with its
   * current state, then removes the origin copy. The order is the safety net: the origin is only touched after
   * the target holds the task. The task keeps its `id` throughout.
   * - target Local: no create, only the origin copy is removed;
   * - target offline or needing attention, or a transient failure (no connection, 401, 403, 5xx): the move
   *   stays local with its marker and failure reason, the next flush continues it ('queued', no toast);
   * - create rejected for good (400, 409, any other 4xx): the task goes back to its origin and nothing is
   *   deleted ('reverted'), `lib/taskMoveEvents` tells the toast;
   * - the origin copy cannot be removed after a successful create: the task lives in its target and
   *   `pendingMove` stays with the new `externalId`, the next flush retries the removal ('queued');
   * - the task is deleted meanwhile: the page that was just created is removed again.
   */
  const commitTaskMove = async (taskId: string): Promise<MoveCommitResult> => {
    const task = tasksStore.task(taskId);
    if (!task?.pendingMove || tasksStore.isMoveHeld(taskId) || movesInFlight.has(taskId)) return 'skipped';
    movesInFlight.add(taskId);
    try {
      if (task.source !== 'local' && task.externalId === null) {
        const created = await createMovedTask(task);
        if (created !== 'created') return created;
      }
      return await removeMoveOrigin(taskId);
    } finally {
      movesInFlight.delete(taskId);
    }
  };

  /** Step one of a move: the target creates the task. 'created' when its page exists and `externalId` is stored. */
  const createMovedTask = async (task: Task): Promise<'created' | MoveCommitResult> => {
    const target = task.source;
    const move = task.pendingMove!;
    const reason = health.needsAttention(target) ? health.healthOf(target).lastError ?? 'Source needs attention'
      : typeof navigator !== 'undefined' && navigator.onLine === false ? 'Offline'
      : null;
    if (reason !== null) {
      // Nothing is called: the move waits behind the marker. The reason shows on the card, once.
      if (tasksStore.task(task.id)?.pendingSync?.lastError == null) tasksStore.recordPendingSyncFailure(task.id, reason);
      return 'queued';
    }

    const revision = tasksStore.markPendingSync(task.id);
    const adapter = adapterFor(target);
    let created: Task;
    try {
      created = await adapter.create(task);
    } catch (error) {
      if (createFailureKind(error) === 'transient') {
        deferMove(task, error);
        return 'queued';
      }
      tasksStore.restoreMoveOrigin(task.id);
      notifyTaskMoveRejected({ taskId: task.id, title: task.title, fromSource: move.fromSource, toSource: target, error });
      return 'reverted';
    }
    const externalId = created.externalId ?? created.id;

    const live = tasksStore.task(task.id);
    if (!live) {
      // Deleted while the create was in flight: the page it made must not stay behind
      await adapter.remove({ ...task, externalId }).catch((error) => console.error('[TaskSync] Could not remove the page of a deleted moving task:', error));
      return 'skipped';
    }
    const dropped = tasksStore.completeMoveCreate(task.id, externalId);
    for (const id of dropped) {
      try { statisticsStore.removeTaskRecord(id); } catch (error) { console.warn('Failed to remove statistics of a duplicate:', error); }
    }
    restoreSourceAfterPush(target);

    // The create writes the title, status, priority, timebox, topic, activity, notes and custom values; time spent
    // and the completion date need a write of their own. A failure keeps the marker: the next flush sends it.
    const settled = tasksStore.task(task.id)!;
    if (settled.timeSpentSeconds > 0 || settled.completedAt) {
      try {
        await adapter.update(settled);
        tasksStore.clearPendingSync(task.id, revision);
      } catch (error) {
        tasksStore.recordPendingSyncFailure(task.id, error instanceof Error ? error.message : String(error));
        console.error('[TaskSync] Follow-up write of a moved task failed:', error);
      }
    } else {
      tasksStore.clearPendingSync(task.id, revision);
    }
    return 'created';
  };

  /** A create failed for a reason that may pass: the move stays local, the reason goes on the marker, no toast. */
  const deferMove = (task: Task, error: unknown): void => {
    tasksStore.recordPendingSyncFailure(task.id, error instanceof Error ? error.message : String(error));
    if (isIntegrationSourceId(task.source) && !isDisconnected(task.source) && pushFailureScope(error) === 'source') {
      health.recordFailure(task.source, error);
    }
    console.error(`[TaskSync] Move of task ${task.id} to ${task.source} is queued:`, error);
  };

  /** Step two of a move: the origin copy goes (Notion: archive, Todoist: delete, Local: nothing upstream). */
  const removeMoveOrigin = async (taskId: string): Promise<MoveCommitResult> => {
    const task = tasksStore.task(taskId);
    if (!task?.pendingMove) return 'skipped';
    const origin = originToRemove(task);
    if (origin) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'queued';
      try {
        await adapterFor(origin.source).remove(origin);
      } catch (error) {
        if (!isAlreadyGone(error)) {
          console.error(`[TaskSync] Could not remove the origin copy of task ${taskId} yet:`, error);
          return 'queued';
        }
      }
    }
    tasksStore.clearPendingMove(taskId);
    return 'committed';
  };

  /**
   * Continues every move that is not inside an undo window: moves left over from a closed app, creates that
   * waited for a recovered source and origin removals that failed. Called on start, on reconnect and by every flush
   * of `syncPendingChanges` (`only` limits it to moves into or out of one source).
   */
  const commitPendingMoves = async (only?: SourceId): Promise<void> => {
    for (const task of [...tasksStore.tasks]) {
      const move = task.pendingMove;
      if (!move || tasksStore.isMoveHeld(task.id) || movesInFlight.has(task.id)) continue;
      if (only && task.source !== only && move.fromSource !== only) continue;
      await commitTaskMove(task.id);
    }
  };

  /**
   * Standardized error handling for sync operations
   */
  const handleSyncError = (error: unknown, syncContext: string, source?: SourceId): void => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (source && source !== 'local') handleError(errorMessage, 'task_sync', { source });
    else handleError(errorMessage, 'task_sync');
    // Still log to console for debugging
    console.error(`[TaskSync] ${syncContext}:`, error);
  };

  return {
    createTask,
    updateTaskStatus,
    updateTaskStatuses,
    setCompletedDay,
    syncTaskToIntegration,
    syncPendingChanges,
    syncArchiveStatusForTasks,
    handleSyncError,
    deleteTaskUpstream,
    commitTaskDelete,
    restoreTask,
    commitTaskMove,
    commitPendingMoves,
  } as const;
};
