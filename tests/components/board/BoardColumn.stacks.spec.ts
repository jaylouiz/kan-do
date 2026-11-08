/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import BoardColumn from '~/components/board/BoardColumn.vue'
import { useStackExpansion } from '~/composables/useStackExpansion'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

/**
 * Expanding a stack in a grouped column (#147): BoardColumn renders the members of an expanded
 * group as ordinary sortable cards in place of the stack. Real TaskStack and SortableTaskWrapper,
 * stubbed cards, mocked dnd-kit registration.
 */

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

vi.mock('~/components/board/ColumnDropZone.vue', () => ({ default: { template: '<div class="column-drop-zone" />' } }))
const motion = vi.hoisted(() => ({ capture: vi.fn(), play: vi.fn(), cancel: vi.fn() }))
vi.mock('~/composables/useStackMotion', () => ({ useStackMotion: () => motion }))
vi.mock('~/utils/featureFlags', () => ({ useFeatureFlags: () => ({ openColumnAddButton: false }) }))

const registered = vi.hoisted(() => ({ indices: {} as Record<string, number> }))
vi.mock('~/composables/useColumnSortable', async () => {
  const { watchEffect, ref, toValue } = await import('vue')
  return {
    useColumnSortable: (id: string | (() => string), index: { value: number }) => {
      watchEffect(() => { registered.indices[toValue(id)] = index.value })
      return { isDragging: ref(false), isDropTarget: ref(false), isDragSource: ref(false) }
    },
  }
})
vi.mock('~/composables/useTaskDeletion', () => ({ useTaskDeletion: () => ({ deleteTaskWithUndo: vi.fn() }) }))
vi.mock('~/store/tasks', () => ({ useTasksStore: () => ({ tasks: [], tasksDonePrevious: [] }) }))
vi.mock('~/store/board', () => ({
  useBoardStore: () => ({
    columnByTaskStatus: vi.fn().mockReturnValue({ sorting: { field: 'manual', direction: 'asc' } }),
    setColumnSorting: vi.fn(),
  }),
}))
const navigateTo = vi.hoisted(() => vi.fn())
vi.stubGlobal('navigateTo', navigateTo)
// jsdom has no CSS.escape
vi.stubGlobal('CSS', { escape: (value: string) => value })
vi.mock('nuxt/app', () => ({ navigateTo }))

const task = (id: string, topic: string | null, status = TaskStatus.Open): Task =>
  ({ id, title: `Task ${id}`, status, topic, priority: 1, timeSpentSeconds: 0, timeBoxSeconds: null }) as unknown as Task

const stubs = {
  BoardColumnHeader: true,
  ColumnSortingControl: true,
  BoardColumnYesterdayNote: true,
  BoardColumnProgressContent: true,
  AddTaskSlot: true,
  TaskCardContextMenu: { template: '<div class="ctx"><slot /></div>' },
  TaskCard: { props: ['task', 'muted'], template: '<div class="task" :data-task-id="task.id" tabindex="0">{{ task.title }}</div>' },
  TaskStackPill: true, // reads the board grouping (#504); covered by TaskStackPill.spec.ts
  UDropdownMenu: true,
  UButton: { props: ['label'], template: '<button type="button" class="u-button">{{ label }}</button>' },
}

// Open column: u1 (no topic) renders first, then the Design group (a1 a2 a3), then Backend (b1) alone
const TASKS = [task('a1', 'Design'), task('u1', null), task('a2', 'Design'), task('b1', 'Backend'), task('a3', 'Design')]

let wrapper: VueWrapper | null = null
const mountColumn = (tasks: Task[] = TASKS, extra: Record<string, unknown> = {}) => {
  wrapper = mount(BoardColumn, {
    props: { taskStatus: TaskStatus.Open, tasks, isDragging: false, muteOthers: false, groupingEnabled: true, groupingKey: 'topic', ...extra },
    global: { stubs },
    attachTo: document.body,
  })
  return wrapper
}

