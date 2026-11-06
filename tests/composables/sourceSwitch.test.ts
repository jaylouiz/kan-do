/**
 * #326 review rounds 1 and 2: until connect/disconnect lands (#320), a mode switch behaves as before the
 * task source existed. The board has one source; Notion -> Local keeps the tasks as Local tasks and
 * nothing is written upstream any more; Local -> Notion replaces the Local tasks with the fetched ones
 * (the first non-empty fetch, however many refreshes it takes); a task keeps its `id` and local data across
 * any sequence of switches. Round 2 tests sequences, not single calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const upstream = vi.fn()
const createInstance = vi.fn(() => ({
  updateTask: upstream,
  updateTaskStatus: upstream,
  archiveTask: upstream,
  fetchActiveBoardTasks: fetchNotion,
}))
const fetchNotion = vi.fn<() => Promise<Task[]>>()

vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ createInstance, isConfigured: { value: true } }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), syncExistingDoneTasks: vi.fn() }),
}))
vi.mock('~/store/notionConfig', () => ({
  useNotionConfigStore: () => ({
    isConfigured: true,
    hasDataSourceSelected: true,
    config: { token: 't', databaseId: 'db', statusMapping: { archive: null } },
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useTaskSync } from '~/composables/useTaskSync'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
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

/** What the removed mode modal did on "Lokal" (the page's "Trennen" is the user-facing path now, #324). */
function switchToLocal() {
  useBoardStore().setSingleSource('local')
  useTasksStore().adoptAsLocal()
}

describe('mode switch keeps the pre-#326 behaviour', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('Notion -> Local: the Notion tasks become Local tasks and nothing is written upstream', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('notion')
    tasks.setTasks([task('n-1', 'notion'), task('n-2', 'notion', { status: TaskStatus.Done })])

    const { updateTaskStatus } = useTaskSync()
    await updateTaskStatus({ taskId: 'n-1', status: TaskStatus.Progress })
    expect(upstream).toHaveBeenCalled() // control: before the switch the edit goes to Notion
    upstream.mockClear()
    createInstance.mockClear()

    switchToLocal()

    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    expect(tasks.tasks.map((t) => [t.id, t.source, t.externalId])).toEqual([
      ['n-1', 'local', null],
      ['n-2', 'local', null],
    ])

    await updateTaskStatus({ taskId: 'n-1', status: TaskStatus.Waiting })
    await updateTaskStatus({ taskId: 'n-2', status: TaskStatus.Open })
    expect(upstream).not.toHaveBeenCalled()
    expect(createInstance).not.toHaveBeenCalled()
    expect(tasks.task('n-1')?.status).toBe(TaskStatus.Waiting)
  })

  it('Local -> Notion: completing the switch replaces the Local tasks with the Notion tasks', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('local')
    tasks.setTasks([task('l-1', 'local'), task('l-2', 'local'), task('l-3', 'local')])
    fetchNotion.mockResolvedValue([task('n-1', 'notion'), task('n-2', 'notion')])

    // The Notion setup flow: begin the switch, then fetch
    tasks.beginSourceSwitch('notion')
    await useIntegrationManager().fetchTasks()

    expect(tasks.tasks.map((t) => [t.id, t.source])).toEqual([
      ['n-1', 'notion'],
      ['n-2', 'notion'],
    ])
  })

  it('Local -> Notion: an empty fetch (possibly a failed one) does not wipe the Local tasks', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('local')
    tasks.setTasks([task('l-1', 'local'), task('l-2', 'local')])
    fetchNotion.mockResolvedValue([])

    tasks.beginSourceSwitch('notion')
    await useIntegrationManager().fetchTasks()

    expect(tasks.tasks.map((t) => t.id)).toEqual(['l-1', 'l-2'])
  })

  it('a plain fetch never touches another source (mixed boards come with #320)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('notion')
    tasks.setTasks([task('l-1', 'local'), task('n-1', 'notion')])
    fetchNotion.mockResolvedValue([task('n-1', 'notion'), task('n-2', 'notion')])

    await useIntegrationManager().fetchTasks()

    expect(tasks.tasks.map((t) => t.id).sort()).toEqual(['l-1', 'n-1', 'n-2'])
  })
})

