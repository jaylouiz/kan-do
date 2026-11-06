import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import TaskStack from '~/components/task/TaskStack.vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

// TaskCard is covered elsewhere; here it is a marker that keeps attrs (class, style, inert, data-*)
vi.mock('~/components/task/TaskCard.vue', () => ({
  default: {
    props: ['task', 'muted'],
    template: '<div class="task" :data-task-id="task.id" tabindex="0">{{ task.title }}</div>',
  },
}))

// dnd-kit registration is covered by the board and E2E specs; here the stack only has to register
const sortable = vi.hoisted(() => ({ calls: [] as unknown[][], dragging: null as unknown as { value: boolean } }))
vi.mock('~/composables/useColumnSortable', async () => {
  const { ref } = await import('vue')
  sortable.dragging = ref(false)
  return {
    useColumnSortable: (...args: unknown[]) => {
      sortable.calls.push(args)
      return { isDragging: sortable.dragging, isDropTarget: ref(false), isDragSource: ref(false) }
    },
  }
})

const task = (id: string, title: string): Task =>
  ({ id, title, status: TaskStatus.Open, priority: 1, timeSpentSeconds: 0, timeBoxSeconds: null }) as unknown as Task

const TASKS = [task('a1', 'Konzept'), task('a2', 'Farben'), task('a3', 'Layout')]

let wrapper: VueWrapper | null = null
const mountStack = (tasks: Task[] = TASKS) => {
  wrapper = mount(TaskStack, { props: { stackKey: 'Design', label: 'Design', tasks, taskStatus: TaskStatus.Open, sortableIndex: 2 } })
  return wrapper
}
const control = () => wrapper!.find('.task-stack__control')