const list = () => wrapper!.find('.task-list').element as HTMLElement
/** The list's items top to bottom: a stack counts once, by its front card */
const items = () =>
  [...list().children].filter(el => el.matches('.task-wrapper, .task-stack')).map(el => `${el.classList.contains('task-stack') ? 'stack:' : ''}${el.getAttribute('data-task-id')}`)
/** The list's direct children top to bottom, header rows included */
const rows = () =>
  [...list().children].filter(el => el.matches('.task-wrapper, .task-stack, .task-stack-header')).map(el => (el.matches('.task-stack-header') ? 'header' : el.getAttribute('data-task-id')))
const headerButton = () => wrapper!.find('.task-stack-header .u-button')
const stack = () => wrapper!.find('.task-stack')
const control = () => wrapper!.find('.task-stack__control')
const flush = async () => { await nextTick(); await new Promise(r => setTimeout(r, 0)); await nextTick() }
/** The pointer release that ends a drag, and the click that follows it at the same spot */
const releasePointerAt = (x: number, y: number) => document.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }))
const pointerClickAt = (x: number, y: number) => new MouseEvent('click', { bubbles: true, detail: 1, clientX: x, clientY: y })
const expandWithClick = async () => { await stack().trigger('click'); await flush() }
const pressEsc = async () => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await flush()
}

