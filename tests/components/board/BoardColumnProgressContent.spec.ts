import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import BoardColumnProgressContent from '~/components/board/BoardColumnProgressContent.vue'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

// ColumnDropZone pulls in @dnd-kit/vue (ResizeObserver is missing in jsdom)
vi.mock('~/components/board/ColumnDropZone.vue', () => ({
  default: { template: '<div />' },
}))

const navigateTo = vi.hoisted(() => vi.fn())
vi.mock('nuxt/app', () => ({ navigateTo }))

const stubs = {
  SortableTaskWrapper: { template: '<div class="task-wrapper"><slot /></div>' },
  TaskCardContextMenu: { template: '<div><slot /></div>' },
  TaskCard: true,
  ColumnDropZone: true,
  AddTaskSlot: {
    props: ['status', 'label', 'showButton'],
    emits: ['open'],
    template: '<button data-testid="add-slot" :data-status="status" :data-show-button="String(showButton)" @click="$emit(\'open\')">{{ label }}</button>',
  },
}

const current = { id: 'p1', title: 'Review', status: TaskStatus.Progress } as unknown as Task

const render = (tasks: Task[] = [], isDragging = false) =>
  mount(BoardColumnProgressContent, {
    props: { tasks, listId: 'column-progress-list', isDragging, taskStatus: TaskStatus.Progress },
    global: { stubs },
  })

const slot = (w: ReturnType<typeof render>) => w.find('[data-testid="add-slot"]')

describe('BoardColumnProgressContent add-and-start slot (#125)', () => {
  afterEach(() => {
    useTaskDraft().clearDraft()
    navigateTo.mockClear()
  })

  it('shows the labelled slot only while Jetzt is empty', () => {
    const w = render()
    expect(slot(w).text()).toBe('Neue Aufgabe sofort starten')
    expect(slot(w).attributes('data-status')).toBe(String(TaskStatus.Progress))
    expect(slot(render([current])).exists()).toBe(false)
  })

  it('is not rendered during a drag', () => {
    expect(slot(render([], true)).exists()).toBe(false)
  })

  it('opens the add-and-start form', async () => {
    await slot(render()).trigger('click')
    expect(navigateTo).toHaveBeenCalledWith({ path: '/tasks/add', query: { mode: 'adhoc' } })
  })

  it('keeps the slot for the Jetzt draft; an Offen draft does not count', () => {
    useTaskDraft().startDraft(TaskStatus.Open)
    expect(slot(render([current])).exists()).toBe(false)

    useTaskDraft().startDraft(TaskStatus.Progress)
    const filled = render([current])
    // Jetzt filled up while drafting (e.g. a sync): the draft stays, without an add button
    expect(slot(filled).exists()).toBe(true)
    expect(slot(filled).attributes('data-show-button')).toBe('false')
    expect(slot(render()).attributes('data-show-button')).toBe('true')
  })

  it('keeps the draft in the slot box while its saved task lands in Jetzt', async () => {
    useTaskDraft().startDraft(TaskStatus.Progress)
    const w = render()
    const wrapper = () => slot(w).element.parentElement!
    expect(wrapper().classList.contains('add-task-slot-overlay')).toBe(true)

    useTaskDraft().setDraftSaving(true)
    await w.setProps({ tasks: [current] })
    expect(wrapper().classList.contains('add-task-slot-overlay')).toBe(true)

    useTaskDraft().clearDraft()
    await w.setProps({ tasks: [] })
    expect(wrapper().classList.contains('add-task-slot-overlay')).toBe(true)
  })

  it('puts the draft in flow below the card when Jetzt fills while drafting (no save running)', async () => {
    useTaskDraft().startDraft(TaskStatus.Progress)
    const w = render()
    await w.setProps({ tasks: [current] })
    expect(slot(w).element.parentElement!.classList.contains('add-task-slot-overlay')).toBe(false)
  })

  it('a draft opened while Jetzt already holds a card stays in flow below it', async () => {
    useTaskDraft().startDraft(TaskStatus.Progress)
    const w = render([current])
    expect(slot(w).element.parentElement!.classList.contains('add-task-slot-overlay')).toBe(false)
  })
})
