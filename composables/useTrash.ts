/**
 * @composable useTrash
 * @description The trash of deleted tasks (#422) as the UI uses it: the entries (newest first), the 3 most
 * recent for the sheet, the Heute / Gestern / Früher groups for the page, and the three actions. A restore
 * goes through `useTaskSync.restoreTask`; a failure keeps the entry and reports through `useErrorHandler`
 * (`task_restore`). Remove-forever and "Papierkorb leeren" only purge kan-do's trash and never touch the source.
 * @responsibility Trash actions and derived lists; the entries live in `store/trash.ts`, the upstream part in `useTaskSync`.
 */
import { computed, ref } from 'vue'
import { useTrashStore } from '~/store/trash'
import { useTasksStore } from '~/store/tasks'
import { useTaskDeletion } from '~/composables/useTaskDeletion'
import type { TrashEntry } from '~/types/trash'
import { useTaskSync } from '~/composables/useTaskSync'
import { useErrorHandler } from '~/composables/useErrorHandler'
import { groupTrashByDay, TRASH_SHEET_LIMIT } from '~/lib/trash'

/** Entries whose restore is running (one at a time per entry, shared across instances). */
const restoring = ref<string[]>([])

export function useTrash() {
  const trashStore = useTrashStore()
  const { restoreTask } = useTaskSync()
  const { handleError } = useErrorHandler()

  const tasksStore = useTasksStore()
  const { undoDelete, isUndoOpen } = useTaskDeletion()

  /**
   * A delete inside its undo window is already in the trash (#27): its entry is derived from the pending
   * delete, restoring it is the undo. Once the window closes the real entry replaces it (same task id).
   */
  const pendingEntries = computed<TrashEntry[]>(() => Object.values(tasksStore.pendingDeletes)
    .filter(pending => pending.state === 'waiting' && isUndoOpen(pending.taskId) && !trashStore.entry(pending.taskId))
    .map(pending => ({
      taskId: pending.taskId,
      task: { ...pending.task, timerId: null },
      deletedAt: pending.requestedAt,
      fromStatus: pending.fromStatus ?? pending.task.status,
      carryOver: pending.carryOver,
    })))
  const entries = computed(() => [...pendingEntries.value, ...trashStore.entries].sort((a, b) => b.deletedAt - a.deletedAt))
  const recent = computed(() => entries.value.slice(0, TRASH_SHEET_LIMIT))
  const count = computed(() => entries.value.length)
  const hasMore = computed(() => count.value > recent.value.length)
  const groups = computed(() => groupTrashByDay(entries.value, Date.now()))

  const isRestoring = (taskId: string): boolean => restoring.value.includes(taskId)

  /** Restores the entry; resolves to whether it is back on the board. A failure keeps it in the trash. */
  async function restoreFromTrash(taskId: string): Promise<boolean> {
    const pending = pendingEntries.value.find(item => item.taskId === taskId)
    if (pending) {
      undoDelete(taskId)
      return !!tasksStore.task(taskId)
    }
    const entry = trashStore.entry(taskId)
    if (!entry || isRestoring(taskId)) return false
    restoring.value = [...restoring.value, taskId]
    try {
      await restoreTask(entry)
      return true
    } catch (error) {
      handleError(error instanceof Error ? error : String(error), 'task_restore')
      return false
    } finally {
      restoring.value = restoring.value.filter(id => id !== taskId)
    }
  }

  function removeForever(taskId: string): void {
    trashStore.remove(taskId)
  }

  function emptyTrash(): void {
    trashStore.clear()
  }

  return { entries, recent, count, hasMore, groups, isRestoring, restoreFromTrash, removeForever, emptyTrash }
}
