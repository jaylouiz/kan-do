/**
 * @composable useTaskMove
 * @description Moves a task to another source with undo (#322, epic #264 D3). Phase 1 is local and immediate:
 * the task takes the target as its source (`tasksStore.reassignSource`) and an undo toast opens. Nothing goes
 * upstream while it is open, so Undo never touches a source. Phase 2 runs once the toast has closed
 * (`useTaskSync.commitTaskMove`): the target creates the task, then the origin copy is removed. Closing the
 * app inside the window is not an undo; `resumePendingMoves` commits what is left on the next start.
 * A move the target refuses for good brings the task back and shows "Verschieben fehlgeschlagen" with a retry.
 * @responsibility Toast, undo window and phase 1; the upstream work lives in useTaskSync.
 */
import { translate } from '~/lib/i18n'
import { onTaskMoveRejected, type TaskMoveRejection } from '~/lib/taskMoveEvents'
import { useTasksStore } from '~/store/tasks'
import { useTaskSync } from '~/composables/useTaskSync'
import { resetUndoWindows, useUndoWindow } from '~/composables/useUndoWindow'
import { SOURCE_META } from '~/utils/sourceMeta'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'

export const MOVE_UNDO_WINDOW_MS = 5000
const FAILURE_TOAST_MS = 10000
const TITLE_MAX_LENGTH = 40

type Previous = NonNullable<ReturnType<ReturnType<typeof useTasksStore>['reassignSource']>>

/** What each open window needs to undo its move (not persisted: closing the app is not an undo). */
const undoSnapshots = new Map<string, Previous>()

/** The latest instance serves the failure toast, whichever surface committed the move. */
let failureToast: ((rejection: TaskMoveRejection) => void) | null = null
let unsubscribe: (() => void) | null = null

const shortTitle = (title: string): string =>
  title.length > TITLE_MAX_LENGTH ? `${title.substring(0, TITLE_MAX_LENGTH)}...` : title

export function useTaskMove() {
  const tasksStore = useTasksStore()
  const { commitTaskMove, commitPendingMoves } = useTaskSync()
  const undoWindow = useUndoWindow('move')
  const { toast } = undoWindow

  const sourceName = (source: SourceId): string => translate(SOURCE_META[source].nameKey)

  function undoMove(taskId: string, toastId: string): void {
    if (!undoWindow.cancel(taskId)) return
    const previous = undoSnapshots.get(taskId)
    undoSnapshots.delete(taskId)
    tasksStore.releaseMove(taskId)
    tasksStore.restoreMoveOrigin(taskId, previous)
    toast.remove(toastId)
  }

  /** The window has closed (the toast is gone): from here the move may go upstream. */
  function commitMove(taskId: string): void {
    undoSnapshots.delete(taskId)
    tasksStore.releaseMove(taskId)
    void commitTaskMove(taskId)
  }

  /**
   * Moves the task to `target` at once and shows the undo toast; the upstream create and the removal of the
   * origin copy wait until the toast has closed. Returns false when there is nothing to move: the task is
   * unknown, already in `target`, or has a move that is not finished.
   */
  function moveTaskToSource(taskId: string, target: SourceId): boolean {
    const previous = tasksStore.reassignSource(taskId, target)
    if (!previous) return false
    tasksStore.holdMove(taskId)
    undoSnapshots.set(taskId, previous)

    const toastId = `move-task-${taskId}`
    toast.add({
      id: toastId,
      title: translate('task.move.done', { source: sourceName(target) }),
      description: shortTitle(tasksStore.task(taskId)?.title ?? ''),
      icon: SOURCE_META[target].icon,
      color: 'neutral',
      duration: MOVE_UNDO_WINDOW_MS,
      'onUpdate:open': (open: boolean) => {
        if (!open) undoWindow.close(taskId)
      },
      actions: [
        {
          label: translate('common.undo'),
          color: 'primary',
          variant: 'solid',
          // The action's own auto-close would report the toast as closed (= commit) before Undo runs.
          closeOnClick: false,
          onClick: () => undoMove(taskId, toastId),
        },
      ],
    })
    undoWindow.begin(taskId, toastId, MOVE_UNDO_WINDOW_MS, () => commitMove(taskId))
    return true
  }

  failureToast = (rejection) => {
    toast.add({
      id: `move-failed-${rejection.taskId}`,
      title: translate('task.move.failed'),
      description: translate('task.move.failedDescription', { title: shortTitle(rejection.title), source: sourceName(rejection.fromSource) }),
      icon: 'i-ph-warning',
      color: 'error',
      duration: FAILURE_TOAST_MS,
      actions: [
        {
          label: translate('task.move.retry'),
          color: 'neutral',
          variant: 'solid',
          // Retrying repeats the whole move, undo window included
          onClick: () => { moveTaskToSource(rejection.taskId, rejection.toSource) },
        },
      ],
    })
  }
  unsubscribe ??= onTaskMoveRejected(rejection => failureToast?.(rejection))

  /**
   * Continues every move that is not inside an undo window: left over from a closed app, or queued while the
   * target was unreachable or the origin copy could not be removed. Call on board start and on reconnect.
   */
  async function resumePendingMoves(): Promise<void> {
    await commitPendingMoves()
  }

  /** Whether a task shows the unfinished-move state ("Wird gespeichert" on the entry). */
  const hasOutstandingMove = (task: Pick<Task, 'pendingMove'>): boolean => task.pendingMove !== undefined

  return { moveTaskToSource, resumePendingMoves, hasOutstandingMove }
}

/** Test helper: forgets open undo windows and the failure listener between tests. */
export function resetTaskMoveState(): void {
  resetUndoWindows()
  undoSnapshots.clear()
  unsubscribe?.()
  unsubscribe = null
  failureToast = null
}
