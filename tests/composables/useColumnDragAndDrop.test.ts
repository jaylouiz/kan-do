import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useBoardDndKit } from '~/composables/useBoardDndKit'

const mockTask = (overrides: Partial<Task> = {}): Task => ({
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

const mockTasksStore = {
  tasksOpen: [mockTask({ id: 'task-open-1', source: 'local', externalId: null, status: TaskStatus.Open })],
  tasksProgress: [] as Task[],
  tasksWaiting: [] as Task[],
  tasksDone: [] as Task[],
  tasksDoneToday: [] as Task[],
  task: (id: string) => mockTasksStore.tasksOpen.find(t => t.id === id),
  updateTask: vi.fn(),
}

const mockBoardStore = {
  grouping: { enabled: false, key: null },
  saveTaskOrder: vi.fn(),
  startConfirmation: vi.fn(),
  startTimeboxNudge: vi.fn(),
  endTimeboxNudge: vi.fn(),
}

const mockDragState = ref({
  isDragging: false,
  draggedTaskId: null as string | null,
})

vi.mock('~/store/tasks', () => ({ useTasksStore: () => mockTasksStore }))
vi.mock('~/store/board', () => ({ useBoardStore: () => mockBoardStore }))
vi.mock('~/composables/useBoardGrouping', () => ({ useBoardGrouping: () => ({ effectiveGroupKey: { get value() { return mockBoardStore.grouping.key } } }) }))
const captureCompletionSnapshotMock = vi.fn(() => ({ taskId: 'snap' }))
const notifyCompletedMock = vi.fn()
vi.mock('~/composables/useCompletionUndo', () => ({
  useCompletionUndo: () => ({
    captureCompletionSnapshot: captureCompletionSnapshotMock,
    notifyCompleted: notifyCompletedMock,
  }),
}))
const updateTaskStatusMock = vi.fn().mockResolvedValue(undefined)
vi.mock('~/composables/useTaskSync', () => ({
  useTaskSync: () => ({ updateTaskStatus: updateTaskStatusMock }),
}))
vi.mock('~/composables/useBoardDragState', () => ({
  useBoardDragState: () => ({ dragState: mockDragState }),
}))

// Mock isSortable from @dnd-kit/vue/sortable
vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: (source: unknown) => source !== null && typeof source === 'object',
}))

describe('useBoardDndKit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDragState.value = { isDragging: false, draggedTaskId: null }
    document.body.innerHTML = ''
  })

  it('sets isDragging and draggedTaskId on dragStart', () => {
    const { onDragStart } = useBoardDndKit()
    onDragStart({ operation: { source: { id: 'task-1' } } })
    expect(mockDragState.value.isDragging).toBe(true)
    expect(mockDragState.value.draggedTaskId).toBe('task-1')
  })

  it('clears drag state on dragEnd', () => {
    const { onDragStart, onDragEnd } = useBoardDndKit()
    onDragStart({ operation: { source: { id: 'task-1' } } })
    onDragEnd({ canceled: true, operation: { source: null, target: null } })
    expect(mockDragState.value.isDragging).toBe(false)
    expect(mockDragState.value.draggedTaskId).toBeNull()
  })

  it('routes a cross-column transfer through updateTaskStatus', () => {
    const { onDragEnd } = useBoardDndKit()
    onDragEnd({
      canceled: false,
      operation: {
        source: {
          id: 'task-1',
          initialIndex: 0,
          index: 0,
          initialGroup: TaskStatus.Open,
          group: TaskStatus.Done,
        },
        target: {},
      },
    })
    expect(updateTaskStatusMock).toHaveBeenCalledWith({ taskId: 'task-1', status: TaskStatus.Done })
    expect(mockTasksStore.updateTask).not.toHaveBeenCalled()
  })

  it('shows no completion toast on a drop into Erledigt (#136)', () => {
    const { onDragEnd } = useBoardDndKit()
    onDragEnd({
      canceled: false,
      operation: {
        source: {
          id: 'task-1',
          initialIndex: 0,
          index: 0,
          initialGroup: TaskStatus.Open,
          group: TaskStatus.Done,
        },
        target: {},
      },
    })
    expect(updateTaskStatusMock).toHaveBeenCalledWith({ taskId: 'task-1', status: TaskStatus.Done })
    expect(captureCompletionSnapshotMock).not.toHaveBeenCalled()
    expect(notifyCompletedMock).not.toHaveBeenCalled()
  })

  it('calls saveTaskOrder on same-column reorder', () => {
    const openTask1 = mockTask({ id: 'task-open-1', source: 'local', externalId: null, status: TaskStatus.Open })
    const openTask2 = mockTask({ id: 'task-open-2', source: 'local', externalId: null, status: TaskStatus.Open })
    mockTasksStore.tasksOpen = [openTask1, openTask2]

    const { onDragEnd } = useBoardDndKit()
    onDragEnd({
      canceled: false,
      operation: {
        source: {
          id: 'task-open-1',
          initialIndex: 0,
          index: 1,
          initialGroup: TaskStatus.Open,
          group: TaskStatus.Open,
        },
        target: {},
      },
    })
    expect(mockBoardStore.saveTaskOrder).toHaveBeenCalledWith({
      taskStatus: TaskStatus.Open,
      taskOrder: ['task-open-2', 'task-open-1'],
    })
  })

  it('prevents drop into Progress column when WIP limit is reached', () => {
    mockTasksStore.tasksProgress = [mockTask({ id: 'task-progress-1', source: 'local', externalId: null, status: TaskStatus.Progress })]
    const { onDragOver } = useBoardDndKit()
    const preventDefault = vi.fn()
    onDragOver({
      operation: {
        source: { group: TaskStatus.Open, initialGroup: TaskStatus.Open },
        target: { group: TaskStatus.Progress },
      },
      preventDefault,
    })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('allows drop within Progress column (reorder) even when WIP=1', () => {
    mockTasksStore.tasksProgress = [mockTask({ id: 'task-progress-1', source: 'local', externalId: null, status: TaskStatus.Progress })]
    const { onDragOver } = useBoardDndKit()
    const preventDefault = vi.fn()
    onDragOver({
      operation: {
        source: { group: TaskStatus.Progress, initialGroup: TaskStatus.Progress },
        target: { group: TaskStatus.Progress },
      },
      preventDefault,
    })
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('allows the Jetzt card back over Jetzt after it was sorted into another column (#372)', () => {
    mockTasksStore.tasksProgress = [mockTask({ id: 'task-progress-1', source: 'local', externalId: null, status: TaskStatus.Progress })]
    const { onDragOver } = useBoardDndKit()
    const preventDefault = vi.fn()
    // dnd-kit's `group` follows the card into Offen; the drag started in Jetzt and the target is
    // Jetzt's drop zone (a plain droppable carrying the column in its data)
    onDragOver({
      operation: {
        source: { group: TaskStatus.Open, initialGroup: TaskStatus.Progress },
        target: { data: { taskStatus: TaskStatus.Progress } },
      },
      preventDefault,
    })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(mockDragState.value).toMatchObject({ isDropBlocked: false })
  })

  it('does not call updateTask when drag is canceled', () => {
    const { onDragEnd } = useBoardDndKit()
    onDragEnd({
      canceled: true,
      operation: {
        source: {
          id: 'task-1',
          initialIndex: 0,
          index: 0,
          initialGroup: TaskStatus.Open,
          group: TaskStatus.Done,
        },
        target: {},
      },
    })
    expect(mockTasksStore.updateTask).not.toHaveBeenCalled()
    expect(updateTaskStatusMock).not.toHaveBeenCalled()
  })
})
