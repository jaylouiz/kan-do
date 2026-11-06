/**
 * #320: connect and disconnect task sources. Sequences, not single calls: a connect on a board full of Local
 * tasks, a disconnect with queued changes by both choices, a disconnect while the source is unreachable, a
 * running timer, the default falling back to Local, disconnect then reconnect the same database, a Keychain
 * that refuses, a push that fails after the disconnect, and a connect during a pending source switch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { computed } from 'vue'
import { TaskStatus } from '~/types/taskStatus'
import { useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import { armedTaskTimerIds } from '~/lib/taskTimers'
import type { Task } from '~/types/task'
import type { NotionConfig } from '~/types/notion'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), syncExistingDoneTasks: vi.fn(), openWorkSession: vi.fn(() => 0), extendWorkSession: vi.fn() }),
}))
// The work-session heartbeat (#600) is its own interval; these tests count the task timers
vi.mock('~/composables/useWorkSessionTracking', () => ({ beginWorkSession: vi.fn(), endWorkSession: vi.fn(), endAllWorkSessions: vi.fn() }))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

// The Keychain: available on "desktop" in these tests, and it can be made slow or refuse
const secretsLog: string[] = []
const removeSecret = vi.fn<(entry: string) => Promise<void>>()
vi.mock('~/composables/useSecrets', () => ({
  useSecrets: () => ({ available: true, remove: removeSecret }),
}))

const notionApi = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  archiveTask: vi.fn<(id: string) => Promise<void>>(),
  createTask: vi.fn(),
}
vi.mock('~/integrations/NotionIntegration', () => ({
  NotionIntegration: vi.fn().mockImplementation(function () {
    return notionApi
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useSourceConnections } from '~/composables/useSourceConnections'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useSyncValidation, resetSyncValidation } from '~/composables/useSyncValidation'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { usePropertyOptionsStore } from '~/store/propertyOptions'
/* eslint-enable import/first */

const NOTION_CONFIG = {
  token: 'secret-token',
  databaseId: 'db-1',
  dataSourceId: 'ds-1',
  propertyMapping: { title: { propertyName: 'Name', propertyType: 'title' } },
  statusMapping: { open: 'Open', progress: 'Progress', waiting: 'Waiting', done: 'Done', archive: null },
} as unknown as NotionConfig

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

const ids = (source: Task['source']) => useTasksStore().tasks.filter((t) => t.source === source).map((t) => t.id)
const order = (status: TaskStatus) => useBoardStore().columnByTaskStatus(status)?.taskOrder ?? []

/** A board with Local tasks and Notion connected (or not), the Notion config saved. */
function setupBoard(options: { notion: boolean; defaultSource?: 'local' | 'notion'; tasks?: Task[] }) {
  const board = useBoardStore()
  const tasks = useTasksStore()
  useNotionConfigStore().setConfig(NOTION_CONFIG)
  board.setSources(options.notion
    ? { connected: ['notion'], default: options.defaultSource ?? 'notion' }
    : { connected: [], default: 'local' })
  tasks.setTasks(options.tasks ?? [])
  return { board, tasks }
}

