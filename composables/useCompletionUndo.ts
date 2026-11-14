/**
 * @composable useCompletionUndo
 * @description Undo toast for task completion. The command palette, context menu and task sheet
 * (via `useTaskOperations`) capture a snapshot with `captureCompletionSnapshot` BEFORE the move
 * and call `notifyCompleted` AFTER it. The drag path of a single card shows no toast (#136): the
 * in-card check and the drop announcement confirm it, undo is the reverse drag.
 * Exception (#150): a whole stack dropped in Erledigt shows ONE toast for all its members
 * (`captureCompletionSnapshots` / `notifyCompletedBlock` / `undoCompletions`), because after a merge
 * the reverse drag would also move the tasks that were done before.
 * Undo is an inverse transition through `useTaskSync().updateTaskStatus`.
 * @responsibility Toast + restore; never decides whether a move is allowed.
 */
import { liveTimeSpent } from '~/lib/liveTime'
import { useToast } from '#imports'
import { useI18n } from 'vue-i18n'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskSync } from '~/composables/useTaskSync'
import { TaskStatus } from '~/types/taskStatus'
import { MAX_TASKS_IN_PROGRESS } from '~/utils/wipGuard'
import type { CarryOverEntry } from '~/utils/carryOver'
import { mapHelpers } from '~/utils/mapHelpers'

const TOAST_DURATION_MS = 5000
const TITLE_MAX_LENGTH = 40

export interface CompletionSnapshot {
  taskId: string
  previousStatus: TaskStatus
  /** Index inside the previous column's displayed order, or null when unknown. */
  previousIndex: number | null
  previousCompletedAt: Date | null
  previousTimeSpentSeconds: number
  /** Carried-over counter before the completion (#99): undo is not a real move, so it comes back. */
  previousCarryOver: CarryOverEntry | null
}

