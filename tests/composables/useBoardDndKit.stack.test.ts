/**
 * Dragging a whole collapsed stack (#150): the stack is one sortable (id = front task, data = the
 * stack), a drop moves every member as one block. Real Pinia stores and real useTaskSync; only the
 * integrations and UI side effects are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useBoardDndKit } from '~/composables/useBoardDndKit'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { getRenderedTaskOrder } from '~/utils/taskGrouping'
import { toastAddMock } from '../mocks/nuxt-imports'
import { sourceOf, switchSource } from '../helpers/taskSource'

const completeTaskMock = vi.fn().mockResolvedValue(undefined)
const reopenTaskMock = vi.fn().mockResolvedValue(undefined)

vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return { completeTask: completeTaskMock, reopenTask: reopenTaskMock }
  }),
}))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: (source: unknown) => source !== null && typeof source === 'object' && 'initialGroup' in source,
}))

const makeTask = (overrides: Partial<Task>): Task => ({
  id: 'task-1', ...sourceOf(overrides.id ?? 'task-1'),
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

const stackData = (taskIds: string[], key = 'S') => ({ stack: { key, label: key, taskIds } })

/** A stack source as dnd-kit hands it over: sortable with the front task's id and the stack as data */
const stackSource = (
  taskIds: string[],
  from: TaskStatus,
  to: TaskStatus,
  index = 0,
  initialIndex = 0,
  element?: Element,
) => ({
  id: taskIds[0]!,
  initialIndex,
  index,
  initialGroup: from,
  group: to,
  data: stackData(taskIds),
  ...(element ? { element } : {}),
})

const dropOf = (source: ReturnType<typeof stackSource>, target: unknown = {}) =>
  ({ canceled: false, operation: { source, target } })

