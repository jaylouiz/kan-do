/**
 * #322: committing a move between sources through `useTaskSync`. Sequences, not single calls: the target creates
 * before the origin is touched, nothing goes upstream inside the undo window, a rejected create brings the task
 * back with nothing deleted, a transient failure keeps it pending until the source recovers, and a fetch that
 * races the create never leaves a second card.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import type { TaskSourceAdapter } from '~/integrations/sources/types'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
const statistics = { recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn() }
vi.mock('~/store/taskStatistics', () => ({ useTaskStatisticsStore: () => statistics }))

/** Every adapter call in order, e.g. `create:todoist`, `remove:notion:page-1` */
const calls: string[] = []
const adapters = {} as Record<SourceId, ReturnType<typeof fakeAdapter>>
let pageCounter = 0

function fakeAdapter(id: SourceId) {
  return {
    id,
    syncsTime: id === 'notion',
    isConfigured: () => true,
    fetchActive: vi.fn(async () => [] as Task[]),
    create: vi.fn(async (draft: Partial<Task>): Promise<Task> => {
      calls.push(`create:${id}`)
      const externalId = `${id}-page-${++pageCounter}`
      return { ...(draft as Task), id: externalId, source: id, externalId }
    }),
    update: vi.fn(async (task: Task): Promise<Task | null> => { calls.push(`update:${id}:${task.externalId}`); return null }),
    remove: vi.fn(async (task: Task) => { calls.push(`remove:${id}:${task.externalId}`) }),
    restore: vi.fn(async (task: Task): Promise<Task> => task),
    archivesAsStatus: () => false,
    health: () => 'healthy' as const,
  } satisfies TaskSourceAdapter
}
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: (id: SourceId) => adapters[id] }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { onTaskMoveRejected, type TaskMoveRejection } from '~/lib/taskMoveEvents'
import { mapHelpers } from '~/utils/mapHelpers'
/* eslint-enable import/first */

const networkError = () => Object.assign(new Error('Network error'), { statusCode: 0 })
const httpError = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode })

const makeTask = (overrides: Partial<Task> & Pick<Task, 'id'>): Task => {
  const source = overrides.source ?? 'local'
  return {
    title: `Task ${overrides.id}`, notes: null, status: TaskStatus.Open, priority: 1, activity: null, timeBoxSeconds: null,
    timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null, source,
    externalId: source === 'local' ? null : overrides.id, createdAt: new Date('2026-01-01T00:00:00Z'), ...overrides,
  }
}

