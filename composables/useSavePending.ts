/**
 * @composable useSavePending
 * @description Whether a card shows the cloud "save pending" icon (#319). It does while the task has changes
 * its source does not hold yet AND either the source cannot sync right now (offline, rejected, failing) or
 * the push of this task was refused (`pendingSync.lastError`, e.g. a 404 on its page). A push in flight
 * without an error never shows it, so an ordinary write never flashes it; a Local task never shows it.
 * Cards show no other source state: the sync button names the source that is the problem.
 */
import { useTasksStore } from '~/store/tasks'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { isIntegrationSourceId } from '~/lib/taskSources'
import type { Task } from '~/types/task'

export function useSavePending() {
  const tasksStore = useTasksStore()
  const health = useIntegrationHealthStore()

  const isSavePending = (task: Pick<Task, 'id' | 'source' | 'pendingSync'>): boolean =>
    isIntegrationSourceId(task.source)
    && tasksStore.isSyncPending(task.id)
    && (health.needsAttention(task.source) || !!task.pendingSync?.lastError)

  return { isSavePending } as const
}
