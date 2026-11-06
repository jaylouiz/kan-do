import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { onMounted } from 'vue'
import TaskCard from '~/components/task/TaskCard.vue'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
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
  useTaskCarryOver: () => ({ displayDay: { value: 0 } }),
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

/** The big "current" look of #93 is gone (#394): none of these hooks may come back */
const BIG_CARD_CLASSES = ['task-current', 'task-current--running']

describe('TaskCard in Jetzt is a regular card (#394)', () => {
  it.each([5, null as unknown as number])('has no big-card class, running or not (timerId %s), but keeps data-current for the overlay', (timerId) => {
    const w = render(makeTask({ timerId }))
    for (const cls of BIG_CARD_CLASSES) expect(w.classes()).not.toContain(cls)
    expect(w.attributes('data-current')).toBe('')
  })

  it('renders the standard card for the drag preview and carries no data-current', () => {
    const w = render(makeTask({ timerId: 5 }), { preview: true })
    expect(w.attributes('data-current')).toBeUndefined()
  })

  it.each([TaskStatus.Open, TaskStatus.Waiting, TaskStatus.Done])('keeps status %s standard', (status) => {
    const w = render(makeTask({ status }))
    expect(w.attributes('data-current')).toBeUndefined()
  })

  it('draws no ring and no corner elapsed text on the card, with or without a timebox (#388)', () => {
    for (const timeBoxSeconds of [3600, null as unknown as number]) {
      const w = render(makeTask({ timeBoxSeconds }))
      expect(w.findComponent({ name: 'TaskProgressCircular' }).exists()).toBe(false)
      expect(w.find('.task-progress-circular').exists()).toBe(false)
      expect(w.find('.task-current-elapsed').exists()).toBe(false)
    }
  })

  it('hands the chip the timebox, the spent time and whether the card is the current one', () => {
    const chip = (w: ReturnType<typeof render>) => w.findComponent({ name: 'TaskProgressChip' }).props()
    expect(chip(render(makeTask()))).toMatchObject({ taskId: 't1', timeBoxSeconds: 3600, timeSpentSeconds: 600, isNow: true })
    expect(chip(render(makeTask(), { preview: true })).isNow).toBe(false)
    expect(chip(render(makeTask({ status: TaskStatus.Open }))).isNow).toBe(false)
  })

  it('reserves no title room for a ring or an elapsed label', () => {
    for (const timeBoxSeconds of [3600, null as unknown as number]) {
      const title = render(makeTask({ timeBoxSeconds })).find('.task-title-text')
      expect(title.attributes('style')).toBeUndefined()
      expect(title.classes().some(c => c.startsWith('pr-'))).toBe(false)
    }
  })

  it('keeps the title at body weight, not the display role (#198)', () => {
    expect(render(makeTask()).find('.task-title-text').classes()).not.toContain('font-display')
  })
})

describe('TaskCard footer under the Jetzt bar (#388)', () => {
  const lead = (w: ReturnType<typeof render>) => w.get('[data-testid="task-footer-lead"]')

  it('makes the covered start group inert while a Jetzt card has a timebox', () => {
    expect(lead(render(makeTask())).attributes('inert')).toBeDefined()
  })

  it.each([
    ['no timebox (the chip covers nothing)', {}, { timeBoxSeconds: null as unknown as number }],
    ['the drag preview', { preview: true }, {}],
    ['the add-and-start draft', { draft: true }, {}],
    ['a card outside Jetzt', {}, { status: TaskStatus.Open }],
  ])('leaves the start group reachable for %s', (_name, props, overrides) => {
    expect(lead(render(makeTask(overrides), props)).attributes('inert')).toBeUndefined()
  })
})

describe('TaskCard timebox nudge (#389)', () => {
  /** The card renders the task it is given; the nudge guard reads the store, so the same task goes in both */
  const renderNudged = (overrides: Partial<Task> = {}, props: Record<string, unknown> = {}) => {
    const task = makeTask({ timeBoxSeconds: null as unknown as number, ...overrides })
    useTasksStore().addTask(task)
    const board = useBoardStore()
    board.startTimeboxNudge(task.id)
    return { board, w: render(task, props) }
  }

  it('mounts the layer on the nudged Jetzt card and hides the card content under it (still in the DOM)', () => {
    const { w } = renderNudged()
    expect(w.find('.nudge').exists()).toBe(true)
    expect(w.classes()).toContain('task--nudged')
    expect(w.find('.task-title-text').exists()).toBe(true)
  })

  it('puts the layer after the card content, so its buttons follow it in DOM order', () => {
    const { w } = renderNudged()
    const html = w.html()
    expect(html.indexOf('task-title-text')).toBeLessThan(html.indexOf('class="nudge"'))
  })

  it('shows no layer without a nudge flag', () => {
    useTasksStore().addTask(makeTask({ timeBoxSeconds: null as unknown as number }))
    const w = render(makeTask({ timeBoxSeconds: null as unknown as number }))
    expect(w.find('.nudge').exists()).toBe(false)
    expect(w.classes()).not.toContain('task--nudged')
  })

  it('shows no layer on the drag preview or the add-and-start draft', () => {
    expect(renderNudged({}, { preview: true }).w.find('.nudge').exists()).toBe(false)
    setActivePinia(createPinia())
    expect(renderNudged({}, { draft: true }).w.find('.nudge').exists()).toBe(false)
  })

  it('removes the dimming class and the layer once the timebox is set', async () => {
    const task = makeTask({ timeBoxSeconds: null as unknown as number })
    useTasksStore().addTask(task)
    useBoardStore().startTimeboxNudge(task.id)
    const w = render(useTasksStore().task(task.id)!)
    expect(w.classes()).toContain('task--nudged')

    useTasksStore().updateTask(task.id, { timeBoxSeconds: 900 })
    await w.vm.$nextTick()
    expect(w.classes()).not.toContain('task--nudged')
    expect(useBoardStore().timeboxNudgeTaskId).toBeNull()
  })
})
