import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { onMounted } from 'vue'
import TaskCard from '~/components/task/TaskCard.vue'
import { TaskStatus } from '~/types/taskStatus'
import { useBoardDragState } from '~/composables/useBoardDragState'
import type { Task } from '~/types/task'

// TaskCard reads the done confirmation (#124) from the board store
beforeEach(() => setActivePinia(createPinia()))
const blocked = vi.hoisted(() => ({ value: false, minDetail: 0 }))
const navigateTo = vi.hoisted(() => vi.fn())
// Both the explicit import and the Nuxt auto-import must stay unused by TaskCard
vi.stubGlobal('navigateTo', navigateTo)

vi.mock('~/composables/useStackExpansion', () => ({
  useStackExpansion: () => ({
    shouldBlockModal: (event: MouseEvent) => blocked.value && event.detail >= blocked.minDetail,
  }),
}))
const spotlight = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('~/composables/useSheetSpotlight', () => ({
  useSheetSpotlight: () => ({ spotlightTaskId: spotlight }),
}))
vi.stubGlobal('onMounted', onMounted)
window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia

vi.mock('nuxt/app', () => ({ navigateTo }))
vi.mock('~/composables/useCarryOver', () => ({
  useTaskCarryOver: () => ({ displayDay: { value: 0 } }),
}))

const task = {
  id: 't1',
  title: 'Review schreiben',
  status: TaskStatus.Open,
  priority: 1,
  timeSpentSeconds: 0,
  timeBoxSeconds: 0,
  timerId: 0,
} as unknown as Task

const render = (attrs: Record<string, unknown> = {}) =>
  mount(TaskCard, {
    props: { task },
    attrs,
    global: { stubs: { UCard: { template: '<div><slot /><slot name="footer" /></div>' }, UBadge: true, TaskProgressChip: true, 'task-priority-badge': true, TaskCarryOverDots: true } },
  })

const { dragState } = useBoardDragState()

describe('TaskCard open gesture (#111, #25)', () => {
  beforeEach(() => {
    blocked.value = false
    blocked.minDetail = 0
    navigateTo.mockClear()
    spotlight.value = null
    dragState.value.isDragging = false
  })

  it('emits open with the task id on click and does not navigate itself', async () => {
    const w = render()
    await w.trigger('click')
    expect(w.emitted('open')).toEqual([['t1']])
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('does not emit open while a stack has just expanded', async () => {
    blocked.value = true
    const w = render()
    await w.trigger('click')
    expect(w.emitted('open')).toBeUndefined()
  })

  it('hands the event to the guard: only the later click of a sequence is blocked (#154)', async () => {
    blocked.value = true
    blocked.minDetail = 2
    const w = render()
    w.element.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }))
    expect(w.emitted('open')).toBeUndefined()
    // Enter on a member dispatches a synthetic click with detail 0
    w.element.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }))
    expect(w.emitted('open')).toEqual([['t1']])
  })

  it('does not emit open for a card inside a collapsed stack', async () => {
    const w = render({ 'data-stack-index': 0 })
    await w.trigger('click')
    expect(w.emitted('open')).toBeUndefined()
  })
  it('does not open while a drag runs (#25)', async () => {
    dragState.value.isDragging = true
    const w = render()
    await w.trigger('click')
    expect(w.emitted('open')).toBeUndefined()
  })

  it('does nothing for the card whose sheet is already open, so a double-click opens once (#25)', async () => {
    spotlight.value = 't1'
    const w = render()
    await w.trigger('click')
    expect(w.emitted('open')).toBeUndefined()
  })

  it('opens another card while a sheet is open (#25)', async () => {
    spotlight.value = 'other'
    const w = render()
    await w.trigger('click')
    expect(w.emitted('open')).toEqual([['t1']])
  })

  it('no longer reacts to dblclick: the click is the one gesture (#25)', async () => {
    const w = render()
    await w.trigger('dblclick')
    expect(w.emitted('open')).toBeUndefined()
  })

  it('a trash entry (readonly) never opens (#422)', async () => {
    const w = mount(TaskCard, {
      props: { task, readonly: true },
      global: { stubs: { UCard: { template: '<div><slot /><slot name="footer" /></div>' }, UBadge: true, TaskProgressChip: true, 'task-priority-badge': true, TaskCarryOverDots: true } },
    })
    await w.trigger('click')
    expect(w.emitted('open')).toBeUndefined()
  })
})
