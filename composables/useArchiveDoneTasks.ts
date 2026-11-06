/**
 * @composable useArchiveDoneTasks
 * @description The one archive path for done tasks: archive them locally and push the archive status upstream per task
 * source. Shared by the board's "Gesehen" button and the new-day recap (#385), so both behave the same.
 * @responsibility `archiveTasks(ids)`: the store archive and `syncArchiveStatusForTasks`. No toast and no undo (#463, D1):
 * the tasks simply leave the board; the former "Schön gemacht" toast with "Rückgängig" was the only way to restore them.
 */
import { useTasksStore } from '~/store/tasks'
import { useTaskSync } from '~/composables/useTaskSync'

export function useArchiveDoneTasks() {
  const tasksStore = useTasksStore()

  function archiveTasks(ids: string[]): void {
    if (ids.length === 0) return
    // Built on use: the board and the recap both call useArchiveDoneTasks() on every mount
    const taskSync = useTaskSync()
    tasksStore.archiveTasks(ids)
    void taskSync.syncArchiveStatusForTasks(ids)
  }

  return { archiveTasks }
}
