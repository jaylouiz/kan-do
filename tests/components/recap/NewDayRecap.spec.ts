import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import NewDayRecap from '~/components/recap/NewDayRecap.vue'
import { resetNewDayRecap, useNewDayRecap } from '~/composables/useNewDayRecap'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { toastAddMock } from '../../mocks/nuxt-imports'
import { setTestLocale } from '../../helpers/i18n'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/composables/useTaskSync', () => ({ useTaskSync: () => ({ syncArchiveStatusForTasks: vi.fn().mockResolvedValue(undefined) }) }))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

// Thursday 22 Oct 2026, 09:00 local
const NOW = new Date(2026, 9, 22, 9, 0)

const stubs = {
  TaskCard: { props: ['task'], template: '<div class="task-card">{{ task.title }}</div>' },
  USwitch: {
    inheritAttrs: false,
    props: ['modelValue', 'label', 'size', 'color'],
    emits: ['update:modelValue'],
    template: '<label><input type="checkbox" role="switch" :checked="modelValue" v-bind="$attrs" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
  },
  UButton: {
    props: ['color', 'variant', 'size'],
    template: '<button type="button" v-bind="$attrs"><slot /></button>',
  },
}

const task = (id: string, status: TaskStatus, completedAt?: Date): Task => ({
  id, source: 'local', externalId: null, title: id, status, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...(completedAt ? { completedAt } : {}),
})
const doneAt = (daysBack: number, id = `d${daysBack}`) => task(id, TaskStatus.Done, new Date(2026, 9, 22 - daysBack, 15))

let wrapper: VueWrapper | null = null

async function open(tasks: Task[]) {
  useBoardStore().boardConfig = { sources: { connected: [], default: 'local' } }
  useTasksStore().tasks = tasks
  useDayRecapStore().lastShownDay = '2020-01-01'
  wrapper = mount(NewDayRecap, { global: { stubs }, attachTo: document.body })
  useNewDayRecap().check('tasks')
  await nextTick()
  await nextTick()
}

const page = () => document.querySelector('[data-testid="new-day-recap"]') as HTMLElement | null
const q = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T

