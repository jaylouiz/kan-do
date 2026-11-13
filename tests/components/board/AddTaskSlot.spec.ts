import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { toastAddMock } from '~/tests/mocks/nuxt-imports'
import AddTaskSlot from '~/components/board/AddTaskSlot.vue'
import { useTaskDraft } from '~/composables/useTaskDraft'
import { TaskStatus } from '~/types/taskStatus'

// Reactive, so a route change on the mounted slot reaches its watcher
const route = vi.hoisted(() => ({ value: null as unknown as { path: string } }))
vi.mock('vue-router', async () => {
  const { reactive: makeReactive } = await import('vue')
  route.value = makeReactive({ path: '/tasks' })
  return { useRoute: () => route.value }
})
// The flow itself is covered by NewCardFlow.spec.ts: here it only offers the two ways out
vi.mock('~/components/board/NewCardFlow.vue', () => ({
  default: {
    name: 'NewCardFlow',
    emits: ['saved', 'cancel'],
    props: ['initialTitle'],
    template: '<div data-testid="new-card-flow" :data-initial-title="initialTitle"><button data-testid="flow-cancel" @click="$emit(\'cancel\')" /><button data-testid="flow-cancel-typed" @click="$emit(\'cancel\', { title: \'Tippfehler\' })" /><button data-testid="flow-saved" @click="$emit(\'saved\', \'task-1\')" /></div>',
  },
}))

const focusWhenReady = vi.hoisted(() => vi.fn())
vi.mock('~/utils/focusRecovery', () => ({ focusWhenReady, findSavedCardElement: vi.fn() }))

const stubs = { TaskDraftCard: { template: '<div data-testid="task-draft-card" />' }, UIcon: true }

const render = (showButton: boolean, status = TaskStatus.Open) =>
  mount(AddTaskSlot, { props: { status, label: 'Aufgabe hinzufügen', showButton }, global: { stubs } })

describe('AddTaskSlot reserved box (#125)', () => {
  afterEach(() => useTaskDraft().clearDraft())

  it('reserves the card box for the Jetzt button', () => {
    expect(render(true, TaskStatus.Progress).classes()).not.toContain('is-empty')
  })

  it('reserves the card box for a draft without a button', () => {
    useTaskDraft().startDraft(TaskStatus.Progress)
    expect(render(false, TaskStatus.Progress).classes()).not.toContain('is-empty')
  })

  it('reserves nothing with neither button nor draft', () => {
    useTaskDraft().startDraft(TaskStatus.Progress)
    const w = render(false)
    expect(w.classes()).toContain('is-empty')
    expect(w.find('button').exists()).toBe(false)
  })

  it('Offen without a draft renders no box at all: no wrapper, nothing the list gap could open above the first card (#248)', () => {
    const w = render(false)
    expect(w.classes()).toContain('add-task-slot--open')
    expect(w.find('.add-task-slot-draft-wrap').exists()).toBe(false)
    expect(w.find('button').exists()).toBe(false)
  })
})

describe('AddTaskSlot surface (#466)', () => {
  afterEach(() => useTaskDraft().clearDraft())

  it('wraps icon and label in the surface inside the native button', () => {
    const w = render(true, TaskStatus.Progress)
    const surface = w.find('button .add-task-button-surface')
    expect(surface.exists()).toBe(true)
    expect(surface.find('.add-task-button-label').text()).toBe('Aufgabe hinzufügen')
    expect(w.find('button').text()).toBe('Aufgabe hinzufügen')
  })

  it('renders the plus icon by default and the icon prop when given', () => {
    const plain = mount(AddTaskSlot, { props: { status: TaskStatus.Open, label: 'x' }, global: { stubs: { ...stubs, UIcon: { props: ['name'], template: '<i :data-icon="name" />' } } } })
    expect(plain.find('[data-icon]').attributes('data-icon')).toBe('i-ph-plus')
    const bolt = mount(AddTaskSlot, { props: { status: TaskStatus.Progress, label: 'x', icon: 'i-ph-lightning' }, global: { stubs: { ...stubs, UIcon: { props: ['name'], template: '<i :data-icon="name" />' } } } })
    expect(bolt.find('[data-icon]').attributes('data-icon')).toBe('i-ph-lightning')
  })

  it('marks the slot as drafting so the Jetzt button is inert', () => {
    useTaskDraft().startDraft(TaskStatus.Progress)
    const w = render(true, TaskStatus.Progress)
    expect(w.classes()).toContain('is-drafting')
    expect(w.find('button').attributes('inert')).toBeDefined()
  })

  it('hides the button in a hidden slot without removing the box', () => {
    const w = mount(AddTaskSlot, { props: { status: TaskStatus.Open, label: 'x', hidden: true }, global: { stubs } })
    expect(w.classes()).toContain('is-hidden')
    expect(w.find('.add-task-button-surface').exists()).toBe(true)
  })
})

