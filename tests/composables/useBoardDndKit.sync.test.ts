/**
 * Cross-column drops must go through the shared status-change path
 * (`useTaskSync().updateTaskStatus`): completedAt, statistics and upstream sync (#104).
 * Real Pinia stores and real useTaskSync; only integrations and UI side effects are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useBoardDndKit } from '~/composables/useBoardDndKit'
import { useStackExpansion } from '~/composables/useStackExpansion'
import { getRenderedTaskOrder } from '~/utils/taskGrouping'
import { switchSource } from '../helpers/taskSource'

const completeTaskMock = vi.fn().mockResolvedValue(undefined)
const reopenTaskMock = vi.fn().mockResolvedValue(undefined)

vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return { completeTask: completeTaskMock, reopenTask: reopenTaskMock }
  }),
}))

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))

vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: (source: unknown) => source !== null && typeof source === 'object' && 'initialGroup' in source,
}))

const makeTask = (overrides: Partial<Task>): Task => ({
  id: 'task-1', source: 'local', externalId: null,
  title: 'Test',
  status: TaskStatus.Open,
  activity: null,
  topic: null,
  topicColorCode: null,
  priority: 0,
  notes: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  timerId: null,
  ...overrides,
})

/**
 * Fixtures sit at 08:00-10:00 today and a drop stamps `completedAt = now`. Pin the clock to 12:00 of
 * the current day (Date only, so timers keep running) so the dropped task always completes after
 * the fixtures; at a real "now" between them the date-sorted order can equal the dropped order,
 * `onDragEnd` then skips the no-op save and the column stays date-sorted (#178).
 */
beforeEach(() => {
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  vi.useFakeTimers({ toFake: ['Date'], now: noon })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Today at `hour`:00 local time, so the task renders in Erledigt (not in the Gestern note). */
const todayAt = (hour: number) => {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d
}

const drop = (id: string, from: TaskStatus, to: TaskStatus, index = 0, initialIndex = 0) => ({
  canceled: false,
  operation: {
    source: { id, initialIndex, index, initialGroup: from, group: to },
    target: {},
  },
})

describe('useBoardDndKit: cross-column drop syncs status (#104)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('drop into Erledigt sets completedAt and records statistics', () => {
    const tasksStore = useTasksStore()
    const statistics = useTaskStatisticsStore()
    switchSource('local')
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done))

    // Applied synchronously inside onDragEnd (DnD invariant: store updates only in onDragEnd)
    const task = tasksStore.task('t1')!
    expect(task.status).toBe(TaskStatus.Done)
    expect(task.completedAt).toBeInstanceOf(Date)
    expect(statistics.completionRecords.some(r => r.taskId === 't1')).toBe(true)
  })

  it('drop out of Erledigt clears completedAt and removes the statistics record', () => {
    const tasksStore = useTasksStore()
    const statistics = useTaskStatisticsStore()
    switchSource('local')
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done))
    onDragEnd(drop('t1', TaskStatus.Done, TaskStatus.Waiting))

    const task = tasksStore.task('t1')!
    expect(task.status).toBe(TaskStatus.Waiting)
    expect(task.completedAt).toBeNull()
    expect(statistics.completionRecords.some(r => r.taskId === 't1')).toBe(false)
  })

  it('syncs the drag upstream (Todoist complete, then reopen)', async () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    switchSource('todoist')
    boardStore.boardConfig.todoistApiToken = 'token'
    tasksStore.addTask(makeTask({ id: 't1', source: 'todoist', externalId: 't1', status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done))
    await vi.waitFor(() => expect(completeTaskMock).toHaveBeenCalledWith('t1'))

    onDragEnd(drop('t1', TaskStatus.Done, TaskStatus.Open))
    await vi.waitFor(() => expect(reopenTaskMock).toHaveBeenCalledWith('t1'))
  })

  it('keeps the drop index in the target column', () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    switchSource('local')
    tasksStore.addTask(makeTask({ id: 'w1', source: 'local', externalId: null, status: TaskStatus.Waiting }))
    tasksStore.addTask(makeTask({ id: 'w2', source: 'local', externalId: null, status: TaskStatus.Waiting }))
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))
    const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Waiting, 0))

    expect(tasksStore.task('t1')!.status).toBe(TaskStatus.Waiting)
    const lastCall = saveTaskOrder.mock.calls.at(-1)?.[0]
    expect(lastCall?.taskStatus).toBe(TaskStatus.Waiting)
    expect(lastCall?.taskOrder[0]).toBe('t1')
  })

  it('a ColumnDropZone target wins over a stale sortable group (pointer crossed another column)', () => {
    const tasksStore = useTasksStore()
    switchSource('local')
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd({
      canceled: false,
      operation: {
        // group is Waiting because the card was moved over that column on the way to Erledigt
        source: { id: 't1', initialIndex: 0, index: 0, initialGroup: TaskStatus.Open, group: TaskStatus.Waiting },
        target: { id: 'column-drop-zone-3', data: { taskStatus: TaskStatus.Done } },
      },
    })

    expect(tasksStore.task('t1')!.status).toBe(TaskStatus.Done)
  })

  it('a drop onto the Jetzt drop zone cannot bypass the WIP limit when Jetzt is occupied', () => {
    const tasksStore = useTasksStore()
    switchSource('local')
    tasksStore.addTask(makeTask({ id: 'p1', source: 'local', externalId: null, status: TaskStatus.Progress }))
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd({
      canceled: false,
      operation: {
        source: { id: 't1', initialIndex: 0, index: 0, initialGroup: TaskStatus.Open, group: TaskStatus.Waiting },
        target: { id: 'column-drop-zone-1', data: { taskStatus: TaskStatus.Progress } },
      },
    })

    expect(tasksStore.task('t1')!.status).toBe(TaskStatus.Open)
    expect(tasksStore.tasksProgress).toHaveLength(1)
  })

  it('a sortable group of Jetzt cannot bypass the WIP limit either', () => {
    const tasksStore = useTasksStore()
    switchSource('local')
    tasksStore.addTask(makeTask({ id: 'p1', source: 'local', externalId: null, status: TaskStatus.Progress }))
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Progress))

    expect(tasksStore.task('t1')!.status).toBe(TaskStatus.Open)
  })

  it('a drop onto an empty Jetzt drop zone still works', () => {
    const tasksStore = useTasksStore()
    switchSource('local')
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd({
      canceled: false,
      operation: {
        source: { id: 't1', initialIndex: 0, index: 0, initialGroup: TaskStatus.Open, group: TaskStatus.Open },
        target: { id: 'column-drop-zone-1', data: { taskStatus: TaskStatus.Progress } },
      },
    })

    expect(tasksStore.task('t1')!.status).toBe(TaskStatus.Progress)
  })

  it('same-column reorder does not touch status or upstream', () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    switchSource('todoist')
    boardStore.boardConfig.todoistApiToken = 'token'
    tasksStore.addTask(makeTask({ id: 'd1', source: 'todoist', externalId: 'd1', status: TaskStatus.Done, completedAt: new Date(0) }))
    tasksStore.addTask(makeTask({ id: 'd2', source: 'todoist', externalId: 'd2', status: TaskStatus.Done, completedAt: new Date(0) }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('d1', TaskStatus.Done, TaskStatus.Done, 1, 0))

    expect(completeTaskMock).not.toHaveBeenCalled()
    expect(tasksStore.task('d1')!.completedAt).toEqual(new Date(0))
  })
})

