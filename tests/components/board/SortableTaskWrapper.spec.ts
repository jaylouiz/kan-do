import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import * as sortable from '~/composables/useColumnSortable'
import SortableTaskWrapper from '~/components/board/SortableTaskWrapper.vue'
import { TaskStatus } from '~/types/taskStatus'

/**
 * The accessible name of a card stays its title; a member of an expanded stack adds a visually hidden
 * "n of m in <group>" description (#154).
 */

const deleteTaskWithUndo = vi.hoisted(() => vi.fn(() => true))
vi.mock('~/composables/useColumnSortable', async () => {
  const { ref } = await import('vue')
  const isDragging = ref(false)
  return { useColumnSortable: () => ({ isDragging }), isDraggingForTest: isDragging }
})
vi.mock('~/composables/useTaskDeletion', () => ({ useTaskDeletion: () => ({ deleteTaskWithUndo }) }))
vi.mock('~/store/tasks', () => ({
  useTasksStore: () => ({ tasks: [{ id: 'a2', title: 'Farben abstimmen' }] }),
}))

let wrapper: VueWrapper | null = null
const mountWrapper = (props: Record<string, unknown> = {}) => {
  wrapper = mount(SortableTaskWrapper, {
    props: { taskId: 'a2', index: 2, taskStatus: TaskStatus.Open, ...props },
    slots: { default: '<div class="task">Farben abstimmen</div>' },
  })
  return wrapper
}
const dragging = (sortable as unknown as { isDraggingForTest: { value: boolean } }).isDraggingForTest
const root = () => wrapper!.find('.task-wrapper')

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  dragging.value = false
  deleteTaskWithUndo.mockClear()
  document.body.innerHTML = ''
})

describe('SortableTaskWrapper: member description (#154)', () => {
  it('describes a member as "n von total in group" and wires it by aria-describedby', () => {
    mountWrapper({ fromStack: 'Design', stackIndex: 2, stackSize: 3, stackLabel: 'Design' })
    const id = root().attributes('aria-describedby')
    expect(id).toBeTruthy()
    const description = wrapper!.find(`[id="${id}"]`)
    expect(description.text()).toBe('2 von 3 in Design')
    expect(description.attributes('hidden')).toBeDefined()
    expect(root().element.contains(description.element)).toBe(true)
  })

  it('speaks English', async () => {
    const { setTestLocale } = await import('~/tests/helpers/i18n')
    setTestLocale('en')
    mountWrapper({ fromStack: 'Design', stackIndex: 1, stackSize: 3, stackLabel: 'Design' })
    expect(wrapper!.find(`[id="${root().attributes('aria-describedby')}"]`).text()).toBe('1 of 3 in Design')
  })

  it('keeps the task title as the accessible name', () => {
    mountWrapper({ fromStack: 'Design', stackIndex: 2, stackSize: 3, stackLabel: 'Design' })
    expect(root().attributes('aria-label')).toBe('Farben abstimmen')
    expect(root().attributes('role')).toBe('group')
  })

  it('gives two members different description ids', () => {
    // one app, as on the board: useId counts per app
    wrapper = mount({
      render: () => h('div', [1, 2].map(n => h(SortableTaskWrapper, { taskId: 'a2', index: n, taskStatus: TaskStatus.Open, stackIndex: n, stackSize: 2, stackLabel: 'Design' }))),
    })
    const ids = wrapper.findAll('.task-wrapper').map(el => el.attributes('aria-describedby'))
    expect(new Set(ids).size).toBe(2)
  })

  it('has no description outside an expanded stack', () => {
    mountWrapper()
    expect(root().attributes('aria-describedby')).toBeUndefined()
    expect(wrapper!.find('[hidden]').exists()).toBe(false)
  })
})

describe('SortableTaskWrapper: Delete key (#579)', () => {
  it.each(['Delete', 'Backspace'])('%s on the card deletes it and prevents the default', async (key) => {
    mountWrapper()
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    root().element.dispatchEvent(event)
    expect(deleteTaskWithUndo).toHaveBeenCalledExactlyOnceWith('a2')
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores a held key, a modifier and a running drag', async () => {
    mountWrapper()
    await root().trigger('keydown', { key: 'Delete', repeat: true })
    for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) {
      await root().trigger('keydown', { key: 'Backspace', [modifier]: true })
    }
    dragging.value = true
    await root().trigger('keydown', { key: 'Delete' })
    expect(deleteTaskWithUndo).not.toHaveBeenCalled()
  })

  it('ignores a key that bubbles from a control inside the card', async () => {
    wrapper = mount(SortableTaskWrapper, {
      props: { taskId: 'a2', index: 2, taskStatus: TaskStatus.Open },
      slots: { default: '<input class="inner" />' },
    })
    await wrapper.find('.inner').trigger('keydown', { key: 'Backspace' })
    expect(deleteTaskWithUndo).not.toHaveBeenCalled()
  })

  it('moves focus to the neighbour card', async () => {
    wrapper = mount({
      render: () => h('div', [
        h(SortableTaskWrapper, { taskId: 'a2', index: 0, taskStatus: TaskStatus.Open }),
        h(SortableTaskWrapper, { taskId: 'a3', index: 1, taskStatus: TaskStatus.Open }),
      ]),
    }, { attachTo: document.body })
    const [first, second] = wrapper.findAll('.task-wrapper')
    second!.element.setAttribute('tabindex', '0') // dnd-kit makes the wrapper focusable
    await first!.trigger('keydown', { key: 'Delete' })
    expect(deleteTaskWithUndo).toHaveBeenCalledWith('a2')
    expect(document.activeElement).toBe(second!.element)
  })
})

describe('SortableTaskWrapper: Enter key (kd#25)', () => {
  it('Enter clicks the card without a pointer (detail 0) and the click does not bubble', async () => {
    mountWrapper()
    const clicks: MouseEvent[] = []
    wrapper!.find('.task').element.addEventListener('click', e => clicks.push(e as MouseEvent))
    const bubbled = vi.fn()
    wrapper!.element.addEventListener('click', bubbled)
    await root().trigger('keydown', { key: 'Enter' })
    expect(clicks).toHaveLength(1)
    expect(clicks[0]!.detail).toBe(0)
    expect(bubbled).not.toHaveBeenCalled()
  })

  it('a held Enter does not click again', async () => {
    mountWrapper()
    const click = vi.fn()
    wrapper!.find('.task').element.addEventListener('click', click)
    await root().trigger('keydown', { key: 'Enter', repeat: true })
    expect(click).not.toHaveBeenCalled()
  })
})
