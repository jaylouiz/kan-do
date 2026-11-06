import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick, onMounted } from 'vue'
import TaskCard from '~/components/task/TaskCard.vue'
import { useBoardStore } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

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
vi.mock('~/composables/useCarryOver', () => ({
  useTaskCarryOver: () => ({ displayDay: { value: 0 } }),
}))

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'Retrospektive vorbereiten',
    status: TaskStatus.Done,
    priority: 4,
    activity: 'Planung',
    timeSpentSeconds: 1800,
    timeBoxSeconds: 3600,
    timerId: null,
    ...overrides,
  }) as unknown as Task

const render = (task: Task, props: Record<string, unknown> = {}) =>
  mount(TaskCard, {
    props: { task, ...props },
    global: {
      stubs: {
        UCard: { template: '<div><slot /><slot name="footer" /></div>' },
        UBadge: { template: '<span class="badge"><slot /></span>' },
        UIcon: true,
        TaskProgressChip: true,
        'task-priority-badge': { template: '<span class="priority-badge" />' },
        TaskCarryOverDots: true,
      },
    },
  })

describe('TaskCard done (#124)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each([
    ['with a timebox', 3600],
    ['without a timebox', null as unknown as number],
  ])('shows the teal corner check %s, and no ring (#388)', (_label, timeBoxSeconds) => {
    const w = render(makeTask({ timeBoxSeconds }))
    expect(w.findComponent({ name: 'TaskProgressCircular' }).exists()).toBe(false)
    const check = w.find('.task-done-check')
    expect(check.exists()).toBe(true)
    expect(check.attributes('aria-hidden')).toBe('true')
    // The title keeps room for the corner glyph
    expect(w.find('.task-title-text').classes()).toContain('pr-9')
  })

  it('keeps the timebox as the progress chip on a done card', () => {
    const chip = render(makeTask()).findComponent({ name: 'TaskProgressChip' })
    expect(chip.props()).toMatchObject({ timeBoxSeconds: 3600, timeSpentSeconds: 1800, isNow: false })
  })

  it('hides the priority badge on done cards only', () => {
    expect(render(makeTask()).find('.priority-badge').exists()).toBe(false)
    expect(render(makeTask({ status: TaskStatus.Open })).find('.priority-badge').exists()).toBe(true)
  })

  it('shows no activity badge on the card (#584)', () => {
    const w = render(makeTask())
    expect(w.find('.badge').exists()).toBe(false)
    expect(w.text()).not.toContain('Planung')
  })

  it('keeps room for the corner check in the topic row as well as the title (#584)', () => {
    const w = render(makeTask({ topic: 'Quartalsplanung' }))
    expect(w.find('.task-topic').classes()).toContain('pr-9')
    expect(w.find('.task-title-text').classes()).toContain('pr-9')
  })

  it('plays the confirmation layer while the store flags the card, without remounting', async () => {
    const w = render(makeTask())
    const board = useBoardStore()
    const root = w.element

    expect(w.find('.task-confirm').exists()).toBe(false)
    board.startConfirmation('t1')
    await nextTick()
    expect(w.classes()).toContain('task--confirming')
    expect(w.find('.task-confirm').attributes('aria-hidden')).toBe('true')

    board.clearConfirmation('t1')
    await nextTick()
    expect(w.find('.task-confirm').exists()).toBe(false)
    expect(w.element).toBe(root)
  })

  it('never plays the confirmation on the drag preview or a card that is not done', async () => {
    useBoardStore().startConfirmation('t1')
    await nextTick()
    expect(render(makeTask(), { preview: true }).find('.task-confirm').exists()).toBe(false)
    expect(render(makeTask({ status: TaskStatus.Open })).find('.task-confirm').exists()).toBe(false)
  })

  describe('completion burst (#692)', () => {
    const burst = (w: ReturnType<typeof render>) => w.find('[data-testid="completion-burst"]')
    // Reduced motion (not mounted, `display: none`) is covered in done-drop.spec.ts: `import.meta.client` is unset in vitest
    afterEach(() => {
      vi.useRealTimers()
    })

    it('bursts decoratively when the store flags the card, and ends itself after its pieces', async () => {
      vi.useFakeTimers()
      const w = render(makeTask())
      expect(burst(w).exists()).toBe(false)

      useBoardStore().startConfirmation('t1')
      await nextTick()
      expect(burst(w).attributes('aria-hidden')).toBe('true')
      expect(burst(w).findAll('i')).toHaveLength(24)
      expect(w.classes()).toContain('task--celebrating') // the card rises above its neighbours while it plays

      // The store flag ends at 800 ms; the burst outlives it and then goes
      vi.advanceTimersByTime(850)
      await nextTick()
      expect(w.classes()).not.toContain('task--confirming')
      expect(burst(w).exists()).toBe(true)
      vi.advanceTimersByTime(400)
      await nextTick()
      expect(burst(w).exists()).toBe(false)
      expect(w.classes()).not.toContain('task--celebrating')
    })

    it('plays when the card mounts already flagged (a drop mounts a fresh card in Erledigt)', () => {
      useBoardStore().startConfirmation('t1')
      expect(burst(render(makeTask())).exists()).toBe(true)
    })

    it('never bursts on a card that is done on load, on the drag preview or on a card that is not done', async () => {
      expect(burst(render(makeTask())).exists()).toBe(false)
      useBoardStore().startConfirmation('t1')
      await nextTick()
      expect(burst(render(makeTask(), { preview: true })).exists()).toBe(false)
      expect(burst(render(makeTask({ status: TaskStatus.Open }))).exists()).toBe(false)
    })

    it('ends when the card leaves Erledigt (undo) and replays on the next completion', async () => {
      const w = render(makeTask())
      useBoardStore().startConfirmation('t1')
      await nextTick()
      expect(burst(w).exists()).toBe(true)

      await w.setProps({ task: makeTask({ status: TaskStatus.Open }) })
      expect(burst(w).exists()).toBe(false)

      useBoardStore().clearConfirmation('t1')
      await w.setProps({ task: makeTask() })
      useBoardStore().startConfirmation('t1')
      await nextTick()
      expect(burst(w).exists()).toBe(true)
    })
  })
})