describe('useBoardDndKit: in-card done confirmation (#124)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    switchSource('local')
  })

  it('a drop into Erledigt flags only the dropped card', () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))
    tasksStore.addTask(makeTask({ id: 'd1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: new Date(0) }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done, 0))

    expect(useBoardStore().confirmingTaskIds).toEqual(['t1'])
  })

  it('flags a drop below the timebox for the faster-than-planned message, and no other (#295)', () => {
    const tasksStore = useTasksStore()
    const base = { source: 'local', externalId: null, status: TaskStatus.Progress } as const
    tasksStore.addTask(makeTask({ ...base, id: 'fast', timeBoxSeconds: 2700, timeSpentSeconds: 1200 }))
    tasksStore.addTask(makeTask({ ...base, id: 'over', status: TaskStatus.Open, timeBoxSeconds: 600, timeSpentSeconds: 900 }))
    tasksStore.addTask(makeTask({ ...base, id: 'idle', status: TaskStatus.Open, timeBoxSeconds: 2700, timeSpentSeconds: 0 }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('fast', TaskStatus.Progress, TaskStatus.Done, 0))
    onDragEnd(drop('over', TaskStatus.Open, TaskStatus.Done, 0))
    onDragEnd(drop('idle', TaskStatus.Open, TaskStatus.Done, 0))

    expect(useBoardStore().confirmingTaskIds).toEqual(['fast', 'over', 'idle'])
    expect(useBoardStore().fasterThanPlanTaskIds).toEqual(['fast'])
  })

  it('keeps the drop index in Erledigt', () => {
    const tasksStore = useTasksStore()
    const boardStore = useBoardStore()
    tasksStore.addTask(makeTask({ id: 'd1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(8) }))
    tasksStore.addTask(makeTask({ id: 'd2', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(9) }))
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done, 1))

    expect(tasksStore.tasksDoneToday.map(t => t.id)).toEqual(['d1', 't1', 'd2'])
    expect(boardStore.confirmingTaskIds).toEqual(['t1'])
  })

  it('a reorder inside Erledigt plays no confirmation', () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask(makeTask({ id: 'd1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(8) }))
    tasksStore.addTask(makeTask({ id: 'd2', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(9) }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('d1', TaskStatus.Done, TaskStatus.Done, 1, 0))

    expect(useBoardStore().confirmingTaskIds).toEqual([])
  })

  it('a drop into another column plays no confirmation', () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Waiting, 0))

    expect(useBoardStore().confirmingTaskIds).toEqual([])
  })
})

describe('useBoardDndKit: timebox nudge (#389)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    switchSource('local')
  })

  const start = (id: string, group: TaskStatus) => ({
    operation: { source: { id, group } },
  }) as unknown as Parameters<ReturnType<typeof useBoardDndKit>['onDragStart']>[0]

  it('a drop into Jetzt starts the nudge on a card without a timebox', () => {
    useTasksStore().addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    useBoardDndKit().onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Progress))

    expect(useBoardStore().timeboxNudgeTaskId).toBe('t1')
  })

  it('a drop into Jetzt of a card with a timebox starts none', () => {
    useTasksStore().addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open, timeBoxSeconds: 900 }))

    useBoardDndKit().onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Progress))

    expect(useBoardStore().timeboxNudgeTaskId).toBeNull()
  })

  it('a reorder inside Jetzt and a drop into another column start none', () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask(makeTask({ id: 'j1', source: 'local', externalId: null, status: TaskStatus.Progress }))
    tasksStore.addTask(makeTask({ id: 'o1', source: 'local', externalId: null, status: TaskStatus.Open }))
    const { onDragEnd } = useBoardDndKit()

    onDragEnd(drop('j1', TaskStatus.Progress, TaskStatus.Progress, 1, 0))
    onDragEnd(drop('o1', TaskStatus.Open, TaskStatus.Waiting))

    expect(useBoardStore().timeboxNudgeTaskId).toBeNull()
  })

  it('starting a drag of the nudged card ends the nudge; another card keeps it', () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask(makeTask({ id: 'j1', source: 'local', externalId: null, status: TaskStatus.Progress }))
    tasksStore.addTask(makeTask({ id: 'o1', source: 'local', externalId: null, status: TaskStatus.Open }))
    const board = useBoardStore()
    board.startTimeboxNudge('j1')
    const { onDragStart } = useBoardDndKit()

    onDragStart(start('o1', TaskStatus.Open))
    expect(board.timeboxNudgeTaskId).toBe('j1')

    onDragStart(start('j1', TaskStatus.Progress))
    expect(board.timeboxNudgeTaskId).toBeNull()
  })
})