describe('useBoardDndKit: a whole collapsed stack (#150)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    switchSource('local')
    boardStore.setGroupingEnabled(true)
    boardStore.setGroupingKey('topic')
  })

  const add = (status: TaskStatus, entries: Array<[string, string | null]>) => {
    entries.forEach(([id, topic]) => tasksStore.addTask(makeTask({ id, status, topic })))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  }

  const renderedIds = (status: TaskStatus) => {
    const tasks = status === TaskStatus.Done
      ? tasksStore.tasksDoneToday
      : status === TaskStatus.Waiting ? tasksStore.tasksWaiting : tasksStore.tasksOpen
    return getRenderedTaskOrder(tasks, 'topic').rendered.map(t => t.id)
  }

  describe('drag state', () => {
    const element = document.createElement('div')
    it('carries the dragged stack from drag start to drag end', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S'], ['s3', 'S']])
      const { dragState } = useBoardDragState()
      const { onDragStart, onDragEnd } = useBoardDndKit()

      onDragStart({ operation: { source: { ...stackSource(['s1', 's2', 's3'], TaskStatus.Open, TaskStatus.Open), group: TaskStatus.Open, element } } })
      expect(dragState.value.draggedTaskId).toBe('s1')
      expect(dragState.value.draggedStack).toEqual({ key: 'S', label: 'S', taskIds: ['s1', 's2', 's3'] })

      onDragEnd({ canceled: true, operation: { source: null, target: null } })
      expect(dragState.value.draggedStack).toBeNull()
    })

    it('a single card has no dragged stack', () => {
      add(TaskStatus.Open, [['u1', null]])
      const { dragState } = useBoardDragState()
      useBoardDndKit().onDragStart({ operation: { source: { id: 'u1', group: TaskStatus.Open, element } } })
      expect(dragState.value.draggedStack).toBeNull()
      useBoardDndKit().onDragEnd({ canceled: true, operation: { source: null, target: null } })
    })
  })

  describe('Jetzt is always refused', () => {
    const hover = (to: TaskStatus, target: unknown) => {
      const preventDefault = vi.fn()
      const { dragState } = useBoardDragState()
      const kit = useBoardDndKit()
      const source = stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Open)
      kit.onDragStart({ operation: { source: { ...source, element: document.createElement('div') } } })
      kit.onDragOver({ operation: { source: { ...source, group: TaskStatus.Open }, target }, preventDefault })
      const blocked = dragState.value.isDropBlocked
      kit.onDragEnd({ canceled: true, operation: { source: null, target: null } })
      return { preventDefault, blocked, to }
    }

    it('hovering an empty Jetzt (its drop zone) prevents the move and blocks the drop', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      const result = hover(TaskStatus.Progress, { id: 'column-drop-zone-1', data: { taskStatus: TaskStatus.Progress } })
      expect(result.preventDefault).toHaveBeenCalledTimes(1)
      expect(result.blocked).toBe(true)
    })

    it('hovering an occupied Jetzt (its card) prevents the move and blocks the drop', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      add(TaskStatus.Progress, [['p1', null]])
      const result = hover(TaskStatus.Progress, { id: 'p1', initialGroup: TaskStatus.Progress, group: TaskStatus.Progress })
      expect(result.preventDefault).toHaveBeenCalledTimes(1)
      expect(result.blocked).toBe(true)
    })

    it('hovering another column prevents nothing', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      const result = hover(TaskStatus.Waiting, { id: 'column-drop-zone-2', data: { taskStatus: TaskStatus.Waiting } })
      expect(result.preventDefault).not.toHaveBeenCalled()
      expect(result.blocked).toBe(false)
    })

    it.each([
      ['empty', false],
      ['occupied', true],
    ])('a drop on %s Jetzt changes nothing in the store and shows no toast', (_label, occupied) => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      if (occupied) add(TaskStatus.Progress, [['p1', null]])
      const kit = useBoardDndKit()
      const source = stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Open)
      kit.onDragStart({ operation: { source: { ...source, element: document.createElement('div') } } })

      kit.onDragEnd(dropOf(source, { id: 'column-drop-zone-1', data: { taskStatus: TaskStatus.Progress } }))

      expect(tasksStore.task('s1')!.status).toBe(TaskStatus.Open)
      expect(tasksStore.task('s2')!.status).toBe(TaskStatus.Open)
      expect(tasksStore.tasksProgress.map(t => t.id)).toEqual(occupied ? ['p1'] : [])
      expect(toastAddMock).not.toHaveBeenCalled()
    })

    it('a sortable group of Jetzt cannot bypass the rule either', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      useBoardDndKit().onDragEnd(dropOf(stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Progress)))
      expect(tasksStore.tasksProgress).toHaveLength(0)
    })
  })

  describe('to another column', () => {
    it('moves every member, in order, as one block at the dropped slot', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S'], ['s3', 'S']])
      add(TaskStatus.Waiting, [['x1', 'X'], ['y1', 'Y']])

      // Slot 1 of Wartet: between the groups X and Y
      useBoardDndKit().onDragEnd(dropOf(stackSource(['s1', 's2', 's3'], TaskStatus.Open, TaskStatus.Waiting, 1)))

      for (const id of ['s1', 's2', 's3']) expect(tasksStore.task(id)!.status).toBe(TaskStatus.Waiting)
      expect(tasksStore.tasksOpen).toHaveLength(0)
      expect(boardStore.columnByTaskStatus(TaskStatus.Waiting)?.taskOrder).toEqual(['x1', 's1', 's2', 's3', 'y1'])
    })

    it('puts the block where dnd-kit previewed it (the node before the next item)', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      add(TaskStatus.Waiting, [['x1', 'X'], ['y1', 'Y']])
      const list = document.createElement('div')
      list.setAttribute('data-task-status', String(TaskStatus.Waiting))
      const [x1, y1] = ['x1', 'y1'].map((id) => {
        const el = document.createElement('div')
        el.className = 'task-wrapper'
        el.setAttribute('data-task-id', id)
        return el
      }) as unknown as [HTMLElement, HTMLElement]
      const stackEl = document.createElement('div')
      stackEl.className = 'task-stack'
      stackEl.setAttribute('data-task-id', 's1')
      list.append(x1, stackEl, y1)
      document.body.append(list)

      const kit = useBoardDndKit()
      const source = stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Waiting, 1, 0, stackEl)
      kit.onDragStart({ operation: { source: { ...source, element: stackEl } } })
      kit.onDragEnd(dropOf(source))

      expect(boardStore.columnByTaskStatus(TaskStatus.Waiting)?.taskOrder).toEqual(['x1', 's1', 's2', 'y1'])
      list.remove()
    })

    it('moves the members snapshotted at drag start, not the ones added to the group mid-drag', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      const kit = useBoardDndKit()
      const source = stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Waiting)
      kit.onDragStart({ operation: { source: { ...source, element: document.createElement('div') } } })
      add(TaskStatus.Open, [['s3', 'S']]) // a sync adds a third member while dragging

      kit.onDragEnd(dropOf({ ...source, data: stackData(['s1', 's2', 's3']) }))

      expect(tasksStore.task('s1')!.status).toBe(TaskStatus.Waiting)
      expect(tasksStore.task('s2')!.status).toBe(TaskStatus.Waiting)
      expect(tasksStore.task('s3')!.status).toBe(TaskStatus.Open)
    })

    it('skips members that were deleted or moved on mid-drag', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S'], ['s3', 'S']])
      const kit = useBoardDndKit()
      const source = stackSource(['s1', 's2', 's3'], TaskStatus.Open, TaskStatus.Waiting)
      kit.onDragStart({ operation: { source: { ...source, element: document.createElement('div') } } })
      tasksStore.removeTask('s2')
      tasksStore.updateTask('s3', { status: TaskStatus.Done })

      kit.onDragEnd(dropOf(source))

      expect(tasksStore.task('s1')!.status).toBe(TaskStatus.Waiting)
      expect(tasksStore.task('s3')!.status).toBe(TaskStatus.Done)
    })

    it('is a no-op when no member is left in the source column', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')
      const kit = useBoardDndKit()
      const source = stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Waiting)
      kit.onDragStart({ operation: { source: { ...source, element: document.createElement('div') } } })
      tasksStore.removeTask('s1')
      tasksStore.removeTask('s2')

      kit.onDragEnd(dropOf(source))

      expect(saveTaskOrder).not.toHaveBeenCalled()
      expect(tasksStore.tasks).toHaveLength(0)
    })

    it('syncs every member upstream, one after another, and a failing one does not stop the others', async () => {
      switchSource('todoist')
      boardStore.boardConfig.todoistApiToken = 'token'
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S'], ['s3', 'S']])
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      completeTaskMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)

      useBoardDndKit().onDragEnd(dropOf(stackSource(['s1', 's2', 's3'], TaskStatus.Open, TaskStatus.Done)))

      // All local moves already happened, synchronously inside onDragEnd
      for (const id of ['s1', 's2', 's3']) expect(tasksStore.task(id)!.status).toBe(TaskStatus.Done)
      await vi.waitFor(() => expect(completeTaskMock.mock.calls).toEqual([['s1'], ['s2'], ['s3']]))
      consoleError.mockRestore()
    })
  })

  describe('a failure escaping the upstream chain', () => {
    it.each([
      ['a stack', ['s1', 's2']],
      ['a single card', ['s1']],
    ])('is reported for %s instead of becoming an unhandled rejection', async (_label, ids) => {
      add(TaskStatus.Open, ids.map(id => [id, ids.length > 1 ? 'S' : null] as [string, string | null]))
      switchSource('todoist')
      boardStore.boardConfig.todoistApiToken = 'token'
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      completeTaskMock.mockRejectedValueOnce(new Error('upstream down'))
      // The per-write error path itself fails once: that is what escapes the chain
      handleErrorMock.mockImplementationOnce(() => { throw new Error('error path failed') })

      const source = ids.length > 1
        ? stackSource(ids, TaskStatus.Open, TaskStatus.Done)
        : { id: 's1', initialIndex: 0, index: 0, initialGroup: TaskStatus.Open, group: TaskStatus.Done }
      useBoardDndKit().onDragEnd(dropOf(source as ReturnType<typeof stackSource>))

      await vi.waitFor(() => expect(handleErrorMock).toHaveBeenCalledTimes(2))
      expect(handleErrorMock).toHaveBeenLastCalledWith('error path failed', 'task_sync')
      consoleError.mockRestore()
    })
  })

  describe('into Erledigt', () => {
    it('completes every member: completedAt, statistics, confirmation, one undo toast', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S'], ['s3', 'S']])
      const statistics = useTaskStatisticsStore()

      useBoardDndKit().onDragEnd(dropOf(stackSource(['s1', 's2', 's3'], TaskStatus.Open, TaskStatus.Done)))

      for (const id of ['s1', 's2', 's3']) {
        expect(tasksStore.task(id)!.status).toBe(TaskStatus.Done)
        expect(tasksStore.task(id)!.completedAt).toBeInstanceOf(Date)
        expect(statistics.completionRecords.some(r => r.taskId === id)).toBe(true)
      }
      expect(boardStore.confirmingTaskIds).toEqual(['s1', 's2', 's3'])
      expect(toastAddMock).toHaveBeenCalledTimes(1)
      expect(toastAddMock.mock.calls[0]![0].title).toBe('3 Aufgaben erledigt')
    })

    it('the toast undo restores every member to its previous status and position', async () => {
      add(TaskStatus.Open, [['s1', 'S'], ['u1', null], ['s2', 'S'], ['s3', 'S']])
      useBoardDndKit().onDragEnd(dropOf(stackSource(['s1', 's2', 's3'], TaskStatus.Open, TaskStatus.Done)))

      toastAddMock.mock.calls[0]![0].actions[0].onClick()
      await vi.waitFor(() => expect(tasksStore.tasksOpen).toHaveLength(4))

      expect(tasksStore.tasksOpen.map(t => t.id)).toEqual(['s1', 'u1', 's2', 's3'])
      for (const id of ['s1', 's2', 's3']) expect(tasksStore.task(id)!.completedAt).toBeNull()
      expect(boardStore.confirmingTaskIds).toEqual([])
    })

    it('a stack dragged out of Erledigt clears completedAt per member and shows no toast', () => {
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      const kit = useBoardDndKit()
      kit.onDragEnd(dropOf(stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Done)))
      toastAddMock.mockClear()

      kit.onDragEnd(dropOf(stackSource(['s1', 's2'], TaskStatus.Done, TaskStatus.Waiting)))

      for (const id of ['s1', 's2']) {
        expect(tasksStore.task(id)!.status).toBe(TaskStatus.Waiting)
        expect(tasksStore.task(id)!.completedAt).toBeNull()
      }
      expect(toastAddMock).not.toHaveBeenCalled()
    })

    it('a single card dropped into Erledigt still shows no toast (#136)', () => {
      add(TaskStatus.Open, [['u1', null]])
      useBoardDndKit().onDragEnd({
        canceled: false,
        operation: { source: { id: 'u1', initialIndex: 0, index: 0, initialGroup: TaskStatus.Open, group: TaskStatus.Done }, target: {} },
      })
      expect(toastAddMock).not.toHaveBeenCalled()
    })
  })

  describe('merging with a group of the same key in the target column', () => {
    it('dropped before the existing stack: the first moved task is the front card', () => {
      add(TaskStatus.Waiting, [['w1', null], ['e1', 'S'], ['e2', 'S']])
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])
      // Wartet draggables: w1 (0), e1 (1, the stack); slot 1 = before the stack

      useBoardDndKit().onDragEnd(dropOf(stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Waiting, 1)))

      expect(renderedIds(TaskStatus.Waiting)).toEqual(['w1', 's1', 's2', 'e1', 'e2'])
    })

    it('dropped after the existing stack: the existing front card stays', () => {
      add(TaskStatus.Waiting, [['w1', null], ['e1', 'S'], ['e2', 'S']])
      add(TaskStatus.Open, [['s1', 'S'], ['s2', 'S']])

      // Slot 2 = behind the stack
      useBoardDndKit().onDragEnd(dropOf(stackSource(['s1', 's2'], TaskStatus.Open, TaskStatus.Waiting, 2)))

      expect(renderedIds(TaskStatus.Waiting)).toEqual(['w1', 'e1', 'e2', 's1', 's2'])
    })
  })

  describe('within its column', () => {
    it('reorders the group among the groups', () => {
      add(TaskStatus.Open, [['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['b2', 'B']])
      // Draggables: a1 (stack A, 0), b1 (stack B, 1). A dropped below B.
      useBoardDndKit().onDragEnd(dropOf(stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 1, 0)))

      expect(renderedIds(TaskStatus.Open)).toEqual(['b1', 'b2', 'a1', 'a2'])
      expect(boardStore.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['b1', 'b2', 'a1', 'a2'])
    })

    it('above the ungrouped tasks it snaps back and saves nothing', () => {
      add(TaskStatus.Open, [['u1', null], ['a1', 'A'], ['a2', 'A']])
      const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')
      // Draggables: u1 (0), a1 (stack A, 1). A dropped above u1.
      useBoardDndKit().onDragEnd(dropOf(stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 0, 1)))

      expect(saveTaskOrder).not.toHaveBeenCalled()
      expect(renderedIds(TaskStatus.Open)).toEqual(['u1', 'a1', 'a2'])
    })

    it('above the ungrouped tasks it snaps back even when other groups sit below them', () => {
      add(TaskStatus.Open, [['u1', null], ['b1', 'B'], ['a1', 'A'], ['a2', 'A']])
      const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')
      // Draggables: u1 (0), b1 (1), a1 (stack A, 2). A dropped above u1: grouping would put it at
      // the top of the groups, which is a different place than the one asked for
      useBoardDndKit().onDragEnd(dropOf(stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 0, 2)))

      expect(saveTaskOrder).not.toHaveBeenCalled()
      expect(renderedIds(TaskStatus.Open)).toEqual(['u1', 'b1', 'a1', 'a2'])
    })

    it('right below the ungrouped tasks it is a reorder among the groups', () => {
      add(TaskStatus.Open, [['u1', null], ['b1', 'B'], ['a1', 'A'], ['a2', 'A']])
      // Slot 1 = in front of b1, the first group
      useBoardDndKit().onDragEnd(dropOf(stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 1, 2)))

      expect(renderedIds(TaskStatus.Open)).toEqual(['u1', 'a1', 'a2', 'b1'])
    })

    it('an unchanged index saves nothing', () => {
      add(TaskStatus.Open, [['a1', 'A'], ['a2', 'A'], ['b1', 'B']])
      const saveTaskOrder = vi.spyOn(boardStore, 'saveTaskOrder')
      useBoardDndKit().onDragEnd(dropOf(stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 0, 0)))
      expect(saveTaskOrder).not.toHaveBeenCalled()
    })
  })

  describe('restoring the dragged node', () => {
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

    it('a stack that grouping snaps back goes back to its place in the list', () => {
      add(TaskStatus.Open, [['u1', null], ['a1', 'A'], ['a2', 'A'], ['b1', 'B']])
      const { list, nodes } = renderList(TaskStatus.Open, ['u1', ['a1', 'a2'], 'b1'])
      const kit = useBoardDndKit()
      const source = stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 0, 1, nodes.a1)
      kit.onDragStart({ operation: { source: { ...source, element: nodes.a1! } } })
      nodes.u1!.before(nodes.a1!) // previewed above the ungrouped card

      kit.onDragEnd(dropOf(source))

      expect(listOrder(list)).toEqual(['u1', 'a1', 'b1'])
      list.remove()
    })

    it('a stack node Vue replaced by a card mid-drag is removed, never left as a ghost', () => {
      add(TaskStatus.Open, [['u1', null], ['a1', 'A'], ['a2', 'A']])
      const { list, nodes } = renderList(TaskStatus.Open, ['u1', ['a1', 'a2']])
      const kit = useBoardDndKit()
      const source = stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 1, 1, nodes.a1)
      kit.onDragStart({ operation: { source: { ...source, element: nodes.a1! } } })
      // a sync turns the stack into two single cards: Vue unmounts the stack and renders a wrapper for a1
      tasksStore.updateTask('a2', { topic: 'Z' })
      nodes.a1!.remove()
      const fresh = document.createElement('div')
      fresh.className = 'task-wrapper'
      fresh.setAttribute('data-task-id', 'a1')
      list.append(fresh)

      kit.onDragEnd(dropOf(source))

      expect(listOrder(list)).toEqual(['u1', 'a1'])
      expect([...list.children].filter(el => el.matches('.task-stack'))).toHaveLength(0)
      list.remove()
    })

    it('a fresh stack node Vue rendered for the same front task counts: the dragged one is the leftover', () => {
      add(TaskStatus.Open, [['a1', 'A'], ['a2', 'A']])
      const { list, nodes } = renderList(TaskStatus.Open, [['a1', 'a2']])
      const kit = useBoardDndKit()
      const source = stackSource(['a1', 'a2'], TaskStatus.Open, TaskStatus.Open, 0, 0, nodes.a1)
      kit.onDragStart({ operation: { source: { ...source, element: nodes.a1! } } })
      const fresh = document.createElement('div')
      fresh.className = 'task-stack'
      fresh.setAttribute('data-task-id', 'a1')
      list.append(fresh)

      kit.onDragEnd(dropOf(source))

      expect([...list.children]).toEqual([fresh])
      list.remove()
    })
  })
})
