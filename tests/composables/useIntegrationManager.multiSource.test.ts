/**
 * #318: `fetchTasks` fetches every connected source in parallel through its adapter and merges per
 * source. These tests drive sequences, not single calls: a source that fails and then recovers, a switch
 * while a fetch is in flight, a newer fetch overtaking an older one, a warning that one source raises
 * while the other merges, and a mixed Local + Notion board refreshed twice.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { SourceNotConfiguredError } from '~/integrations/sources/types'

const handleErrorMock = vi.fn()
const handleSuccessMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: handleSuccessMock }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), syncExistingDoneTasks: vi.fn() }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

const fetchNotion = vi.fn<() => Promise<Task[]>>()
const fetchTodoist = vi.fn<() => Promise<Task[]>>()
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({
    isConfigured: { value: true },
    createInstance: () => ({ fetchActiveBoardTasks: fetchNotion }),
  }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({ isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null } } }),
}))
vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return { fetchActiveBoardTasks: fetchTodoist }
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useSyncValidation, resetSyncValidation } from '~/composables/useSyncValidation'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

function task(id: string, source: Task['source'], overrides: Partial<Task> = {}): Task {
  return {
    id,
    source,
    externalId: source === 'local' ? null : id,
    title: `Task ${id}`,
    status: TaskStatus.Open,
    activity: null,
    topic: null,
    topicColorCode: null,
    priority: 1,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const ids = (source: Task['source']) => useTasksStore().tasks.filter((t) => t.source === source).map((t) => t.id).sort()
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function connectBoth() {
  const board = useBoardStore()
  board.setSources({ connected: ['notion', 'todoist'], default: 'notion' })
  board.boardConfig.todoistApiToken = 'token'
}

describe('useIntegrationManager: several sources (#318)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetSyncValidation()
    fetchNotion.mockReset()
    fetchTodoist.mockReset()
    handleErrorMock.mockReset()
    handleSuccessMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('starts the fetch of every connected source before any of them has answered', async () => {
    connectBoth()
    const notion = deferred<Task[]>()
    const todoist = deferred<Task[]>()
    fetchNotion.mockReturnValue(notion.promise)
    fetchTodoist.mockReturnValue(todoist.promise)

    const running = useIntegrationManager().fetchTasks()
    await flush()
    expect(fetchNotion).toHaveBeenCalledTimes(1)
    expect(fetchTodoist).toHaveBeenCalledTimes(1)

    todoist.resolve([task('td-1', 'todoist')])
    notion.resolve([task('n-1', 'notion')])
    await running
    expect(ids('notion')).toEqual(['n-1'])
    expect(ids('todoist')).toEqual(['td-1'])
  })

  it('one failing source neither blocks nor empties the others, and keeps its own tasks (then a refresh recovers)', async () => {
    connectBoth()
    const tasks = useTasksStore()
    const health = useIntegrationHealthStore()
    fetchNotion.mockResolvedValue([task('n-1', 'notion'), task('n-2', 'notion')])
    fetchTodoist.mockResolvedValue([task('td-1', 'todoist')])
    await useIntegrationManager().fetchTasks()
    expect(ids('notion')).toEqual(['n-1', 'n-2'])
    const firstSync = health.healthOf('notion').lastSuccessfulSync
    expect(firstSync).not.toBeNull()

    // Refresh 1: Notion is offline, Todoist has a new task
    fetchNotion.mockRejectedValue(new TypeError('Failed to fetch'))
    fetchTodoist.mockResolvedValue([task('td-1', 'todoist'), task('td-2', 'todoist')])
    const result = await useIntegrationManager().fetchTasks()

    expect(ids('notion')).toEqual(['n-1', 'n-2']) // stays on the board
    expect(ids('todoist')).toEqual(['td-1', 'td-2'])
    expect(result.map((t) => t.id).sort()).toEqual(['td-1', 'td-2']) // only what arrived
    expect(health.statusOf('notion')).toBe('offline')
    expect(health.healthOf('notion').lastError).toBe('Failed to fetch')
    expect(health.healthOf('notion').lastSuccessfulSync).toBe(firstSync) // not touched by the failure
    expect(health.statusOf('todoist')).toBe('healthy')
    // Quiet: no toast, no error report, no automatic setup dialog
    expect(handleErrorMock).not.toHaveBeenCalled()
    // The board's last sync is the oldest successful one: Notion's, from before the failure
    expect(tasks.lastSyncTimestamp?.getTime()).toBe(firstSync)

    // Refresh 2: Notion is back with changed data
    fetchNotion.mockResolvedValue([task('n-1', 'notion', { title: 'Renamed' })])
    fetchTodoist.mockResolvedValue([task('td-1', 'todoist'), task('td-2', 'todoist')])
    await useIntegrationManager().fetchTasks()

    expect(tasks.tasks.find((t) => t.id === 'n-1')?.title).toBe('Renamed')
    expect(health.statusOf('notion')).toBe('healthy')
    expect(health.healthOf('notion').lastError).toBeNull()
    expect(handleSuccessMock).toHaveBeenCalledTimes(1) // "connection restored"
    expect(tasks.lastSyncTimestamp?.getTime()).toBe(Math.min(
      health.healthOf('notion').lastSuccessfulSync!, health.healthOf('todoist').lastSuccessfulSync!,
    ))
  })

  it('marks a rejected token broken without a toast or a setup dialog, on every refresh', async () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    fetchNotion.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))
    const health = useIntegrationHealthStore()

    await useIntegrationManager().fetchTasks()
    await useIntegrationManager().fetchTasks()

    expect(health.isBroken('notion')).toBe(true)
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a source with a missing token is broken, the other one syncs', async () => {
    connectBoth()
    useBoardStore().boardConfig.todoistApiToken = ''
    fetchNotion.mockResolvedValue([task('n-1', 'notion')])

    await useIntegrationManager().fetchTasks()

    expect(ids('notion')).toEqual(['n-1'])
    expect(useIntegrationHealthStore().isBroken('todoist')).toBe(true)
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a source that was never set up is marked broken and never opens the setup dialog, alone or beside another source', async () => {
    // Notion is connected but has no configuration: the adapter rejects with SourceNotConfiguredError
    fetchNotion.mockRejectedValue(new SourceNotConfiguredError('notion', 'Notion integration is not properly configured'))
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    await useIntegrationManager().fetchTasks()
    await useIntegrationManager().fetchTasks() // the next auto-refresh
    expect(handleErrorMock).not.toHaveBeenCalled()
    expect(useIntegrationHealthStore().isBroken('notion')).toBe(true)
    expect(useIntegrationHealthStore().needsAttention('notion')).toBe(true)

    connectBoth()
    fetchTodoist.mockResolvedValue([])
    await useIntegrationManager().fetchTasks()
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a revoked token behind the "Cannot access Notion database" wrapper is broken, and a refresh opens no dialog', async () => {
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    const health = useIntegrationHealthStore()
    const api = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    fetchNotion.mockRejectedValue(new Error('Cannot access Notion database: Unauthorized', { cause: api }))

    await useIntegrationManager().fetchTasks()
    expect(health.statusOf('notion')).toBe('broken')
    await useIntegrationManager().fetchTasks() // refresh

    expect(health.statusOf('notion')).toBe('broken')
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a failing Todoist fetch is not healthy and not synced, toasts nothing on any refresh, and recovers', async () => {
    useBoardStore().setSources({ connected: ['todoist'], default: 'todoist' })
    useBoardStore().boardConfig.todoistApiToken = 'token'
    const health = useIntegrationHealthStore()
    const tasks = useTasksStore()
    fetchTodoist.mockResolvedValueOnce([task('td-1', 'todoist')])
    await useIntegrationManager().fetchTasks()
    const firstSync = health.healthOf('todoist').lastSuccessfulSync
    expect(firstSync).not.toBeNull()

    fetchTodoist.mockRejectedValue(new TypeError('Failed to fetch'))
    await useIntegrationManager().fetchTasks()
    await useIntegrationManager().fetchTasks() // the second refresh must stay as quiet as the first

    expect(health.statusOf('todoist')).toBe('offline')
    expect(health.healthOf('todoist').lastSuccessfulSync).toBe(firstSync)
    expect(ids('todoist')).toEqual(['td-1']) // not emptied
    expect(useSyncValidation().showWarningModal.value).toBe(false)
    expect(handleErrorMock).not.toHaveBeenCalled()

    fetchTodoist.mockResolvedValue([task('td-1', 'todoist'), task('td-2', 'todoist')])
    await useIntegrationManager().fetchTasks()
    expect(health.statusOf('todoist')).toBe('healthy')
    expect(tasks.tasks).toHaveLength(2)
  })

  describe('a result that is no longer wanted is dropped (#326 N6)', () => {
    it('a Notion fetch in flight when the board switches to Local merges nothing', async () => {
      const board = useBoardStore()
      const tasks = useTasksStore()
      board.setSources({ connected: ['notion'], default: 'notion' })
      tasks.setTasks([task('n-1', 'notion')])
      const inFlight = deferred<Task[]>()
      fetchNotion.mockReturnValue(inFlight.promise)

      const running = useIntegrationManager().fetchTasks()
      await flush()
      board.setSingleSource('local') // the user leaves Notion
      tasks.adoptAsLocal()
      inFlight.resolve([task('n-1', 'notion'), task('n-2', 'notion')])
      await running

      // No duplicates, nothing Notion-stamped on a Local board, no health written for the old source
      expect(tasks.tasks.map((t) => [t.id, t.source])).toEqual([['n-1', 'local']])
      expect(useIntegrationHealthStore().healthOf('notion').lastSuccessfulSync).toBeNull()
    })

    it('a stale fetch of the old source cannot complete a pending switch to another source', async () => {
      const board = useBoardStore()
      const tasks = useTasksStore()
      board.setSources({ connected: ['notion'], default: 'notion' })
      tasks.setTasks([task('n-1', 'notion')])
      const staleNotion = deferred<Task[]>()
      fetchNotion.mockReturnValue(staleNotion.promise)

      const running = useIntegrationManager().fetchTasks()
      await flush()
      board.boardConfig.todoistApiToken = 'token'
      tasks.beginSourceSwitch('todoist') // Notion -> Todoist, first Todoist fetch still to come
      staleNotion.resolve([task('n-9', 'notion')])
      await running

      expect(tasks.tasks.map((t) => t.id)).toEqual(['n-1']) // not replaced by the old source's tasks
      expect(board.isSourceSwitchPending).toBe(true) // still waiting for the Todoist fetch

      fetchTodoist.mockResolvedValue([task('td-1', 'todoist')])
      await useIntegrationManager().fetchTasks()
      expect(tasks.tasks.map((t) => [t.id, t.source])).toEqual([['td-1', 'todoist']])
      expect(board.isSourceSwitchPending).toBe(false)
    })

    it('an older fetch that resolves after a newer one started does not overwrite the newer result', async () => {
      useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
      const older = deferred<Task[]>()
      const newer = deferred<Task[]>()
      fetchNotion.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
      const manager = useIntegrationManager()

      const first = manager.fetchTasks()
      await flush()
      const second = useIntegrationManager().fetchTasks() // another instance, as the page and a middleware have
      await flush()

      newer.resolve([task('n-1', 'notion', { title: 'New' })])
      await second
      older.resolve([task('n-1', 'notion', { title: 'Old' })])
      await first

      expect(useTasksStore().tasks.map((t) => t.title)).toEqual(['New'])
    })

    it('a result that arrives while the warning waits for the user is dropped when the board moved on', async () => {
      const board = useBoardStore()
      const tasks = useTasksStore()
      board.setSources({ connected: ['notion'], default: 'notion' })
      tasks.setTasks(Array.from({ length: 10 }, (_, i) => task(`n-${i}`, 'notion')))
      fetchNotion.mockResolvedValue([task('n-0', 'notion')]) // a drop of 90%
      const { warning, handleConfirm } = useSyncValidation()

      const running = useIntegrationManager().fetchTasks()
      await vi.waitFor(() => expect(warning.value?.source).toBe('notion'))
      board.setSingleSource('local') // while the dialog is open
      tasks.adoptAsLocal()
      handleConfirm()
      await running

      expect(tasks.tasks).toHaveLength(10) // the confirmed result was not merged: no Notion-stamped duplicate
      expect(tasks.tasks.every((t) => t.source === 'local')).toBe(true)
    })
  })

  describe('validation per source', () => {
    it('a drop in one source raises its warning while the other source merges; cancelling keeps that source', async () => {
      connectBoth()
      const tasks = useTasksStore()
      tasks.setTasks([
        ...Array.from({ length: 10 }, (_, i) => task(`n-${i}`, 'notion')),
        task('td-1', 'todoist'),
      ])
      fetchNotion.mockResolvedValue([task('n-0', 'notion')]) // 90% drop
      fetchTodoist.mockResolvedValue([task('td-1', 'todoist'), task('td-2', 'todoist')])
      const { warning, handleCancel } = useSyncValidation()

      const running = useIntegrationManager().fetchTasks()
      await vi.waitFor(() => expect(warning.value?.source).toBe('notion'))
      expect(warning.value).toMatchObject({ currentTaskCount: 10, fetchedCount: 1, reason: 'significant_task_count_drop' })
      expect(ids('todoist')).toEqual(['td-1', 'td-2']) // merged without waiting for the other source

      handleCancel()
      await running
      expect(ids('notion')).toHaveLength(10)
      expect(useIntegrationHealthStore().healthOf('notion').lastSuccessfulSync).toBeNull() // not synced
    })

    it('confirming the warning resumes the fetch and applies the drop', async () => {
      useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
      useTasksStore().setTasks(Array.from({ length: 10 }, (_, i) => task(`n-${i}`, 'notion')))
      fetchNotion.mockResolvedValue([])
      const { warning, handleConfirm } = useSyncValidation()

      const running = useIntegrationManager().fetchTasks()
      await vi.waitFor(() => expect(warning.value?.source).toBe('notion'))
      handleConfirm()
      await running

      expect(useTasksStore().tasks).toHaveLength(0)
    })

    it('Local tasks never take part: 20 Local tasks beside 2 Notion tasks raise no warning', async () => {
      useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
      useTasksStore().setTasks([
        ...Array.from({ length: 20 }, (_, i) => task(`l-${i}`, 'local')),
        task('n-1', 'notion'), task('n-2', 'notion'),
      ])
      fetchNotion.mockResolvedValue([task('n-1', 'notion'), task('n-2', 'notion')])

      await useIntegrationManager().fetchTasks()

      expect(useSyncValidation().showWarningModal.value).toBe(false)
      expect(ids('local')).toHaveLength(20)
    })
  })

  describe('a mixed Local + Notion board', () => {
    it('refreshes twice: Local tasks are left alone, Notion tasks follow the source, no switch happens', async () => {
      const board = useBoardStore()
      const tasks = useTasksStore()
      board.setSources({ connected: ['notion'], default: 'local' })
      tasks.setTasks([task('l-1', 'local'), task('l-2', 'local'), task('n-1', 'notion'), task('n-2', 'notion')])
      fetchNotion.mockResolvedValueOnce([task('n-1', 'notion'), task('n-3', 'notion')])
      fetchNotion.mockResolvedValueOnce([task('n-3', 'notion')])

      await useIntegrationManager().fetchTasks()
      expect(ids('local')).toEqual(['l-1', 'l-2'])
      expect(ids('notion')).toEqual(['n-1', 'n-3'])

      await useIntegrationManager().fetchTasks()
      expect(ids('local')).toEqual(['l-1', 'l-2'])
      expect(ids('notion')).toEqual(['n-3'])
      expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
      expect(fetchTodoist).not.toHaveBeenCalled()
    })

    it('a failing Notion fetch leaves the Local tasks and the Notion tasks as they were', async () => {
      useBoardStore().setSources({ connected: ['notion'], default: 'local' })
      useTasksStore().setTasks([task('l-1', 'local'), task('n-1', 'notion')])
      fetchNotion.mockRejectedValue(new Error('Notion API error: 502'))

      await useIntegrationManager().fetchTasks()

      expect(useTasksStore().tasks.map((t) => t.id).sort()).toEqual(['l-1', 'n-1'])
      expect(useIntegrationHealthStore().statusOf('notion')).toBe('degraded')
    })
  })

  describe('boards without an integration', () => {
    it('a board that never onboarded fetches nothing', async () => {
      expect(await useIntegrationManager().fetchTasks()).toEqual([])
      expect(fetchNotion).not.toHaveBeenCalled()
    })

    it('a Local-only board keeps its tasks and stamps its sync time', async () => {
      useBoardStore().setSingleSource('local')
      useTasksStore().setTasks([task('l-1', 'local')])

      const result = await useIntegrationManager().fetchTasks()

      expect(result.map((t) => t.id)).toEqual(['l-1'])
      expect(useTasksStore().lastSyncTimestamp).not.toBeNull()
    })
  })
})
