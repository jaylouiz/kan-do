/**
 * #4: a total the user set is pushed with `timeEdited` (Notion writes it even at 0), survives a fetch of the
 * older, higher Notion value while the push waits (offline), and is an ordinary max-merge task once pushed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(),
  }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task, change?: { timeEdited?: boolean }) => Promise<Task>>(),
}
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({ isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null } } }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { mapHelpers } from '~/utils/mapHelpers'
/* eslint-enable import/first */

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, source: 'notion', externalId: `page-${id}`, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

describe('a user-set total reaches Notion and holds against a fetch (#4)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    Object.values(notion).forEach((fn) => fn.mockReset())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([task('n1', { timeSpentSeconds: 7200 })])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it('pushes the lowered total with timeEdited and keeps it afterwards', async () => {
    const store = useTasksStore()
    notion.updateTask.mockImplementation(async (t) => ({ ...t })) // Notion now holds what was written
    store.setTimeSpent('n1', 1800)

    await useTaskSync().syncTaskToIntegration(store.task('n1')!)

    expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', timeSpentSeconds: 1800 }), { timeEdited: true })
    expect(store.task('n1')?.timeSpentSeconds).toBe(1800)
    expect(mapHelpers.has(store.pendingTimeUpdates, 'n1')).toBe(false) // the push carried it: the flag is gone
  })

  it('a push at 0 is a time edit too', async () => {
    const store = useTasksStore()
    notion.updateTask.mockImplementation(async (t) => ({ ...t }))
    store.setTimeSpent('n1', 0)

    await useTaskSync().syncTaskToIntegration(store.task('n1')!)

    expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ timeSpentSeconds: 0 }), { timeEdited: true })
    expect(store.task('n1')?.timeSpentSeconds).toBe(0)
  })

  it('an ordinary push carries no timeEdited', async () => {
    const store = useTasksStore()
    notion.updateTask.mockImplementation(async (t) => ({ ...t }))

    await useTaskSync().updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })

    expect(notion.updateTask).toHaveBeenCalledTimes(1)
    expect(notion.updateTask.mock.calls[0]?.[1]).toBeUndefined() // no time edit flag on an ordinary write
    expect(store.task('n1')?.timeSpentSeconds).toBe(7200)
  })

  it('offline: a fetch with the old higher value does not undo the edit; the later push does the write', async () => {
    const store = useTasksStore()
    notion.updateTask.mockRejectedValueOnce(Object.assign(new Error('Network error'), { statusCode: 0 }))
    store.setTimeSpent('n1', 1800)
    await useTaskSync().syncTaskToIntegration(store.task('n1')!)
    expect(store.task('n1')?.pendingSync).toBeDefined()

    store.mergeTasks('notion', [task('n1', { timeSpentSeconds: 7200 })]) // the fetch is older than the edit
    expect(store.task('n1')?.timeSpentSeconds).toBe(1800)

    notion.updateTask.mockImplementation(async (t) => ({ ...t }))
    await useTaskSync().syncPendingChanges()
    expect(notion.updateTask).toHaveBeenLastCalledWith(expect.objectContaining({ timeSpentSeconds: 1800 }), { timeEdited: true })
    expect(store.task('n1')?.pendingSync).toBeUndefined()
    expect(store.task('n1')?.timeSpentSeconds).toBe(1800)
  })
})
