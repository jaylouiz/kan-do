/**
 * @composable useDeletedGaps
 * @description The gaps on the board (#422): the slots of cards deleted inside their undo window, plus the ones
 * gliding shut after it. Derived from the pending deletes and the open undo windows; the columns render them
 * (`utils/columnItems.ts` places them), `TaskDeletedGap` pauses and resumes the window.
 * @responsibility Read side of the delete flow for the board; the actions live in `useTaskDeletion`.
 */
import { computed } from 'vue'
import { useTasksStore, type PendingTaskDelete } from '~/store/tasks'
import { useUndoWindow } from '~/composables/useUndoWindow'
import { closingGaps } from '~/lib/deleteGapState'
import type { DeletedGap } from '~/types/deletedGap'

export function useDeletedGaps() {
  const tasksStore = useTasksStore()
  const undoWindow = useUndoWindow('delete')

  /** Every gap on the board: the open windows and the ones gliding shut. */
  const gaps = computed<DeletedGap[]>(() => {
    const open = new Set(undoWindow.openIds())
    const toGap = (pending: PendingTaskDelete, state: DeletedGap['state']): DeletedGap | null => {
      if (!pending.slot) return null
      return {
        taskId: pending.taskId,
        task: pending.task,
        fromStatus: pending.fromStatus ?? pending.task.status,
        afterId: pending.slot.afterId,
        height: pending.slot.height,
        state,
        paused: undoWindow.isPaused(pending.taskId),
        requestedAt: pending.requestedAt,
      }
    }
    const result: DeletedGap[] = []
    for (const pending of Object.values(tasksStore.pendingDeletes ?? {})) {
      if (!open.has(pending.taskId)) continue
      const gap = toGap(pending, 'open')
      if (gap) result.push(gap)
    }
    for (const pending of Object.values(closingGaps)) {
      const gap = toGap(pending, 'closing')
      if (gap) result.push(gap)
    }
    return result
  })

  /** The gaps of one column. */
  const gapsIn = (status: number) => computed(() => gaps.value.filter(gap => gap.fromStatus === status))

  return { gaps, gapsIn }
}