// The pill reads the board's grouping (#504)
beforeEach(() => { setActivePinia(createPinia()) })

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('TaskStack (collapsed stack, #147)', () => {
  it('is one button with an accessible name and aria-expanded=false', () => {
    mountStack()
    expect(control().attributes('role')).toBe('button')
    expect(control().attributes('tabindex')).toBe('0')
    expect(control().attributes('aria-label')).toBe('Konzept, Design, 3 Aufgaben')
    expect(control().attributes('aria-expanded')).toBe('false')
  })

  it('names the stack in the active locale', async () => {
    const { setTestLocale } = await import('~/tests/helpers/i18n')
    setTestLocale('en')
    mountStack()
    expect(control().attributes('aria-label')).toBe('Konzept, Design, 3 tasks')
  })

  it('names the stack by the front title, the group and the count, for 2 and 3 tasks in both locales (#154, WCAG 2.5.3)', async () => {
    const { setTestLocale } = await import('~/tests/helpers/i18n')
    const two = [task('a1', 'Konzept'), task('a2', 'Farben')]
    const names: Record<string, string> = {}
    for (const [locale, tasks] of [['de', two], ['de', TASKS], ['en', two], ['en', TASKS]] as const) {
      setTestLocale(locale)
      mountStack([...tasks])
      names[`${locale}${tasks.length}`] = control().attributes('aria-label')!
      wrapper!.unmount()
    }
    expect(names).toEqual({
      de2: 'Konzept, Design, 2 Aufgaben',
      de3: 'Konzept, Design, 3 Aufgaben',
      en2: 'Konzept, Design, 2 tasks',
      en3: 'Konzept, Design, 3 tasks',
    })
  })

  it('the name contains the visible front title and the caption text, which stays aria-hidden', () => {
    mountStack()
    const name = control().attributes('aria-label')!
    expect(name).toContain(wrapper!.find('.task').text())
    expect(name).toContain('Design')
    expect(name).toContain('3 Aufgaben')
    expect(wrapper!.find('.task-stack__pill-layer').attributes('aria-hidden')).toBe('true')
  })

  it('keeps every card inert: only the control is in the tab order and the accessibility tree', () => {
    mountStack()
    const cards = wrapper!.findAll('.task')
    expect(cards).toHaveLength(3)
    cards.forEach(card => expect(card.attributes('inert')).toBeDefined())
    expect(wrapper!.findAll('[tabindex="0"]:not([inert])')).toHaveLength(1)
  })

  it('renders the first task as the front card, first in the card order, and names it in data-task-id', () => {
    mountStack()
    const cards = wrapper!.findAll('.task')
    expect(cards[0]!.attributes('data-task-id')).toBe('a1')
    expect(cards[0]!.classes()).toContain('stacked-task--top')
    expect(cards[1]!.classes()).not.toContain('stacked-task--top')
    expect(wrapper!.find('.task-stack').attributes('data-task-id')).toBe('a1')
    expect(JSON.parse(wrapper!.find('.task-stack').attributes('data-stack-task-ids')!)).toEqual(['a1', 'a2', 'a3'])
  })

  it('asks the column to expand on click (pointer) and on Enter (keyboard); Space is the drag pick-up (#150)', async () => {
    mountStack()
    await wrapper!.find('.task-stack').trigger('click')
    await control().trigger('keydown', { key: 'Enter' })
    const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
    control().element.dispatchEvent(space)
    const [click, enter] = wrapper!.emitted('expand')!
    // a click hands its event to the column, so a click that ended a drag can be told apart by identity
    expect(click).toEqual(['pointer', expect.any(MouseEvent)])
    expect(enter).toEqual(['keyboard'])
    // left alone for dnd-kit's keyboard sensor, which skips a prevented event
    expect(space.defaultPrevented).toBe(false)
  })

  it('ignores the repeats of a held Enter but still prevents their default (#156)', () => {
    mountStack()
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    control().element.dispatchEvent(repeat)
    expect(wrapper!.emitted('expand')).toBeUndefined()
    expect(repeat.defaultPrevented).toBe(true)
  })

  it('shows the pill, hidden from the tree because the control carries the details', () => {
    mountStack()
    const caption = wrapper!.find('.task-stack__caption')
    expect(caption.text()).toBe('Design3') // the word "Aufgaben" is gone from the pill (#504)
    expect(caption.element.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(control().attributes('aria-label')).toBe('Konzept, Design, 3 Aufgaben')
    expect(control().attributes('aria-label')).not.toContain('·')
  })

  it('pluralises the accessible name: one task, many tasks, in both locales', async () => {
    const { setTestLocale } = await import('~/tests/helpers/i18n')
    mountStack([task('a1', 'Konzept'), task('a2', 'Farben')])
    expect(control().attributes('aria-label')).toBe('Konzept, Design, 2 Aufgaben')
    wrapper!.unmount()
    setTestLocale('en')
    mountStack([task('a1', 'Konzept'), task('a2', 'Farben')])
    expect(control().attributes('aria-label')).toBe('Konzept, Design, 2 tasks')
  })

  it.each([
    [2, 1],
    [3, 2],
    [9, 2],
  ])('a stack of %i cards has %i peek layers, never more than two', (count, layers) => {
    mountStack(Array.from({ length: count }, (_, i) => task(`t${i}`, `Task ${i}`)))
    const stack = wrapper!.find('.task-stack')
    expect(stack.attributes('style')).toContain(`--stack-layers: ${layers}`)
    const shown = wrapper!.findAll('.task').filter(card => !card.classes().includes('stacked-task--hidden'))
    // the front card plus the peek layers
    expect(shown).toHaveLength(layers + 1)
  })

  it('has no expanded state of its own', async () => {
    mountStack()
    await control().trigger('keydown', { key: 'Enter' })
    expect(control().attributes('aria-expanded')).toBe('false')
    expect(wrapper!.findAll('.task[inert]')).toHaveLength(3)
  })
})

describe('TaskStack as one sortable (#150)', () => {
  beforeEach(() => {
    sortable.calls.length = 0
    sortable.dragging.value = false
  })

  it('registers once, with the front task as its id, the column index and status, the control as handle', () => {
    mountStack()
    expect(sortable.calls).toHaveLength(1)
    const [id, index, status, element, options] = sortable.calls[0] as [() => string, { value: number }, TaskStatus, { value: HTMLElement | null }, { handle: { value: HTMLElement | null } }]
    expect(id()).toBe('a1')
    expect(index.value).toBe(2)
    expect(status).toBe(TaskStatus.Open)
    expect(element.value).toBe(wrapper!.find('.task-stack').element)
    expect(options.handle.value).toBe(control().element)
  })

  it('carries the stack as data: key, label and every member in order', () => {
    mountStack()
    const options = sortable.calls[0]![4] as { data: { value: unknown } }
    expect(options.data.value).toEqual({ stack: { key: 'Design', label: 'Design', taskIds: ['a1', 'a2', 'a3'] } })
  })

  it('follows the front card: the id and the data change with the tasks', async () => {
    mountStack()
    await wrapper!.setProps({ tasks: [task('a2', 'Farben'), task('a3', 'Layout')] })
    const [id, , , , options] = sortable.calls[0] as [() => string, unknown, unknown, unknown, { data: { value: { stack: { taskIds: string[] } } } }]
    expect(id()).toBe('a2')
    expect(options.data.value.stack.taskIds).toEqual(['a2', 'a3'])
  })

  it('marks its root as the drag source while dragging', async () => {
    mountStack()
    expect(wrapper!.find('.task-stack').classes()).not.toContain('kando-dnd-dragged')
    sortable.dragging.value = true
    await nextTick()
    expect(wrapper!.find('.task-stack').classes()).toContain('kando-dnd-dragged')
  })

  it('describes itself as a draggable stack and points to stack-specific instructions (de)', () => {
    mountStack()
    expect(control().attributes('aria-roledescription')).toBe('Verschiebbarer Stapel')
    const description = wrapper!.find(`[id="${control().attributes('aria-describedby')!}"]`)
    expect(description.text()).toBe('Enter öffnet den Stapel. Leertaste hebt den ganzen Stapel auf, Pfeiltasten verschieben ihn, Leertaste legt ab, Escape bricht ab.')
  })

  it('describes itself in English as well', async () => {
    const { setTestLocale } = await import('~/tests/helpers/i18n')
    setTestLocale('en')
    mountStack()
    expect(control().attributes('aria-roledescription')).toBe('Draggable stack')
    const description = wrapper!.find(`[id="${control().attributes('aria-describedby')!}"]`)
    expect(description.text()).toBe('Press Enter to open the stack. Press Space to pick up the whole stack, arrow keys to move it, Space to drop, Escape to cancel.')
  })

  describe('preview (the DragOverlay face)', () => {
    const mountPreview = () => {
      wrapper = mount(TaskStack, { props: { stackKey: 'Design', label: 'Design', tasks: TASKS, taskStatus: TaskStatus.Open, sortableIndex: 0, preview: true } })
      return wrapper
    }

    it('shows the resting face: front card, peek layers and caption', () => {
      mountPreview()
      expect(wrapper!.findAll('.task')).toHaveLength(3)
      expect(wrapper!.find('.stacked-task--top').attributes('data-task-id')).toBe('a1')
      expect(wrapper!.find('.task-stack__caption').text()).toBe('Design3')
      expect(wrapper!.find('.task-stack').attributes('style')).toContain('--stack-layers: 2')
    })

    it('has no control, registers nowhere and asks for nothing on click', async () => {
      mountPreview()
      expect(wrapper!.find('.task-stack__control').exists()).toBe(false)
      expect(sortable.calls).toHaveLength(0)
      await wrapper!.find('.task-stack').trigger('click')
      expect(wrapper!.emitted('expand')).toBeUndefined()
    })

    it('is hidden from assistive tech and carries no task id the board could mistake for the stack', () => {
      mountPreview()
      const root = wrapper!.find('.task-stack')
      expect(root.attributes('aria-hidden')).toBe('true')
      expect(root.attributes('data-task-id')).toBeUndefined()
      expect(root.attributes('data-stack-task-ids')).toBeUndefined()
    })
  })
})

describe('TaskStack details pill (#195)', () => {
  it('shows the details as an aria-hidden pill layer over the front card, no caption row', () => {
    mountStack()
    const layer = wrapper!.find('.task-stack__pill-layer')
    expect(layer.attributes('aria-hidden')).toBe('true')
    expect(layer.find('.task-stack__caption').classes()).toContain('task-stack-pill')
    expect(layer.text()).toBe('Design3')
    expect(wrapper!.findAll('.task-stack__caption')).toHaveLength(1)
    expect(control().attributes('aria-label')).toBe('Konzept, Design, 3 Aufgaben')
  })

  it('tones the wash (#270) with a muted or waiting front card, not with a plain one', async () => {
    mountStack()
    expect(wrapper!.find('.task-stack__pill-layer').classes()).not.toContain('task-stack__pill-layer--toned')
    await wrapper!.setProps({ muted: true })
    expect(wrapper!.find('.task-stack__pill-layer').classes()).toContain('task-stack__pill-layer--toned')
    await wrapper!.setProps({ muted: false, tasks: [{ ...TASKS[0], status: TaskStatus.Waiting } as Task, ...TASKS.slice(1)] })
    expect(wrapper!.find('.task-stack__pill-layer').classes()).toContain('task-stack__pill-layer--toned')
  })
})