beforeEach(() => {
  useStackExpansion().reset()
  useBoardDragState().dragState.value.isDragging = false
  registered.indices = {}
  motion.capture.mockClear()
  motion.play.mockClear()
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('BoardColumn: collapsed stacks', () => {
  it('renders the group as one stack and the other tasks as cards', () => {
    mountColumn()
    expect(items()).toEqual(['u1', 'stack:a1', 'b1'])
    expect(stack().attributes('data-stack-size')).toBe('3')
  })

  it('cards and collapsed stacks are sortables, with dense indices; the stack is one, by its front card (#150)', () => {
    mountColumn()
    expect(registered.indices).toEqual({ u1: 0, a1: 1, b1: 2 })
  })
})

describe('BoardColumn: expanded stacks (#147)', () => {
  it('renders the members in group order, in place of the stack, as marked sortable cards', async () => {
    mountColumn()
    await expandWithClick()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
    expect(wrapper!.find('.task-stack').exists()).toBe(false)
    const members = wrapper!.findAll('.task-wrapper[data-from-stack="Design"]')
    expect(members.map(m => m.attributes('data-task-id'))).toEqual(['a1', 'a2', 'a3'])
    expect(members.map(m => m.attributes('data-stack-position'))).toEqual(['first', 'middle', 'last'])
    // same markup as a single card: wrapper > context menu > card
    members.forEach(m => expect(m.find('.ctx .task').exists()).toBe(true))
    expect(wrapper!.find('.task-wrapper[data-task-id="u1"]').attributes('data-from-stack')).toBeUndefined()
  })

  it('puts one header row before the members: a root node of the list, outside every sortable, with the pill', async () => {
    mountColumn()
    expect(wrapper!.find('.task-stack-header').exists()).toBe(false)
    await expandWithClick()
    expect(rows()).toEqual(['u1', 'header', 'a1', 'a2', 'a3', 'b1'])
    const header = wrapper!.find('.task-stack-header')
    expect(header.element.parentElement).toBe(list())
    expect(header.element.closest('.task-wrapper')).toBeNull()
    expect(header.find('task-stack-pill-stub').exists()).toBe(true)
    expect(header.find('.task-stack-caption').exists()).toBe(false)
    expect(header.attributes('data-task-id')).toBeUndefined()
  })

  it('the close X from the keyboard collapses the group, announces it and returns focus to the stack', async () => {
    mountColumn()
    await expandWithClick()
    await headerButton().trigger('click')
    await flush()
    expect(rows()).toEqual(['u1', 'a1', 'b1'])
    expect(items()).toEqual(['u1', 'stack:a1', 'b1'])
    expect(useStackExpansion().stackAnnouncement.value).toBe('Stapel Design geschlossen.')
    expect(document.activeElement).toBe(control().element)
  })

  it('the close X with the mouse collapses the group but does not move focus', async () => {
    mountColumn()
    await expandWithClick()
    const button = headerButton().element as HTMLElement
    button.focus()
    // a real pointer click carries detail >= 1 (Enter or Space on the button give 0)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await flush()
    expect(items()).toEqual(['u1', 'stack:a1', 'b1'])
    expect(document.activeElement).not.toBe(control().element)
  })

  it('a click on the header row is not an outside click', async () => {
    mountColumn()
    await expandWithClick()
    wrapper!.find('.task-stack-header__pill').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(rows()).toEqual(['u1', 'header', 'a1', 'a2', 'a3', 'b1'])
  })

  it('the header row does not move any drop index: sortables are numbered as without it', async () => {
    mountColumn()
    const collapsed = { ...registered.indices }
    await expandWithClick()
    expect(collapsed).toEqual({ u1: 0, a1: 1, b1: 2 })
    expect(registered.indices).toEqual({ u1: 0, a1: 1, a2: 2, a3: 3, b1: 4 })
    expect(wrapper!.findAll('.task-stack-header [data-task-id], .task-stack-header .task-wrapper')).toHaveLength(0)
  })

  it('moves no node out of the Vue tree: the card nodes are children of their wrappers', async () => {
    mountColumn()
    await expandWithClick()
    expect(list().querySelectorAll('[data-original-stack], [data-original-index]')).toHaveLength(0)
    list().querySelectorAll('.task').forEach(card => expect(card.parentElement!.closest('.task-wrapper')).not.toBeNull())
  })

  it('keeps the sortable indices dense over the rendered order', async () => {
    mountColumn()
    await expandWithClick()
    expect(registered.indices).toEqual({ u1: 0, a1: 1, a2: 2, a3: 3, b1: 4 })
  })

  it('announces opening and then closing', async () => {
    mountColumn()
    const { stackAnnouncement } = useStackExpansion()
    await control().trigger('keydown', { key: 'Enter' })
    await flush()
    expect(stackAnnouncement.value).toBe('Stapel Design geöffnet, 3 Aufgaben. Esc schließt.')
    await pressEsc()
    expect(stackAnnouncement.value).toBe('Stapel Design geschlossen.')
  })

  it('a pointer expand announces the hint for pointer and touch: "Use Close", not Esc (#154)', async () => {
    mountColumn()
    await expandWithClick()
    expect(useStackExpansion().stackAnnouncement.value).toBe('Stapel Design geöffnet, 3 Aufgaben. Mit „Schließen“ einklappen.')
  })

  it('speaks both announcements in English', async () => {
    const { setTestLocale } = await import('~/tests/helpers/i18n')
    setTestLocale('en')
    const { stackAnnouncement } = useStackExpansion()
    mountColumn()
    await control().trigger('keydown', { key: 'Enter' })
    await flush()
    expect(stackAnnouncement.value).toBe('Stack Design opened, 3 tasks. Esc closes.')
    await pressEsc()
    wrapper!.unmount()
    mountColumn()
    await expandWithClick()
    expect(stackAnnouncement.value).toBe('Stack Design opened, 3 tasks. Use Close to collapse.')
  })

  it('describes each member of an expanded group as "n von total in group"; ungrouped cards have none (#154)', async () => {
    mountColumn()
    await expandWithClick()
    const described = wrapper!.findAll('.task-wrapper').map((el) => {
      const id = el.attributes('aria-describedby')
      return [el.attributes('data-task-id'), id ? wrapper!.find(`[id="${id}"]`).text() : null]
    })
    expect(described).toEqual([
      ['u1', null],
      ['a1', '1 von 3 in Design'],
      ['a2', '2 von 3 in Design'],
      ['a3', '3 von 3 in Design'],
      ['b1', null],
    ])
    expect(wrapper!.find('.task-stack-header').attributes('role')).toBe('group')
  })

  it('keeps a stack expanded when the column is mounted again, as on a mobile tab switch (#154)', async () => {
    mountColumn()
    await expandWithClick()
    wrapper!.unmount()
    mountColumn()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })

  it('keyboard expansion moves focus to the first member; Esc collapses and returns focus to the stack', async () => {
    mountColumn()
    await control().trigger('keydown', { key: 'Enter' })
    await flush()
    expect(document.activeElement).toBe(wrapper!.find('.task-wrapper[data-task-id="a1"]').element)

    await pressEsc()
    expect(items()).toEqual(['u1', 'stack:a1', 'b1'])
    expect(document.activeElement).toBe(control().element)
  })

  it('a held Enter expands once and opens no sheet: the repeats land on the first member (#156)', async () => {
    mountColumn()
    const sheet = vi.fn()
    document.addEventListener('click', sheet, true)
    await control().trigger('keydown', { key: 'Enter' })
    await flush()
    const member = wrapper!.find('.task-wrapper[data-task-id="a1"]')
    expect(document.activeElement).toBe(member.element)

    // the key repeats on the focused member
    await member.trigger('keydown', { key: 'Enter', repeat: true })
    await member.trigger('keydown', { key: 'Enter', repeat: true })
    document.removeEventListener('click', sheet, true)

    expect(sheet).not.toHaveBeenCalled()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
    expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual(['Design'])
  })

  it('a fresh Enter on a member opens its details (#156)', async () => {
    mountColumn()
    await expandWithClick()
    const sheet = vi.fn()
    document.addEventListener('click', sheet, true)
    await wrapper!.find('.task-wrapper[data-task-id="a1"]').trigger('keydown', { key: 'Enter' })
    document.removeEventListener('click', sheet, true)
    expect(sheet).toHaveBeenCalledOnce()
  })

  it('Esc leaves focus alone when it is outside the column (dock, other column)', async () => {
    mountColumn()
    await expandWithClick()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    await pressEsc()
    expect(items()).toEqual(['u1', 'stack:a1', 'b1'])
    expect(document.activeElement).toBe(outside)
  })

  it('Esc yields to a handler that already used the key, an open dialog and a running drag', async () => {
    mountColumn()
    await expandWithClick()

    const consume = (e: Event) => e.preventDefault()
    document.addEventListener('keydown', consume)
    await pressEsc()
    document.removeEventListener('keydown', consume)
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    await pressEsc()
    dialog.remove()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])

    useBoardDragState().dragState.value.isDragging = true
    await pressEsc()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })

  it('an outside click collapses; a click on a member or on the click ending a drag does not', async () => {
    mountColumn()
    await expandWithClick()

    wrapper!.find('.task-wrapper[data-task-id="a2"] .task').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])

    // the click that ends a drag
    const { dragState } = useBoardDragState()
    dragState.value.isDragging = true
    await nextTick()
    releasePointerAt(40, 50)
    dragState.value.isDragging = false
    wrapper!.find('.task-wrapper[data-task-id="u1"] .task').element.dispatchEvent(pointerClickAt(40, 50))
    await flush()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])

    // a deliberate click right after the drop: its pointerdown ended the drag gesture, no waiting
    const outside = wrapper!.find('.task-wrapper[data-task-id="u1"] .task').element
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(items()).toEqual(['u1', 'stack:a1', 'b1'])
  })

  it('a click that removed its own target inside this column is not an outside click', async () => {
    mountColumn()
    // stands for another stack of this column: Vue re-renders it away between the stack's handler
    // and the document listeners. Registered first, so it runs before the column's bubble listener; the
    // capture listener has classified the click as a stack click by then (#176).
    const ghost = document.createElement('span')
    ghost.className = 'task-stack'
    list().appendChild(ghost)
    let removeGhost = false
    const reRender = () => { if (removeGhost) ghost.remove() }
    document.addEventListener('click', reRender)
    await expandWithClick()
    removeGhost = true
    const click = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(click, 'target', { value: ghost })
    document.dispatchEvent(click)
    document.removeEventListener('click', reRender)
    await flush()
    expect(ghost.isConnected).toBe(false)
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })

  it('a click on the stack while a drag runs does not expand it', async () => {
    mountColumn()
    useBoardDragState().dragState.value.isDragging = true
    await stack().trigger('click')
    await flush()
    expect(stack().exists()).toBe(true)
  })

  it('the click that ends a drag does not expand a stack, the next tap does at once (#154)', async () => {
    mountColumn()
    const { dragState } = useBoardDragState()
    dragState.value.isDragging = true
    await nextTick()
    releasePointerAt(40, 50)
    dragState.value.isDragging = false

    // one click, seen by the stack's own handler and then by the document listener of an expanded column
    stack().element.dispatchEvent(pointerClickAt(40, 50))
    await flush()
    expect(stack().exists()).toBe(true)

    await stack().trigger('pointerdown')
    await stack().trigger('click')
    await flush()
    expect(stack().exists()).toBe(false)
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })

  it('a synthetic click right after a drag expands the stack (VoiceOver, TalkBack, voice control)', async () => {
    mountColumn()
    const { dragState } = useBoardDragState()
    dragState.value.isDragging = true
    await nextTick()
    releasePointerAt(40, 50)
    dragState.value.isDragging = false

    // no pointerdown, no key release in between: what assistive technology sends
    ;(stack().element as HTMLElement).click()
    await flush()

    expect(stack().exists()).toBe(false)
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })

  it('the sheet is blocked for the later clicks of the expanding double-click, not for a single click or Enter', async () => {
    mountColumn()
    const { shouldBlockModal } = useStackExpansion()
    await expandWithClick()
    expect(shouldBlockModal({ detail: 2 } as MouseEvent)).toBe(true)
    expect(shouldBlockModal({ detail: 1 } as MouseEvent)).toBe(false)
    expect(shouldBlockModal({ detail: 0 } as MouseEvent)).toBe(false)
  })

  it('a keyboard expand never blocks the sheet', async () => {
    mountColumn()
    await control().trigger('keydown', { key: 'Enter' })
    await flush()
    expect(useStackExpansion().shouldBlockModal({ detail: 2 } as MouseEvent)).toBe(false)
  })

  describe('membership changes', () => {
    it('survives a sync that adds a member: the stack stays expanded with the new card in place', async () => {
      mountColumn()
      await expandWithClick()
      await wrapper!.setProps({ tasks: [...TASKS, task('a4', 'Design')] })
      expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'a4', 'b1'])
      expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual(['Design'])
    })

    it('stays expanded when the group shrinks from 3 to 2', async () => {
      mountColumn()
      await expandWithClick()
      await wrapper!.setProps({ tasks: TASKS.filter(t => t.id !== 'a3') })
      expect(items()).toEqual(['u1', 'a1', 'a2', 'b1'])
      expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual(['Design'])
    })

    it('a group shrinking to 1 becomes a normal card and forgets its expansion', async () => {
      mountColumn()
      await expandWithClick()
      await wrapper!.setProps({ tasks: TASKS.filter(t => t.id === 'a1' || t.id === 'u1' || t.id === 'b1') })
      expect(items()).toEqual(['u1', 'a1', 'b1'])
      expect(wrapper!.find('[data-from-stack]').exists()).toBe(false)
      expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual([])
      // growing back yields a collapsed stack, not a stale expansion
      await wrapper!.setProps({ tasks: TASKS })
      expect(items()).toEqual(['u1', 'stack:a1', 'b1'])
    })

    it('a member leaving the group by topic change leaves no orphan', async () => {
      mountColumn()
      await expandWithClick()
      await wrapper!.setProps({ tasks: TASKS.map(t => (t.id === 'a2' ? task('a2', 'Backend') : t)) })
      // a2 joins Backend (now a stack of a2 + b1); Design (a1 + a3) stays expanded
      expect(items()).toEqual(['u1', 'a1', 'a3', 'stack:a2'])
      expect(list().querySelectorAll('.task-wrapper')).toHaveLength(3)
    })
  })

  it('grouping switched off or to another key forgets all expansions', async () => {
    mountColumn()
    await expandWithClick()
    await wrapper!.setProps({ groupingKey: 'priority' })
    expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual([])
    await wrapper!.setProps({ groupingKey: 'topic' })
    expect(items()).toEqual(['u1', 'stack:a1', 'b1'])

    await expandWithClick()
    await wrapper!.setProps({ groupingEnabled: false })
    expect(useStackExpansion().expandedKeys(TaskStatus.Open)).toEqual([])
    expect(list().querySelectorAll('.task-wrapper[data-from-stack]')).toHaveLength(0)
  })

  it('keeps its expanded state when the column re-mounts', async () => {
    mountColumn()
    await expandWithClick()
    wrapper!.unmount()
    mountColumn()
    await flush()
    expect(items()).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  })
})

