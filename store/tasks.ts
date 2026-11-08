import { defineStore, acceptHMRUpdate  } from "pinia";
import { ref, computed, type Ref } from "vue";
import type { PendingSync, Task } from "@/types/task";
import { TaskStatus } from "~/types/taskStatus";
import { useBoardStore } from "./board";
import { useToday } from "~/composables/useToday";
import { usePropertyOptionsStore } from "./propertyOptions";
import type { PendingTimeUpdate } from "@/types/pendingTimeUpdate";
import { createPendingTimeUpdate, shouldCleanupPendingUpdate } from "@/types/pendingTimeUpdate";
import type { CustomPropertyIndex } from "~/types/customPropertyIndex";
import { extractValueKey, createCustomPropertyIndex } from "~/types/customPropertyIndex";
import type { SortField, SortDirection } from "~/types/state";
import { mapHelpers, setHelpers } from "~/utils/mapHelpers";
import type { CarryOverEntry } from "~/utils/carryOver";
import { advanceCarryOverEntry, createCarryOverEntry } from "~/utils/carryOver";
import { isKnownSource } from "~/utils/sourceMeta";
import type { IntegrationSourceId, SourceId } from "~/types/taskSource";
import { disarmTaskTimer } from "~/lib/taskTimers";
import { generateTaskId, legacyTaskSource, normalizePendingDeletes, normalizeTasks, sourceSyncsTime } from "~/lib/taskSources";
import { normalizePriority } from "~/lib/priority";
import { renameField, type NameKind } from "~/lib/topicNames";
import { reviveDate, revivePendingDeletes, revivePendingTimeUpdates, reviveTaskDates } from "~/lib/taskDates";

/** How long a restored task survives a fetch that does not contain it (#422, D5). */
export const RESTORE_GUARD_MS = 60_000;

/**
 * A delete waiting for its upstream commit (#99). `waiting`: inside the undo window;
 * `queued`: the window has passed but the upstream call has not succeeded yet (offline, app closed).
 */
export interface PendingTaskDelete {
  taskId: string;
  /** Snapshot for undo and for restoring after a failed upstream delete; its `source` decides which integration receives the delete. */
  task: Task;
  carryOver: CarryOverEntry | null;
  state: 'waiting' | 'queued';
  requestedAt: number;
  /**
   * The column the task was in (#422). The trash entry made when the window closes and the gap that holds
   * the card's place both need it after the snapshot's status may have been rewritten. Absent on a delete
   * persisted before the trash: its status is read from the snapshot.
   */
  fromStatus?: TaskStatus;
  /**
   * Where the card's gap sits (#422): `afterId` is the card or gap that precedes it in the column as it was
   * displayed (`null` = first; an id that is no longer in the column falls back to the column end),
   * `height` the card's measured height in px (`null` when it could not be measured). Absent on a delete
   * persisted before the trash: no gap is rendered then. `afterId` undefined = the column end (the card
   * was on the board's DOM neither as a card nor as a member of a collapsed stack). A member of a collapsed
   * stack anchors at a member that stays and takes the stack's height (#433).
   */
  slot?: { afterId?: string | null; height: number | null };
  /** The task's index in its column's manual order at delete time: an undo puts it back there (#422). */
  orderIndex?: number | null;
}

export interface IUpdateStatusPayload {
  taskId: string;
  status: TaskStatus;
}

export interface IUpdateTimeSpentPayload {
  taskId: string;
  timeSpentSeconds: number;
}

/**
 * Helper function for sorting tasks by their order in columns.
 * Uses a Map for O(1) lookups instead of O(n) findIndex per comparison.
 */
const sortByTaskIdOrder = (
  taskIdOrder: Array<string>,
  tasks: Task[],
): Task[] => {
  // Build index map once: O(n)
  const orderMap = new Map(taskIdOrder.map((id, i) => [id, i]));
  
  // Sort using O(1) lookups: O(n log n) total instead of O(n² log n)
  return [...tasks].sort((a, b) => {
    const aIndex = orderMap.get(a.id) ?? Infinity;
    const bIndex = orderMap.get(b.id) ?? Infinity;
    return aIndex - bIndex;
  });
};

/**
 * Helper to safely get timestamp from Date or string
 */
