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

/** Slot-rendering shell for UModal / UDrawer (jsdom has no portal or dialog support); emits like the real ones. */
const OverlayShell = {
  props: ['open', 'title', 'content', 'ui', 'close'],
  emits: ['update:open', 'after:leave', 'after:enter'],
  template: `<div v-if="open" role="dialog" :aria-label="title" :data-testid="content?.['data-testid']"><header><slot name="title" /><slot name="description" /></header><slot name="body" /><slot name="footer" /></div>`,
}

function setDesktop(matches: boolean) {
  // Only the desktop breakpoint query matches; prefers-reduced-motion stays off
  window.matchMedia = vi.fn((query: string) => ({
    matches: matches && query.includes('min-width'), addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const stubs = {
  UModal: OverlayShell,
  UDrawer: OverlayShell,
  TaskCard: { props: ['task'], template: '<div class="task-card">{{ task.title }}</div>' },
  USwitch: {
    inheritAttrs: false,
    props: ['modelValue', 'label', 'size', 'color'],
    emits: ['update:modelValue'],
    template: '<label><input type="checkbox" role="switch" :checked="modelValue" v-bind="$attrs" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>',
  },
  UTabs: {
    inheritAttrs: false,
    props: ['modelValue', 'items', 'content', 'variant', 'ui'],
    emits: ['update:modelValue'],
    template: '<div v-bind="$attrs" role="tablist"><button v-for="item in items" :key="item.value" type="button" role="tab" :aria-selected="modelValue === item.value" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
  },
  UButton: {
    props: ['color', 'variant', 'size', 'icon', 'trailingIcon'],
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
    setDesktop(true)
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

  it('is hosted by the overlay, titled "Kurzer Rückblick", with the partial sentence', async () => {
    await open([doneAt(1, 'a'), doneAt(1, 'b'), task('o', TaskStatus.Open), task('w', TaskStatus.Waiting), task('j', TaskStatus.Progress)])
    expect(q('[role="dialog"]').getAttribute('aria-label')).toBe('Kurzer Rückblick')
    expect(q('header .font-display').textContent).toContain('Kurzer Rückblick')
    expect(q('[data-testid="recap-summary"]').textContent).toBe('Du hast gestern 2 von 5 Aufgaben erledigt.')
    expect(wrapper!.findComponent({ name: 'ResponsiveOverlay' }).props('closeButton')).toBe(false)
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
    expect(q('header .font-display').textContent).toContain('Quick look back')
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

  /** Escape, scrim click and swipe down all reach the host as `update:open` = false. */
  const dismiss = () => wrapper!.findComponent(OverlayShell).vm.$emit('update:open', false)

  it('a dismissal (Escape, scrim, swipe) does what the button does: archives when the switch is on, nothing when it is off', async () => {
    await open([doneAt(1, 'a')])
    dismiss()
    await nextTick()
    expect(useTasksStore().archivedTaskIds).toEqual(['a'])

    wrapper?.unmount()
    resetNewDayRecap()
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    toastAddMock.mockClear()
    await open([doneAt(1, 'a')])
    useDayRecapStore().setArchiveDone(false)
    dismiss()
    await nextTick()
    expect(useTasksStore().archivedTaskIds).toEqual([])
    expect(toastAddMock).not.toHaveBeenCalled()
    expect(useNewDayRecap().isOpen.value).toBe(false)
  })

  it('hands focus to the button on open and keeps the browser from restoring focus on close', async () => {
    await open([doneAt(1, 'a')])
    const content = wrapper!.findComponent(OverlayShell).props('content') as Record<string, (e: Event) => void>
    const event = new Event('focus', { cancelable: true })
    content.onCloseAutoFocus!(event)
    expect(event.defaultPrevented).toBe(true)
    const open2 = new Event('focus', { cancelable: true })
    content.onOpenAutoFocus!(open2)
    expect(open2.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(q('[data-testid="recap-continue"]'))
  })

  describe('on a phone', () => {
    beforeEach(() => setDesktop(false))
    const tab = (kind: 'undone' | 'done') => document.querySelectorAll('[data-testid="recap-switcher"] [role="tab"]')[kind === 'undone' ? 0 : 1] as HTMLElement
    const pressed = () => (['undone', 'done'] as const).filter(k => tab(k).getAttribute('aria-selected') === 'true').map(k => `recap-switch-${k}`)
    const decks = () => [...document.querySelectorAll('[data-testid^="recap-deck-"][role="group"]')].map(el => el.getAttribute('data-testid'))

    it('shows one deck at a time, starting on "noch offen", and the switcher counts say what is in each', async () => {
      await open([doneAt(1, 'a'), doneAt(1, 'b'), task('o', TaskStatus.Open)])
      expect(tab('undone').textContent?.trim()).toBe('1 noch offen')
      expect(tab('done').textContent?.trim()).toBe('2 erledigt')
      expect(pressed()).toEqual(['recap-switch-undone'])
      expect(decks()).toEqual(['recap-deck-undone'])

      tab('done').click()
      await nextTick()
      expect(pressed()).toEqual(['recap-switch-done'])
      expect(decks()).toEqual(['recap-deck-done'])

      tab('undone').click()
      await nextTick()
      expect(decks()).toEqual(['recap-deck-undone'])
    })

    it('names the tablist itself (UTabs puts attrs on its root, not on the tablist)', async () => {
      await open([doneAt(1, 'a'), task('o', TaskStatus.Open)])
      expect(q('[role="tablist"]').getAttribute('aria-label')).toBe('Anzeige wählen')
    })

    it('the shown deck keeps its name for assistive tech while its heading is visually hidden', async () => {
      await open([doneAt(1, 'a'), task('o', TaskStatus.Open)])
      const heading = q('[data-testid="recap-deck-label"]')
      expect(heading.parentElement!.classList.contains('sr-only')).toBe(true)
      expect(q('[data-testid="recap-deck-undone"]').closest('section')!.getAttribute('aria-labelledby')).toBe(heading.id)
    })

    it('with nothing open there is no switcher, only the done deck with its heading', async () => {
      await open([doneAt(1, 'a'), doneAt(1, 'b')])
      expect(document.querySelector('[data-testid="recap-switcher"]')).toBeNull()
      expect(decks()).toEqual(['recap-deck-done'])
      expect(q('[data-testid="recap-deck-label"]').parentElement!.classList.contains('sr-only')).toBe(false)
    })

    it('a reopened recap starts on "noch offen" again', async () => {
      await open([doneAt(1, 'a'), task('o', TaskStatus.Open)])
      useDayRecapStore().setArchiveDone(false)
      tab('done').click()
      await nextTick()
      q('[data-testid="recap-continue"]').click()
      await nextTick()
      resetNewDayRecap()
      useDayRecapStore().lastShownDay = '2020-01-01'
      useNewDayRecap().check('tasks')
      await nextTick()
      await nextTick()
      expect(pressed()).toEqual(['recap-switch-undone'])
    })
  })

  it('on desktop both decks show side by side and there is no switcher', async () => {
    await open([doneAt(1, 'a'), task('o', TaskStatus.Open)])
    expect(document.querySelector('[data-testid="recap-switcher"]')).toBeNull()
    expect(document.querySelectorAll('[data-testid^="recap-deck-"][role="group"]')).toHaveLength(2)
  })
})