describe('BoardColumn: stack motion (#197)', () => {
  it('records and plays once per expand: capture before the state change, play after it rendered', async () => {
    mountColumn()
    motion.capture.mockImplementation(() => expect(stack().exists()).toBe(true))
    await expandWithClick()
    expect(motion.capture).toHaveBeenCalledTimes(1)
    expect(motion.capture).toHaveBeenCalledWith('Design', 'expand')
    expect(motion.play).toHaveBeenCalledTimes(1)
    motion.capture.mockReset()
  })

  it('records and plays once for "Schließen" and for Escape', async () => {
    mountColumn()
    await expandWithClick()
    motion.capture.mockClear()
    motion.play.mockClear()
    await headerButton().trigger('click')
    await flush()
    expect(motion.capture).toHaveBeenCalledTimes(1)
    expect(motion.capture).toHaveBeenCalledWith(['Design'], 'collapse')
    expect(motion.play).toHaveBeenCalledTimes(1)

    await expandWithClick()
    motion.capture.mockClear()
    motion.play.mockClear()
    await pressEsc()
    expect(motion.capture).toHaveBeenCalledTimes(1)
    expect(motion.play).toHaveBeenCalledTimes(1)
  })

  it('an outside click collapsing several groups records them in one capture', async () => {
    mountColumn([...TASKS, task('b2', 'Backend')])
    await expandWithClick()
    useStackExpansion().expand(TaskStatus.Open, 'Backend', 'pointer')
    await flush()
    motion.capture.mockClear()
    motion.play.mockClear()
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await flush()
    expect(motion.capture).toHaveBeenCalledTimes(1)
    expect(motion.capture.mock.calls[0]![0]).toHaveLength(2)
    expect(motion.play).toHaveBeenCalledTimes(1)
  })

  it('prune (a group shrinking to one card) and collapseAll (grouping changed) never animate', async () => {
    mountColumn()
    await expandWithClick()
    motion.capture.mockClear()
    motion.play.mockClear()
    await wrapper!.setProps({ tasks: TASKS.filter(t => t.id === 'a1' || t.id === 'u1' || t.id === 'b1') })
    await wrapper!.setProps({ tasks: TASKS })
    await expandWithClick()
    motion.capture.mockClear()
    motion.play.mockClear()
    await wrapper!.setProps({ groupingKey: 'priority' })
    await wrapper!.setProps({ groupingEnabled: false })
    expect(motion.capture).not.toHaveBeenCalled()
    expect(motion.play).not.toHaveBeenCalled()
  })

  it('a click that ends a drag does not expand, so it does not animate', async () => {
    mountColumn()
    useBoardDragState().dragState.value.isDragging = true
    await stack().trigger('click')
    await flush()
    expect(motion.capture).not.toHaveBeenCalled()
  })
})
