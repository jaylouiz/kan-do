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
import { useTaskSync } from '~/composables/useTaskSync'
import { useErrorHandler } from '~/composables/useErrorHandler'
import { groupTrashByDay } from '~/lib/trash'

/** Entries whose restore is running (one at a time per entry, shared across instances). */
const restoring = ref<string[]>([])

export function useTrash() {
  const trashStore = useTrashStore()
  const { restoreTask } = useTaskSync()
  const { handleError } = useErrorHandler()

  const entries = computed(() => trashStore.entries)
  const recent = computed(() => trashStore.recent)
  const count = computed(() => trashStore.count)
  const hasMore = computed(() => trashStore.count > trashStore.recent.length)
  const groups = computed(() => groupTrashByDay(trashStore.entries, Date.now()))

  const isRestoring = (taskId: string): boolean => restoring.value.includes(taskId)

  /** Restores the entry; resolves to whether it is back on the board. A failure keeps it in the trash. */
  async function restoreFromTrash(taskId: string): Promise<boolean> {
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
