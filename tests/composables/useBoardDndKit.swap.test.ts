/**
 * Dropping one card on the running Jetzt card (#162): the drag marks the running card (`swapTaskId`),
 * the drop swaps. Real Pinia stores and real useTaskSync; only the integrations and UI are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useBoardDndKit } from '~/composables/useBoardDndKit'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { toastAddMock } from '../mocks/nuxt-imports'
import { sourceOf } from '../helpers/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
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

const card = (id: string, from: TaskStatus, group = from, extra: Record<string, unknown> = {}) =>
  ({ id, initialIndex: 0, index: 0, initialGroup: from, group, ...extra })
const runningCard = (id: string) => ({ id, initialGroup: TaskStatus.Progress, group: TaskStatus.Progress })
const jetztZone = { id: 'column-drop-zone-1', data: { taskStatus: TaskStatus.Progress } }

describe('useBoardDndKit: swap on drop (#162)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  const { dragState } = useBoardDragState()

  const seed = (entries: Array<[string, TaskStatus]>) => {
    entries.forEach(([id, status]) => tasksStore.addTask(makeTask({ id, status })))
    useBoardStore().reconcileColumnsWithTasks(tasksStore.tasks)
  }
  const start = (source: ReturnType<typeof card>) => {
    const kit = useBoardDndKit()
    kit.onDragStart({ operation: { source: { ...source, element: document.createElement('div') } } })
    return kit
  }
  const over = (kit: ReturnType<typeof useBoardDndKit>, source: ReturnType<typeof card>, target: unknown) => {
    const preventDefault = vi.fn()
    kit.onDragOver({ operation: { source, target }, preventDefault })
    return preventDefault
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tasksStore = useTasksStore()
  })

  it.each([
    ['the running card', () => runningCard('run')],
    ['Jetzt\'s drop zone', () => jetztZone],
  ])('a card over %s marks the running task instead of refusing', (_label, target) => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
    const source = card('next', TaskStatus.Open)
    const kit = start(source)

    const preventDefault = over(kit, source, target())

    expect(dragState.value.swapTaskId).toBe('run')
    expect(dragState.value.isDropBlocked).toBe(false)
    expect(preventDefault).toHaveBeenCalledTimes(1) // the card still must not move into Jetzt
    kit.onDragEnd({ canceled: true, operation: { source: null, target: null } })
  })

  it('the mark ends at once when the pointer leaves Jetzt, finds no target, or the drag ends', () => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
    const source = card('next', TaskStatus.Open)
    const kit = start(source)

    over(kit, source, runningCard('run'))
    over(kit, source, { id: 'column-drop-zone-2', data: { taskStatus: TaskStatus.Waiting } })
    expect(dragState.value.swapTaskId).toBeNull()

    over(kit, source, runningCard('run'))
    kit.onDragOver({ operation: { source, target: null }, preventDefault: vi.fn() })
    expect(dragState.value.swapTaskId).toBeNull()

    over(kit, source, runningCard('run'))
    kit.onDragEnd({ canceled: true, operation: { source: null, target: null } })
    expect(dragState.value.swapTaskId).toBeNull()
  })

  it.each([
    ['a stack', () => card('s1', TaskStatus.Open, TaskStatus.Open, { data: { stack: { key: 'S', label: 'S', taskIds: ['s1', 's2'] } } }), true],
    ['a card from Erledigt', () => card('next', TaskStatus.Done), true],
  ])('%s is refused as before', (_label, source, blocked) => {
    seed([['run', TaskStatus.Progress], ['s1', TaskStatus.Open], ['s2', TaskStatus.Open], ['next', TaskStatus.Done]])
    const src = source()
    const kit = start(src)

    const preventDefault = over(kit, src, runningCard('run'))

    expect(dragState.value.swapTaskId).toBeNull()
    expect(dragState.value.isDropBlocked).toBe(blocked)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    kit.onDragEnd({ canceled: true, operation: { source: null, target: null } })
  })

  it('dragging the running card itself marks nothing', () => {
    seed([['run', TaskStatus.Progress]])
    const source = runningCard('run') as ReturnType<typeof card>
    const kit = start(source)
    over(kit, source, runningCard('run'))
    expect(dragState.value.swapTaskId).toBeNull()
    kit.onDragEnd({ canceled: true, operation: { source: null, target: null } })
  })

  it.each([
    ['on the running card', () => runningCard('run')],
    ['on Jetzt\'s drop zone', () => jetztZone],
  ])('a drop %s swaps the two tasks', (_label, target) => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Waiting]])
    const source = card('next', TaskStatus.Waiting)
    const kit = start(source)
    over(kit, source, target())

    kit.onDragEnd({ canceled: false, operation: { source, target: target() } })

    expect(tasksStore.tasksProgress.map(t => t.id)).toEqual(['next'])
    expect(tasksStore.tasksWaiting.map(t => t.id)).toEqual(['run'])
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    expect(dragState.value.swapTaskId).toBeNull()
  })

  it('a canceled drag over the running card swaps nothing', () => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
    const source = card('next', TaskStatus.Open)
    const kit = start(source)
    over(kit, source, runningCard('run'))

    kit.onDragEnd({ canceled: true, operation: { source, target: runningCard('run') } })

    expect(tasksStore.task('run')!.status).toBe(TaskStatus.Progress)
    expect(tasksStore.task('next')!.status).toBe(TaskStatus.Open)
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('Jetzt emptied during the drag: the drop is an ordinary move, no swap toast', () => {
    seed([['run', TaskStatus.Progress], ['next', TaskStatus.Open]])
    const source = card('next', TaskStatus.Open)
    const kit = start(source)
    over(kit, source, jetztZone)
    tasksStore.updateTask('run', { status: TaskStatus.Waiting })

    kit.onDragEnd({ canceled: false, operation: { source, target: jetztZone } })

    expect(tasksStore.task('next')!.status).toBe(TaskStatus.Progress)
    expect(toastAddMock).not.toHaveBeenCalled()
  })
})
