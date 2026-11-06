import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import RecapDeck from '~/components/recap/RecapDeck.vue'
import { setTestLocale } from '../../helpers/i18n'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const stubs = {
  TaskCard: { props: ['task'], template: '<div class="task-card">{{ task.title }}</div>' },
  UButton: { props: ['color', 'variant', 'size'], template: '<button type="button" v-bind="$attrs"><slot /></button>' },
}

const task = (id: string): Task => ({
  id, source: 'local', externalId: null, title: id, status: TaskStatus.Done, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, completedAt: new Date(2026, 9, 21, 15),
})
const tasks = (n: number) => Array.from({ length: n }, (_, i) => task(`t${i}`))

let wrapper: VueWrapper | null = null
const mountDeck = (n: number) => {
  wrapper = mount(RecapDeck, { props: { tasks: tasks(n), kind: 'done' }, global: { stubs } })
  return wrapper
}
const deck = () => wrapper!.get('[data-testid="recap-deck-done"]')

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('RecapDeck tab stop and name (#478)', () => {
  it.each([0, 1])('%i card: not a tab stop, no arrow-key hint, no roledescription', (n) => {
    mountDeck(n)
    expect(deck().attributes('tabindex')).toBeUndefined()
    expect(deck().attributes('role')).toBe('group')
    expect(deck().attributes('aria-roledescription')).toBeUndefined()
    expect(deck().attributes('aria-label')).toBe(`${n} erledigt`)
    expect(deck().attributes('aria-label')).not.toContain('Pfeiltasten')
  })

  it('2 cards: tab stop with the arrow-key hint and roledescription', () => {
    mountDeck(2)
    expect(deck().attributes('tabindex')).toBe('0')
    expect(deck().attributes('aria-roledescription')).toBe('Stapel')
    expect(deck().attributes('aria-label')).toBe('2 erledigt, mit Pfeiltasten wechseln')
  })

  it('English: no hint with one card, hint with two', async () => {
    setTestLocale('en')
    mountDeck(1)
    expect(deck().attributes('aria-label')).toBe('1 done')
    await wrapper!.setProps({ tasks: tasks(2) })
    expect(deck().attributes('aria-label')).toBe('2 done, switch with arrow keys')
    expect(deck().attributes('aria-roledescription')).toBe('Stack')
  })

  it('follows the card count across 2 -> 1 -> 2 -> 0 -> 2 while open', async () => {
    mountDeck(2)
    const state = () => [deck().attributes('tabindex') ?? null, deck().attributes('aria-label')]
    expect(state()).toEqual(['0', '2 erledigt, mit Pfeiltasten wechseln'])
    await wrapper!.setProps({ tasks: tasks(1) })
    expect(state()).toEqual([null, '1 erledigt'])
    await wrapper!.setProps({ tasks: tasks(2) })
    expect(state()).toEqual(['0', '2 erledigt, mit Pfeiltasten wechseln'])
    await wrapper!.setProps({ tasks: [] })
    expect(state()).toEqual([null, '0 erledigt'])
    await wrapper!.setProps({ tasks: tasks(2) })
    expect(state()).toEqual(['0', '2 erledigt, mit Pfeiltasten wechseln'])
  })

  it('with a single card the arrow keys stay inert (counter and live region unchanged)', async () => {
    mountDeck(1)
    await deck().trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper!.get('[data-testid="recap-deck-counter"]').text()).toBe('1 / 1')
    expect(wrapper!.get('[data-testid="recap-deck-live"]').text()).toBe('')
  })
})