export function useCompletionUndo() {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const { updateTaskStatus } = useTaskSync()
  const toast = useToast()
  const { t } = useI18n()

  const columnTasks = (status: TaskStatus) => {
    switch (status) {
      case TaskStatus.Open: return tasksStore.tasksOpen
      case TaskStatus.Progress: return tasksStore.tasksProgress
      case TaskStatus.Waiting: return tasksStore.tasksWaiting
      default: return []
    }
  }

  /**
   * Captures what undo needs. Call before the task leaves its column.
   * Returns null when the move is not a completion (task missing or already Done).
   */
  function captureCompletionSnapshot(taskId: string, previousIndex?: number | null): CompletionSnapshot | null {
    const task = tasksStore.task(taskId)
    if (!task || task.status === TaskStatus.Done) return null
    const index = previousIndex ?? columnTasks(task.status).findIndex(el => el.id === taskId)
    return {
      taskId,
      previousStatus: task.status,
      previousIndex: index >= 0 ? index : null,
      previousCompletedAt: task.completedAt ?? null,
      // Stored time plus the seconds a running timer has not written yet (#286): what the stop flush is about to write
      previousTimeSpentSeconds: liveTimeSpent(task),
      previousCarryOver: mapHelpers.get(tasksStore.carryOverByTaskId, taskId) ?? null,
    }
  }

  /**
   * Captures every task of a block about to complete, each with its index in the column as it is
   * now. Tasks that are missing or already done are left out. Call before any of them moves.
   */
  function captureCompletionSnapshots(taskIds: readonly string[]): CompletionSnapshot[] {
    return taskIds.flatMap((taskId) => {
      const snapshot = captureCompletionSnapshot(taskId)
      return snapshot ? [snapshot] : []
    })
  }

  /**
   * Restores the task. No-op when it was deleted, archived or already moved out of Done.
   * `after` holds back the upstream write (a block restores one task after another).
   */
  async function undoCompletion(snapshot: CompletionSnapshot, after?: Promise<unknown>): Promise<void> {
    const { taskId } = snapshot
    // The in-card done confirmation (#124) must not play on, nor follow the card back
    boardStore.clearConfirmation(taskId)
    const task = tasksStore.task(taskId)
    if (!task || task.status !== TaskStatus.Done || tasksStore.archivedTaskIds.includes(taskId)) return

    // WIP limit: a full "Jetzt" sends the task to "Wartet" instead (no position restore).
    const intoFullProgress =
      snapshot.previousStatus === TaskStatus.Progress
      && tasksStore.tasksProgress.length >= MAX_TASKS_IN_PROGRESS
    const target = intoFullProgress ? TaskStatus.Waiting : snapshot.previousStatus

    // A bumped version makes a still-in-flight completion response stale.
    const operationVersion = tasksStore.incrementTaskOperationVersion(taskId)

    // The sync call applies the local change synchronously, then awaits the upstream write.
    const sync = updateTaskStatus({ taskId, status: target, operationVersion, ...(after ? { after } : {}) })
    tasksStore.updateTask(taskId, {
      completedAt: snapshot.previousCompletedAt,
      timeSpentSeconds: snapshot.previousTimeSpentSeconds,
    })
    boardStore.moveTaskToIndex(taskId, target, TaskStatus.Done, intoFullProgress ? null : snapshot.previousIndex)
    tasksStore.restoreCarryOver(taskId, snapshot.previousCarryOver)

    const lock = tasksStore.lockTaskStatus(taskId)
    try {
      await sync
    } finally {
      tasksStore.unlockTaskStatus(taskId, lock)
    }
  }

  /**
   * Restores a block in one go. Every task is back locally at once, in ascending previous index so
   * each lands at its old place; the upstream writes run one after another.
   */
  async function undoCompletions(snapshots: readonly CompletionSnapshot[]): Promise<void> {
    const ordered = [...snapshots].sort((a, b) => (a.previousIndex ?? Infinity) - (b.previousIndex ?? Infinity))
    let previous: Promise<void> = Promise.resolve()
    for (const snapshot of ordered) previous = undoCompletion(snapshot, previous)
    await previous
  }

  /** Shows the undo toast for a finished completion. Call after the move. */
  function notifyCompleted(snapshot: CompletionSnapshot | null): void {
    if (!snapshot) return
    const task = tasksStore.task(snapshot.taskId)
    if (!task) return
    const id = `complete-task-${snapshot.taskId}`
    const title = task.title
    toast.add({
      id,
      title: t('task.completed'),
      description: title.length > TITLE_MAX_LENGTH ? `${title.substring(0, TITLE_MAX_LENGTH)}...` : title,
      icon: 'i-ph-check-circle',
      color: 'neutral',
      duration: TOAST_DURATION_MS,
      actions: [
        {
          label: t('common.undo'),
          color: 'primary',
          variant: 'solid',
          onClick: () => {
            toast.remove(id)
            void undoCompletion(snapshot)
          },
        },
      ],
    })
  }

  /** One undo toast for a block completed together (a whole stack, #150). Call after the move. */
  function notifyCompletedBlock(snapshots: readonly CompletionSnapshot[]): void {
    const [first, ...rest] = snapshots
    if (!first) return
    if (rest.length === 0) {
      notifyCompleted(first)
      return
    }
    const id = `complete-tasks-${first.taskId}`
    toast.add({
      id,
      title: t('task.completedMany', { n: snapshots.length }, snapshots.length),
      icon: 'i-ph-check-circle',
      color: 'neutral',
      duration: TOAST_DURATION_MS,
      actions: [
        {
          label: t('common.undo'),
          color: 'primary',
          variant: 'solid',
          onClick: () => {
            toast.remove(id)
            void undoCompletions(snapshots)
          },
        },
      ],
    })
  }

  return {
    captureCompletionSnapshot,
    captureCompletionSnapshots,
    notifyCompleted,
    notifyCompletedBlock,
    undoCompletion,
    undoCompletions,
  }
}