describe('useSourceConnections', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    secretsLog.length = 0
    removeSecret.mockImplementation(async (entry) => { secretsLog.push(`remove:${entry}`) })
    notionApi.fetchActiveBoardTasks.mockResolvedValue([])
    notionApi.updateTask.mockImplementation(async (t) => t)
    notionApi.archiveTask.mockResolvedValue(undefined)
    resetSyncValidation()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    resetSyncValidation()
  })

  describe('connect', () => {
    it('keeps every Local task in its place, adds the Notion tasks in their columns and warns about nothing', async () => {
      const locals = [
        ...Array.from({ length: 12 }, (_, i) => task(`l-open-${i}`, 'local')),
        task('l-prog', 'local', { status: TaskStatus.Progress }),
        ...Array.from({ length: 5 }, (_, i) => task(`l-wait-${i}`, 'local', { status: TaskStatus.Waiting })),
        ...Array.from({ length: 6 }, (_, i) => task(`l-done-${i}`, 'local', { status: TaskStatus.Done })),
      ]
      const { board, tasks } = setupBoard({ notion: false, tasks: locals })
      // The user dragged cards into a manual order that is not the creation order
      board.saveTaskOrder({ taskStatus: TaskStatus.Open, taskOrder: [...order(TaskStatus.Open)].reverse() })
      const openBefore = [...order(TaskStatus.Open)]
      const doneBefore = [...order(TaskStatus.Done)]
      notionApi.fetchActiveBoardTasks.mockResolvedValue([
        task('n-open', 'notion'),
        task('n-prog', 'notion', { status: TaskStatus.Progress }),
        task('n-done', 'notion', { status: TaskStatus.Done }),
      ])

      const result = await useSourceConnections().connectSource('notion')

      expect(result).toEqual({ ok: true, fetched: true })
      expect(useSyncValidation().showWarningModal.value).toBe(false)
      expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' }) // the default never moves
      expect(board.isSourceSwitchPending).toBe(false) // a connect is not a source switch
      expect(ids('local')).toHaveLength(locals.length)
      // Existing cards keep their relative order; the Notion cards join behind them
      expect(order(TaskStatus.Open).filter((id) => id.startsWith('l-'))).toEqual(openBefore)
      expect(order(TaskStatus.Open)).toContain('n-open')
      expect(order(TaskStatus.Done).filter((id) => id.startsWith('l-'))).toEqual(doneBefore)
      expect(tasks.tasksProgress.map((t) => t.id).sort()).toEqual(['l-prog', 'n-prog'])
      expect(tasks.tasksDone.map((t) => t.id)).toContain('n-done')
      // A later refresh of everything leaves the Local tasks alone as well
      await useIntegrationManager().fetchTasks()
      expect(ids('local')).toHaveLength(locals.length)
      expect(order(TaskStatus.Open).filter((id) => id.startsWith('l-'))).toEqual(openBefore)
    })

    it('does not touch the Local tasks when the first fetch fails, and keeps the connection', async () => {
      const { board } = setupBoard({ notion: false, tasks: [task('l-1', 'local'), task('l-2', 'local')] })
      notionApi.fetchActiveBoardTasks.mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))

      const result = await useSourceConnections().connectSource('notion')

      expect(result).toEqual({ ok: true, fetched: false })
      expect(board.connectedIntegrations).toEqual(['notion'])
      expect(useIntegrationHealthStore().needsAttention('notion')).toBe(true)
      expect(ids('local')).toEqual(['l-1', 'l-2'])
      expect(handleErrorMock).not.toHaveBeenCalled() // no toast, no setup dialog (#319)
    })

    it('refuses what cannot be connected: not onboarded, already connected, not configured', async () => {
      const connections = useSourceConnections()
      useNotionConfigStore().setConfig(NOTION_CONFIG)
      expect(await connections.connectSource('notion')).toEqual({ ok: false, reason: 'not-onboarded' })
      expect(useBoardStore().boardConfig.sources).toBeNull()

      useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
      expect(await connections.connectSource('notion')).toEqual({ ok: false, reason: 'already-connected' })

      useBoardStore().setSources({ connected: [], default: 'local' })
      await useNotionConfigStore().clearConfig()
      expect(await connections.connectSource('notion')).toEqual({ ok: false, reason: 'not-configured' })
      expect(useBoardStore().connectedIntegrations).toEqual([])
    })

    it('a second connect while the first fetch runs is refused, not run twice', async () => {
      setupBoard({ notion: false })
      const gate = deferred<Task[]>()
      notionApi.fetchActiveBoardTasks.mockReturnValue(gate.promise)
      const connections = useSourceConnections()

      const first = connections.connectSource('notion')
      expect(await connections.connectSource('notion')).toEqual({ ok: false, reason: 'busy' })
      gate.resolve([task('n-1', 'notion')])
      expect(await first).toEqual({ ok: true, fetched: true })
      expect(notionApi.fetchActiveBoardTasks).toHaveBeenCalledTimes(1)
    })

    it('a connect during a pending Notion switch leaves the switch to Notion: the other source never replaces the Local tasks', async () => {
      const { board, tasks } = setupBoard({ notion: false })
      tasks.setTasks([task('l-1', 'local'), task('l-2', 'local')])
      tasks.beginSourceSwitch('notion') // Local tasks adopted, waiting for Notion's first non-empty fetch
      expect(board.isSourceSwitchPending).toBe(true)

      // Todoist is connected meanwhile and answers first
      board.connectIntegration('todoist')
      expect(board.isSourceSwitchPending).toBe(true) // a connect does not end the switch
      tasks.mergeTasks('todoist', [task('t-1', 'todoist')])
      expect(ids('local')).toEqual(['l-1', 'l-2'])

      // Notion's fetch completes the switch: it replaces the Local tasks, not Todoist's
      notionApi.fetchActiveBoardTasks.mockResolvedValue([task('n-1', 'notion')])
      await useIntegrationManager().fetchTasks().catch(() => undefined)
      expect(board.isSourceSwitchPending).toBe(false)
      expect(ids('local')).toEqual([])
      expect(ids('notion')).toEqual(['n-1'])
      expect(ids('todoist')).toEqual(['t-1'])
    })
  })

  describe('disconnect', () => {
    function boardWithNotion() {
      const notionTasks = [
        task('n-1', 'notion'),
        task('n-2', 'notion', { status: TaskStatus.Waiting }),
        task('n-3', 'notion', { status: TaskStatus.Done }),
      ]
      return setupBoard({ notion: true, tasks: [task('l-1', 'local'), task('l-2', 'local', { status: TaskStatus.Done }), ...notionTasks] })
    }

    it('the plan counts the tasks that leave, the unsynced work and the default fallback', () => {
      const { tasks } = boardWithNotion()
      tasks.archivedTaskIds.push('n-3') // archived tasks are not on the board
      expect(useSourceConnections().disconnectPlan('notion')).toEqual({
        source: 'notion', taskCount: 2, unsyncedCount: 0, isDefault: true, reachable: true,
      })
      tasks.markPendingSync('n-1')
      tasks.addPendingDelete({ taskId: 'n-9', task: task('n-9', 'notion'), carryOver: null, state: 'queued', requestedAt: 1 })
      expect(useSourceConnections().disconnectPlan('notion')?.unsyncedCount).toBe(2) // a marked task + a queued delete
      useIntegrationHealthStore().markOffline('notion')
      expect(useSourceConnections().disconnectPlan('notion')?.reachable).toBe(false)
    })

    it('"Trotzdem trennen" discards the queued changes: nothing is pushed, the tasks and everything keyed by them go, Local stays', async () => {
      const { board, tasks } = boardWithNotion()
      board.setTaskPosition(TaskStatus.Open, 'n-1', 100)
      tasks.markPendingSync('n-1')
      tasks.addPendingTimeUpdate('n-2', 30)
      tasks.carryOverByTaskId['n-1'] = { days: 3, lastSeen: '2026-10-27', keptAtDays: 0 } as never
      tasks.archivedTaskIds.push('n-3')
      tasks.incrementTaskOperationVersion('n-1')

      const result = await useSourceConnections().disconnectSource('notion', { syncFirst: false })

      expect(result).toEqual({ ok: true, removedTaskCount: 3 })
      expect(notionApi.updateTask).not.toHaveBeenCalled()
      expect(ids('notion')).toEqual([])
      expect(ids('local')).toEqual(['l-1', 'l-2'])
      expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
      // No orphans
      const allColumnIds = board.columns.flatMap((c) => [...c.taskOrder, ...Object.keys(c.taskPositions ?? {})])
      expect(allColumnIds.filter((id) => id.startsWith('n-'))).toEqual([])
      expect(Object.keys(tasks.pendingTimeUpdates)).toEqual([])
      expect(Object.keys(tasks.carryOverByTaskId)).toEqual([])
      expect(tasks.archivedTaskIds).toEqual([])
      expect(Object.keys(tasks.taskOperationVersions)).toEqual([])
      expect(tasks.hasPendingSync).toBe(false)
      expect(useNotionConfigStore().config).toBeNull()
    })

    it('"Erst synchronisieren, dann trennen" pushes the queued changes first, then discards', async () => {
      const { tasks } = boardWithNotion()
      tasks.updateTask('n-1', { notes: 'edited offline' })
      tasks.markPendingSync('n-1')
      tasks.addPendingTimeUpdate('n-2', 45)
      tasks.updateTask('n-2', { timeSpentSeconds: 45 })
      const pushed: string[] = []
      notionApi.updateTask.mockImplementation(async (t) => { pushed.push(t.id); return t })

      const result = await useSourceConnections().disconnectSource('notion', { syncFirst: true })

      expect(result).toEqual({ ok: true, removedTaskCount: 3 })
      expect(pushed.sort()).toEqual(['n-1', 'n-2'])
      expect(ids('notion')).toEqual([])
      expect(useBoardStore().connectedIntegrations).toEqual([])
    })

    it('pushes a queued delete before the source goes, and a discarded one leaves no guard behind', async () => {
      const { tasks } = boardWithNotion()
      const gone = task('n-gone', 'notion')
      tasks.addPendingDelete({ taskId: 'n-gone', task: gone, carryOver: null, state: 'queued', requestedAt: 1 })
      tasks.deletedTaskIds.push('n-gone')

      expect(await useSourceConnections().disconnectSource('notion', { syncFirst: true })).toMatchObject({ ok: true })
      expect(notionApi.archiveTask).toHaveBeenCalledWith('n-gone')
      expect(tasks.pendingDeletes).toEqual({})

      // The same again, discarded: the page stays in Notion, so a reconnect must show it again
      setupBoard({ notion: true, tasks: [] })
      tasks.addPendingDelete({ taskId: 'n-kept', task: task('n-kept', 'notion'), carryOver: null, state: 'queued', requestedAt: 1 })
      tasks.deletedTaskIds.push('n-kept')
      notionApi.archiveTask.mockClear()
      expect(await useSourceConnections().disconnectSource('notion', { syncFirst: false })).toMatchObject({ ok: true })
      expect(notionApi.archiveTask).not.toHaveBeenCalled()
      expect(tasks.pendingDeletes).toEqual({})
      expect(tasks.deletedTaskIds).not.toContain('n-kept')
    })

    it('unreachable source: a failed "sync first" keeps everything, and "Trotzdem trennen" still works', async () => {
      const { board, tasks } = boardWithNotion()
      tasks.markPendingSync('n-1')
      notionApi.updateTask.mockRejectedValue(Object.assign(new Error('Network error'), { statusCode: 0 }))
      const connections = useSourceConnections()

      const failed = await connections.disconnectSource('notion', { syncFirst: true })

      expect(failed).toEqual({ ok: false, reason: 'sync-incomplete' })
      expect(board.connectedIntegrations).toEqual(['notion'])
      expect(ids('notion')).toEqual(['n-1', 'n-2', 'n-3'])
      expect(useNotionConfigStore().config).not.toBeNull()
      expect(removeSecret).not.toHaveBeenCalled()
      // The failure is the source's state now: the dialog offers only "Trotzdem trennen" / "Abbrechen"
      expect(connections.disconnectPlan('notion')?.reachable).toBe(false)
      expect(tasks.task('n-1')?.pendingSync).toBeDefined()

      expect(await connections.disconnectSource('notion', { syncFirst: false })).toMatchObject({ ok: true })
      expect(ids('notion')).toEqual([])
      expect(ids('local')).toEqual(['l-1', 'l-2'])
    })

    it('a source that is offline is never disconnected on its own: tasks stay usable, edits and time queue', async () => {
      const { board, tasks } = boardWithNotion()
      notionApi.fetchActiveBoardTasks.mockRejectedValue(Object.assign(new Error('Network error'), { statusCode: 0 }))
      await useIntegrationManager().fetchTasks()
      await useIntegrationManager().fetchTasks()

      expect(board.connectedIntegrations).toEqual(['notion'])
      expect(ids('notion')).toEqual(['n-1', 'n-2', 'n-3'])
      expect(useNotionConfigStore().config).not.toBeNull()
      tasks.addPendingTimeUpdate('n-1', 5)
      expect(tasks.isSyncPending('n-1')).toBe(true)
      expect(removeSecret).not.toHaveBeenCalled()
    })

    it('stops a running timer first: the time counts as an unsynced change, the task leaves Jetzt with its source', async () => {
      vi.useFakeTimers()
      const { tasks } = setupBoard({
        notion: true,
        tasks: [task('n-run', 'notion', { status: TaskStatus.Progress }), task('l-1', 'local')],
      })
      const driver = useTaskTimerDriver()
      driver.start()
      vi.advanceTimersByTime(3000)

      // The dialog sees the timer: the stop will queue its time, so it counts before anything is decided
      expect(useSourceConnections().disconnectPlan('notion')?.unsyncedCount).toBe(1)
      const pushed: Array<{ id: string; time: number }> = []
      notionApi.updateTask.mockImplementation(async (t) => { pushed.push({ id: t.id, time: t.timeSpentSeconds }); return t })

      const result = await useSourceConnections().disconnectSource('notion', { syncFirst: true })
      vi.advanceTimersByTime(5000)

      expect(result).toMatchObject({ ok: true })
      expect(pushed).toEqual([{ id: 'n-run', time: 3 }]) // the tracked time went upstream before the discard
      expect(tasks.tasksProgress).toEqual([])
      expect(tasks.tasks.map((t) => t.id)).toEqual(['l-1'])
      expect(vi.getTimerCount()).toBe(0) // nothing keeps ticking against a removed task
      expect(armedTaskTimerIds()).toEqual([])
      driver.stop()
    })

    it('a disconnect that fails closed leaves the Jetzt task counting: one interval, time keeps growing (#352)', async () => {
      vi.useFakeTimers()
      const { tasks } = setupBoard({ notion: true, tasks: [task('n-run', 'notion', { status: TaskStatus.Progress })] })
      const driver = useTaskTimerDriver()
      driver.start()
      vi.advanceTimersByTime(3000)
      const connections = useSourceConnections()

      // Sync first, the source refuses: sync-incomplete
      notionApi.updateTask.mockRejectedValue(Object.assign(new Error('Network error'), { statusCode: 0 }))
      expect(await connections.disconnectSource('notion', { syncFirst: true })).toEqual({ ok: false, reason: 'sync-incomplete' })
      expect(tasks.task('n-run')?.status).toBe(TaskStatus.Progress)
      expect(armedTaskTimerIds()).toEqual(['n-run'])
      expect(vi.getTimerCount()).toBe(1)
      expect(tasks.task('n-run')?.timerId).not.toBeNull()
      const afterFailure = tasks.task('n-run')?.timeSpentSeconds ?? 0
      vi.advanceTimersByTime(2000)
      expect(tasks.task('n-run')?.timeSpentSeconds).toBe(afterFailure + 2)

      // The Keychain refuses: credentials
      removeSecret.mockRejectedValueOnce(new Error('keychain'))
      expect(await connections.disconnectSource('notion')).toEqual({ ok: false, reason: 'credentials' })
      expect(armedTaskTimerIds()).toEqual(['n-run'])
      expect(vi.getTimerCount()).toBe(1)
      const afterKeychain = tasks.task('n-run')?.timeSpentSeconds ?? 0
      vi.advanceTimersByTime(2000)
      expect(tasks.task('n-run')?.timeSpentSeconds).toBe(afterKeychain + 2)

      // A disconnect that goes through still ends the timer with the source
      expect(await connections.disconnectSource('notion')).toMatchObject({ ok: true })
      vi.advanceTimersByTime(3000)
      expect(armedTaskTimerIds()).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
      driver.stop()
    })

    it('the default falls back to Local; a source that was not the default leaves it alone', async () => {
      const { board } = boardWithNotion()
      await useSourceConnections().disconnectSource('notion')
      expect(board.defaultSource).toBe('local')

      setupBoard({ notion: true, defaultSource: 'local', tasks: [] })
      await useSourceConnections().disconnectSource('notion')
      expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    })

    it('awaits the Keychain delete before anything leaves the board', async () => {
      const { tasks } = boardWithNotion()
      const gate = deferred<undefined>()
      removeSecret.mockImplementation(() => gate.promise)

      const pending = useSourceConnections().disconnectSource('notion')
      await Promise.resolve()
      await Promise.resolve()
      expect(removeSecret).toHaveBeenCalledWith('notion-token')
      expect(ids('notion')).toEqual(['n-1', 'n-2', 'n-3']) // still there while the Keychain is slow
      expect(useBoardStore().connectedIntegrations).toEqual(['notion'])

      gate.resolve(undefined)
      expect(await pending).toMatchObject({ ok: true })
      expect(ids('notion')).toEqual([])
      expect(tasks.tasks.map((t) => t.id)).toEqual(['l-1', 'l-2'])
    })

    it('a Keychain that refuses leaves the source connected with its tasks, and a retry works', async () => {
      boardWithNotion()
      removeSecret.mockRejectedValueOnce(new Error('keychain'))
      const connections = useSourceConnections()

      expect(await connections.disconnectSource('notion')).toEqual({ ok: false, reason: 'credentials' })
      expect(useBoardStore().connectedIntegrations).toEqual(['notion'])
      expect(ids('notion')).toEqual(['n-1', 'n-2', 'n-3'])
      expect(useNotionConfigStore().config).not.toBeNull()
      expect(handleErrorMock).toHaveBeenCalledWith(expect.anything(), 'secrets_reset')

      expect(await connections.disconnectSource('notion')).toMatchObject({ ok: true })
      expect(ids('notion')).toEqual([])
    })

    it('a second disconnect while the first runs is refused; a disconnect of what is not connected is too', async () => {
      boardWithNotion()
      const gate = deferred<undefined>()
      removeSecret.mockImplementation(() => gate.promise)
      const connections = useSourceConnections()

      const first = connections.disconnectSource('notion')
      expect(await connections.disconnectSource('notion')).toEqual({ ok: false, reason: 'busy' })
      gate.resolve(undefined)
      await first
      expect(await connections.disconnectSource('notion')).toEqual({ ok: false, reason: 'not-connected' })
      expect(removeSecret).toHaveBeenCalledTimes(1)
    })

    it('a push that was in flight and fails after the disconnect stays quiet: no toast, no health for the gone source', async () => {
      const { tasks } = boardWithNotion()
      tasks.markPendingSync('n-1')
      const inFlight = deferred<Task>()
      notionApi.updateTask.mockReturnValue(inFlight.promise)
      const { syncPendingChanges } = (await import('~/composables/useTaskSync')).useTaskSync()
      const push = syncPendingChanges('notion')
      await Promise.resolve()

      expect(await useSourceConnections().disconnectSource('notion')).toMatchObject({ ok: true })
      inFlight.reject(Object.assign(new Error('Network error'), { statusCode: 0 }))
      await push

      expect(handleErrorMock).not.toHaveBeenCalled()
      expect(useIntegrationHealthStore().statusOf('notion')).toBe('unconfigured')
    })

    it('removes the Notion options with the source and keeps the ones the Local tasks use', async () => {
      boardWithNotion()
      const options = usePropertyOptionsStore()
      options.addTopicOption('Notion-Thema')
      useTasksStore().updateTask('l-1', { topic: 'Lokal-Thema' })

      await useSourceConnections().disconnectSource('notion')

      expect(options.getTopicOptions).toEqual(['Lokal-Thema'])
    })

    it('disconnect, then reconnect the same database: a fresh connect, tasks back once, no leftovers', async () => {
      const { board, tasks } = boardWithNotion()
      const upstream = [task('n-1', 'notion'), task('n-2', 'notion', { status: TaskStatus.Waiting }), task('n-3', 'notion', { status: TaskStatus.Done })]
      notionApi.fetchActiveBoardTasks.mockResolvedValue(upstream)
      tasks.addPendingDelete({ taskId: 'n-3', task: upstream[2]!, carryOver: null, state: 'queued', requestedAt: 1 })
      tasks.deletedTaskIds.push('n-3')
      tasks.removeTask('n-3')
      useIntegrationHealthStore().recordSuccessfulSync('notion', 1234)

      await useSourceConnections().disconnectSource('notion')
      expect(useIntegrationHealthStore().healthOf('notion').lastSuccessfulSync).toBe(1234) // kept for the settings page

      // Reconnect: the token comes back through the setup, then the connect
      useNotionConfigStore().setConfig(NOTION_CONFIG)
      const result = await useSourceConnections().connectSource('notion')

      expect(result).toEqual({ ok: true, fetched: true })
      expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' }) // the default stays Local
      expect(ids('notion').sort()).toEqual(['n-1', 'n-2', 'n-3']) // n-3 was a discarded delete: it is back
      expect(ids('local')).toEqual(['l-1', 'l-2'])
      expect(useIntegrationHealthStore().healthOf('notion').lastSuccessfulSync).not.toBe(1234)
      expect(tasks.pendingDeletes).toEqual({})
    })

    it('Local has no disconnect: the store refuses it and the type system does not offer it', () => {
      const { board } = boardWithNotion()
      expect(board.disconnectIntegration('local' as never)).toBe(false)
      expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'notion' })
      // @ts-expect-error Local is not an IntegrationSourceId
      void useSourceConnections().disconnectSource('local')
    })

    it('the computed plan follows the stores while a dialog is open', () => {
      const { tasks } = boardWithNotion()
      const connections = useSourceConnections()
      const plan = computed(() => connections.disconnectPlan('notion'))
      expect(plan.value?.unsyncedCount).toBe(0)
      tasks.markPendingSync('n-2')
      expect(plan.value?.unsyncedCount).toBe(1)
    })
  })
})
