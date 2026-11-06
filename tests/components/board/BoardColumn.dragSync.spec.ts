/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Mid-drag syncs in a grouped column (#146, #147). dnd-kit moves the dragged wrapper next to the
 * target wrapper, which in a grouped column sits inside the neighbouring card's keyed fragment.
 * Plain-DOM tests cannot see that: these mount the real keyed fragments (BoardColumn +
 * SortableTaskWrapper) and drive useBoardDndKit with the node moves dnd-kit would make.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import BoardColumn from '~/components/board/BoardColumn.vue'
import { useBoardDndKit } from '~/composables/useBoardDndKit'
import { useStackExpansion } from '~/composables/useStackExpansion'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

vi.mock('~/components/board/ColumnDropZone.vue', () => ({ default: { template: '<div class="column-drop-zone" />' } }))
vi.mock('~/utils/featureFlags', () => ({ useFeatureFlags: () => ({ openColumnAddButton: false }) }))
vi.mock('~/composables/useColumnSortable', async () => {
  const { ref } = await import('vue')
  return { useColumnSortable: () => ({ isDragging: ref(false), isDropTarget: ref(false), isDragSource: ref(false) }) }
})
vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: (source: unknown) => source !== null && typeof source === 'object' && 'initialGroup' in source,
}))
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }) }))
const navigateTo = vi.hoisted(() => vi.fn())
vi.stubGlobal('navigateTo', navigateTo)
vi.stubGlobal('CSS', { escape: (value: string) => value })
vi.mock('nuxt/app', () => ({ navigateTo }))

const stubs = {
  BoardColumnHeader: true,
  ColumnSortingControl: true,
  BoardColumnYesterdayNote: true,
  BoardColumnProgressContent: true,
  AddTaskSlot: true,
  TaskCardContextMenu: { template: '<div><slot /></div>' },
  TaskCard: { props: ['task', 'muted'], template: '<div class="task" :data-task-id="task.id">{{ task.title }}</div>' },
  UDropdownMenu: true,
  UButton: true,
}

const makeTask = (id: string, topic: string | null, status = TaskStatus.Open): Task =>
  ({ id, title: `Task ${id}`, status, topic, activity: null, topicColorCode: null, priority: 0, notes: null, timeSpentSeconds: 0, timeBoxSeconds: null, timerId: null }) as unknown as Task

let wrapper: VueWrapper | null = null
let pinia: ReturnType<typeof createPinia>

const mountColumn = (ids: Array<[string, string | null]>) => {
  const tasksStore = useTasksStore()
  ids.forEach(([id, topic]) => tasksStore.addTask(makeTask(id, topic)))
  wrapper = mount(BoardColumn, {
    props: { taskStatus: TaskStatus.Open, tasks: tasksStore.tasksOpen, isDragging: false, muteOthers: false, groupingEnabled: true, groupingKey: 'topic' },
    global: { stubs, plugins: [pinia] },
    attachTo: document.body,
  })
}
const sync = async () => {
  await wrapper!.setProps({ tasks: useTasksStore().tasksOpen })
  await nextTick()
}
const list = () => wrapper!.find('.task-list').element as HTMLElement
const wrapperEl = (id: string) => list().querySelector<HTMLElement>(`.task-wrapper[data-task-id="${id}"]`)!
const order = () =>
  [...list().children].filter(el => el.hasAttribute('data-task-id')).map(el => `${el.classList.contains('task-stack') ? 'stack:' : ''}${el.getAttribute('data-task-id')}`)
const count = (id: string) => list().querySelectorAll(`.task-wrapper[data-task-id="${id}"]`).length