describe('mode switch sequences (#326 round 2)', () => {
  const fetchPlain = () => useIntegrationManager().fetchTasks()
  const shape = (tasks: Task[]) => tasks.map((t) => [t.id, t.source, t.externalId])

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('Notion -> Local -> Notion keeps each task id and its local data (N1)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('notion')
    tasks.setTasks([
      task('n-1', 'notion', { timeSpentSeconds: 600, timerId: 7 }),
      task('n-2', 'notion', { status: TaskStatus.Done }),
    ])
    board.saveTaskOrder({ taskStatus: TaskStatus.Open, taskOrder: ['n-1'] })

    switchToLocal()
    expect(shape(tasks.tasks)).toEqual([['n-1', 'local', null], ['n-2', 'local', null]])

    // Back to Notion: the fetch knows the pages as before, without our local time data
    fetchNotion.mockResolvedValue([task('n-1', 'notion'), task('n-2', 'notion', { status: TaskStatus.Done })])
    tasks.beginSourceSwitch('notion')
    await fetchPlain()

    expect(shape(tasks.tasks)).toEqual([['n-1', 'notion', 'n-1'], ['n-2', 'notion', 'n-2']])
    expect(tasks.task('n-1')?.timeSpentSeconds).toBe(600)
    expect(tasks.task('n-1')?.timerId).toBe(7)
    expect(board.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['n-1'])
    expect(board.isSourceSwitchPending).toBe(false)
  })

  it('Local -> Notion, an empty first fetch, then a plain refresh leaves no mixed board (N2)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('local')
    tasks.setTasks([task('l-1', 'local'), task('l-2', 'local')])

    tasks.beginSourceSwitch('notion')
    fetchNotion.mockResolvedValue([]) // what the fetcher returns on a failure
    await fetchPlain()
    expect(tasks.tasks.map((t) => t.id)).toEqual(['l-1', 'l-2'])
    expect(board.isSourceSwitchPending).toBe(true)

    fetchNotion.mockResolvedValue([task('n-1', 'notion'), task('n-2', 'notion')])
    await fetchPlain() // the auto refresh, not the setup flow
    expect(shape(tasks.tasks)).toEqual([['n-1', 'notion', 'n-1'], ['n-2', 'notion', 'n-2']])
    expect(board.isSourceSwitchPending).toBe(false)

    // The switch is over: a further refresh never touches another source again
    tasks.addTask(task('l-3', 'local'))
    await fetchPlain()
    expect(tasks.tasks.map((t) => t.id).sort()).toEqual(['l-3', 'n-1', 'n-2'])
  })

  it('a thrown first fetch keeps the switch pending as well (N2)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('local')
    tasks.setTasks([task('l-1', 'local')])

    tasks.beginSourceSwitch('notion')
    fetchNotion.mockRejectedValueOnce(new Error('offline'))
    await fetchPlain()
    expect(board.isSourceSwitchPending).toBe(true)

    fetchNotion.mockResolvedValue([task('n-1', 'notion')])
    await fetchPlain()
    expect(tasks.tasks.map((t) => t.id)).toEqual(['n-1'])
  })

  it('switching to Local while a switch is pending ends it (N2)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('local')
    tasks.setTasks([task('l-1', 'local')])

    tasks.beginSourceSwitch('notion')
    switchToLocal()
    expect(board.isSourceSwitchPending).toBe(false)
    expect(board.boardConfig).not.toHaveProperty('pendingSourceSwitch')
  })

  it('Local -> Notion -> Local -> Notion keeps the Notion tasks and drops the Local-born ones (c)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('local')
    tasks.setTasks([task('l-1', 'local'), task('l-2', 'local')])

    fetchNotion.mockResolvedValue([task('n-1', 'notion', { timeSpentSeconds: 30 }), task('n-2', 'notion')])
    tasks.beginSourceSwitch('notion')
    await fetchPlain()
    expect(shape(tasks.tasks)).toEqual([['n-1', 'notion', 'n-1'], ['n-2', 'notion', 'n-2']])

    tasks.updateTask('n-1', { timeSpentSeconds: 900 })
    switchToLocal()
    expect(shape(tasks.tasks)).toEqual([['n-1', 'local', null], ['n-2', 'local', null]])
    tasks.addTask(task('l-3', 'local')) // born while Local: no Notion page behind it

    tasks.beginSourceSwitch('notion')
    await fetchPlain()

    expect(shape(tasks.tasks)).toEqual([['n-1', 'notion', 'n-1'], ['n-2', 'notion', 'n-2']])
    expect(tasks.task('n-1')?.timeSpentSeconds).toBe(900)
    expect(board.isSourceSwitchPending).toBe(false)
  })

  it('a Todoist -> Notion switch leaves nothing in Todoist-owned state and nothing goes upstream (N1/N3 rule)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('todoist')
    tasks.setTasks([task('t-1', 'todoist')])

    tasks.beginSourceSwitch('notion')
    expect(shape(tasks.tasks)).toEqual([['t-1', 'local', null]])
    await useTaskSync().updateTaskStatus({ taskId: 't-1', status: TaskStatus.Progress })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('a pending delete in its undo window is re-stamped by a switch to Local and goes nowhere upstream (N3)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('notion')
    const doomed = task('n-1', 'notion')
    tasks.setTasks([task('n-2', 'notion')])
    tasks.addPendingDelete({ taskId: 'n-1', task: doomed, carryOver: null, state: 'waiting', requestedAt: Date.now() })

    switchToLocal()
    expect(tasks.pendingDeletes['n-1']?.task).toMatchObject({ id: 'n-1', source: 'local', externalId: null })

    await useTaskSync().commitTaskDelete('n-1')
    expect(upstream).not.toHaveBeenCalled()
    expect(createInstance).not.toHaveBeenCalled()
  })

  it('a board without a pending switch (seedMixedBoard) keeps its Local tasks through plain refreshes (d)', async () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSources({ connected: ['notion'], default: 'notion' })
    tasks.setTasks([
      task('n-1', 'notion'),
      task('local-open-1', 'local', { timeSpentSeconds: 42 }),
      task('local-done-1', 'local', { status: TaskStatus.Done }),
    ])
    fetchNotion.mockResolvedValue([task('n-1', 'notion'), task('n-2', 'notion')])

    await fetchPlain()
    await fetchPlain()

    expect(tasks.tasks.map((t) => t.id).sort()).toEqual(['local-done-1', 'local-open-1', 'n-1', 'n-2'])
    expect(tasks.task('local-open-1')).toMatchObject({ source: 'local', externalId: null, timeSpentSeconds: 42 })
  })
})
