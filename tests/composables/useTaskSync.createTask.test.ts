/**
 * #321: `useTaskSync().createTask` on a Local + Notion board. Sequences, not single calls: a create while the
 * default source needs attention is shown at once with the marker and reaches Notion exactly once after the
 * reconnect, with the id it was born with.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
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
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  createTask: vi.fn<(draft: Partial<Task>) => Promise<Task>>(),
  archiveTask: vi.fn<(externalId: string) => Promise<void>>(),
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useSavePending } from '~/composables/useSavePending'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const networkError = () => Object.assign(new Error('Network error'), { statusCode: 0 })
const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })

const draft = (overrides: Partial<Task> = {}): Partial<Task> => ({
  title: 'Rückruf', status: TaskStatus.Open, priority: 2, topic: 'Büro', timeBoxSeconds: 900, ...overrides,
})

/** What Notion answers a create with: the page id is the task's id and externalId (D1) */
const notionPage = (pageId: string, input: Partial<Task>): Task => ({
  id: pageId, source: 'notion', externalId: pageId,
  title: input.title ?? 'Untitled', status: input.status ?? TaskStatus.Open, activity: null, topic: input.topic ?? null,
  topicColorCode: 'blue', priority: input.priority ?? 1, notes: null, timeBoxSeconds: input.timeBoxSeconds ?? null,
  timeSpentSeconds: 0, timerId: null,
})