const dragStart = (id: string, element: Element) => ({ operation: { source: { id, group: TaskStatus.Open, element } } })
const drop = (id: string, element: Element, to = TaskStatus.Open, index = 0, initialIndex = 0) => ({
  canceled: false,
  operation: { source: { id, initialIndex, index, initialGroup: TaskStatus.Open, group: to, element }, target: {} },
})

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  useStackExpansion().reset()
  const boardStore = useBoardStore()
  boardStore.setSingleSource('local')
  boardStore.setGroupingEnabled(true)
  boardStore.setGroupingKey('topic')
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('#146 repro 1: the card dnd-kit moved the dragged one next to unmounts mid-drag', () => {
  it('x1 dragged below y1, y1 removed mid-drag, dropped: x1 and z1 both render', async () => {
    mountColumn([['x1', 'X'], ['y1', 'Y'], ['z1', 'Z']])
    expect(order()).toEqual(['x1', 'y1', 'z1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    const x1 = wrapperEl('x1')
    onDragStart(dragStart('x1', x1))
    wrapperEl('y1').after(x1) // dnd-kit's optimistic move: x1 now sits inside y1's fragment

    useTasksStore().removeTask('y1')
    await sync()
    // Every item is a single root node (BoardColumnItem), so unmounting y1 takes only y1's node:
    // the dragged node is not swept away with a fragment range, as it was before (#146)
    expect(x1.isConnected).toBe(true)

    onDragEnd(drop('x1', x1, TaskStatus.Open, 1, 0))
    await sync()

    // lands where the placeholder sat: before z1, where y1 was
    expect(order()).toEqual(['x1', 'z1'])
    expect(count('x1')).toBe(1)
    expect(count('z1')).toBe(1)
  })
})

describe('#146 repro 2: the dragged card stops being a draggable mid-drag', () => {
  it('a card whose topic change turns its group into a stack leaves no ghost', async () => {
    mountColumn([['x1', 'X'], ['z1', 'Z']])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    const z1 = wrapperEl('z1')
    onDragStart(dragStart('z1', z1))
    wrapperEl('x1').after(z1)

    useTasksStore().updateTask('z1', { topic: 'X' }) // z1 joins X: a collapsed stack of x1 + z1
    await sync()
    onDragEnd(drop('z1', z1, TaskStatus.Open, 1, 1))
    await sync()

    expect(order()).toEqual(['stack:x1'])
    expect(count('z1')).toBe(0)
    expect(count('x1')).toBe(0)
  })

  it('a status change mid-drag leaves no ghost', async () => {
    mountColumn([['x1', 'X'], ['y1', 'Y']])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    const x1 = wrapperEl('x1')
    onDragStart(dragStart('x1', x1))
    wrapperEl('y1').after(x1)

    useTasksStore().updateTask('x1', { status: TaskStatus.Waiting })
    await sync()
    onDragEnd(drop('x1', x1, TaskStatus.Open, 1, 0))
    await sync()

    expect(order()).toEqual(['y1'])
    expect(count('x1')).toBe(0)
  })
})

describe('members of an expanded stack (#147)', () => {
  const expand = async (key: string) => {
    useStackExpansion().expand(TaskStatus.Open, key, 'keyboard')
    await nextTick()
  }

  it('a member dropped within its group persists the new group order', async () => {
    mountColumn([['u1', null], ['a1', 'A'], ['a2', 'A'], ['a3', 'A'], ['b1', 'B']])
    await expand('A')
    expect(order()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
    const { onDragStart, onDragEnd } = useBoardDndKit()
    const a1 = wrapperEl('a1')
    onDragStart(dragStart('a1', a1))
    wrapperEl('a2').after(a1)

    // sortable indices: u1 0, a1 1, a2 2, a3 3, b1 4; a1 moved to index 2
    onDragEnd(drop('a1', a1, TaskStatus.Open, 2, 1))
    await sync()

    expect(order()).toEqual(['u1', 'a2', 'a1', 'a3', 'b1'])
    expect(useBoardStore().columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['u1', 'a2', 'a1', 'a3', 'b1'])
  })

  it('a member dropped outside its group in the same column changes nothing and shows no ghost', async () => {
    mountColumn([['u1', null], ['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['c1', 'C']])
    await expand('A')
    const saveTaskOrder = vi.spyOn(useBoardStore(), 'saveTaskOrder')
    const { onDragStart, onDragEnd } = useBoardDndKit()
    const a1 = wrapperEl('a1')
    onDragStart(dragStart('a1', a1))
    wrapperEl('c1').after(a1) // below the last card, far outside the group

    onDragEnd(drop('a1', a1, TaskStatus.Open, 4, 1))
    await sync()

    expect(saveTaskOrder).not.toHaveBeenCalled()
    expect(order()).toEqual(['u1', 'a1', 'a2', 'b1', 'c1'])
    expect(count('a1')).toBe(1)
  })

  it('a member dragged out to another column leaves the group: 3 to 2 stays expanded, 2 to 1 becomes a card', async () => {
    mountColumn([['a1', 'A'], ['a2', 'A'], ['a3', 'A']])
    await expand('A')
    const { onDragStart, onDragEnd } = useBoardDndKit()

    const a2 = wrapperEl('a2')
    onDragStart(dragStart('a2', a2))
    const elsewhere = document.createElement('div') // dnd-kit's move into the Wartet list
    document.body.append(elsewhere)
    elsewhere.append(a2)
    onDragEnd(drop('a2', a2, TaskStatus.Waiting, 0, 1))
    await sync()
    expect(order()).toEqual(['a1', 'a3'])
    expect(wrapper!.findAll('[data-from-stack="A"]')).toHaveLength(2)
    expect(count('a2')).toBe(0)

    const a3 = wrapperEl('a3')
    onDragStart(dragStart('a3', a3))
    elsewhere.append(a3)
    onDragEnd(drop('a3', a3, TaskStatus.Waiting, 0, 1))
    await sync()
    expect(order()).toEqual(['a1'])
    expect(wrapper!.find('[data-from-stack]').exists()).toBe(false)
    expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual([])
    expect(useTasksStore().task('a2')!.status).toBe(TaskStatus.Waiting)
  })

  it('a sync that removes the dragged member and adds another leaves no orphan or missing card', async () => {
    mountColumn([['a1', 'A'], ['a2', 'A'], ['a3', 'A']])
    await expand('A')
    const { onDragStart, onDragEnd } = useBoardDndKit()
    const a2 = wrapperEl('a2')
    onDragStart(dragStart('a2', a2))
    wrapperEl('a3').after(a2)

    useTasksStore().removeTask('a2')
    useTasksStore().addTask(makeTask('a4', 'A'))
    await sync()
    onDragEnd(drop('a2', a2, TaskStatus.Open, 2, 1))
    await sync()

    expect(order()).toEqual(['a1', 'a3', 'a4'])
    expect(count('a2')).toBe(0)
  })
})
