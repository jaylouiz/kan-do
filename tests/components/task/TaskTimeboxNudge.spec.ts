import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import TaskTimeboxNudge from '~/components/task/TaskTimeboxNudge.vue'
import { useBoardStore, TIMEBOX_NUDGE_MS } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const spotlightTaskId = ref<string | null>(null)
vi.mock('~/composables/useSheetSpotlight', () => ({
  useSheetSpotlight: () => ({ spotlightTaskId }),
}))

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1', source: 'local', externalId: null, title: 'Review schreiben', status: TaskStatus.Progress,
    activity: null, topic: null, topicColorCode: null, priority: 1, notes: null,
    timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }) as Task

let wrapper: VueWrapper | null = null

/** Mounts the nudge for a task in the store, with the nudge started like a drop into Jetzt does */
const setup = (overrides: Partial<Task> = {}) => {
  const tasks = useTasksStore()
  tasks.addTask(makeTask(overrides))
  const board = useBoardStore()
  board.startTimeboxNudge('t1')
  // The component reads the task from its prop; keep it the store's reactive object so outside edits reach it
  wrapper = mount(TaskTimeboxNudge, {
    props: { task: tasks.task('t1')! },
    attachTo: document.body,
    global: { stubs: { UIcon: true, Transition: false } },
  })
  return { tasks, board, w: wrapper }
}

const buttons = (w: VueWrapper) => w.findAll('button')
const group = (w: VueWrapper) => w.find('[role="group"]')