const getTimestamp = (date: Date | string | null | undefined): number => {
  if (!date) return 0;
  if (date instanceof Date) return date.getTime();
  const d = new Date(date);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

/**
 * The earlier of the local and the fetched creation time (#322): Notion and Todoist stamp their own time on a
 * page created for a moved task, which must not reset the date the task was made. A missing or invalid date loses.
 */
const earlierCreatedAt = (local: Date | string | null | undefined, fetched: Date | string | null | undefined): Task['createdAt'] => {
  const localTime = getTimestamp(local);
  const fetchedTime = getTimestamp(fetched);
  if (localTime === 0) return (fetched ?? null) as Task['createdAt'];
  if (fetchedTime === 0 || localTime <= fetchedTime) return local as Task['createdAt'];
  return fetched as Task['createdAt'];
};

/**
 * Helper to sort tasks based on column configuration
 */
const sortTasks = (
  tasks: Task[],
  sorting: { field: SortField; direction: SortDirection } | undefined,
  manualOrder: string[]
): Task[] => {
  // Default to manual sorting if not specified or explicitly manual
  if (!sorting || sorting.field === 'manual') {
    return sortByTaskIdOrder(manualOrder, tasks);
  }

  return [...tasks].sort((a, b) => {
    let valA: number | string;
    let valB: number | string;

    switch (sorting.field) {
      case 'dateCreated':
        valA = getTimestamp(a.createdAt);
        valB = getTimestamp(b.createdAt);
        break;
      case 'dateCompleted':
        valA = getTimestamp(a.completedAt);
        valB = getTimestamp(b.completedAt);
        break;
      case 'dateUpdated':
        valA = getTimestamp(a.updatedAt);
        valB = getTimestamp(b.updatedAt);
        break;
      case 'priority':
        valA = normalizePriority(a.priority);
        valB = normalizePriority(b.priority);
        break;
      case 'timeBox':
        valA = a.timeBoxSeconds ?? 0;
        valB = b.timeBoxSeconds ?? 0;
        break;
      default:
        return 0;
    }

    if (valA === valB) {
        return 0;
    }

    const comparison = valA < valB ? -1 : 1;
    return sorting.direction === 'asc' ? comparison : -comparison;
  });
};

/**
 * Factory function to create task getters by status
 */
const createTasksByStatusGetter = (status: TaskStatus, tasks: Ref<Task[]>) => computed(() => {
  const boardStore = useBoardStore();
  const column = boardStore.columnByTaskStatus(status);
  const order = column?.taskOrder ?? [];
  const sorting = column?.sorting;
  
  const filtered = tasks.value.filter((task: Task) => task.status === status);
  return sortTasks(filtered, sorting, order);
});

export const useTasksStore = defineStore("tasks", () => {
  // State
  const tasks = ref<Array<Task>>([]);
  const isLoading = ref(false);
  const lastSyncTimestamp = ref<Date | null>(null);
  const pendingTimeUpdates = ref<Record<string, PendingTimeUpdate>>({}); // Record instead of Map
  const archivedTaskIds = ref<string[]>([]); // Local-only archive state (UI filter)
  const deletedTaskIds = ref<string[]>([]); // Track deleted task IDs to prevent resurrection on sync
  const customPropertyIndexes = ref<Record<string, CustomPropertyIndex>>({}); // Record instead of Map
  const taskOperationVersions = ref<Record<string, number>>({}); // Track operation versions per task
  const batchOperationInProgress = ref(false); // Flag to prevent updates during batch operations
  /** Carried-over counter per task id (#99). Missing key hydrates to {}; pruned in mergeTasks. */
  const carryOverByTaskId = ref<Record<string, CarryOverEntry>>({});
  /** Deletes whose upstream call has not been committed yet (#99), keyed by task id. */
  const pendingDeletes = ref<Record<string, PendingTaskDelete>>({});
  /**
   * Transient (never persisted, per Pinia instance) status locks: while a locally-initiated
   * status change (e.g. undoing a completion) is still being written upstream, a concurrent
   * refresh must not overwrite it with stale upstream data. One entry per task, owned by a token:
   * the newest lock wins, and only its owner can release it (an older write finishing later must not
   * drop a newer write's lock).
   */
  const statusLocks = new Map<string, { token: number; status: TaskStatus; completedAt: Date | null }>();
  /**
   * Transient (never persisted) guard of a task restored from the trash (#422, D5): task id -> when. A fetch
   * that started before the restore finished does not contain the task; `mergeTasks` keeps a guarded local
   * task instead of dropping it, and releases the guard once a merge contains it or after `RESTORE_GUARD_MS`.
   */
  const restoreGuard = new Map<string, number>();
  let nextStatusLockToken = 0;
  /**
   * Transient (never persisted) revision of each task's `pendingSync`, bumped by every change that needs a
   * push. A write remembers the revision it started with and clears the marker only if no newer change came
   * in meanwhile, so an edit made during a push is not marked as pushed.
   */
  const pendingSyncRevisions = new Map<string, number>();

  // Getters
  /**
   * Finds a task by ID. This is a function (not a computed returning a function)
   * to ensure proper reactivity tracking when called inside other computeds.
   */
  const task = (id: string): Task | null => {
    return tasks.value.find((el) => el.id === id) ?? null;
  };

  const tasksOpen = createTasksByStatusGetter(TaskStatus.Open, tasks);
  const tasksProgress = createTasksByStatusGetter(TaskStatus.Progress, tasks);
  const tasksWaiting = createTasksByStatusGetter(TaskStatus.Waiting, tasks);
  const tasksDone = createTasksByStatusGetter(TaskStatus.Done, tasks);

  /** Reactive local start of today: a board left open overnight re-evaluates the day split */
  const { today: todayRef } = useToday();

  /**
   * Tasks marked done today (not archived)
   */
  const tasksDoneToday = computed(() => {
    const boardStore = useBoardStore();
    const column = boardStore.columnByTaskStatus(TaskStatus.Done);
    const order = column?.taskOrder ?? [];
    const sorting = column?.sorting;
    const today = todayRef.value;

    const filtered = tasks.value.filter((task: Task) => {
      if (task.status !== TaskStatus.Done) return false;
      if (archivedTaskIds.value.includes(task.id)) return false;
      
      // If task has completedAt, check if it's today
      if (task.completedAt) {
        return task.completedAt >= today;
      }
      
      // No completedAt: default to "today" for new completions
      return true;
    });
    return sortTasks(filtered, sorting, order);
  });

  /**
   * Tasks marked done before today (not archived)
   */
  const tasksDonePrevious = computed(() => {
    const boardStore = useBoardStore();
    const column = boardStore.columnByTaskStatus(TaskStatus.Done);
    const order = column?.taskOrder ?? [];
    const sorting = column?.sorting;
    const today = todayRef.value;

    const filtered = tasks.value.filter((task: Task) => {
        if (task.status !== TaskStatus.Done) return false;
        if (archivedTaskIds.value.includes(task.id)) return false;
        
        // If task has completedAt, check if it's before today
        if (task.completedAt) {
          return task.completedAt < today;
        }
        
        // No completedAt for done task: assume it's old (previous day)
        return false;
      });
    return sortTasks(filtered, sorting, order);
  });

  /**
   * Count of archivable tasks (done before today)
   */
  const archivableTaskCount = computed(() => {
    return tasksDonePrevious.value.length;
  });

  /**
   * Count of archived tasks
   */
  const archivedTaskCount = computed(() => {
    return archivedTaskIds.value.length;
  });

  const hasPendingTimeUpdates = computed(() => {
    return mapHelpers.size(pendingTimeUpdates.value) > 0;
  });

  /**
   * Whether the source does not hold the task's local state yet (#319): it carries the `pendingSync` marker,
   * or tracked time waits in the time queue. A timer tick queues time without the marker, so a running timer
   * does not freeze the rest of the task against a fetch (see `mergeTasks`).
   */
  const isSyncPending = (taskId: string): boolean =>
    tasks.value.find((el) => el.id === taskId)?.pendingSync !== undefined || mapHelpers.has(pendingTimeUpdates.value, taskId);

  /** Tasks whose local state the source does not hold yet, in board order. */
  const pendingSyncTasks = computed((): Task[] => tasks.value.filter((el) => el.source !== 'local' && isSyncPending(el.id)));
  const hasPendingSync = computed(() => pendingSyncTasks.value.length > 0);

  /**
   * Whether tasks of two or more sources sit on the board (#323): the cards then show their source icon.
   * Derived from the tasks, not from `boardConfig.sources`: a connected source without tasks yet shows nothing.
   * The add sheet's draft card is not in the store, so it never counts.
   */
  const hasMultipleSources = computed((): boolean => {
    const seen = new Set<string>();
    for (const el of tasks.value) {
      if (!isKnownSource(el.source)) continue;
      seen.add(el.source);
      if (seen.size >= 2) return true;
    }
    return false;
  });

  /**
   * Get pending updates that have failed and need attention
   */
  const failedPendingUpdates = computed((): PendingTimeUpdate[] => {
    return mapHelpers.values(pendingTimeUpdates.value)
      .filter(update => update.status === 'failed');
  });

  /**
   * Get count of pending updates by status
   */
  const pendingUpdateStats = computed(() => {
    const stats = { pending: 0, syncing: 0, failed: 0 };
    mapHelpers.forEach(pendingTimeUpdates.value, update => {
      stats[update.status]++;
    });
    return stats;
  });

  // Actions
  function updateTask(taskId: string, updates: Partial<Task>) {
    // Skip updates during batch operations to prevent re-grouping
    if (batchOperationInProgress.value) {
      return;
    }
    
    const task = tasks.value.find((el) => el.id === taskId);

    if (task) {
      const wasInDone = task.status === TaskStatus.Done;
      Object.assign(task, updates);
      // A change inside a move's undo window (starting or stopping the timer excepted) is not on the origin
      // copy: Undo has to push it there (#322)
      if (heldMoves.has(taskId) && Object.keys(updates).some((key) => key !== 'timerId')) heldChanged.add(taskId);
      
      // Update statistics if task is in Done status and not archived
      const isArchived = archivedTaskIds.value.includes(taskId);
      const isInDone = task.status === TaskStatus.Done;
      
      if (isInDone && wasInDone && !isArchived) {
        // Task properties changed while in Done status (e.g., time spent updated)
        // Update statistics record (use dynamic import to avoid circular dependency)
        import('~/store/taskStatistics').then(({ useTaskStatisticsStore }) => {
          const statisticsStore = useTaskStatisticsStore();
          statisticsStore.updateTaskRecord(task);
        }).catch((error) => {
          console.warn('Failed to update task statistics:', error);
        });
      }
    }
    else {
      console.error(`Task with id ${taskId} not found for update`);
    }
  }

  /**
   * Notes that the task has changes the source does not hold yet: sets its `pendingSync` marker (once, the
   * first change keeps `since`) and returns the revision a write must hand back to `clearPendingSync`.
   * A Local task has no upstream and never gets one (0). `upstreamDone` (whether the source holds the task as
   * completed) is taken by a new marker and by an older one that lacks it; an existing answer stays, as the
   * source has not changed since.
   */
  function markPendingSync(taskId: string, upstreamDone?: boolean): number {
    const target = tasks.value.find((el) => el.id === taskId);
    if (!target || target.source === 'local') return 0;
    const revision = (pendingSyncRevisions.get(taskId) ?? 0) + 1;
    pendingSyncRevisions.set(taskId, revision);
    if (!target.pendingSync) target.pendingSync = { since: Date.now(), attempts: 0, lastError: null };
    if (target.pendingSync.upstreamDone === undefined) {
      target.pendingSync.upstreamDone = upstreamDone ?? target.status === TaskStatus.Done;
    }
    return revision;
  }

  /** The revision a push of the task starts from (0 for a marker restored from storage, or none). */
  function pendingSyncRevision(taskId: string): number {
    return pendingSyncRevisions.get(taskId) ?? 0;
  }

  /**
   * A push of the task went through: drops the marker and the queued time update (the push carried the time
   * too). A `pendingMove` stays: the origin copy of a move is removed by `clearPendingMove`, not by a push. With the `revision` of the write it started, a change made since keeps the marker; it then records what the
   * push left the source holding (`upstreamDone`), so the next push does not reopen a task that is open.
   * @returns whether the marker was cleared
   */
  function clearPendingSync(taskId: string, revision?: number, upstreamDone?: boolean): boolean {
    if (revision !== undefined && pendingSyncRevision(taskId) !== revision) {
      const kept = tasks.value.find((el) => el.id === taskId);
      if (kept?.pendingSync && upstreamDone !== undefined) kept.pendingSync.upstreamDone = upstreamDone;
      return false;
    }
    const target = tasks.value.find((el) => el.id === taskId);
    if (target) delete target.pendingSync;
    pendingSyncRevisions.delete(taskId);
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
    return true;
  }

  /** A push of the task failed: counts the attempt and keeps the reason on the marker. */
  function recordPendingSyncFailure(taskId: string, errorMessage: string): void {
    const target = tasks.value.find((el) => el.id === taskId);
    if (!target?.pendingSync) return;
    target.pendingSync = { ...target.pendingSync, attempts: target.pendingSync.attempts + 1, lastError: errorMessage };
  }

  /**
   * The source created a task that was made while it was unreachable: the task keeps its `id` and takes the
   * `externalId` the source gave it, then counts as pushed (unless it changed again meanwhile).
   */
  function completeCreate(taskId: string, created: Pick<Task, 'externalId'>, revision?: number): void {
    const target = tasks.value.find((el) => el.id === taskId);
    if (target && target.source !== 'local') target.externalId = created.externalId ?? target.externalId;
    clearPendingSync(taskId, revision);
  }

  /**
   * Phase 1 of a move to another source (#322, ADR 015): the task takes `target` as its source, loses its
   * `externalId` (the target creates its own page) and records where it came from in `pendingMove`, all in one
   * mutation. `id`, column, position, timer, tracked time and dates stay (everything is keyed by `id`). A target
   * with an upstream also gets the `pendingSync` marker, so a restart sees a task whose create is outstanding.
   * Time queued for the origin goes (the origin is being left), and the operation version moves on so a response
   * of a write still in flight to the origin is dropped. Nothing goes upstream here.
   * @returns what `restoreMoveOrigin` needs to undo it; null when there is nothing to move (unknown task,
   *   already in `target`, or a move is already outstanding)
   */
  function reassignSource(taskId: string, target: SourceId): { pendingSync: PendingSync | undefined } | null {
    const moving = tasks.value.find((el) => el.id === taskId);
    if (!moving || moving.source === target || moving.pendingMove) return null;
    const previous = { pendingSync: moving.pendingSync };
    moving.pendingMove = { fromSource: moving.source, fromExternalId: moving.externalId, toSource: target };
    moving.source = target;
    moving.externalId = null;
    delete moving.pendingSync;
    pendingSyncRevisions.delete(taskId);
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
    incrementTaskOperationVersion(taskId);
    markPendingSync(taskId); // no-op for Local: it has no upstream to wait for
    return previous;
  }

  /**
   * Puts a task back where `pendingMove` says it came from: the undo of a move (`previous` is what
   * `reassignSource` returned, so the task carries the marker it had before) and the answer to a rejected create
   * (no `previous`: an integration origin gets a fresh marker, because the task may have changed since). Nothing
   * is called upstream, so there is nothing to revert there. A task changed inside the undo window (`heldChanged`)
   * comes back to an integration origin with a marker, so the next flush sends it what it missed.
   */
  function restoreMoveOrigin(taskId: string, previous?: { pendingSync: PendingSync | undefined }): void {
    const moved = tasks.value.find((el) => el.id === taskId);
    const move = moved?.pendingMove;
    if (!moved || !move) return;
    moved.source = move.fromSource;
    moved.externalId = move.fromExternalId;
    delete moved.pendingMove;
    delete moved.pendingSync;
    pendingSyncRevisions.delete(taskId);
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
    incrementTaskOperationVersion(taskId);
    const changedInWindow = heldChanged.delete(taskId);
    if (previous?.pendingSync) moved.pendingSync = previous.pendingSync;
    if (!previous || changedInWindow) markPendingSync(taskId);
  }

  /**
   * The target created the page of a moving task: the task takes its `externalId` and keeps `pendingMove` (the
   * origin copy is still to be removed) and its marker. A card that a fetch made from that very page before this
   * response was stored is a duplicate of the moving task and is dropped in the same mutation.
   * @returns the ids of the dropped duplicates
   */
  function completeMoveCreate(taskId: string, externalId: string): string[] {
    const moved = tasks.value.find((el) => el.id === taskId);
    if (!moved || moved.source === 'local') return [];
    moved.externalId = externalId;
    const duplicates = tasks.value.filter((el) => el.id !== taskId && el.source === moved.source && el.externalId === externalId);
    if (duplicates.length === 0) return [];
    const dropped = new Set(duplicates.map((el) => el.id));
    tasks.value = tasks.value.filter((el) => !dropped.has(el.id));
    for (const id of dropped) mapHelpers.delete(pendingTimeUpdates.value, id);
    pruneCarryOver(tasks.value.map((el) => el.id));
    useBoardStore().reconcileColumnsWithTasks(tasks.value);
    return [...dropped];
  }

  /** The move is finished: the origin copy is gone (or nothing was there to remove). */
  function clearPendingMove(taskId: string): void {
    const moved = tasks.value.find((el) => el.id === taskId);
    if (moved) delete moved.pendingMove;
  }

  /** Moves inside their undo window (not persisted): a push or a flush must not create them upstream yet. */
  const heldMoves = new Set<string>();
  /** Held moves whose task changed inside the window (not persisted): what Undo must push to the origin. */
  const heldChanged = new Set<string>();
  const holdMove = (taskId: string): void => { heldMoves.add(taskId); heldChanged.delete(taskId); };
  /** Ends the hold; the record of changes stays until `restoreMoveOrigin` reads it or the next hold resets it. */
  const releaseMove = (taskId: string): void => { heldMoves.delete(taskId); };
  const isMoveHeld = (taskId: string): boolean => heldMoves.has(taskId);

  function addPendingTimeUpdate(taskId: string, seconds: number) {
    // Only a source that stores time has anything to push (a Local or Todoist task's time is already complete)
    const owner = tasks.value.find((el) => el.id === taskId);
    if (owner && !sourceSyncsTime(owner.source)) return;
    const existing = mapHelpers.get(pendingTimeUpdates.value, taskId);
    
    if (existing) {
      existing.timeSpentSeconds += seconds;
    } else {
      mapHelpers.set(pendingTimeUpdates.value, taskId, createPendingTimeUpdate(taskId, seconds));
    }
  }

  function addTask(task: Task) {
    tasks.value.push(task);
  }

  function removeTask(id: string) {
    restoreGuard.delete(id);
    const taskIndex = tasks.value.findIndex((el) => el.id === id);
    if (taskIndex !== -1) {
      const [removed] = tasks.value.splice(taskIndex, 1);
      // Track deleted IDs to prevent resurrection on sync: the app-level id, and the integration's id
      // when it differs (a sync fetches the task by its externalId only)
      for (const deletedId of [id, removed?.externalId, removed?.pendingMove?.fromExternalId]) {
        if (deletedId && !deletedTaskIds.value.includes(deletedId)) {
          deletedTaskIds.value.push(deletedId);
        }
      }
    }
  }

  function replaceTasksWith(newTasks: Array<Task>) {
    tasks.value = newTasks;
  }

  /**
   * Updates the time spent on a task
   * @param payload containing taskId and timeSpentSeconds
   * @returns true if the task is found and updated, false otherwise
   */
  function updateTaskTimespent(payload: IUpdateTimeSpentPayload): boolean {
    const task = tasks.value.find((el) => el.id === payload.taskId);
    if (!task) {
      return false;
    }

    // Update local state using proper action
    updateTask(payload.taskId, { timeSpentSeconds: payload.timeSpentSeconds });

    // Store in pending updates if task is in progress (and its source stores time)
    if (task.status === TaskStatus.Progress && sourceSyncsTime(task.source)) {
      const existing = mapHelpers.get(pendingTimeUpdates.value, task.id);
      if (existing) {
        existing.timeSpentSeconds = payload.timeSpentSeconds;
      } else {
        mapHelpers.set(pendingTimeUpdates.value, task.id, createPendingTimeUpdate(task.id, payload.timeSpentSeconds));
      }
      return true;
    }

    // If task is moved out of progress, handle sync in the sync composable
    if (mapHelpers.has(pendingTimeUpdates.value, task.id)) {
      // Remove from pending updates - sync will be handled by composable
      mapHelpers.delete(pendingTimeUpdates.value, task.id);
    }

    return true;
  }

  /**
   * A user's edit of a task's total time spent (kd#4). Unlike the timer tick (`updateTaskTimespent`, which
   * accumulates and queues only for a task in Jetzt) the edit is absolute, for any status: the total is
   * written at once and, for a source that stores time, queued as an `absolute` entry. While that entry
   * exists `mergeTasks` takes the local total over a higher fetched one, and the Notion push writes the time
   * property even at 0 (otherwise the old value would come back). A running timer keeps counting from the
   * new total; a done task's completion record follows through `updateTask`. Work sessions are not touched.
   * @returns false for an unknown task or a total that is negative or not a finite number
   */
  function setTimeSpent(taskId: string, seconds: number): boolean {
    const task = tasks.value.find((el) => el.id === taskId);
    if (!task || !Number.isFinite(seconds) || seconds < 0) return false;

    updateTask(taskId, { timeSpentSeconds: seconds });

    if (sourceSyncsTime(task.source)) {
      // A new revision, so a push already in flight does not clear this edit's entry when it lands
      markPendingSync(taskId);
      const existing = mapHelpers.get(pendingTimeUpdates.value, taskId);
      if (existing) {
        existing.timeSpentSeconds = seconds;
        existing.absolute = true;
      } else {
        mapHelpers.set(pendingTimeUpdates.value, taskId, { ...createPendingTimeUpdate(taskId, seconds), absolute: true });
      }
    }
    return true;
  }

  /**
   * Clear pending time updates for a specific task
   */
  function clearPendingTimeUpdate(taskId: string) {
    mapHelpers.delete(pendingTimeUpdates.value, taskId);
  }

  /**
   * Clear all pending time updates
   */
  function clearAllPendingTimeUpdates(): void {
    pendingTimeUpdates.value = {};
  }

  /**
   * Set tasks array (replaces all tasks)
   * Also extracts and populates property options for select fields
   */
  function setTasks(tasksArray: Task[]): void {
    const boardStore = useBoardStore();
    tasks.value = tasksArray;
    boardStore.reconcileColumnsWithTasks(tasksArray);
    
    // Auto-populate property options store from tasks
    const propertyOptionsStore = usePropertyOptionsStore();
    propertyOptionsStore.extractOptionsFromTasks(tasksArray);
  }

  /**
   * Turns the tasks of every source except `keep` into Local tasks (same `id`, no `externalId`), pending
   * deletes in their undo window included. A switch away from an integration keeps the board's tasks and
   * never writes upstream to it again, as before #326 (the service changed, the tasks stayed).
   */
  function adoptAsLocal(keep: SourceId | null = null): void {
    const stays = (task: Pick<Task, 'source' | 'externalId'>) =>
      task.source === 'local' ? task.externalId === null : task.source === keep;
    // Nothing goes upstream any more, so the marker (and a move) goes with the source
    const adopt = (task: Task): Task => {
      if (stays(task)) return task;
      const { pendingSync: _sync, pendingMove: _move, ...rest } = task;
      return { ...rest, source: 'local', externalId: null };
    };
    if (!tasks.value.every(stays)) tasks.value = tasks.value.map(adopt);
    for (const pending of Object.values(pendingDeletes.value)) {
      if (!stays(pending.task)) pending.task = adopt(pending.task);
    }
  }

  /**
   * Starts a switch of the board to one integration (welcome, Notion setup, Todoist OAuth): that source
   * becomes the only one, the other sources' tasks become Local tasks right away (nothing goes upstream
   * to a source the user left), and the board is flagged so the first non-empty fetch replaces them.
   */
  function beginSourceSwitch(source: IntegrationSourceId): void {
    const boardStore = useBoardStore();
    boardStore.setSingleSource(source);
    boardStore.markSourceSwitchPending();
    adoptAsLocal(source);
  }

  /**
   * Unsynced work of one integration that a disconnect would discard: its tasks the source does not hold
   * yet (marker or queued time) or that are being timed (the stop queues their time), and its deletes that
   * have not reached it. Counted per task, a task with several reasons counts once.
   */
  function unsyncedOf(source: SourceId): { taskIds: string[]; pendingDeleteIds: string[] } {
    const taskIds = tasks.value
      .filter((el) => el.source === source && (isSyncPending(el.id) || (!!el.timerId && el.status === TaskStatus.Progress)))
      .map((el) => el.id);
    const pendingDeleteIds = Object.values(pendingDeletes.value)
      .filter((pending) => pending.task.source === source && pending.task.externalId !== null)
      .map((pending) => pending.taskId);
    return { taskIds, pendingDeleteIds };
  }

  /**
   * Takes one integration off the board (#320): stops the timers of its tasks (their intervals; the time
   * stays queued as an unsynced change until the tasks go), removes the tasks and everything keyed by their
   * ids that is not history (column order and positions, carry-over, archive, queued time, pending deletes,
   * operation versions, status locks, markers), and removes the source from `connected` (the default falls
   * back to Local). Statistics records stay: statistics ignore sources. Deleted-id guards of its queued
   * deletes go too, so a reconnect shows the database as it is (a fresh connect). Credentials are the
   * caller's job (`useSourceConnections`, Keychain first).
   * @returns the ids of the removed tasks
   */
  function disconnectSource(source: IntegrationSourceId): string[] {
    const boardStore = useBoardStore();
    const leaving = tasks.value.filter((el) => el.source === source);
    const ids = new Set(leaving.map((el) => el.id));

    for (const leavingTask of leaving) {
      disarmTaskTimer(leavingTask.id);
      statusLocks.delete(leavingTask.id);
      pendingSyncRevisions.delete(leavingTask.id);
      mapHelpers.delete(pendingTimeUpdates.value, leavingTask.id);
      mapHelpers.delete(taskOperationVersions.value, leavingTask.id);
    }
    // A delete that never reached the source: its undo (if the toast is still open) finds nothing to restore
    for (const pending of Object.values(pendingDeletes.value)) {
      if (pending.task.source !== source) continue;
      ids.add(pending.taskId);
      undeleteTask(pending.taskId, pending.task.externalId, pending.task.pendingMove?.fromExternalId);
      mapHelpers.delete(pendingDeletes.value, pending.taskId);
    }

    const remaining = tasks.value.filter((el) => el.source !== source);
    tasks.value = remaining;
    archivedTaskIds.value = archivedTaskIds.value.filter((id) => !ids.has(id));
    for (const id of ids) mapHelpers.delete(carryOverByTaskId.value, id);
    for (const index of Object.values(customPropertyIndexes.value)) {
      for (const valueKey of Object.keys(index.taskIdsByValue)) {
        index.taskIdsByValue[valueKey] = (index.taskIdsByValue[valueKey] ?? []).filter((id) => !ids.has(id));
      }
    }
    boardStore.disconnectIntegration(source);
    boardStore.reconcileColumnsWithTasks(remaining);
    return [...ids];
  }

  /**
   * Replaces the tasks of one source with `fetchedTasks`, leaving every other source's tasks untouched.
   * Existing tasks are matched by `(source, externalId)` (`id` for Local, which has no externalId), so a
   * task keeps its app-level `id` whatever the integration calls it. A new external task gets
   * `id = externalId` unless that id is already taken (then a generated one). Preserves local time
   * tracking, timers and in-flight status locks; skips tasks deleted locally.
   * @param source The source the tasks were fetched from (Notion, Todoist, ...)
   * @param fetchedTasks Tasks from that source's integration
   * @param options `replaceOthers` drops the Local tasks too, as the single-service merge did before #326:
   *   set by the fetch that completes a source switch (`pendingSourceSwitch`); the tasks of another
   *   connected integration stay (a connect during a pending switch, #320). A Local task
   *   whose `id` equals a fetched `externalId` is that task (a Notion -> Local -> Notion round trip): it
   *   keeps its `id` and local data and takes the source and `externalId` again.
   */
  function mergeTasks(source: SourceId, fetchedTasks: Task[], options: { replaceOthers?: boolean } = {}): void {
    const boardStore = useBoardStore();

    // A completed switch replaces the Local tasks it adopted; another connected integration's tasks stay (#320)
    const otherTasks = tasks.value.filter(task => task.source !== source && !(options.replaceOthers && task.source === 'local'));
    const keyOf = (task: Pick<Task, 'id' | 'externalId'>) => task.externalId ?? task.id;
    const existingBySourceKey = new Map<string, Task>();
    tasks.value.forEach(task => {
      // A task moved here whose page is not created yet cannot match a fetched page (its id may equal the origin page's)
      const awaitsCreate = task.pendingMove !== undefined && task.externalId === null;
      if (task.source === source && !(source !== 'local' && awaitsCreate)) existingBySourceKey.set(keyOf(task), task);
      else if (options.replaceOthers && task.source === 'local' && source !== 'local' && !existingBySourceKey.has(task.id)) {
        existingBySourceKey.set(task.id, task);
      }
    });
    const takenIds = new Set(tasks.value.map(task => task.id));
    // The origin pages of moves that are not finished (#322): the task already lives in another source, so the
    // page this source still returns for it is not a new task
    const movedAwayPages = new Set<string>();
    for (const task of tasks.value) {
      if (task.pendingMove?.fromSource === source && task.pendingMove.fromExternalId !== null) movedAwayPages.add(task.pendingMove.fromExternalId);
    }

    const mergedTasks: Task[] = [];
    fetchedTasks.forEach(fetchedFrom => {
      const fetchedTask: Task = { ...fetchedFrom, source, externalId: source === 'local' ? null : (fetchedFrom.externalId ?? fetchedFrom.id) };
      if (fetchedTask.externalId !== null && movedAwayPages.has(fetchedTask.externalId)) return;
      const existingTask = existingBySourceKey.get(keyOf(fetchedTask));
      const resolvedId = existingTask?.id ?? fetchedTask.id;

      // Skip tasks that were deleted locally
      if ([resolvedId, fetchedTask.id, fetchedTask.externalId].some(candidate => candidate !== null && deletedTaskIds.value.includes(candidate))) {
        console.log(`Skipping deleted task ${resolvedId} during merge`);
        return;
      }

      if (existingTask) {
        // Preserve local time tracking data and timer state
        const localTimeSpent = existingTask.timeSpentSeconds || 0;
        const externalTimeSpent = fetchedTask.timeSpentSeconds || 0;
        const pendingUpdate = mapHelpers.get(pendingTimeUpdates.value, resolvedId);
        const pendingLocal = pendingUpdate?.timeSpentSeconds || 0;
        // A total the user set (kd#4) wins over the fetched one, also when it is lower; otherwise the larger value stays
        const userSetTime = pendingUpdate?.absolute === true;
        const effectiveLocal = userSetTime ? localTimeSpent : Math.max(localTimeSpent, pendingLocal);

        // A task with unpushed changes (#319) keeps its local state: the fetch is older than the edit, and the
        // push that follows would otherwise send the source's stale copy back. Only the source's id is taken.
        // What the source says now also corrects the marker's note of whether it holds the task as completed (#344)
        const marker = existingTask.pendingSync;
        const heldDone = fetchedTask.status === TaskStatus.Done;
        const base: Task = marker
          ? {
            ...existingTask,
            externalId: fetchedTask.externalId,
            ...(marker.upstreamDone !== undefined && marker.upstreamDone !== heldDone ? { pendingSync: { ...marker, upstreamDone: heldDone } } : {}),
          }
          : fetchedTask;

        // Merge task: use fetched data but preserve local time tracking
        const mergedTask: Task = {
          ...base, // Use all fetched data as base
          id: existingTask.id, // The app-level identity never changes
          createdAt: earlierCreatedAt(existingTask.createdAt, base.createdAt), // A moved task keeps its first creation time
          // Keep the highest value across external and effective local (including pending)
          timeSpentSeconds: userSetTime ? effectiveLocal : Math.max(effectiveLocal, externalTimeSpent),
          timerId: existingTask.timerId, // Preserve active timer
        };

        // Keep an in-flight local status change (e.g. an undone completion)
        const statusLock = statusLocks.get(resolvedId);
        if (statusLock) {
          mergedTask.status = statusLock.status;
          mergedTask.completedAt = statusLock.completedAt;
        }

        // If effective local (local or pending) is greater than external, ensure pending reflects the highest local value
        if (effectiveLocal > externalTimeSpent && effectiveLocal > 0 && sourceSyncsTime(source)) {
          const existing = mapHelpers.get(pendingTimeUpdates.value, resolvedId);
          if (existing) {
            existing.timeSpentSeconds = Math.max(existing.timeSpentSeconds, effectiveLocal);
          } else {
            mapHelpers.set(pendingTimeUpdates.value, resolvedId, createPendingTimeUpdate(resolvedId, effectiveLocal));
          }
        }

        mergedTasks.push(mergedTask);
      } else {
        // New task from the source: its externalId becomes the id unless another task already uses it
        const id = takenIds.has(fetchedTask.id) ? generateTaskId() : fetchedTask.id;
        takenIds.add(id);
        mergedTasks.push({ ...fetchedTask, id });
      }
    });

    // A task restored from the trash (#422, D5): a fetch that started before the restore finished does not
    // contain it, so it stays; one that contains it ends the guard (the merge above matched it normally).
    const guardNow = Date.now();
    for (const local of tasks.value) {
      const guardedAt = restoreGuard.get(local.id);
      if (guardedAt === undefined) continue;
      if (guardNow - guardedAt > RESTORE_GUARD_MS || mergedTasks.some(merged => merged.id === local.id)) {
        restoreGuard.delete(local.id);
      } else if (local.source === source) {
        mergedTasks.push(local);
      }
    }

    // A task made while the source was unreachable is not upstream yet (#319): the fetch cannot know it
    if (source !== 'local') {
      for (const local of tasks.value) {
        if (local.source === source && local.externalId === null && local.pendingSync && !mergedTasks.some(merged => merged.id === local.id)) {
          mergedTasks.push(local);
        }
      }
    }

    // Replace this source's tasks with the merged results
    const allTasks = [...otherTasks, ...mergedTasks];
    tasks.value = allTasks;
    pruneCarryOver(allTasks.map(t => t.id));
    boardStore.reconcileColumnsWithTasks(allTasks);

    // Auto-populate property options store from the merged tasks
    const propertyOptionsStore = usePropertyOptionsStore();
    propertyOptionsStore.extractOptionsFromTasks(allTasks);

    console.log(`Merged ${fetchedTasks.length} ${source} tasks, preserved local time data for ${mapHelpers.size(pendingTimeUpdates.value)} tasks`);

    // Backfill statistics from Done tasks after merge (use dynamic import to avoid circular dependency)
    const doneTasks = mergedTasks.filter(t => t.status === TaskStatus.Done);
    if (doneTasks.length > 0) {
      import('~/store/taskStatistics').then(({ useTaskStatisticsStore }) => {
        const statisticsStore = useTaskStatisticsStore();
        statisticsStore.syncExistingDoneTasks(doneTasks, archivedTaskIds.value);
      }).catch((error) => {
        console.warn('Failed to sync statistics after merge:', error);
      });
    }
  }

  /**
   * Set loading state
   */
  function setLoading(loading: boolean): void {
    if (import.meta.dev) {
      console.log('[TasksStore] setLoading:', loading, new Error().stack?.split('\n')[2]?.trim());
    }
    isLoading.value = loading;
  }

  /**
   * Set last sync timestamp
   */
  function setLastSyncTimestamp(timestamp: Date): void {
    lastSyncTimestamp.value = timestamp;
  }

  /**
   * Update last sync timestamp
   */
  function updateLastSyncTimestamp() {
    lastSyncTimestamp.value = new Date();
  }

  /**
   * Archive tasks (local UI-only state)
   * @param taskIds Array of task IDs to archive
   */
  function archiveTasks(taskIds: string[]): void {
    // Add to archived list
    const newArchived = taskIds.filter(id => !archivedTaskIds.value.includes(id));
    archivedTaskIds.value.push(...newArchived);

    // Mark archived timestamp on tasks
    taskIds.forEach(id => {
      updateTask(id, { archivedAt: new Date() });
    });

    if (import.meta.dev) {
      console.log(`Archived ${taskIds.length} tasks locally`);
    }
  }

  /**
   * Unarchive tasks (for undo functionality)
   * @param taskIds Array of task IDs to unarchive
   */
  function unarchiveTasks(taskIds: string[]): void {
    // Remove from archived list
    archivedTaskIds.value = archivedTaskIds.value.filter(
      id => !taskIds.includes(id)
    );

    // Clear archived timestamp
    taskIds.forEach(id => {
      updateTask(id, { archivedAt: null });
    });

    if (import.meta.dev) {
      console.log(`Unarchived ${taskIds.length} tasks`);
    }
  }

  /**
   * Mark a pending update as syncing
   */
  function markPendingUpdateSyncing(taskId: string): void {
    const update = mapHelpers.get(pendingTimeUpdates.value, taskId);
    if (update) {
      update.status = 'syncing';
      update.lastAttemptAt = new Date();
      update.attemptCount++;
    }
  }

  /**
   * Mark a pending update as failed
   */
  function markPendingUpdateFailed(taskId: string, errorMessage: string): void {
    const update = mapHelpers.get(pendingTimeUpdates.value, taskId);
    if (update) {
      update.status = 'failed';
      update.errorMessage = errorMessage;
      update.lastAttemptAt = new Date();
    }
  }

  /**
   * Clean up stale pending updates (older than 7 days)
   */
  function cleanupStalePendingUpdates(): void {
    const toRemove: string[] = [];
    mapHelpers.forEach(pendingTimeUpdates.value, (update, taskId) => {
      if (shouldCleanupPendingUpdate(update)) {
        toRemove.push(taskId);
      }
    });
    
    toRemove.forEach(taskId => {
      mapHelpers.delete(pendingTimeUpdates.value, taskId);
    });
    
    if (toRemove.length > 0 && import.meta.dev) {
      console.log(`Cleaned up ${toRemove.length} stale pending updates`);
    }
  }

  /**
   * Rebuild custom property index for a specific property key
   */
  function rebuildCustomPropertyIndex(propertyKey: string): void {
    const index = createCustomPropertyIndex(propertyKey, 'text'); // Default type
    
    tasks.value.forEach(task => {
      const entry = task.custom?.[propertyKey];
      if (!entry) return;
      
      // Update type from first occurrence
      if (tasks.value.indexOf(task) === 0) {
        index.valueType = entry.propType;
      }
      
      const valueKey = extractValueKey(entry.value);
      if (!index.taskIdsByValue[valueKey]) {
        index.taskIdsByValue[valueKey] = [];
      }
      setHelpers.add(index.taskIdsByValue[valueKey], task.id);
    });
    
    customPropertyIndexes.value[propertyKey] = index; // Direct assignment instead of mapHelpers.set
    
    if (import.meta.dev) {
      console.log(`Rebuilt index for property: ${propertyKey}`);
    }
  }

  /**
   * Get tasks filtered by custom property value
   */
  function getTasksWithCustomValue(propertyKey: string, valueName: string): Task[] {
    const index = customPropertyIndexes.value[propertyKey];
    if (!index) {
      // Index doesn't exist, build it on demand
      rebuildCustomPropertyIndex(propertyKey);
      const newIndex = customPropertyIndexes.value[propertyKey];
      if (!newIndex) return [];
      const taskIds = newIndex.taskIdsByValue[valueName] || [];
      return tasks.value.filter(t => taskIds.includes(t.id));
    }
    
    const taskIds = index.taskIdsByValue[valueName] || [];
    return tasks.value.filter(t => taskIds.includes(t.id));
  }

  /**
   * Clear all custom property indexes
   */
  function clearCustomPropertyIndexes(): void {
    customPropertyIndexes.value = {};
  }

  /**
   * Increment operation version for a task
   */
  function incrementTaskOperationVersion(taskId: string): number {
    const current = taskOperationVersions.value[taskId] || 0;
    const next = current + 1;
    taskOperationVersions.value[taskId] = next;
    return next;
  }
  
  /**
   * Batch update status for multiple tasks atomically
   * This prevents re-grouping between individual updates
   */
  function batchUpdateTaskStatus(taskIds: string[], status: TaskStatus): void {
    // Set batch operation flag to prevent any updates during batch
    batchOperationInProgress.value = true;
    
    // Create a new array for atomic update
    const newTasks = [...tasks.value];
    const taskIdsSet = new Set(taskIds);
    
    // Update tasks in the new array
    for (let i = 0; i < newTasks.length; i++) {
      const currentTask = newTasks[i];
      if (currentTask && taskIdsSet.has(currentTask.id)) {
        const task: Task = { ...currentTask, status };
        
        // Track completion timestamp when moved to Done
        if (status === TaskStatus.Done && currentTask.status !== TaskStatus.Done) {
          task.completedAt = new Date();
        }
        // Clear completion timestamp if moved out of Done
        if (status !== TaskStatus.Done && currentTask.status === TaskStatus.Done) {
          task.completedAt = null;
        }
        
        newTasks[i] = task;
      }
    }
    
    // Apply all updates in a single reactivity trigger
    tasks.value = newTasks;
    
    // Clear batch flag after a delay to allow sync to complete
    setTimeout(() => {
      batchOperationInProgress.value = false;
    }, 2000);
  }

  /**
   * Pins a task's status/completedAt against merges until the returned token is passed to
   * `unlockTaskStatus`. A later lock on the same task supersedes this one. Returns null when the
   * task does not exist (nothing to pin; unlocking null is a no-op).
   */
  function lockTaskStatus(taskId: string): number | null {
    const current = tasks.value.find((el) => el.id === taskId);
    if (!current) return null;
    const token = ++nextStatusLockToken;
    statusLocks.set(taskId, { token, status: current.status, completedAt: current.completedAt ?? null });
    return token;
  }

  /** Releases the lock `token` owns; a no-op once a newer lock has superseded it. */
  function unlockTaskStatus(taskId: string, token: number | null): void {
    if (token !== null && statusLocks.get(taskId)?.token === token) {
      statusLocks.delete(taskId);
    }
  }

  /**
   * Get current operation version for a task
   */
  function getTaskOperationVersion(taskId: string): number {
    return taskOperationVersions.value[taskId] || 0;
  }

  /**
   * Counts the current board day for every not-done task (#99). Idempotent within a day:
   * a task first seen today starts at 0, a later day adds one, Done (or archived) drops the counter,
   * and ids no longer on the board are pruned.
   * @param today Local date key (YYYY-MM-DD)
   */
  function recordCarryOver(today: string): void {
    const next: Record<string, CarryOverEntry> = {};
    for (const current of tasks.value) {
      if (current.status === TaskStatus.Done || archivedTaskIds.value.includes(current.id)) continue;
      const entry = mapHelpers.get(carryOverByTaskId.value, current.id);
      next[current.id] = entry ? advanceCarryOverEntry(entry, today) : createCarryOverEntry(today);
    }
    carryOverByTaskId.value = next;
  }

  /** Drops counters for task ids that are not in `taskIds`. */
  function pruneCarryOver(taskIds: string[]): void {
    const keep = new Set(taskIds);
    for (const id of mapHelpers.keys(carryOverByTaskId.value)) {
      if (!keep.has(id)) mapHelpers.delete(carryOverByTaskId.value, id);
    }
  }

  /**
   * Sets the counters of several tasks at once (#536): the demo board's samples come with theirs. Entries of other
   * tasks stay as they are; an id in `entries` replaces its counter.
   */
  function setCarryOver(entries: Record<string, CarryOverEntry>): void {
    carryOverByTaskId.value = { ...carryOverByTaskId.value, ...entries };
  }

  /** Keep (#99): silences the nudge until CARRY_OVER_NUDGE_DAYS further days; the count runs on. */
  function keepCarryOver(taskId: string): void {
    const entry = mapHelpers.get(carryOverByTaskId.value, taskId);
    if (entry) mapHelpers.set(carryOverByTaskId.value, taskId, { ...entry, keptAtDays: entry.days });
  }

  /** Restores a counter snapshot (undo of a delete). */
  function restoreCarryOver(taskId: string, entry: CarryOverEntry | null): void {
    if (entry) mapHelpers.set(carryOverByTaskId.value, taskId, entry);
  }

  /**
   * Rewrites a topic or activity name on every task, whatever its status, and on the task snapshots of the
   * deletes still inside their undo window (#430). Both names are trimmed by the caller. A dedicated action,
   * not `updateTask`: a rename is local bookkeeping, so it sets no `pendingSync`, bumps no revision and
   * leaves `updatedAt` alone. Returns how many tasks (snapshots included) changed; nothing matching is a no-op.
   */
  function renameValue(kind: NameKind, from: string, to: string): number {
    let changed = 0;
    tasks.value = tasks.value.map((task) => {
      const renamed = renameField(task, kind, from, to);
      if (renamed !== task) changed += 1;
      return renamed;
    });
    for (const pending of Object.values(pendingDeletes.value)) {
      const renamed = renameField(pending.task, kind, from, to);
      if (renamed === pending.task) continue;
      changed += 1;
      mapHelpers.set(pendingDeletes.value, pending.taskId, { ...pending, task: renamed });
    }
    return changed;
  }

  function addPendingDelete(pending: PendingTaskDelete): void {
    mapHelpers.set(pendingDeletes.value, pending.taskId, pending);
  }

  function removePendingDelete(taskId: string): void {
    mapHelpers.delete(pendingDeletes.value, taskId);
  }

  function markPendingDeleteQueued(taskId: string): void {
    const pending = mapHelpers.get(pendingDeletes.value, taskId);
    if (pending) mapHelpers.set(pendingDeletes.value, taskId, { ...pending, state: 'queued' });
  }

  /** Replaces the gap slot of a pending delete (#438: its anchor's gap ended); no-op when it is gone. */
  function setPendingDeleteSlot(taskId: string, slot: NonNullable<PendingTaskDelete['slot']>): void {
    const pending = mapHelpers.get(pendingDeletes.value, taskId);
    if (pending) mapHelpers.set(pendingDeletes.value, taskId, { ...pending, slot });
  }

  /** Guards a task that was just restored from the trash against a fetch that started before (#422, D5). */
  function guardRestoredTask(id: string): void {
    restoreGuard.set(id, Date.now());
  }

  /**
   * Also remove from deleted list if task is re-added via undo. The single guard-clearing function: a trashed
   * task stays blocked in `deletedTaskIds` (no fetch re-adds it) until this runs for it (#422).
   */
  function undeleteTask(id: string, externalId?: string | null, originExternalId?: string | null) {
    for (const deletedId of [id, externalId, originExternalId]) {
      const index = deletedId ? deletedTaskIds.value.indexOf(deletedId) : -1;
      if (index > -1) {
        deletedTaskIds.value.splice(index, 1);
      }
    }
  }

  return {
    // State
    tasks,
    isLoading,
    lastSyncTimestamp,
    pendingTimeUpdates,
    archivedTaskIds,
    deletedTaskIds,
    customPropertyIndexes,
    taskOperationVersions,
    carryOverByTaskId,
    pendingDeletes,
    
    // Getters
    task,
    tasksOpen,
    tasksProgress,
    tasksWaiting,
    tasksDone,
    tasksDoneToday,
    tasksDonePrevious,
    archivableTaskCount,
    archivedTaskCount,
    hasPendingTimeUpdates,
    isSyncPending,
    pendingSyncTasks,
    hasPendingSync,
    hasMultipleSources,
    failedPendingUpdates,
    pendingUpdateStats,
    
    // Actions
    updateTask,
    addPendingTimeUpdate,
    markPendingSync,
    pendingSyncRevision,
    clearPendingSync,
    recordPendingSyncFailure,
    completeCreate,
    reassignSource,
    restoreMoveOrigin,
    completeMoveCreate,
    clearPendingMove,
    holdMove,
    releaseMove,
    isMoveHeld,
    addTask,
    removeTask,
    replaceTasksWith,
    updateTaskTimespent,
    setTimeSpent,
    clearPendingTimeUpdate,
    clearAllPendingTimeUpdates,
    setTasks,
    adoptAsLocal,
    beginSourceSwitch,
    unsyncedOf,
    disconnectSource,
    mergeTasks,
    setLoading,
    setLastSyncTimestamp,
    updateLastSyncTimestamp,
    archiveTasks,
    unarchiveTasks,
    undeleteTask,
    guardRestoredTask,
    markPendingUpdateSyncing,
    markPendingUpdateFailed,
    cleanupStalePendingUpdates,
    rebuildCustomPropertyIndex,
    getTasksWithCustomValue,
    clearCustomPropertyIndexes,
    incrementTaskOperationVersion,
    getTaskOperationVersion,
    lockTaskStatus,
    unlockTaskStatus,
    batchUpdateTaskStatus,
    recordCarryOver,
    pruneCarryOver,
    setCarryOver,
    keepCarryOver,
    restoreCarryOver,
    renameValue,
    addPendingDelete,
    removePendingDelete,
    markPendingDeleteQueued,
    setPendingDeleteSlot,
  };
}, {
  persist: {
    key: 'tasks-store',
    afterHydrate: (ctx: { store: { tasks: Task[]; pendingDeletes?: Record<string, PendingTaskDelete>; lastSyncTimestamp?: Date | null; pendingTimeUpdates?: Record<string, PendingTimeUpdate>; $persist: () => void } }) => {
      // Storage holds ISO strings; the types say Date (#376). Reviving is not a stored-shape change, so it
      // stays out of `changed` below and never writes by itself (#273). It runs on every hydrate, also
      // when no task came back: the sync time and the pending time updates live outside the tasks.
      const reviveRest = () => {
        const lastSync = reviveDate(ctx.store.lastSyncTimestamp);
        if (lastSync !== ctx.store.lastSyncTimestamp) ctx.store.lastSyncTimestamp = lastSync;
        const timeUpdates = revivePendingTimeUpdates(ctx.store.pendingTimeUpdates ?? {});
        if (timeUpdates !== (ctx.store.pendingTimeUpdates ?? {})) ctx.store.pendingTimeUpdates = timeUpdates;
      };

      const restoredTasks = ctx.store.tasks;
      // Nothing restored (no tasks-store key): reconciling with [] would wipe the persisted board order.
      if (!restoredTasks?.length && !Object.keys(ctx.store.pendingDeletes ?? {}).length) {
        reviveRest();
        return;
      }
      const boardStore = useBoardStore();

      // Tasks saved before sources existed belong to the board's only source of that time (D2). The
      // board store hydrated first (it was just created above), so its sources are already mapped.
      const fallback = legacyTaskSource(boardStore.boardConfig.sources);
      const normalizedTasks = normalizeTasks(restoredTasks ?? [], fallback);
      const normalizedDeletes = normalizePendingDeletes(ctx.store.pendingDeletes ?? {}, fallback);
      const changed = normalizedTasks !== (restoredTasks ?? []) || normalizedDeletes !== (ctx.store.pendingDeletes ?? {});
      const tasks = reviveTaskDates(normalizedTasks);
      const pendingDeletes = revivePendingDeletes(normalizedDeletes);
      if (tasks !== (restoredTasks ?? [])) ctx.store.tasks = tasks;
      if (pendingDeletes !== (ctx.store.pendingDeletes ?? {})) ctx.store.pendingDeletes = pendingDeletes;
      reviveRest();

      if (tasks.length) {
        const propertyOptionsStore = usePropertyOptionsStore();
        boardStore.reconcileColumnsWithTasks(tasks);
        propertyOptionsStore.extractOptionsFromTasks(tasks);
      }

      // Hydration must not write on its own (#273): persist only when normalising changed something.
      if (!changed) return;
      try {
        ctx.store.$persist();
      } catch {
        // Storage unavailable - the normalised value is persisted on the next mutation instead.
      }
    },
    // No custom serializer needed!
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTasksStore, import.meta.hot));
}