describe('useTaskSync.createTask (#321)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.createTask.mockImplementation(async (input) => notionPage('page-new', input))
    notion.updateTask.mockImplementation(async (task) => task)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it('Local: a generated local_ id, no externalId, no upstream call, placed in its column', async () => {
    const created = await useTaskSync().createTask(draft(), 'local')
    expect(created).toMatchObject({ source: 'local', externalId: null, title: 'Rückruf', status: TaskStatus.Open })
    expect(created.id).toMatch(/^local_/)
    expect(notion.createTask).not.toHaveBeenCalled()
    expect(useTasksStore().task(created.id)).toBeTruthy()
    expect(useBoardStore().columns.find((c) => c.taskStatus === TaskStatus.Open)?.taskOrder).toContain(created.id)
    expect(useTasksStore().task(created.id)?.pendingSync).toBeUndefined()
  })

  it('Notion: the task keeps the id and externalId the integration returned, without a marker', async () => {
    const created = await useTaskSync().createTask(draft(), 'notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(created).toMatchObject({ id: 'page-new', source: 'notion', externalId: 'page-new' })
    expect(useTasksStore().task('page-new')?.pendingSync).toBeUndefined()
    expect(useBoardStore().columns.find((c) => c.taskStatus === TaskStatus.Open)?.taskOrder).toContain('page-new')
  })

  it('default needs attention, then reconnect: shown at once with the marker, created upstream exactly once, id unchanged', async () => {
    const tasksStore = useTasksStore()
    const health = useIntegrationHealthStore()
    const { isSavePending } = useSavePending()
    health.recordFailure('notion', networkError())

    const created = await useTaskSync().createTask(draft(), 'notion')
    expect(notion.createTask).not.toHaveBeenCalled()
    expect(created.id).toMatch(/^local_/)
    expect(tasksStore.task(created.id)).toMatchObject({ source: 'notion', externalId: null, title: 'Rückruf' })
    expect(tasksStore.task(created.id)?.pendingSync).toBeDefined()
    expect(isSavePending(tasksStore.task(created.id)!)).toBe(true)
    expect(tasksStore.pendingSyncTasks.map((t) => t.id)).toEqual([created.id])

    // Still down: the retry creates nothing and keeps the marker
    notion.createTask.mockRejectedValueOnce(networkError())
    await useTaskSync().syncPendingChanges('notion')
    expect(tasksStore.task(created.id)?.pendingSync).toBeDefined()
    expect(tasksStore.task(created.id)?.externalId).toBeNull()

    // Reconnect: the next sync creates the page once
    health.markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(2) // the refused retry + the one that went through
    expect(notion.updateTask).not.toHaveBeenCalled()
    const done = tasksStore.task(created.id)!
    expect(done).toMatchObject({ id: created.id, source: 'notion', externalId: 'page-new' })
    expect(done.pendingSync).toBeUndefined()
    expect(isSavePending(done)).toBe(false)
    expect(tasksStore.tasks.filter((t) => t.title === 'Rückruf')).toHaveLength(1)
  })

  it('a browser that is offline does not call the adapter and shows the marker', async () => {
    const tasksStore = useTasksStore()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const created = await useTaskSync().createTask(draft(), 'notion')
    expect(notion.createTask).not.toHaveBeenCalled()
    expect(tasksStore.task(created.id)?.pendingSync?.lastError).toBeTruthy()
    expect(useSavePending().isSavePending(tasksStore.task(created.id)!)).toBe(true)
  })

  it.each([
    ['no connection', networkError(), 'offline', 0],
    ['a rejected token', httpError(401), 'broken', 1],
  ])('%s: the task is kept with the marker and the source health records it', async (_name, error, status, toasts) => {
    notion.createTask.mockRejectedValueOnce(error)
    const created = await useTaskSync().createTask(draft(), 'notion')
    const stored = useTasksStore().task(created.id)
    expect(stored).toMatchObject({ source: 'notion', externalId: null })
    expect(stored?.pendingSync).toMatchObject({ attempts: 1, lastError: error.message })
    expect(useIntegrationHealthStore().statusOf('notion')).toBe(status)
    // Plain offline is quiet; any other source fault is reported once, as the form closes like on success
    expect(handleErrorMock).toHaveBeenCalledTimes(toasts)
  })

  it.each([
    ['no access to the database (403)', 403],
    ['a server error (503)', 503],
  ])('%s: kept with the task-scoped marker and reported once, the source stays healthy (as for an update)', async (_name, status) => {
    notion.createTask.mockRejectedValueOnce(httpError(status))
    const created = await useTaskSync().createTask(draft(), 'notion')
    expect(useTasksStore().task(created.id)).toMatchObject({ source: 'notion', externalId: null })
    expect(useTasksStore().task(created.id)?.pendingSync).toMatchObject({ attempts: 1, lastError: `HTTP ${status}` })
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')
    expect(handleErrorMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['invalid (400)', 400],
    ['the database is gone (404)', 404],
    ['in conflict (409)', 409],
  ])('a create Notion refuses as %s throws, adds nothing, queues nothing and leaves the source healthy', async (_name, status) => {
    notion.createTask.mockRejectedValueOnce(httpError(status))
    await expect(useTaskSync().createTask(draft(), 'notion')).rejects.toThrow(`HTTP ${status}`)
    expect(useTasksStore().tasks).toHaveLength(0)
    expect(useTasksStore().pendingSyncTasks).toHaveLength(0)
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
  })

  it('a create offline, then the reconnect: exactly one page, the id unchanged', async () => {
    const tasksStore = useTasksStore()
    notion.createTask.mockRejectedValueOnce(networkError())
    const created = await useTaskSync().createTask(draft(), 'notion')
    expect(notion.createTask).toHaveBeenCalledTimes(1)
    expect(tasksStore.task(created.id)?.pendingSync).toBeDefined()

    useIntegrationHealthStore().markHealthy('notion')
    await useTaskSync().syncPendingChanges('notion')
    await useTaskSync().syncPendingChanges('notion')
    expect(notion.createTask).toHaveBeenCalledTimes(2) // the refused first try + the one page
    expect(tasksStore.task(created.id)).toMatchObject({ id: created.id, externalId: 'page-new' })
    expect(tasksStore.task(created.id)?.pendingSync).toBeUndefined()
    expect(tasksStore.tasks.filter((t) => t.title === 'Rückruf')).toHaveLength(1)
  })

  it('a task created pending in Jetzt keeps its status, time and flags for the later push', async () => {
    useIntegrationHealthStore().recordFailure('notion', networkError())
    const created = await useTaskSync().createTask(
      draft({ status: TaskStatus.Progress, timeSpentSeconds: 42, isUnplanned: true }),
      'notion',
    )
    expect(useTasksStore().task(created.id)).toMatchObject({ status: TaskStatus.Progress, timeSpentSeconds: 42, isUnplanned: true })
    expect(useBoardStore().columns.find((c) => c.taskStatus === TaskStatus.Progress)?.taskOrder).toContain(created.id)
  })
})