describe('useTaskSync: committing a move (#322)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let health: ReturnType<typeof useIntegrationHealthStore>
  let rejections: TaskMoveRejection[]
  let stopListening: () => void

  /** Phase 1 and the end of the undo window, as `useTaskMove` does them */
  const move = (taskId: string, target: SourceId) => {
    tasksStore.reassignSource(taskId, target)
    tasksStore.holdMove(taskId)
  }
  const closeWindow = (taskId: string) => tasksStore.releaseMove(taskId)

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    calls.length = 0
    pageCounter = 0
    handleErrorMock.mockReset()
    Object.values(statistics).forEach((fn) => fn.mockReset())
    for (const id of ['local', 'notion', 'todoist'] as const) adapters[id] = fakeAdapter(id)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion', 'todoist'], default: 'local' })
    tasksStore = useTasksStore()
    health = useIntegrationHealthStore()
    health.recordSuccessfulSync('notion')
    health.recordSuccessfulSync('todoist')
    rejections = []
    stopListening = onTaskMoveRejected((rejection) => rejections.push(rejection))
  })
  afterEach(() => {
    stopListening()
    vi.restoreAllMocks()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  })

  it('Local -> Notion: nothing goes upstream inside the window, then one create keeps id, createdAt and position', async () => {
    tasksStore.setTasks([makeTask({ id: 'a', priority: 2, topic: 'Büro', timeBoxSeconds: 900, notes: 'n' }), makeTask({ id: 'b' })])
    useBoardStore().reconcileColumnsWithTasks(tasksStore.tasks)
    const order = useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder.slice()
    const { commitTaskMove, syncPendingChanges } = useTaskSync()

    move('a', 'notion')
    expect(await commitTaskMove('a')).toBe('skipped')
    await syncPendingChanges()
    await useTaskSync().syncTaskToIntegration(tasksStore.task('a')!)
    expect(calls).toEqual([])

    closeWindow('a')
    expect(await commitTaskMove('a')).toBe('committed')

    expect(calls).toEqual(['create:notion'])
    expect(adapters.notion.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Task a', priority: 2, topic: 'Büro', timeBoxSeconds: 900, notes: 'n' }))
    const moved = tasksStore.task('a')!
    expect(moved).toMatchObject({ id: 'a', source: 'notion', externalId: 'notion-page-1' })
    expect(moved.pendingSync).toBeUndefined()
    expect(moved.pendingMove).toBeUndefined()
    expect(moved.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'))
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(order)
    expect(tasksStore.tasks.map((t) => t.id).sort()).toEqual(['a', 'b'])
  })

  it('safety order: the target creates before the origin is removed, with the origin\'s own id', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    const { commitTaskMove } = useTaskSync()

    move('n1', 'todoist')
    closeWindow('n1')
    expect(await commitTaskMove('n1')).toBe('committed')

    expect(calls).toEqual(['create:todoist', 'remove:notion:page-1'])
    expect(tasksStore.task('n1')).toMatchObject({ id: 'n1', source: 'todoist', externalId: 'todoist-page-1' })
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
  })

  it('Notion -> Local needs no create: only the origin page is removed, the task is Local at once', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    const { commitTaskMove } = useTaskSync()

    move('n1', 'local')
    expect(tasksStore.task('n1')).toMatchObject({ source: 'local', externalId: null })
    closeWindow('n1')
    expect(await commitTaskMove('n1')).toBe('committed')

    expect(calls).toEqual(['remove:notion:page-1'])
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
  })

  it('create rejected for good: back in the origin as before, nothing deleted, the rejection is announced', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1', title: 'Rechnung' })])
    adapters.todoist.create.mockRejectedValueOnce(httpError(400))
    const { commitTaskMove } = useTaskSync()

    move('n1', 'todoist')
    closeWindow('n1')
    expect(await commitTaskMove('n1')).toBe('reverted')

    expect(adapters.notion.remove).not.toHaveBeenCalled()
    expect(adapters.todoist.remove).not.toHaveBeenCalled()
    expect(tasksStore.task('n1')).toMatchObject({ source: 'notion', externalId: 'page-1' })
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
    expect(rejections).toEqual([expect.objectContaining({ taskId: 'n1', title: 'Rechnung', fromSource: 'notion', toSource: 'todoist' })])
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a rejected Local -> Notion move leaves the task Local without a marker', async () => {
    tasksStore.setTasks([makeTask({ id: 'a' })])
    adapters.notion.create.mockRejectedValueOnce(httpError(409))
    const { commitTaskMove } = useTaskSync()

    move('a', 'notion')
    closeWindow('a')
    await commitTaskMove('a')

    expect(tasksStore.task('a')).toMatchObject({ source: 'local', externalId: null })
    expect(tasksStore.task('a')?.pendingSync).toBeUndefined()
    expect(tasksStore.task('a')?.pendingMove).toBeUndefined()
  })

  it('transient failure: no toast, the task stays in the target with the marker, the reconnect creates it exactly once and removes the origin', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    adapters.todoist.create.mockRejectedValueOnce(httpError(503))
    const { commitTaskMove, syncPendingChanges } = useTaskSync()

    move('n1', 'todoist')
    closeWindow('n1')
    expect(await commitTaskMove('n1')).toBe('queued')

    expect(handleErrorMock).not.toHaveBeenCalled()
    expect(rejections).toEqual([])
    expect(adapters.notion.remove).not.toHaveBeenCalled()
    expect(tasksStore.task('n1')).toMatchObject({ source: 'todoist', externalId: null })
    expect(tasksStore.task('n1')?.pendingSync).toMatchObject({ attempts: 1, lastError: 'HTTP 503' })

    await syncPendingChanges()

    expect(adapters.todoist.create).toHaveBeenCalledTimes(2)
    // The first call was rejected before it created anything: one page exists in the target
    expect(calls.filter((c) => c.startsWith('create:'))).toHaveLength(1)
    expect(calls.at(-1)).toBe('remove:notion:page-1')
    expect(tasksStore.task('n1')).toMatchObject({ source: 'todoist', externalId: 'todoist-page-1' })
    expect(tasksStore.task('n1')?.pendingSync).toBeUndefined()
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
    // Exactly one page in the target and the origin removed once
    expect(calls.filter((c) => c === 'remove:notion:page-1')).toHaveLength(1)
  })

  it('offline: the move waits without calling anything, then reconnecting creates once and removes the origin', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    const { commitTaskMove, syncPendingChanges } = useTaskSync()
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })

    move('n1', 'todoist')
    closeWindow('n1')
    expect(await commitTaskMove('n1')).toBe('queued')
    await syncPendingChanges()
    expect(calls).toEqual([])
    expect(tasksStore.task('n1')?.pendingSync?.lastError).toBe('Offline')
    expect(tasksStore.task('n1')?.pendingMove).toBeDefined()

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    await syncPendingChanges()

    expect(calls).toEqual(['create:todoist', 'remove:notion:page-1'])
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
  })

  it('a target that needs attention is not called until it recovers', async () => {
    tasksStore.setTasks([makeTask({ id: 'a' })])
    health.recordFailure('notion', networkError())
    const { commitTaskMove, syncPendingChanges } = useTaskSync()

    move('a', 'notion')
    closeWindow('a')
    expect(await commitTaskMove('a')).toBe('queued')
    expect(adapters.notion.create).not.toHaveBeenCalled()

    health.markHealthy('notion')
    await syncPendingChanges('notion')
    expect(adapters.notion.create).toHaveBeenCalledTimes(1)
    expect(tasksStore.task('a')?.externalId).toBe('notion-page-1')
  })

  it('origin removal fails after a successful create: the task lives in the target, the removal is retried alone and then clears the move', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    adapters.notion.remove.mockRejectedValueOnce(networkError())
    const { commitTaskMove, syncPendingChanges } = useTaskSync()

    move('n1', 'todoist')
    closeWindow('n1')
    expect(await commitTaskMove('n1')).toBe('queued')

    expect(tasksStore.task('n1')).toMatchObject({ source: 'todoist', externalId: 'todoist-page-1' })
    expect(tasksStore.task('n1')?.pendingMove).toEqual({ fromSource: 'notion', fromExternalId: 'page-1', toSource: 'todoist' })
    // The origin page is still returned by a fetch of its source: it is not shown a second time
    tasksStore.mergeTasks('notion', [makeTask({ id: 'page-1', source: 'notion', externalId: 'page-1' })])
    expect(tasksStore.tasks.map((t) => t.id)).toEqual(['n1'])

    await syncPendingChanges()

    expect(adapters.todoist.create).toHaveBeenCalledTimes(1)
    expect(adapters.notion.remove).toHaveBeenCalledTimes(2)
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
  })

  it('an origin page that is already gone counts as removed', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    adapters.notion.remove.mockRejectedValueOnce(httpError(404))
    const { commitTaskMove } = useTaskSync()

    move('n1', 'local')
    closeWindow('n1')
    expect(await commitTaskMove('n1')).toBe('committed')
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
  })

  it('create -> fetch race: a fetch that returns the new page before the create response is stored leaves one card', async () => {
    tasksStore.setTasks([makeTask({ id: 'a', createdAt: new Date('2026-01-01T00:00:00Z') })])
    adapters.notion.create.mockImplementationOnce(async (draft) => {
      calls.push('create:notion')
      // The page exists in Notion; a fetch lands before the response reaches the move
      tasksStore.mergeTasks('notion', [makeTask({ id: 'raced-page', source: 'notion', title: 'Task a', createdAt: new Date('2026-10-28T00:00:00Z') })])
      return { ...(draft as Task), id: 'raced-page', source: 'notion', externalId: 'raced-page' }
    })
    const { commitTaskMove } = useTaskSync()

    move('a', 'notion')
    closeWindow('a')
    await commitTaskMove('a')

    expect(tasksStore.tasks.map((t) => t.id)).toEqual(['a'])
    expect(tasksStore.task('a')).toMatchObject({ source: 'notion', externalId: 'raced-page' })
    expect(statistics.removeTaskRecord).toHaveBeenCalledWith('raced-page')

    // The next fetch matches the card by (source, externalId) and does not reset the created date
    tasksStore.mergeTasks('notion', [makeTask({ id: 'raced-page', source: 'notion', title: 'Task a', createdAt: new Date('2026-10-28T00:00:00Z') })])
    expect(tasksStore.tasks.map((t) => t.id)).toEqual(['a'])
    expect(tasksStore.task('a')?.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'))
  })

  it('a fetch inside the undo window neither duplicates the origin page nor drops the moved task', async () => {
    tasksStore.setTasks([makeTask({ id: 'page-1', source: 'notion', externalId: 'page-1' })])
    move('page-1', 'local')

    tasksStore.mergeTasks('notion', [makeTask({ id: 'page-1', source: 'notion', externalId: 'page-1' })])

    expect(tasksStore.tasks).toHaveLength(1)
    expect(tasksStore.task('page-1')).toMatchObject({ source: 'local', externalId: null })
  })

  it('a task in Jetzt keeps its timer and tracked time; the create carries the time, nothing is lost', async () => {
    tasksStore.setTasks([makeTask({ id: 'a', status: TaskStatus.Progress, timerId: 42, timeSpentSeconds: 120 })])
    const { commitTaskMove } = useTaskSync()

    move('a', 'notion')
    // The timer keeps ticking inside the window
    await tasksStore.updateTaskTimespent({ taskId: 'a', timeSpentSeconds: 150 })
    expect(tasksStore.task('a')).toMatchObject({ timerId: 42, status: TaskStatus.Progress })
    closeWindow('a')
    await commitTaskMove('a')

    expect(adapters.notion.create).toHaveBeenCalledWith(expect.objectContaining({ timeSpentSeconds: 150, status: TaskStatus.Progress }))
    // The create does not write time spent: a follow-up write does, with the page id
    expect(adapters.notion.update).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'notion-page-1', timeSpentSeconds: 150 }))
    expect(tasksStore.task('a')).toMatchObject({ timerId: 42, timeSpentSeconds: 150, source: 'notion', status: TaskStatus.Progress })
    expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'a')).toBe(false)
  })

  it('a Done task keeps its column and completed date, is written once more with it, and records no new statistics', async () => {
    const completedAt = new Date('2026-10-27T10:00:00Z')
    tasksStore.setTasks([makeTask({ id: 'a', status: TaskStatus.Done, completedAt })])
    const { commitTaskMove } = useTaskSync()

    move('a', 'notion')
    closeWindow('a')
    await commitTaskMove('a')

    expect(tasksStore.task('a')).toMatchObject({ status: TaskStatus.Done, completedAt, source: 'notion', externalId: 'notion-page-1' })
    expect(adapters.notion.update).toHaveBeenCalledWith(expect.objectContaining({ completedAt }))
    expect(statistics.recordTaskCompletion).not.toHaveBeenCalled()
  })

  it('a status change inside the window is sent by the create after it, not before', async () => {
    tasksStore.setTasks([makeTask({ id: 'a' })])
    const { commitTaskMove, updateTaskStatus } = useTaskSync()

    move('a', 'notion')
    await updateTaskStatus({ taskId: 'a', status: TaskStatus.Waiting })
    expect(calls).toEqual([])
    closeWindow('a')
    await commitTaskMove('a')

    expect(adapters.notion.create).toHaveBeenCalledWith(expect.objectContaining({ status: TaskStatus.Waiting }))
  })

  it('a move that is already committing is not started twice (two triggers, one create)', async () => {
    tasksStore.setTasks([makeTask({ id: 'a' })])
    const { commitTaskMove, syncPendingChanges } = useTaskSync()
    move('a', 'notion')
    closeWindow('a')

    await Promise.all([commitTaskMove('a'), syncPendingChanges(), commitTaskMove('a')])

    expect(adapters.notion.create).toHaveBeenCalledTimes(1)
  })

  describe('delete while a move is outstanding', () => {
    it('create outstanding: the origin page is removed, no page is created', async () => {
      tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
      const { deleteTaskUpstream } = useTaskSync()
      move('n1', 'todoist')
      const snapshot = { ...tasksStore.task('n1')! }

      await deleteTaskUpstream({ taskId: 'n1', task: snapshot, carryOver: null, state: 'waiting', requestedAt: 0 })

      expect(calls).toEqual(['remove:notion:page-1'])
    })

    it('create done, origin removal queued: both pages are removed', async () => {
      tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
      adapters.notion.remove.mockRejectedValueOnce(networkError())
      const { commitTaskMove, deleteTaskUpstream } = useTaskSync()
      move('n1', 'todoist')
      closeWindow('n1')
      await commitTaskMove('n1')
      const snapshot = { ...tasksStore.task('n1')! }
      calls.length = 0

      await deleteTaskUpstream({ taskId: 'n1', task: snapshot, carryOver: null, state: 'waiting', requestedAt: 0 })

      expect(calls.sort()).toEqual(['remove:notion:page-1', 'remove:todoist:todoist-page-1'])
    })

    it('a delete inside the window, then a fetch of the origin, does not bring the task back', () => {
      tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
      move('n1', 'local')
      tasksStore.removeTask('n1')

      tasksStore.mergeTasks('notion', [makeTask({ id: 'page-1', source: 'notion', externalId: 'page-1' })])

      expect(tasksStore.tasks).toHaveLength(0)
    })

    it('deleted while the create is in flight: the page it made is removed again', async () => {
      tasksStore.setTasks([makeTask({ id: 'a' })])
      adapters.notion.create.mockImplementationOnce(async (draft) => {
        tasksStore.removeTask('a')
        return { ...(draft as Task), id: 'late-page', source: 'notion', externalId: 'late-page' }
      })
      const { commitTaskMove } = useTaskSync()

      move('a', 'notion')
      closeWindow('a')
      await commitTaskMove('a')

      expect(adapters.notion.remove).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'late-page' }))
      expect(tasksStore.tasks).toHaveLength(0)
    })
  })

  it('resume on start: a persisted move without an open window is committed', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    tasksStore.reassignSource('n1', 'todoist') // as left behind by a closed app: not held
    const { commitPendingMoves } = useTaskSync()

    await commitPendingMoves()

    expect(calls).toEqual(['create:todoist', 'remove:notion:page-1'])
  })

  it('a move whose origin source was disconnected meanwhile just finishes', async () => {
    tasksStore.setTasks([makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' })])
    move('n1', 'local')
    useBoardStore().disconnectIntegration('notion')
    closeWindow('n1')
    const { commitTaskMove } = useTaskSync()

    expect(await commitTaskMove('n1')).toBe('committed')
    expect(calls).toEqual([])
    expect(tasksStore.task('n1')?.pendingMove).toBeUndefined()
  })
})