describe('useBoardDndKit: Erledigt indices refer to the tasks it renders (#124)', () => {
  // Erledigt renders today's tasks only; earlier days sit in the Gestern note, archived ones nowhere
  const yesterday = () => new Date(todayAt(0).getTime() - 12 * 60 * 60 * 1000)

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    switchSource('local')
  })

  const seedDone = () => {
    const tasksStore = useTasksStore()
    // Default Erledigt sorting is by completion, so the earlier tasks come first in tasksDone
    tasksStore.addTask(makeTask({ id: 'y1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: yesterday() }))
    tasksStore.addTask(makeTask({ id: 'a1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: yesterday() }))
    tasksStore.archiveTasks(['a1'])
    tasksStore.addTask(makeTask({ id: 'd1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(8) }))
    tasksStore.addTask(makeTask({ id: 'd2', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(9) }))
    tasksStore.addTask(makeTask({ id: 'd3', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(10) }))
    return tasksStore
  }

  it('a drop into Erledigt lands at the slot index despite a Gestern task and an archived one', () => {
    const tasksStore = seedDone()
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))
    expect(tasksStore.tasksDoneToday.map(t => t.id)).toEqual(['d1', 'd2', 'd3'])

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done, 1))

    expect(tasksStore.tasksDoneToday.map(t => t.id)).toEqual(['d1', 't1', 'd2', 'd3'])
    // Hidden tasks keep their order behind the rendered ones and stay done
    expect(tasksStore.tasksDone.map(t => t.id)).toEqual(['d1', 't1', 'd2', 'd3', 'y1', 'a1'])
    expect(tasksStore.tasksDonePrevious.map(t => t.id)).toEqual(['y1'])
  })

  it('a drop at the first slot of Erledigt lands first', () => {
    const tasksStore = seedDone()
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done, 0))

    expect(tasksStore.tasksDoneToday.map(t => t.id)).toEqual(['t1', 'd1', 'd2', 'd3'])
  })

  it('a reorder inside Erledigt maps both indices to the rendered list', () => {
    const tasksStore = seedDone()

    const { onDragEnd } = useBoardDndKit()
    // d3 (rendered index 2) to the top (rendered index 0)
    onDragEnd(drop('d3', TaskStatus.Done, TaskStatus.Done, 0, 2))

    expect(tasksStore.tasksDoneToday.map(t => t.id)).toEqual(['d3', 'd1', 'd2'])
    expect(tasksStore.tasksDonePrevious.map(t => t.id)).toEqual(['y1'])
  })
})

describe('useBoardDndKit: grouped columns map indices to the rendered order (#135)', () => {
  // Rendered order of a grouped column: ungrouped first, then groups by first task; stacks (2+)
  // are not sortables, so dnd-kit indices count only ungrouped and single-card wrappers
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const boardStore = useBoardStore()
    switchSource('local')
    boardStore.setGroupingEnabled(true)
    boardStore.setGroupingKey('topic')
  })

  const add = (status: TaskStatus, entries: Array<[string, string | null]>) => {
    const tasksStore = useTasksStore()
    entries.forEach(([id, topic]) => tasksStore.addTask(makeTask({ id, status, topic })))
    return tasksStore
  }

  const renderedIds = (status: TaskStatus) => {
    const tasksStore = useTasksStore()
    const tasks = status === TaskStatus.Waiting ? tasksStore.tasksWaiting : tasksStore.tasksOpen
    return getRenderedTaskOrder(tasks, 'topic').rendered.map(t => t.id)
  }

  it('reorders an ungrouped card below another one across a stack in the store order', () => {
    add(TaskStatus.Open, [['a1', 'A'], ['u1', null], ['a2', 'A'], ['u2', null], ['b1', 'B']])
    expect(renderedIds(TaskStatus.Open)).toEqual(['u1', 'u2', 'a1', 'a2', 'b1'])

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('u1', TaskStatus.Open, TaskStatus.Open, 1, 0))

    expect(renderedIds(TaskStatus.Open)).toEqual(['u2', 'u1', 'a1', 'a2', 'b1'])
    // The saved order is the rendered order
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['u2', 'u1', 'a1', 'a2', 'b1'])
  })

  it('a single card moved above another single card swaps the groups, the stack stays contiguous', () => {
    add(TaskStatus.Open, [['b1', 'B'], ['a1', 'A'], ['a2', 'A'], ['c1', 'C']])
    // Draggables: b1 (0), c1 (1)
    expect(renderedIds(TaskStatus.Open)).toEqual(['b1', 'a1', 'a2', 'c1'])

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('c1', TaskStatus.Open, TaskStatus.Open, 0, 1))

    expect(renderedIds(TaskStatus.Open)).toEqual(['c1', 'b1', 'a1', 'a2'])
  })

  it('a cross-column drop into grouped Wartet at index 1 lands between draggables 0 and 1', () => {
    add(TaskStatus.Waiting, [['w1', null], ['s1', 'S'], ['s2', 'S'], ['w2', null]])
    add(TaskStatus.Open, [['t1', null]])

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Waiting, 1))

    expect(useTasksStore().task('t1')!.status).toBe(TaskStatus.Waiting)
    expect(renderedIds(TaskStatus.Waiting)).toEqual(['w1', 't1', 'w2', 's1', 's2'])
  })

  it('a cross-column drop at the last index appends after the last draggable', () => {
    add(TaskStatus.Waiting, [['w1', null], ['x1', 'X'], ['s1', 'S'], ['s2', 'S']])
    add(TaskStatus.Open, [['t1', 'T']])
    // Draggables: w1 (0), x1 (1); the stack S sits behind x1

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Waiting, 2))

    expect(renderedIds(TaskStatus.Waiting)).toEqual(['w1', 'x1', 't1', 's1', 's2'])
  })

  it('a grouped card joins its group in the target, the group then follows its first task', () => {
    add(TaskStatus.Waiting, [['w1', null], ['x1', 'X'], ['s1', 'S'], ['s2', 'S']])
    add(TaskStatus.Open, [['t1', 'S']])

    const { onDragEnd } = useBoardDndKit()
    // Dropped above x1 (slot 1): t1 is now the first task of S, so S renders before X
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Waiting, 1))

    expect(renderedIds(TaskStatus.Waiting)).toEqual(['w1', 't1', 's1', 's2', 'x1'])
  })

  it('a drop into a column whose only cards are a stack appends', () => {
    add(TaskStatus.Waiting, [['s1', 'S'], ['s2', 'S']])
    add(TaskStatus.Open, [['t1', 'T']])

    const { onDragEnd } = useBoardDndKit()
    // Draggables: the stack S counts once (by s1); index 1 is behind it
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Waiting, 1))

    expect(useTasksStore().task('t1')!.status).toBe(TaskStatus.Waiting)
    expect(renderedIds(TaskStatus.Waiting)).toEqual(['s1', 's2', 't1'])
  })

  it('no-op drops leave the order and the column sorting untouched', () => {
    add(TaskStatus.Waiting, [['w1', null], ['s1', 'S'], ['s2', 'S'], ['w2', null]])
    const boardStore = useBoardStore()
    const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')

    const { onDragEnd } = useBoardDndKit()
    // Same index
    onDragEnd(drop('w1', TaskStatus.Waiting, TaskStatus.Waiting, 0, 0))
    // Ungrouped w2 dropped behind the stack: grouping puts it back into the ungrouped section
    onDragEnd(drop('w1', TaskStatus.Waiting, TaskStatus.Waiting, 0, 1))
    onDragEnd(drop('w2', TaskStatus.Waiting, TaskStatus.Waiting, 2, 1))

    expect(saveTaskOrder).not.toHaveBeenCalled()
    expect(boardStore.columnByTaskStatus(TaskStatus.Waiting)?.sorting).toEqual({ field: 'dateUpdated', direction: 'asc' })
  })

  /**
   * A column list as BoardColumn renders it: `items` top to bottom, a stack as `[top, ...]`.
   * Returns the list and the item nodes by top card id.
   */
  const renderList = (status: TaskStatus, items: Array<string | string[]>) => {
    const list = document.createElement('div')
    list.setAttribute('data-task-status', String(status))
    const nodes: Record<string, HTMLElement> = {}
    for (const item of items) {
      const node = document.createElement('div')
      node.className = Array.isArray(item) ? 'task-stack' : 'task-wrapper'
      const id = Array.isArray(item) ? item[0]! : item
      node.setAttribute('data-task-id', id)
      nodes[id] = node
      list.append(node)
    }
    document.body.append(list)
    return { list, nodes }
  }
  const listOrder = (list: HTMLElement) => [...list.children].map(el => el.getAttribute('data-task-id'))
  const dragStart = (id: string, group: TaskStatus, element: Element) => ({ operation: { source: { id, group, element } } })
  const withElement = (event: ReturnType<typeof drop>, element: Element) =>
    ({ ...event, operation: { ...event.operation, source: { ...event.operation.source, element } } })

  it('a card dragged down onto a card above a stack lands where dnd-kit previews it (above the stack)', () => {
    add(TaskStatus.Open, [['x1', 'X'], ['a1', 'A'], ['s1', 'S'], ['s2', 'S'], ['b1', 'B']])
    // Draggables: x1 (0), a1 (1), b1 (2). dnd-kit drops x1 `afterend` of a1: a1, x1, [S], b1
    const { list, nodes } = renderList(TaskStatus.Open, ['x1', 'a1', ['s1', 's2'], 'b1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('x1', TaskStatus.Open, nodes.x1!))
    nodes.a1!.after(nodes.x1!)

    onDragEnd(withElement(drop('x1', TaskStatus.Open, TaskStatus.Open, 1, 0), nodes.x1!))

    expect(renderedIds(TaskStatus.Open)).toEqual(['a1', 'x1', 's1', 's2', 'b1'])
    list.remove()
  })

  it('the previewed slot wins over the index direction (dragged down, then back up below the stack)', () => {
    add(TaskStatus.Open, [['x1', 'X'], ['a1', 'A'], ['s1', 'S'], ['s2', 'S'], ['b1', 'B']])
    // Down past b1, then up onto b1: dnd-kit leaves x1 `beforebegin` b1 at index 1
    const { list, nodes } = renderList(TaskStatus.Open, ['x1', 'a1', ['s1', 's2'], 'b1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('x1', TaskStatus.Open, nodes.x1!))
    nodes.b1!.before(nodes.x1!)

    onDragEnd(withElement(drop('x1', TaskStatus.Open, TaskStatus.Open, 1, 0), nodes.x1!))

    expect(renderedIds(TaskStatus.Open)).toEqual(['a1', 's1', 's2', 'x1', 'b1'])
    list.remove()
  })

  it('without a DOM to read, a downward drop goes after the draggable above the slot', () => {
    add(TaskStatus.Open, [['x1', 'X'], ['a1', 'A'], ['s1', 'S'], ['s2', 'S'], ['b1', 'B']])

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('x1', TaskStatus.Open, TaskStatus.Open, 1, 0))

    expect(renderedIds(TaskStatus.Open)).toEqual(['a1', 'x1', 's1', 's2', 'b1'])
  })

  it('a cross-column drop below a card that sits above a stack lands above the stack', () => {
    add(TaskStatus.Waiting, [['x1', 'X'], ['s1', 'S'], ['s2', 'S'], ['y1', 'Y']])
    add(TaskStatus.Open, [['t1', 'T']])
    const source = renderList(TaskStatus.Open, ['t1'])
    const { list, nodes } = renderList(TaskStatus.Waiting, ['x1', ['s1', 's2'], 'y1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('t1', TaskStatus.Open, source.nodes.t1!))
    nodes.x1!.after(source.nodes.t1!)

    onDragEnd(withElement(drop('t1', TaskStatus.Open, TaskStatus.Waiting, 1), source.nodes.t1!))

    expect(renderedIds(TaskStatus.Waiting)).toEqual(['x1', 't1', 's1', 's2', 'y1'])
    // The node is back in its own list; Vue moves it by the store change
    expect(listOrder(source.list)).toEqual(['t1'])
    list.remove()
    source.list.remove()
  })

  it('a drop that grouping snaps back restores the DOM order and saves nothing', () => {
    add(TaskStatus.Open, [['u1', null], ['u2', null], ['a1', 'A'], ['a2', 'A'], ['b1', 'B']])
    const boardStore = useBoardStore()
    const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')
    const { list, nodes } = renderList(TaskStatus.Open, ['u1', 'u2', ['a1', 'a2'], 'b1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('u2', TaskStatus.Open, nodes.u2!))
    // dnd-kit previews u2 below b1; grouping keeps an ungrouped card in the ungrouped section
    nodes.b1!.after(nodes.u2!)

    onDragEnd(withElement(drop('u2', TaskStatus.Open, TaskStatus.Open, 2, 1), nodes.u2!))

    expect(saveTaskOrder).not.toHaveBeenCalled()
    expect(listOrder(list)).toEqual(['u1', 'u2', 'a1', 'b1'])
    list.remove()
  })

  it('a card whose wrapper Vue unmounted mid-drag is not put back (no ghost card)', () => {
    add(TaskStatus.Open, [['u1', null], ['u2', null], ['a1', 'A'], ['a2', 'A']])
    const { list, nodes } = renderList(TaskStatus.Open, ['u1', 'u2', ['a1', 'a2']])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('u1', TaskStatus.Open, nodes.u1!))
    nodes.u2!.after(nodes.u1!)
    // A sync moves u1 into the A stack while it is dragged: Vue unmounts its wrapper and the stack,
    // now fronted by u1, is re-rendered
    useTasksStore().updateTask('u1', { topic: 'A' })
    nodes.u1!.remove()
    nodes.a1!.setAttribute('data-task-id', 'u1')

    onDragEnd(withElement(drop('u1', TaskStatus.Open, TaskStatus.Open, 1, 0), nodes.u1!))

    expect(listOrder(list)).toEqual(['u2', 'u1'])
    list.remove()
  })

  it('when the card that followed the dragged one unmounted mid-drag, the node goes before the next one left', () => {
    add(TaskStatus.Open, [['u1', null], ['u2', null], ['b1', 'B']])
    const { list, nodes } = renderList(TaskStatus.Open, ['u1', 'u2', 'b1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('u1', TaskStatus.Open, nodes.u1!))
    nodes.b1!.after(nodes.u1!)
    // A sync removes u2 while u1 is dragged: Vue unmounts its wrapper
    useTasksStore().removeTask('u2')
    nodes.u2!.remove()

    onDragEnd(withElement(drop('u1', TaskStatus.Open, TaskStatus.Open, 1, 0), nodes.u1!))

    expect(listOrder(list)).toEqual(['u1', 'b1'])
    list.remove()
  })

  it('a dragged node Vue removed (its fragment unmounted) is put back while the column still renders the task (#146)', () => {
    add(TaskStatus.Open, [['x1', 'X'], ['y1', 'Y'], ['z1', 'Z']])
    const { list, nodes } = renderList(TaskStatus.Open, ['x1', 'y1', 'z1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('x1', TaskStatus.Open, nodes.x1!))
    nodes.y1!.after(nodes.x1!)
    // y1 is removed mid-drag and the dragged node goes with it
    useTasksStore().removeTask('y1')
    nodes.y1!.remove()
    nodes.x1!.remove()

    onDragEnd(withElement(drop('x1', TaskStatus.Open, TaskStatus.Open, 1, 0), nodes.x1!))

    expect(listOrder(list)).toEqual(['x1', 'z1'])
    list.remove()
  })

  it('a canceled drag puts the node back where the store renders the task (#424)', () => {
    add(TaskStatus.Open, [['u1', null], ['u2', null]])
    const { list, nodes } = renderList(TaskStatus.Open, ['u1', 'u2'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('u2', TaskStatus.Open, nodes.u2!))
    nodes.u1!.before(nodes.u2!)

    onDragEnd({ ...withElement(drop('u2', TaskStatus.Open, TaskStatus.Open, 0, 1), nodes.u2!), canceled: true })

    expect(listOrder(list)).toEqual(['u1', 'u2'])
    expect(useTasksStore().task('u2')?.status).toBe(TaskStatus.Open)
    list.remove()
  })

  it('a canceled drag of the only card of a column brings its node back from another column (#424)', () => {
    add(TaskStatus.Open, [['u1', null]])
    add(TaskStatus.Waiting, [['w1', null]])
    const home = renderList(TaskStatus.Open, ['u1'])
    const other = renderList(TaskStatus.Waiting, ['w1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart(dragStart('u1', TaskStatus.Open, home.nodes.u1!))
    other.nodes.w1!.before(home.nodes.u1!)

    onDragEnd({ ...withElement(drop('u1', TaskStatus.Open, TaskStatus.Waiting, 0, 0), home.nodes.u1!), canceled: true })

    expect(listOrder(home.list)).toEqual(['u1'])
    expect(listOrder(other.list)).toEqual(['w1'])
    home.list.remove()
    other.list.remove()
  })

  it('a drop into grouped Erledigt keeps a Gestern and an archived task behind the rendered ones', () => {
    const tasksStore = useTasksStore()
    const yesterday = new Date(todayAt(0).getTime() - 12 * 60 * 60 * 1000)
    tasksStore.addTask(makeTask({ id: 'y1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: yesterday }))
    tasksStore.addTask(makeTask({ id: 'ar1', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: yesterday }))
    tasksStore.archiveTasks(['ar1'])
    tasksStore.addTask(makeTask({ id: 'd1', source: 'local', externalId: null, status: TaskStatus.Done, topic: 'A', completedAt: todayAt(8) }))
    tasksStore.addTask(makeTask({ id: 'd2', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(9) }))
    tasksStore.addTask(makeTask({ id: 'd3', source: 'local', externalId: null, status: TaskStatus.Done, topic: 'A', completedAt: todayAt(10) }))
    tasksStore.addTask(makeTask({ id: 'd4', source: 'local', externalId: null, status: TaskStatus.Done, completedAt: todayAt(11) }))
    tasksStore.addTask(makeTask({ id: 't1', source: 'local', externalId: null, status: TaskStatus.Open }))
    // Rendered: d2, d4, [d1, d3]; draggables d2 (0), d4 (1)

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Open, TaskStatus.Done, 1))

    expect(getRenderedTaskOrder(tasksStore.tasksDoneToday, 'topic').rendered.map(t => t.id))
      .toEqual(['d2', 't1', 'd4', 'd1', 'd3'])
    expect(tasksStore.tasksDone.map(t => t.id)).toEqual(['d2', 't1', 'd4', 'd1', 'd3', 'y1', 'ar1'])
    expect(tasksStore.tasksDonePrevious.map(t => t.id)).toEqual(['y1'])
  })

  it('Jetzt is never grouped: its mapping stays flat', () => {
    const tasksStore = useTasksStore()
    tasksStore.addTask(makeTask({ id: 'p1', source: 'local', externalId: null, status: TaskStatus.Open, topic: 'A' }))
    const boardStore = useBoardStore()
    const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')

    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('p1', TaskStatus.Open, TaskStatus.Progress, 0))

    expect(tasksStore.task('p1')!.status).toBe(TaskStatus.Progress)
    expect(tasksStore.tasksProgress.map(t => t.id)).toEqual(['p1'])
    expect(saveTaskOrder).not.toHaveBeenCalled()
  })
})

describe('useBoardDndKit: members of an expanded stack are draggable (#147)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useStackExpansion().reset()
    const boardStore = useBoardStore()
    switchSource('local')
    boardStore.setGroupingEnabled(true)
    boardStore.setGroupingKey('topic')
  })

  const add = (status: TaskStatus, entries: Array<[string, string | null]>) => {
    const tasksStore = useTasksStore()
    entries.forEach(([id, topic]) => tasksStore.addTask(makeTask({ id, status, topic })))
    return tasksStore
  }
  const rendered = (status: TaskStatus) => {
    const tasksStore = useTasksStore()
    const tasks = status === TaskStatus.Waiting ? tasksStore.tasksWaiting : tasksStore.tasksOpen
    return getRenderedTaskOrder(tasks, 'topic').rendered.map(t => t.id)
  }
  const expand = (key: string, status = TaskStatus.Open) => useStackExpansion().expand(status, key, 'keyboard')

  // Rendered Offen: u1, [a1 a2 a3], b1. Sortables once A is expanded: u1 0, a1 1, a2 2, a3 3, b1 4
  const seedOpen = () => add(TaskStatus.Open, [['u1', null], ['a1', 'A'], ['a2', 'A'], ['a3', 'A'], ['b1', 'B']])

  it('a member moved down inside its group persists the new group order', () => {
    seedOpen()
    expand('A')
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('a1', TaskStatus.Open, TaskStatus.Open, 2, 1))

    expect(rendered(TaskStatus.Open)).toEqual(['u1', 'a2', 'a1', 'a3', 'b1'])
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['u1', 'a2', 'a1', 'a3', 'b1'])
  })

  it('a member moved up inside its group, and to the end of it', () => {
    seedOpen()
    expand('A')
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('a3', TaskStatus.Open, TaskStatus.Open, 1, 3))
    expect(rendered(TaskStatus.Open)).toEqual(['u1', 'a3', 'a1', 'a2', 'b1'])

    onDragEnd(drop('a3', TaskStatus.Open, TaskStatus.Open, 3, 1))
    expect(rendered(TaskStatus.Open)).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })

  it('a drop index counts the expanded members: the same index lands differently when collapsed', () => {
    seedOpen()
    add(TaskStatus.Waiting, [['t1', 'T']])
    // Collapsed sortables: u1 0, the stack A (by a1) 1, b1 2 -> index 3 is the end of the column
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Waiting, TaskStatus.Open, 3))
    expect(rendered(TaskStatus.Open)).toEqual(['u1', 'a1', 'a2', 'a3', 'b1', 't1'])
  })

  it('a drop between members of an expanded group lands after the group, grouping keeps it contiguous', () => {
    seedOpen()
    add(TaskStatus.Waiting, [['t1', 'T']])
    expand('A')
    // Expanded sortables: u1 0, a1 1, a2 2, a3 3, b1 4 -> index 2 is between a1 and a2
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('t1', TaskStatus.Waiting, TaskStatus.Open, 2))
    expect(rendered(TaskStatus.Open)).toEqual(['u1', 'a1', 'a2', 'a3', 't1', 'b1'])
  })

  it('a member dropped outside its group in the same column changes nothing and saves nothing', () => {
    seedOpen()
    expand('A')
    const saveTaskOrder = vi.spyOn(useBoardStore(), 'saveTaskOrder')
    const { onDragEnd } = useBoardDndKit()

    // below b1 (the end of the column), and above u1 (the top)
    onDragEnd(drop('a2', TaskStatus.Open, TaskStatus.Open, 4, 2))
    onDragEnd(drop('a2', TaskStatus.Open, TaskStatus.Open, 0, 2))

    expect(saveTaskOrder).not.toHaveBeenCalled()
    expect(rendered(TaskStatus.Open)).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })

  it('a member dragged to Wartet lands at the slot index; the source group shrinks', () => {
    seedOpen()
    add(TaskStatus.Waiting, [['w1', 'W'], ['w2', 'V']])
    expand('A')
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('a2', TaskStatus.Open, TaskStatus.Waiting, 1, 2))

    expect(useTasksStore().task('a2')!.status).toBe(TaskStatus.Waiting)
    expect(rendered(TaskStatus.Waiting)).toEqual(['w1', 'a2', 'w2'])
    expect(rendered(TaskStatus.Open)).toEqual(['u1', 'a1', 'a3', 'b1'])
  })

  it('a member dragged to Erledigt is completed and flagged for the confirmation', () => {
    seedOpen()
    expand('A')
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('a1', TaskStatus.Open, TaskStatus.Done, 0, 1))

    expect(useTasksStore().task('a1')!.status).toBe(TaskStatus.Done)
    expect(useBoardStore().confirmingTaskIds).toContain('a1')
  })

  it('a member cannot bypass the WIP limit of Jetzt', () => {
    seedOpen()
    add(TaskStatus.Progress, [['p1', null]])
    expand('A')
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('a2', TaskStatus.Open, TaskStatus.Progress, 0, 2))

    expect(useTasksStore().task('a2')!.status).toBe(TaskStatus.Open)
  })

  it('a member into an empty Jetzt works', () => {
    seedOpen()
    expand('A')
    const { onDragEnd } = useBoardDndKit()
    onDragEnd(drop('a2', TaskStatus.Open, TaskStatus.Progress, 0, 2))

    expect(useTasksStore().task('a2')!.status).toBe(TaskStatus.Progress)
  })
})
