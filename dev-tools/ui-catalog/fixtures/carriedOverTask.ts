import type { CatalogFixture } from '../useCatalog'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'

/** The Offen or Jetzt task of the sample's demo board that has been carried over the longest, which is when the triage nudge shows (host `board`). */
const fixture: CatalogFixture = () => {
  const tasks = useTasksStore()
  const [id] = Object.entries(tasks.carryOverByTaskId)
    .filter(([taskId]) => {
      const status = tasks.task(taskId)?.status
      return status === TaskStatus.Open || status === TaskStatus.Progress
    })
    .sort(([, a], [, b]) => b.days - a.days)[0] ?? []
  return { taskId: id ?? null }
}
export default fixture