beforeEach(() => {
  setActivePinia(createPinia())
  spotlightTaskId.value = null
  vi.useFakeTimers()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('TaskTimeboxNudge (#389)', () => {
  it('asks the question over three buttons, as a non-modal group named by the question', () => {
    const { w } = setup()
    const g = group(w)
    expect(g.exists()).toBe(true)
    expect(g.attributes('role')).not.toBe('dialog')
    expect(g.attributes('aria-modal')).toBeUndefined()
    const labelledBy = g.attributes('aria-labelledby')!
    expect(w.find(`[id="${labelledBy}"]`).text()).toBe('Timebox hinzufügen?')
    expect(buttons(w).map(b => b.attributes('aria-label') ?? b.text())).toEqual(['15 min', '30 min', 'Eigene Dauer'])
  })

  it('renders nothing for a card that is not the nudged one', () => {
    const tasks = useTasksStore()
    tasks.addTask(makeTask())
    wrapper = mount(TaskTimeboxNudge, { props: { task: tasks.task('t1')! }, global: { stubs: { UIcon: true, Transition: false } } })
    expect(wrapper.find('.nudge').exists()).toBe(false)
  })

  it.each([[0, 900], [1, 1800]])('button %i sets %i seconds after the pressed beat and ends the nudge', async (index, seconds) => {
    const { w, tasks, board } = setup()
    await buttons(w)[index]!.trigger('click')

    expect(buttons(w)[index]!.classes()).toContain('is-picked')
    expect(tasks.task('t1')!.timeBoxSeconds).toBeNull()

    vi.advanceTimersByTime(240)
    await nextTick()
    expect(tasks.task('t1')!.timeBoxSeconds).toBe(seconds)
    expect(board.timeboxNudgeTaskId).toBeNull()
    expect(w.find('.nudge').exists()).toBe(false)
  })

  it('a timebox set elsewhere during the pressed beat is not overwritten', async () => {
    const { w, tasks } = setup()
    await buttons(w)[0]!.trigger('click')
    tasks.updateTask('t1', { timeBoxSeconds: 3600 })
    vi.advanceTimersByTime(240)
    expect(tasks.task('t1')!.timeBoxSeconds).toBe(3600)
  })

  describe('custom duration', () => {
    const openField = async (w: VueWrapper) => {
      await buttons(w)[2]!.trigger('click')
      await nextTick()
      return w.find<HTMLInputElement>('input')
    }

    it('swaps the buttons for a field prefilled with 45, selected and focused', async () => {
      const { w } = setup()
      const select = vi.spyOn(HTMLInputElement.prototype, 'select') // jsdom has no selection range on type=number
      const input = await openField(w)
      expect(input.element.value).toBe('45')
      expect(document.activeElement).toBe(input.element)
      expect(select).toHaveBeenCalled()
      select.mockRestore()
      expect(w.find('button[type="submit"]').attributes('aria-label')).toBe('Übernehmen')
      expect(w.text()).not.toContain('15 min')
    })

    it('Enter applies a valid value as seconds', async () => {
      const { w, tasks } = setup()
      const input = await openField(w)
      await input.setValue('50')
      await w.find('form').trigger('submit')
      vi.advanceTimersByTime(240)
      expect(tasks.task('t1')!.timeBoxSeconds).toBe(3000)
    })

    it.each(['0', '481', '-5', '', '2.5'])('%j is invalid: the check is disabled and submit does nothing', async (value) => {
      const { w, tasks } = setup()
      const input = await openField(w)
      await input.setValue(value)
      expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined()
      await w.find('form').trigger('submit')
      vi.advanceTimersByTime(240)
      expect(tasks.task('t1')!.timeBoxSeconds).toBeNull()
    })

    it.each(['1', '480'])('%s is the edge of the valid range', async (value) => {
      const { w, tasks } = setup()
      const input = await openField(w)
      await input.setValue(value)
      expect(w.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
      await w.find('form').trigger('submit')
      vi.advanceTimersByTime(240)
      expect(tasks.task('t1')!.timeBoxSeconds).toBe(Number(value) * 60)
    })

    it('Escape goes back to the buttons (focus on "…"), a second Escape dismisses', async () => {
      const { w, board } = setup()
      const input = await openField(w)
      await input.trigger('keydown', { key: 'Escape' })
      await nextTick()
      expect(w.find('input').exists()).toBe(false)
      expect(buttons(w)).toHaveLength(3)
      expect(document.activeElement).toBe(buttons(w)[2]!.element)
      expect(board.timeboxNudgeTaskId).toBe('t1')

      await buttons(w)[2]!.trigger('keydown', { key: 'Escape' })
      expect(board.timeboxNudgeTaskId).toBeNull()
    })
  })

  describe('countdown', () => {
    const bar = (w: VueWrapper) => w.find('.nudge__bar')

    it('runs for TIMEBOX_NUDGE_MS (8 s) and ends the nudge when the hairline has drained', async () => {
      const { w, board, tasks } = setup()
      expect(TIMEBOX_NUDGE_MS).toBe(8000)
      expect(bar(w).attributes('style')).toContain('--nudge-duration: 8000ms')
      expect(bar(w).classes()).not.toContain('is-paused')

      const end = new Event('animationend') as AnimationEvent
      Object.defineProperty(end, 'animationName', { value: 'nudge-drain' })
      bar(w).element.dispatchEvent(end)
      expect(board.timeboxNudgeTaskId).toBeNull()
      expect(tasks.task('t1')!.timeBoxSeconds).toBeNull() // ignoring it leaves the card as it was
    })

    it('ignores the end of an unrelated animation', () => {
      const { w, board } = setup()
      const end = new Event('animationend') as AnimationEvent
      Object.defineProperty(end, 'animationName', { value: 'something-else' })
      bar(w).element.dispatchEvent(end)
      expect(board.timeboxNudgeTaskId).toBe('t1')
    })

    it('pauses (does not remove) while the pointer is on the layer and resumes on leave', async () => {
      const { w } = setup()
      await group(w).trigger('pointerenter')
      expect(bar(w).classes()).toContain('is-paused')
      await group(w).trigger('pointerleave')
      expect(bar(w).classes()).not.toContain('is-paused')
    })

    it('pauses while focus is inside the layer and resumes when it leaves', async () => {
      const { w } = setup()
      await buttons(w)[0]!.trigger('focusin')
      expect(bar(w).classes()).toContain('is-paused')
      await group(w).trigger('focusout', { relatedTarget: document.body })
      expect(bar(w).classes()).not.toContain('is-paused')
    })

    it('keeps its progress while the field is open: the bar stays mounted and paused', async () => {
      const { w } = setup()
      const before = bar(w).element
      await buttons(w)[2]!.trigger('click')
      expect(bar(w).element).toBe(before)
      expect(bar(w).classes()).toContain('is-paused')
    })
  })

  describe('ends when the question is settled elsewhere', () => {
    it('Escape inside the layer dismisses', async () => {
      const { w, board } = setup()
      await buttons(w)[0]!.trigger('keydown', { key: 'Escape' })
      expect(board.timeboxNudgeTaskId).toBeNull()
    })

    it('the card leaving Jetzt', async () => {
      const { tasks, board } = setup()
      tasks.updateTask('t1', { status: TaskStatus.Waiting })
      await nextTick()
      expect(board.timeboxNudgeTaskId).toBeNull()
    })

    it('a timebox set through menu, palette or sheet', async () => {
      const { tasks, board } = setup()
      tasks.updateTask('t1', { timeBoxSeconds: 600 })
      await nextTick()
      expect(board.timeboxNudgeTaskId).toBeNull()
      expect(tasks.task('t1')!.timeBoxSeconds).toBe(600)
    })

    it('the sheet of the card opening, but not another card\'s', async () => {
      const { board } = setup()
      spotlightTaskId.value = 'other'
      await nextTick()
      expect(board.timeboxNudgeTaskId).toBe('t1')
      spotlightTaskId.value = 't1'
      await nextTick()
      expect(board.timeboxNudgeTaskId).toBeNull()
    })

    it('focus inside the layer goes back to the card when the layer leaves; focus elsewhere stays', async () => {
      const host = document.createElement('div')
      host.className = 'task-wrapper'
      host.tabIndex = 0
      document.body.appendChild(host)
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      const tasks = useTasksStore()
      tasks.addTask(makeTask())
      useBoardStore().startTimeboxNudge('t1')
      wrapper = mount(TaskTimeboxNudge, { props: { task: tasks.task('t1')! }, attachTo: host, global: { stubs: { UIcon: true, Transition: false } } })

      outside.focus()
      useBoardStore().endTimeboxNudge('t1')
      await nextTick()
      expect(document.activeElement).toBe(outside)

      useBoardStore().startTimeboxNudge('t1')
      await nextTick()
      ;(wrapper.findAll('button')[0]!.element as HTMLElement).focus()
      useBoardStore().endTimeboxNudge('t1')
      await nextTick()
      expect(document.activeElement).toBe(host)
      host.remove()
      outside.remove()
    })

    it('the card being deleted (unmount without a task)', () => {
      const { tasks, board, w } = setup()
      tasks.removeTask('t1')
      w.unmount()
      wrapper = null
      expect(board.timeboxNudgeTaskId).toBeNull()
    })

    it('a re-render of a card that is still in Jetzt keeps the flag', () => {
      const { board, w } = setup()
      w.unmount()
      wrapper = null
      expect(board.timeboxNudgeTaskId).toBe('t1')
    })
  })
})
