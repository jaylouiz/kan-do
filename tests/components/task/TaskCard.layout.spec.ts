import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { onMounted } from 'vue'
import TaskCard from '~/components/task/TaskCard.vue'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

// Card layout (#584): the topic leads, the title sits below it, the timebox chip opens the footer, no activity badge
vi.mock('~/composables/useStackExpansion', () => ({
  useStackExpansion: () => ({ shouldBlockModal: () => false }),
}))
vi.mock('~/composables/useSheetSpotlight', () => ({
  useSheetSpotlight: () => ({ spotlightTaskId: { value: null } }),
}))
vi.stubGlobal('onMounted', onMounted)
window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia
vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
vi.mock('~/composables/useCarryOver', () => ({
  useTaskCarryOver: () => ({ displayDay: { value: 3 } }),
}))

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'Angebot schreiben',
    status: TaskStatus.Open,
    priority: 4,
    activity: 'Büro',
    topic: 'Kundenprojekt',
    timeSpentSeconds: 0,
    timeBoxSeconds: 2700,
    timerId: null,
    source: 'local',
    ...overrides,
  }) as unknown as Task

const render = (task: Task) =>
  mount(TaskCard, {
    props: { task },
    global: {
      stubs: {
        UCard: { template: '<div><slot /><slot name="footer" /></div>' },
        UBadge: { template: '<span class="badge"><slot /></span>' },
        UIcon: true,
        TopicMark: true,
        TaskProgressChip: { template: '<span class="chip-stub" />' },
        'task-priority-badge': { template: '<span class="priority-badge" />' },
        TaskCarryOverDots: { template: '<span class="dots-stub" />' },
      },
    },
  })

describe('TaskCard layout (#584)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('puts the topic row before the title', () => {
    const w = render(makeTask())
    const html = w.html()
    expect(html.indexOf('task-topic')).toBeGreaterThan(-1)
    expect(html.indexOf('task-topic')).toBeLessThan(html.indexOf('task-title-text'))
  })

  it('without a topic the title is the first line', () => {
    const w = render(makeTask({ topic: null }))
    expect(w.find('.task-topic').exists()).toBe(false)
    expect(w.find('.task-title-text').exists()).toBe(true)
  })

  it('opens the footer with the timebox chip, outside the group that goes inert under the Jetzt bar', () => {
    const w = render(makeTask())
    const footer = w.get('.task-footer')
    expect((footer.element.firstElementChild as HTMLElement).className).toBe('chip-stub')
    expect(w.get('[data-testid="task-footer-lead"]').find('.chip-stub').exists()).toBe(false)
    // the priority badge stays at the footer end
    expect(footer.element.lastElementChild?.querySelector('.priority-badge')).not.toBeNull()
  })

  it('shows no activity badge even when the task has an activity', () => {
    const w = render(makeTask())
    expect(w.find('.badge').exists()).toBe(false)
    expect(w.text()).not.toContain('Büro')
  })
})