describe('NewDayRecap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    setActivePinia(createPinia())
    resetNewDayRecap()
    setTestLocale('de')
    toastAddMock.mockClear()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('renders nothing while the recap is not due', async () => {
    wrapper = mount(NewDayRecap, { global: { stubs }, attachTo: document.body })
    await nextTick()
    expect(page()).toBeNull()
  })

  it('is a labelled modal dialog with the headline and the partial sentence', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b'), task('o', TaskStatus.Open), task('w', TaskStatus.Waiting), task('j', TaskStatus.Progress)])
    const dialog = page()!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = q('h1')
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(title.textContent).toContain('Kurzer Rückblick')
    expect(q('[data-testid="recap-summary"]').textContent).toBe('Du hast gestern 2 von 5 Aufgaben erledigt.')
  })

  it('reads "alle Aufgaben" and shows only the Erledigt deck when nothing is open', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b')])
    expect(q('[data-testid="recap-summary"]').textContent).toBe('Du hast gestern alle Aufgaben erledigt.')
    expect(document.querySelector('[data-testid="recap-deck-done"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="recap-deck-undone"]')).toBeNull()
  })

  it.each([
    [1, 'gestern'],
    [2, 'vorgestern'],
    [3, 'am Montag'],
    [4, 'am Sonntag'],
    [5, 'am 17. Oktober'],
  ])('names the day %i days back as "%s"', async (daysBack, phrase) => {
    await open([doneAt(daysBack), task('o', TaskStatus.Open)])
    expect(q('[data-testid="recap-summary"]').textContent).toBe(`Du hast ${phrase} 1 von 2 Aufgaben erledigt.`)
  })

  it('has English copy', async () => {
    setTestLocale('en')
    await open([doneAt(3), task('o', TaskStatus.Open)])
    expect(q('h1').textContent).toContain('Quick look back')
    expect(q('[data-testid="recap-summary"]').textContent).toBe('You got 1 of 2 tasks done on Monday.')
  })

  it('lists the Offen deck before the Erledigt deck (board order), each heading above its cards', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b'), task('o', TaskStatus.Open), task('w', TaskStatus.Waiting)])
    const decks = [...document.querySelectorAll('[data-testid^="recap-deck-"][role="group"]')]
    expect(decks.map(el => el.getAttribute('data-testid'))).toEqual(['recap-deck-undone', 'recap-deck-done'])
    const labels = [...document.querySelectorAll('[data-testid="recap-deck-label"]')]
    expect(labels.map(el => el.tagName)).toEqual(['H2', 'H2'])
    expect(labels.map(el => el.textContent?.trim())).toEqual(['2 noch offen', '2 erledigt'])
    for (const [i, deck] of decks.entries()) {
      // heading before the deck in the same group, so it reads and renders above the cards
      expect(labels[i]!.compareDocumentPosition(deck) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(labels[i]!.closest('section')).toBe(deck.closest('section'))
    }
  })

  it('names each deck for what it is and how to use it: group, roledescription, label with the arrow-key hint', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b'), doneAt(1, 'c'), doneAt(1, 'd'), task('o', TaskStatus.Open), task('w', TaskStatus.Waiting)])
    const done = q('[data-testid="recap-deck-done"]')
    expect(done.getAttribute('role')).toBe('group')
    expect(done.getAttribute('tabindex')).toBe('0')
    expect(done.getAttribute('aria-roledescription')).toBe('Stapel')
    expect(done.getAttribute('aria-label')).toBe('4 erledigt, mit Pfeiltasten wechseln')
    expect(q('[data-testid="recap-deck-undone"]').getAttribute('aria-label')).toBe('2 noch offen, mit Pfeiltasten wechseln')
    expect(document.body.innerHTML).not.toContain('ansehen')
  })

  it('has English deck copy', async () => {
    setTestLocale('en')
    await open([doneAt(1, 'a'), doneAt(1, 'b')])
    expect(q('[data-testid="recap-deck-done"]').getAttribute('aria-label')).toBe('2 done, switch with arrow keys')
    expect(q('[data-testid="recap-deck-done"]').getAttribute('aria-roledescription')).toBe('Stack')
    expect(q('[data-testid="recap-prev-done"]').getAttribute('aria-label')).toBe('Previous task')
    expect(q('[data-testid="recap-next-done"]').getAttribute('aria-label')).toBe('Next task')
  })

  it('shows the front card plus at most two layers: 3 of 5 cards, 2 for two, 1 for one are visible', async () => {
    const visible = () => [...document.querySelectorAll<HTMLElement>('[data-testid="recap-deck-done"] .recap-deck__card')].filter(el => el.style.opacity !== '0').length
    await open([doneAt(1, 'a'), doneAt(1, 'b'), doneAt(1, 'c'), doneAt(1, 'd'), doneAt(1, 'e')])
    expect(document.querySelectorAll('[data-testid="recap-deck-done"] .recap-deck__card')).toHaveLength(5)
    expect(visible()).toBe(3)
    for (const [n, expected] of [[2, 2], [1, 1]] as const) {
      wrapper?.unmount()
      resetNewDayRecap()
      setActivePinia(createPinia())
      document.body.innerHTML = ''
      await open(Array.from({ length: n }, (_, i) => doneAt(1, `x${i}`)))
      expect(visible()).toBe(expected)
    }
    expect(q('[data-testid="recap-deck-label"]').textContent?.trim()).toBe('1 erledigt')
  })

  it('the front card is the newest completion (done) and the first open task (open)', async () => {
    await open([
      task('open-1', TaskStatus.Progress), task('open-2', TaskStatus.Open),
      doneAt(1, 'old'), { ...doneAt(1, 'new'), completedAt: new Date(2026, 9, 21, 18) },
    ])
    const front = (kind: string) => q(`[data-testid="recap-deck-${kind}"] .recap-deck__card[style*="z-index: 10"]`).textContent
    expect(front('done')).toBe('new')
    expect(front('undone')).toBe('open-1')
  })

  it('renders the cards inert, hidden from assistive tech, with no task sheet or link', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b')])
    const cards = [...document.querySelectorAll('[data-testid="recap-deck-card"]')]
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card.hasAttribute('inert')).toBe(true)
      expect(card.getAttribute('aria-hidden')).toBe('true')
    }
    expect(document.querySelector('[data-testid="recap-deck-done"] a, [data-testid="recap-deck-done"] button')).toBeNull()
  })

  it('counts "1 / n", also "1 / 1" for one card, and advances with the chevron and the keys (A -> B -> A)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    await open([doneAt(1, 'a'), doneAt(1, 'b'), doneAt(1, 'c'), task('o', TaskStatus.Open)])
    const counter = (kind: string) => q(`[data-testid="recap-deck-${kind}"]`).closest('section')!.querySelector('[data-testid="recap-deck-counter"]')!.textContent?.trim()
    expect(counter('done')).toBe('1 / 3')
    expect(counter('undone')).toBe('1 / 1')

    q('[data-testid="recap-next-done"]').click()
    await vi.advanceTimersByTimeAsync(340)
    expect(counter('done')).toBe('2 / 3')
    expect(counter('undone')).toBe('1 / 1')

    q('[data-testid="recap-prev-done"]').click()
    await vi.advanceTimersByTimeAsync(340)
    expect(counter('done')).toBe('1 / 3')
  })

  it('the chevrons are labelled buttons, disabled with a single card; the counter is decorative', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b'), task('o', TaskStatus.Open)])
    const prev = q<HTMLButtonElement>('[data-testid="recap-prev-done"]')
    expect(prev.tagName).toBe('BUTTON')
    expect(prev.getAttribute('aria-label')).toBe('Vorherige Aufgabe')
    expect(q('[data-testid="recap-next-done"]').getAttribute('aria-label')).toBe('Nächste Aufgabe')
    expect(prev.disabled).toBe(false)
    expect(q<HTMLButtonElement>('[data-testid="recap-prev-undone"]').disabled).toBe(true)
    expect(q<HTMLButtonElement>('[data-testid="recap-next-undone"]').disabled).toBe(true)
    expect(document.querySelector('[data-testid="recap-deck-counter"]')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('announces "2 von 4: Titel" once after a settled advance, nothing on first render', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    await open([doneAt(1, 'a'), doneAt(1, 'b'), doneAt(1, 'c'), doneAt(1, 'd')])
    const live = () => q('[data-testid="recap-deck-live"]')
    expect(live().getAttribute('aria-live')).toBe('polite')
    expect(live().textContent).toBe('')
    // done deck deals newest first: d, c, b, a (all completed at the same hour; reverse order of the list)
    q('[data-testid="recap-next-done"]').click()
    await vi.advanceTimersByTimeAsync(100)
    expect(live().textContent).toBe('')
    await vi.advanceTimersByTimeAsync(50)
    expect(live().textContent).toBe('2 von 4: c')
  })

  it('arrow keys act only while the deck itself has focus and are ignored with a modifier', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    await open([doneAt(1, 'a'), doneAt(1, 'b'), doneAt(1, 'c')])
    const deck = q('[data-testid="recap-deck-done"]')
    const counter = () => q('[data-testid="recap-deck-counter"]').textContent?.trim()
    const press = (target: HTMLElement, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      target.dispatchEvent(event)
      return event
    }

    // a chevron has focus: the key bubbles from outside the deck's element, nothing happens
    press(q('[data-testid="recap-next-done"]'), { key: 'ArrowRight' })
    press(q('[data-testid="recap-continue"]'), { key: 'ArrowRight' })
    await vi.advanceTimersByTimeAsync(500)
    expect(counter()).toBe('1 / 3')

    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(press(deck, { key: 'ArrowRight', ...init }).defaultPrevented).toBe(false)
    }
    await vi.advanceTimersByTimeAsync(500)
    expect(counter()).toBe('1 / 3')

    expect(press(deck, { key: 'ArrowRight' }).defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(counter()).toBe('2 / 3')
    press(deck, { key: 'ArrowLeft' })
    await vi.advanceTimersByTimeAsync(300)
    expect(counter()).toBe('1 / 3')
  })

  it('the decks are independent, and a reopened recap starts at 1 / n', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    await open([doneAt(1, 'a'), doneAt(1, 'b'), task('o1', TaskStatus.Open), task('o2', TaskStatus.Open)])
    const counterOf = (kind: string) => q(`[data-testid="recap-deck-${kind}"]`).closest('section')!.querySelector('[data-testid="recap-deck-counter"]')!.textContent?.trim()
    q('[data-testid="recap-next-undone"]').click()
    await vi.advanceTimersByTimeAsync(300)
    expect(counterOf('undone')).toBe('2 / 2')
    expect(counterOf('done')).toBe('1 / 2')

    useDayRecapStore().setArchiveDone(false)
    q('[data-testid="recap-continue"]').click()
    await vi.advanceTimersByTimeAsync(400)
    expect(page()).toBeNull()
    resetNewDayRecap()
    useDayRecapStore().lastShownDay = '2020-01-01'
    useNewDayRecap().check('tasks')
    await vi.advanceTimersByTimeAsync(400)
    expect(page()).not.toBeNull()
    expect(counterOf('undone')).toBe('1 / 2')
  })

  it('a card is no link: clicking it opens nothing', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b')])
    const before = window.location.href
    q('[data-testid="recap-deck-card"]').click()
    expect(window.location.href).toBe(before)
  })

  it('focuses "Weiter zum Board" on open', async () => {
    await open([doneAt(1, 'a')])
    expect(document.activeElement).toBe(q('[data-testid="recap-continue"]'))
  })

  it('the switch writes the store at once', async () => {
    await open([doneAt(1, 'a')])
    const input = q<HTMLInputElement>('[data-testid="recap-archive-toggle"]')
    expect(input.checked).toBe(true)
    input.checked = false
    input.dispatchEvent(new Event('change'))
    await nextTick()
    expect(useDayRecapStore().archiveDone).toBe(false)
  })

  it('the button archives with the switch on', async () => {
    await open([doneAt(1, 'a'), task('o', TaskStatus.Open)])
    q('[data-testid="recap-continue"]').click()
    await nextTick()
    expect(useTasksStore().archivedTaskIds).toEqual(['a'])
    expect(toastAddMock).not.toHaveBeenCalled()
    expect(useNewDayRecap().isOpen.value).toBe(false)
  })

  it('Escape does what the button does: archives when the switch is on, nothing when it is off', async () => {
    await open([doneAt(1, 'a')])
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(useTasksStore().archivedTaskIds).toEqual(['a'])

    wrapper?.unmount()
    resetNewDayRecap()
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    toastAddMock.mockClear()
    await open([doneAt(1, 'a')])
    useDayRecapStore().setArchiveDone(false)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(useTasksStore().archivedTaskIds).toEqual([])
    expect(toastAddMock).not.toHaveBeenCalled()
    expect(useNewDayRecap().isOpen.value).toBe(false)
  })

  it('wraps Tab inside the page', async () => {
    await open([doneAt(1, 'a')])
    const last = q('[data-testid="recap-continue"]')
    last.focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(page()!.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(last)
  })
})
