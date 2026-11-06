import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import BoardColumnYesterdayNote from '~/components/board/BoardColumnYesterdayNote.vue'
import { setTestLocale } from '~/tests/helpers/i18n'
import type { Task } from '~/types/task'

const navigateTo = vi.hoisted(() => vi.fn())
vi.stubGlobal('navigateTo', navigateTo)

const NOW = new Date(2026, 9, 22, 9, 0) // Thursday, local time

function makeTasks(count: number, completedAt = new Date(2026, 9, 21, 15, 0)): Task[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    title: `Aufgabe ${i + 1}`,
    completedAt,
  }) as unknown as Task)
}

// UButton renders a real <button>, UIcon an empty span: enough for DOM assertions.
const stubs = {
  UButton: {
    props: ['icon', 'color', 'variant', 'size'],
    template: '<button type="button" v-bind="$attrs"><slot /></button>',
  },
  UIcon: { template: '<span />' },
}

const mountNote = (tasks: Task[]) => mount(BoardColumnYesterdayNote, { props: { tasks }, global: { stubs } })

describe('BoardColumnYesterdayNote', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    setTestLocale('de')
    navigateTo.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  const toggle = (w: ReturnType<typeof mountNote>) => w.get('[data-testid="yesterday-toggle"]')

  it('is one collapsed line by default: label, count, no titles', () => {
    const wrapper = mountNote(makeTasks(3))
    expect(wrapper.findAll('li')).toHaveLength(0)
    expect(wrapper.find('h3').text()).toContain('Gestern erledigt')
    expect(wrapper.find('h3').text()).toContain('3')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false')
  })

  it('the label button inside the heading opens and closes the titles', async () => {
    const wrapper = mountNote(makeTasks(3))
    expect(wrapper.get('h3').find('button').exists()).toBe(true)
    await toggle(wrapper).trigger('click')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.yesterday-note__title')).toHaveLength(3)
    expect(wrapper.find('.yesterday-note__more').exists()).toBe(false)
    await toggle(wrapper).trigger('click')
    expect(toggle(wrapper).attributes('aria-expanded')).toBe('false')
    expect(wrapper.findAll('li')).toHaveLength(0)
  })

  it('opened: five titles, then counts the rest', async () => {
    const wrapper = mountNote(makeTasks(10))
    await toggle(wrapper).trigger('click')
    expect(wrapper.findAll('.yesterday-note__title')).toHaveLength(5)
    expect(wrapper.find('.yesterday-note__more').text()).toBe('+ 5 weitere')
    expect(wrapper.find('h3').text()).toContain('10')
  })

  it('one task opens as one row', async () => {
    const wrapper = mountNote(makeTasks(1))
    await toggle(wrapper).trigger('click')
    expect(wrapper.findAll('.yesterday-note__title')).toHaveLength(1)
    expect(wrapper.find('.yesterday-note__more').exists()).toBe(false)
  })

  it('shows time spent right of a title only when tracked, localised', async () => {
    const tasks = makeTasks(2)
    ;(tasks[0] as unknown as Task).timeSpentSeconds = 45 * 60
    ;(tasks[1] as unknown as Task).timeSpentSeconds = 0
    const wrapper = mountNote(tasks)
    await toggle(wrapper).trigger('click')
    const times = wrapper.findAll('.yesterday-note__time')
    expect(times).toHaveLength(1)
    expect(times[0]!.text()).toBe('45 min')
  })

  it('renders no card and exactly one action', () => {
    const wrapper = mountNote(makeTasks(2))
    expect(wrapper.find('.task').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="yesterday-ack"]')).toHaveLength(1)
  })

  it('names the count and consequence in the action label, starting with the visible label', () => {
    const one = mountNote(makeTasks(1)).get('[data-testid="yesterday-ack"]')
    expect(one.attributes('aria-label')).toBe('Gesehen, 1 erledigte Aufgabe ablegen')
    const many = mountNote(makeTasks(5)).get('[data-testid="yesterday-ack"]')
    expect(many.attributes('aria-label')).toBe('Gesehen, 5 erledigte Aufgaben ablegen')
    expect(many.text()).toBe('Gesehen')
  })

  it('emits acknowledge once on click', async () => {
    const wrapper = mountNote(makeTasks(4))
    await wrapper.get('[data-testid="yesterday-ack"]').trigger('click')
    expect(wrapper.emitted('acknowledge')).toHaveLength(1)
  })

  it('opens the task sheet route from a title', async () => {
    const wrapper = mountNote(makeTasks(2))
    await toggle(wrapper).trigger('click')
    await wrapper.findAll('.yesterday-note__title')[1]!.trigger('click')
    expect(navigateTo).toHaveBeenCalledWith({ path: '/tasks/t2' })
  })

  it('uses the weekday after a weekend and "recently" when older than six days', () => {
    vi.setSystemTime(new Date(2026, 9, 26, 8, 0)) // Monday
    const friday = mountNote(makeTasks(2, new Date(2026, 9, 23, 17, 0)))
    expect(friday.find('h3').text()).toContain('Freitag erledigt')
    const old = mountNote(makeTasks(2, new Date(2026, 9, 1, 17, 0)))
    expect(old.find('h3').text()).toContain('Zuletzt erledigt')
  })

  it('is a labelled region', () => {
    const wrapper = mountNote(makeTasks(1))
    const section = wrapper.get('section')
    expect(section.attributes('aria-labelledby')).toBe(wrapper.get('h3').attributes('id'))
  })

  it('speaks English', async () => {
    setTestLocale('en')
    const wrapper = mountNote(makeTasks(8))
    expect(wrapper.find('h3').text()).toContain('Done yesterday')
    await toggle(wrapper).trigger('click')
    expect(wrapper.find('.yesterday-note__more').text()).toBe('+ 3 more')
  })
})
