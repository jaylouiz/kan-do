/**
 * #319: sequences of the pending-sync marker on a Notion + Local board. A change made while the source
 * cannot be reached keeps its marker (and shows the cloud); the next successful sync clears it; a healthy
 * source never shows the cloud; a failing source is reported once, never opens a dialog, and the sync
 * picks the work up again after a recovery.
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
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useSavePending } from '~/composables/useSavePending'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { mapHelpers } from '~/utils/mapHelpers'
/* eslint-enable import/first */

const networkError = () => Object.assign(new Error('Network error'), { statusCode: 0 })
const unauthorized = () => Object.assign(new Error('Unauthorized'), { statusCode: 401 })
const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })

function task(id: string, source: Task['source'], overrides: Partial<Task> = {}): Task {
  return {
    id, source, externalId: source === 'local' ? null : `page-${id}`,
    title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

describe('pending-sync marker sequences (#319)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.updateTask.mockImplementation(async (t) => t)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useTasksStore().setTasks([task('l1', 'local'), task('n1', 'notion')])
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => vi.restoreAllMocks())

  it('a change while Notion is offline keeps the marker and shows the cloud; after the reconnect the next sync clears both', async () => {
    const tasksStore = useTasksStore()
    const health = useIntegrationHealthStore()
    const { isSavePending } = useSavePending()
    notion.updateTask.mockRejectedValueOnce(networkError())

    await useTaskSync().updateTaskStatus({ taskId: 'n1', status: TaskStatus.Progress })

    expect(tasksStore.task('n1')?.status).toBe(TaskStatus.Progress) // the change stays local
    expect(tasksStore.task('n1')?.pendingSync).toMatchObject({ attempts: 1, lastError: 'Network error' })
    expect(health.statusOf('notion')).toBe('offline')
    expect(isSavePending(tasksStore.task('n1')!)).toBe(true)

    await useTaskSync().syncPendingChanges() // back online

    expect(notion.updateTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'n1', status: TaskStatus.Progress }))
    expect(tasksStore.task('n1')?.pendingSync).toBeUndefined()
    expect(isSavePending(tasksStore.task('n1')!)).toBe(false)
  })

  it('a healthy sync never shows the cloud, not even while the write is in flight', async () => {
    const tasksStore = useTasksStore()
    const { isSavePending } = useSavePending()
    let release: (t: Task) => void = () => {}
    notion.updateTask.mockImplementationOnce(() => new Promise<Task>((resolve) => { release = resolve }))

    const write = useTaskSync().updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })
    await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalled())

    expect(tasksStore.task('n1')?.pendingSync).toBeDefined() // marked for the crash case...
    expect(isSavePending(tasksStore.task('n1')!)).toBe(false) // ...but the source is healthy: no cloud

    release(tasksStore.task('n1')!)
    await write
    expect(tasksStore.task('n1')?.pendingSync).toBeUndefined()
  })

  it('a Local task never carries a marker or shows the cloud', async () => {
    const tasksStore = useTasksStore()
    useIntegrationHealthStore().markOffline('notion', 'Network error')

    await useTaskSync().updateTaskStatus({ taskId: 'l1', status: TaskStatus.Done })

    expect(tasksStore.task('l1')?.pendingSync).toBeUndefined()
    expect(useSavePending().isSavePending(tasksStore.task('l1')!)).toBe(false)
  })

  it('a change made while the write is in flight keeps the marker for the next push', async () => {
    const tasksStore = useTasksStore()
    let release: (t: Task) => void = () => {}
    notion.updateTask.mockImplementationOnce(() => new Promise<Task>((resolve) => { release = resolve }))

    const write = useTaskSync().updateTaskStatus({ taskId: 'n1', status: TaskStatus.Waiting })
    await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalled())
    tasksStore.markPendingSync('n1') // another local change, e.g. notes
    release(tasksStore.task('n1')!)
    await write

    expect(tasksStore.task('n1')?.pendingSync).toBeDefined()
  })

  it('a failing source is reported once, a retry of the periodic sync stays quiet, and no dialog opens', async () => {
    notion.updateTask.mockRejectedValue(unauthorized())
    const { updateTaskStatus, syncPendingChanges } = useTaskSync()

    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Progress })
    await syncPendingChanges()
    await syncPendingChanges()

    expect(handleErrorMock).toHaveBeenCalledTimes(1)
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('broken')
    expect(useTasksStore().task('n1')?.pendingSync?.attempts).toBe(3)
  })

  it('queued time is pushed with the marker and keeps its failed state between attempts', async () => {
    const tasksStore = useTasksStore()
    tasksStore.updateTask('n1', { timeSpentSeconds: 90 })
    tasksStore.addPendingTimeUpdate('n1', 90)
    notion.updateTask.mockRejectedValueOnce(networkError())

    await useTaskSync().syncPendingChanges()

    expect(mapHelpers.get(tasksStore.pendingTimeUpdates, 'n1')).toMatchObject({ status: 'failed', attemptCount: 1 })
    expect(tasksStore.task('n1')?.pendingSync).toMatchObject({ attempts: 1 })
    expect(useSavePending().isSavePending(tasksStore.task('n1')!)).toBe(true)

    await useTaskSync().syncPendingChanges()

    expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'n1')).toBe(false)
    expect(tasksStore.task('n1')?.pendingSync).toBeUndefined()
  })

  it('a fetch of the recovered source keeps the unpushed local state, pushes it and clears the marker', async () => {
    const tasksStore = useTasksStore()
    notion.updateTask.mockRejectedValueOnce(networkError())
    await useTaskSync().updateTaskStatus({ taskId: 'n1', status: TaskStatus.Done })
    expect(tasksStore.task('n1')?.pendingSync).toBeDefined()

    notion.fetchActiveBoardTasks.mockResolvedValue([task('n1', 'notion', { status: TaskStatus.Open })]) // the source's older copy
    await useIntegrationManager().fetchTasks()

    expect(notion.updateTask).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'n1', status: TaskStatus.Done }))
    expect(tasksStore.task('n1')).toMatchObject({ status: TaskStatus.Done })
    expect(tasksStore.task('n1')?.pendingSync).toBeUndefined()
    expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')
  })

  it('a task made while Notion was unreachable is created there by the next sync, keeping its id', async () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask(task('local_9', 'notion', { externalId: null, title: 'Offline task' }))
    tasksStore.markPendingSync('local_9')
    notion.createTask.mockResolvedValue(task('page-new', 'notion', { externalId: 'page-new', title: 'Offline task' }))

    await useTaskSync().syncPendingChanges()

    expect(notion.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Offline task' }))
    expect(tasksStore.task('local_9')).toMatchObject({ id: 'local_9', externalId: 'page-new' })
    expect(tasksStore.task('local_9')?.pendingSync).toBeUndefined()
    expect(notion.updateTask).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'local_9' }))
  })

  it('deleting a task that never reached Notion sends nothing upstream', async () => {
    const tasksStore = useTasksStore()
    const created = task('local_9', 'notion', { externalId: null })
    tasksStore.addTask(created)
    tasksStore.markPendingSync('local_9')
    tasksStore.addPendingDelete({ taskId: 'local_9', task: created, carryOver: undefined, state: 'waiting', deadline: 0 } as never)

    const result = await useTaskSync().commitTaskDelete('local_9')

    expect(result).toBe('committed')
    expect(notion.archiveTask).not.toHaveBeenCalled()
  })

  it('queued time of a Local task is dropped by the sync instead of lingering (#336)', async () => {
    const tasksStore = useTasksStore()
    mapHelpers.set(tasksStore.pendingTimeUpdates, 'l1', {
      taskId: 'l1', timeSpentSeconds: 30, createdAt: new Date(), lastAttemptAt: null, attemptCount: 0, status: 'pending',
    })

    await useTaskSync().syncPendingChanges()

    expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'l1')).toBe(false)
    expect(notion.updateTask).not.toHaveBeenCalled()
  })

  describe('review fixes (#319)', () => {
    const toasts = () => handleErrorMock.mock.calls.length

    it('a write that keeps failing while reads work toasts at most once over three refreshes', async () => {
      notion.updateTask.mockRejectedValue(httpError(500))
      notion.fetchActiveBoardTasks.mockResolvedValue([task('n1', 'notion')])
      const { updateTaskStatus, syncPendingChanges } = useTaskSync()
      const { fetchTasks } = useIntegrationManager()

      await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Progress })
      for (let refresh = 0; refresh < 3; refresh++) {
        await syncPendingChanges()
        await fetchTasks()
      }

      expect(toasts()).toBeLessThanOrEqual(1)
      expect(useTasksStore().task('n1')?.pendingSync).toMatchObject({ lastError: 'HTTP 500' })
    })

    it('a rejected token on the write toasts once even though every fetch resets the health in between', async () => {
      notion.updateTask.mockRejectedValue(unauthorized())
      notion.fetchActiveBoardTasks.mockResolvedValue([task('n1', 'notion')])
      const { updateTaskStatus, syncPendingChanges } = useTaskSync()
      const { fetchTasks } = useIntegrationManager()

      await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Progress })
      for (let refresh = 0; refresh < 3; refresh++) {
        await syncPendingChanges()
        await fetchTasks()
      }

      expect(toasts()).toBe(1)
    })

    it('two overlapping pushes of a task made offline create exactly one page', async () => {
      const tasksStore = useTasksStore()
      tasksStore.addTask(task('local_9', 'notion', { externalId: null, title: 'Offline task' }))
      tasksStore.markPendingSync('local_9')
      let release: (t: Task) => void = () => {}
      notion.createTask.mockImplementation(() => new Promise<Task>((resolve) => { release = resolve }))
      notion.fetchActiveBoardTasks.mockResolvedValue([task('n1', 'notion'), task('page-new', 'notion', { externalId: 'page-new', title: 'Offline task' })])
      const { syncPendingChanges } = useTaskSync()

      const pushes = Promise.all([syncPendingChanges(), syncPendingChanges(), useIntegrationManager().fetchTasks()])
      await vi.waitFor(() => expect(notion.createTask).toHaveBeenCalled())
      release(task('page-new', 'notion', { externalId: 'page-new', title: 'Offline task' }))
      await pushes

      expect(notion.createTask).toHaveBeenCalledTimes(1)
      expect(tasksStore.task('local_9')).toMatchObject({ externalId: 'page-new' })
      expect(tasksStore.task('local_9')?.pendingSync).toBeUndefined()
    })

    it('a later change of a task that is being created waits for the create and updates the new page', async () => {
      const tasksStore = useTasksStore()
      tasksStore.addTask(task('local_9', 'notion', { externalId: null, title: 'Offline task' }))
      tasksStore.markPendingSync('local_9')
      let release: (t: Task) => void = () => {}
      notion.createTask.mockImplementation(() => new Promise<Task>((resolve) => { release = resolve }))

      const push = useTaskSync().syncPendingChanges()
      await vi.waitFor(() => expect(notion.createTask).toHaveBeenCalled())
      const move = useTaskSync().updateTaskStatus({ taskId: 'local_9', status: TaskStatus.Progress })
      release(task('page-new', 'notion', { externalId: 'page-new', title: 'Offline task' }))
      await Promise.all([push, move])

      expect(notion.createTask).toHaveBeenCalledTimes(1)
      expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'local_9', externalId: 'page-new' }))
    })

    it('a 404 on one page leaves the source healthy, marks only that task and still pushes the others', async () => {
      const tasksStore = useTasksStore()
      tasksStore.addTask(task('n2', 'notion'))
      tasksStore.addTask(task('n3', 'notion'))
      for (const id of ['n1', 'n2', 'n3']) tasksStore.markPendingSync(id)
      notion.updateTask.mockImplementation(async (t) => {
        if (t.id === 'n2') throw httpError(404)
        return t
      })

      await useTaskSync().syncPendingChanges()

      expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')
      expect(notion.updateTask).toHaveBeenCalledTimes(3)
      expect(tasksStore.task('n1')?.pendingSync).toBeUndefined()
      expect(tasksStore.task('n3')?.pendingSync).toBeUndefined()
      expect(tasksStore.task('n2')?.pendingSync).toMatchObject({ attempts: 1, lastError: 'HTTP 404' })
      expect(useSavePending().isSavePending(tasksStore.task('n2')!)).toBe(true)

      notion.updateTask.mockImplementation(async (t) => t)
      await useTaskSync().syncPendingChanges()
      expect(useSavePending().isSavePending(tasksStore.task('n2')!)).toBe(false)
    })

    it('a push in flight without an error shows no cloud on a healthy source', async () => {
      const tasksStore = useTasksStore()
      tasksStore.markPendingSync('n1')
      let release: (t: Task) => void = () => {}
      notion.updateTask.mockImplementation(() => new Promise<Task>((resolve) => { release = resolve }))

      const push = useTaskSync().syncPendingChanges()
      await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalled())
      expect(tasksStore.task('n1')?.pendingSync).toBeDefined()
      expect(useSavePending().isSavePending(tasksStore.task('n1')!)).toBe(false)
      release(task('n1', 'notion'))
      await push
    })

    it('a task deleted during its first create is not pushed a second time', async () => {
      const tasksStore = useTasksStore()
      tasksStore.addTask(task('local_9', 'notion', { externalId: null, title: 'Offline task' }))
      tasksStore.markPendingSync('local_9')
      let release: (t: Task) => void = () => {}
      notion.createTask.mockImplementation(() => new Promise<Task>((resolve) => { release = resolve }))

      const push = useTaskSync().syncPendingChanges()
      await vi.waitFor(() => expect(notion.createTask).toHaveBeenCalled())
      const move = useTaskSync().updateTaskStatus({ taskId: 'local_9', status: TaskStatus.Progress })
      tasksStore.removeTask('local_9')
      release(task('page-new', 'notion', { externalId: 'page-new', title: 'Offline task' }))
      await Promise.all([push, move])

      expect(notion.createTask).toHaveBeenCalledTimes(1)
      expect(notion.updateTask).not.toHaveBeenCalled()
    })

    it('a push that went through restores a source that was marked offline', async () => {
      useIntegrationHealthStore().markOffline('notion', 'Network error')

      await useTaskSync().updateTaskStatus({ taskId: 'n1', status: TaskStatus.Progress })

      expect(useIntegrationHealthStore().statusOf('notion')).toBe('healthy')
    })

    it('archiving a task that never reached Notion creates it first instead of updating a missing page', async () => {
      const tasksStore = useTasksStore()
      notionConfig.config.statusMapping.archive = 'Archived'
      tasksStore.addTask(task('local_9', 'notion', { externalId: null, status: TaskStatus.Done }))
      tasksStore.markPendingSync('local_9')
      notion.createTask.mockResolvedValue(task('page-new', 'notion', { externalId: 'page-new', status: TaskStatus.Done }))

      await useTaskSync().syncArchiveStatusForTasks(['local_9'])

      expect(notion.createTask).toHaveBeenCalledTimes(1)
      expect(notion.updateTask).not.toHaveBeenCalled()
      expect(handleErrorMock).not.toHaveBeenCalled()
      expect(tasksStore.task('local_9')).toMatchObject({ externalId: 'page-new' })
      notionConfig.config.statusMapping.archive = null
    })

    it('a degraded source gets one failing request per run, not one per pending task', async () => {
      const tasksStore = useTasksStore()
      tasksStore.addTask(task('n2', 'notion'))
      tasksStore.addTask(task('n3', 'notion'))
      for (const id of ['n1', 'n2', 'n3']) tasksStore.markPendingSync(id)
      useIntegrationHealthStore().markDegraded('notion', 'HTTP 500')
      notion.updateTask.mockRejectedValue(httpError(500))

      await useTaskSync().syncPendingChanges()

      expect(notion.updateTask).toHaveBeenCalledTimes(1)
    })
  })
})