describe('AddTaskSlot in-card adding (#649)', () => {
  afterEach(() => {
    useTaskDraft().clearDraft()
    route.value.path = '/tasks'
  })

  // Offen (#248): no button of its own; the header's add button calls the exposed `open()`
  const headerButton = document.createElement('button')
  const renderInCard = (props: Record<string, unknown> = {}) =>
    mount(AddTaskSlot, {
      props: { status: TaskStatus.Open, label: 'Aufgabe hinzufügen', showButton: false, inCard: true, focusFallback: () => headerButton, ...props },
      global: { stubs },
      attachTo: document.body,
    })
  const open = (w: ReturnType<typeof renderInCard>) => (w.vm as unknown as { open: () => void }).open()

  it('open() shows the card at the slot instead of emitting open; a second open() never opens a second card', async () => {
    const w = renderInCard()
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(false)
    open(w)
    await nextTick()
    expect(w.emitted('open')).toBeUndefined()
    expect(w.findAll('[data-testid="new-card-flow"]')).toHaveLength(1)
    expect(w.classes()).toContain('is-drafting')
    expect((w.vm as unknown as { isDrafting: boolean }).isDrafting).toBe(true)
    open(w)
    await nextTick()
    expect(w.findAll('[data-testid="new-card-flow"]')).toHaveLength(1)
    expect(w.find('[data-testid="task-draft-card"]').exists()).toBe(false)
    w.unmount()
  })

  it('still emits open without inCard (Jetzt): the sheet path', async () => {
    const w = mount(AddTaskSlot, { props: { status: TaskStatus.Progress, label: 'x' }, global: { stubs } })
    await w.find('button.add-task-button').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(false)
  })

  it('cancel closes the card and hands focus to the fallback (the header button)', async () => {
    document.body.appendChild(headerButton)
    const w = renderInCard()
    open(w)
    await nextTick()
    await w.find('[data-testid="flow-cancel"]').trigger('click')
    await nextTick()
    await nextTick()
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(false)
    expect(w.classes()).not.toContain('is-drafting')
    expect(document.activeElement).toBe(headerButton)
    headerButton.remove()
    w.unmount()
  })

  it('#665: Esc on a typed title offers an undo toast that reopens the card with the title; no toast without one', async () => {
    toastAddMock.mockReset()
    const w = renderInCard()
    open(w)
    await nextTick()
    await w.find('[data-testid="flow-cancel"]').trigger('click')
    expect(toastAddMock).not.toHaveBeenCalled()

    open(w)
    await nextTick()
    await w.find('[data-testid="flow-cancel-typed"]').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(false)
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    const toast = toastAddMock.mock.calls[0]![0]
    expect(toast.title).toBe('Entwurf gelöscht')
    expect(toast.actions[0].label).toBe('Rückgängig')
    toast.actions[0].onClick()
    await nextTick()
    expect(w.find('[data-testid="new-card-flow"]').attributes('data-initial-title')).toBe('Tippfehler')
    // A fresh open starts blank again
    await w.find('[data-testid="flow-cancel"]').trigger('click')
    open(w)
    await nextTick()
    expect(w.find('[data-testid="new-card-flow"]').attributes('data-initial-title')).toBeUndefined()
    w.unmount()
  })

  it('a save closes the card (the saved card replaces it) and a new card can be opened afterwards', async () => {
    const w = renderInCard()
    open(w)
    await nextTick()
    await w.find('[data-testid="flow-saved"]').trigger('click')
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(false)
    expect(focusWhenReady).toHaveBeenCalledTimes(1) // focus goes to the saved card
    open(w)
    await nextTick()
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(true)
    w.unmount()
  })

  it('the sheet opening cancels the card; a drag keeps it, hidden in its place, and gives it back (#248)', async () => {
    const w = renderInCard()
    open(w)
    await nextTick()
    route.value.path = '/tasks/add'
    await nextTick()
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(false)

    route.value.path = '/tasks'
    open(w)
    await nextTick()
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(true)
    await w.setProps({ hidden: true })
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(true)
    expect(w.find('.add-task-slot').classes()).toContain('is-hidden')
    await w.setProps({ hidden: false })
    expect(w.find('[data-testid="new-card-flow"]').exists()).toBe(true)
    expect(w.find('.add-task-slot').classes()).not.toContain('is-hidden')
    w.unmount()
  })
})
