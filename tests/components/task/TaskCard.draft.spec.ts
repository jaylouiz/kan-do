import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { onMounted } from 'vue'
import { armedTaskTimerIds } from '~/lib/taskTimers'
import TaskCard from '~/components/task/TaskCard.vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

// TaskCard reads the done confirmation (#124) from the board store
beforeEach(() => setActivePinia(createPinia()))

vi.mock('~/composables/useStackExpansion', () => ({
  useStackExpansion: () => ({ shouldBlockModal: () => false }),
}))
vi.mock('~/composables/useSheetSpotlight', () => ({
  useSheetSpotlight: () => ({ spotlightTaskId: { value: null } }),
}))
// TaskCard relies on Nuxt auto-imports and matchMedia, neither exists in plain jsdom
vi.stubGlobal('onMounted', onMounted)
window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
// The carried-over counter (#99) is store state; its own tests live in tests/store/tasks.carryOver.test.ts
vi.mock('~/composables/useCarryOver', () => ({
  useTaskCarryOver: () => ({ days: { value: 0 } }),
}))

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'Review schreiben',
    status: TaskStatus.Progress,
    priority: 1,
    timeSpentSeconds: 600,
    timeBoxSeconds: 3600,
    timerId: 0,
    ...overrides,
  }) as unknown as Task

const render = (task: Task, props: Record<string, unknown> = {}) =>
  mount(TaskCard, {
    props: { task, ...props },
    global: { stubs: { UCard: { template: '<div><slot /><slot name="footer" /></div>' }, UBadge: true, TaskProgressChip: true, 'task-priority-badge': true, TaskCarryOverDots: true } },
  })

describe('TaskCard draft (#110, #125)', () => {
  it('stays the standard variant in Jetzt and shows the running time at the start of the footer', () => {
    const w = render(makeTask({ id: 'draft', timeBoxSeconds: null as unknown as number, timerId: null as unknown as number }), { draft: true })
    expect(w.classes()).not.toContain('task-current')
    expect(w.classes()).toContain('task--draft')
    expect(w.attributes('data-current')).toBeUndefined()
    expect(w.find('.task-current-elapsed').exists()).toBe(false)
    expect(w.find('.task-draft-elapsed').text()).toBe('10 min')
  })

  it('keeps the time in the footer for a timeboxed Jetzt draft and shows no chip (#125, #388)', () => {
    const w = render(makeTask({ id: 'draft' }), { draft: true })
    expect(w.find('.task-draft-elapsed').exists()).toBe(true)
    expect(w.findComponent({ name: 'TaskProgressChip' }).exists()).toBe(false)
  })

  it('shows the grey chip on a draft outside Jetzt like on any card', () => {
    const w = render(makeTask({ id: 'draft', status: TaskStatus.Open }), { draft: true })
    expect(w.findComponent({ name: 'TaskProgressChip' }).props('isNow')).toBe(false)
  })

  it('shows no elapsed time for an Offen draft', () => {
    const w = render(makeTask({ id: 'draft', status: TaskStatus.Open, timeBoxSeconds: null as unknown as number }), { draft: true })
    expect(w.find('.task-draft-elapsed').exists()).toBe(false)
  })

  it('never runs a card timer, for the draft or a stored task: the app-level driver times Jetzt (#352)', () => {
    render(makeTask({ id: 'draft', status: TaskStatus.Progress }), { draft: true })
    render(makeTask({ status: TaskStatus.Progress }))
    expect(armedTaskTimerIds()).toEqual([])
  })
})
