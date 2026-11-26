/**
 * #800: which intro hint shows on the board. One at a time, only on "Heute" without a task sheet, never while a
 * notice about the board is up; "Start" is due with cards in Offen and an empty Jetzt, and a card in Jetzt ends it
 * whether the hint was on screen or not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import { INTRO_AUSWAHL_MIN_OPEN } from '~/lib/introHints'
import type { Task } from '~/types/task'

const noticeShown = ref(false)
const timeOffer = ref<{ taskId: string } | null>(null)
const recapOpen = ref(false)
const dayCloseOpen = ref(false)
vi.mock('~/composables/useNewDay', () => ({ useNewDay: () => ({ noticeShown, timeOffer }) }))
vi.mock('~/composables/useNewDayRecap', () => ({ useNewDayRecap: () => ({ isOpen: recapOpen }) }))
vi.mock('~/composables/useDayClose', () => ({ useDayClose: () => ({ isOpen: dayCloseOpen }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useIntroHints, useIntroHintSteps } from '~/composables/useIntroHints'
import { useSettingsStore } from '~/store/settings'
import { useDayRecapStore } from '~/store/dayRecap'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { setCurrentBoardPath } from '~/lib/boardPlace'
import { dayKey } from '~/utils/recapDay'
import { markFirstFetchEnded, resetFirstFetchEnded } from '~/lib/boardSettled'
/* eslint-enable import/first */

const task = (id: string, status: TaskStatus): Task => ({ id, title: id, status, source: 'local', externalId: null } as Task)

function setup(tasks: Task[], started = true, welcomeAhead = false) {
  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
  tasksStore.setTasks(tasks)
  if (started) {
    settings.startIntroHints()
    // Past the welcome (#853), with a card of their own in Jetzt before: the step hints are what these tests are about
    if (!welcomeAhead) {
      settings.endIntroWelcome()
      settings.markOwnJetzt()
    }
  }
  return { settings, tasksStore, hints: useIntroHints() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  noticeShown.value = false
  timeOffer.value = null
  recapOpen.value = false
  dayCloseOpen.value = false
  setCurrentBoardPath('/tasks')
})

describe('useIntroHints: the hint "Start"', () => {
  it('shows with cards in Offen and an empty Jetzt', () => {
    expect(setup([task('a', TaskStatus.Open)]).hints.current.value).toBe('start')
  })

  it('does not show on an empty board or with a card in Jetzt', () => {
    expect(setup([]).hints.current.value).toBeNull()
    setActivePinia(createPinia())
    // a card in Jetzt is not the moment of "Start" ("Weiter" is)
    expect(setup([task('a', TaskStatus.Open), task('b', TaskStatus.Progress)]).hints.current.value).not.toBe('start')
  })

  it('never shows for a user whose hints never started (an install from before #800)', () => {
    expect(setup([task('a', TaskStatus.Open)], false).hints.current.value).toBeNull()
  })

  it('shows on "Heute" only: not on "Alle", not under a task sheet, and is back afterwards', () => {
    const { hints } = setup([task('a', TaskStatus.Open)])
    for (const path of ['/all', '/all/a', '/tasks/a', '/tasks/add']) {
      setCurrentBoardPath(path)
      expect(hints.current.value, path).toBeNull()
    }
    setCurrentBoardPath('/tasks')
    expect(hints.current.value).toBe('start')
  })

  it.each([
    ['the fresh-start notice', () => { noticeShown.value = true }],
    ['the question about time after midnight', () => { timeOffer.value = { taskId: 'a' } }],
    ['the recap', () => { recapOpen.value = true }],
    ['the day close', () => { dayCloseOpen.value = true }],
  ])('waits while %s is up, and shows once it is gone', (_name, raise) => {
    const { hints } = setup([task('a', TaskStatus.Open)])
    raise()
    expect(hints.current.value).toBeNull()
    noticeShown.value = false
    timeOffer.value = null
    recapOpen.value = false
    dayCloseOpen.value = false
    expect(hints.current.value).toBe('start')
  })

  it('"Schließen" ends it and keeps the day quiet', () => {
    const { hints, settings } = setup([task('a', TaskStatus.Open)])
    hints.close()
    expect(hints.current.value).toBeNull()
    expect(settings.introHints).toMatchObject({ on: true, quietDay: dayKey(new Date()), hints: { start: { answered: true, days: [] } } })
  })

  it('markShown stores today once', () => {
    const { hints, settings } = setup([task('a', TaskStatus.Open)])
    hints.markShown('start')
    const stored = settings.introHints
    hints.markShown('start')
    expect(settings.introHints).toBe(stored)
    expect(stored?.hints.start?.days).toEqual([dayKey(new Date())])
  })
})

describe('useIntroHintSteps: doing the step ends the hint', () => {
  it('a card in Jetzt answers "Start", also while a notice hides the hint; it does not return when Jetzt is empty again', async () => {
    const { hints, settings, tasksStore } = setup([task('a', TaskStatus.Open), task('b', TaskStatus.Open)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(settings.introHints?.hints.start).toBeUndefined()
    noticeShown.value = true
    tasksStore.setTasks([task('a', TaskStatus.Progress), task('b', TaskStatus.Open)])
    await nextTick()
    expect(settings.introHints?.hints.start?.answered).toBe(true)
    noticeShown.value = false
    tasksStore.setTasks([task('a', TaskStatus.Open), task('b', TaskStatus.Open)])
    await nextTick()
    expect(hints.current.value).toBeNull()
    scope.stop()
  })

  it('a board that starts with a card in Jetzt (a first sync) answers "Start" at once', () => {
    const { settings } = setup([task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(settings.introHints?.hints.start?.answered).toBe(true)
    scope.stop()
  })

  it('writes nothing for a user whose hints never started', async () => {
    const { settings, tasksStore } = setup([task('a', TaskStatus.Open)], false)
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([task('a', TaskStatus.Progress)])
    await nextTick()
    expect(settings.introHints).toBeNull()
    scope.stop()
  })
})

const done = (id: string, completedAt = new Date()): Task => ({ ...task(id, TaskStatus.Done), completedAt } as Task)
const openCards = (n: number) => Array.from({ length: n }, (_, i) => task(`o${i}`, TaskStatus.Open))
const answered = (settings: ReturnType<typeof useSettingsStore>, id: string) => settings.introHints?.hints[id]?.answered

describe('the hint "Weiter" (#801)', () => {
  it('shows with a card in Jetzt, once "Start" has ended', () => {
    const { hints, settings } = setup([task('a', TaskStatus.Progress)])
    settings.answerIntroHint('start')
    expect(hints.current.value).toBe('weiter')
  })

  it('ends when a card that was in Jetzt goes to Erledigt, on screen or not', async () => {
    const { hints, settings, tasksStore } = setup([task('a', TaskStatus.Progress), task('b', TaskStatus.Open)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    noticeShown.value = true
    tasksStore.setTasks([done('a'), task('b', TaskStatus.Open)])
    await nextTick()
    expect(answered(settings, 'weiter')).toBe(true)
    noticeShown.value = false
    expect(hints.current.value).not.toBe('weiter')
    scope.stop()
  })

  it('ends when a card that was in Jetzt goes to Wartet', async () => {
    const { settings, tasksStore } = setup([task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([task('a', TaskStatus.Waiting)])
    await nextTick()
    expect(answered(settings, 'weiter')).toBe(true)
    scope.stop()
  })

  it('a card back in Offen ends nothing: the hint is there again with the next card in Jetzt', async () => {
    const { hints, settings, tasksStore } = setup([task('a', TaskStatus.Progress)])
    settings.answerIntroHint('start')
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([task('a', TaskStatus.Open)])
    await nextTick()
    expect(answered(settings, 'weiter')).toBeUndefined()
    tasksStore.setTasks([task('a', TaskStatus.Progress)])
    await nextTick()
    expect(hints.current.value).toBe('weiter')
    scope.stop()
  })

  it('a Wartet or Erledigt card the board starts with ends nothing: the user never ran the timer (a Notion board)', () => {
    const { hints, settings } = setup([task('w', TaskStatus.Waiting), done('d'), task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(answered(settings, 'weiter')).toBeUndefined()
    expect(answered(settings, 'start')).toBe(true) // the card in Jetzt answered "Start"
    expect(hints.current.value).toBe('weiter')
    scope.stop()
  })

  it('a card deleted from Jetzt ends nothing', async () => {
    const { settings, tasksStore } = setup([task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([])
    await nextTick()
    expect(answered(settings, 'weiter')).toBeUndefined()
    scope.stop()
  })
})

describe('the hint "Auswahl" (#801)', () => {
  const ended = (settings: ReturnType<typeof useSettingsStore>, ...ids: string[]) => ids.forEach((id) => settings.answerIntroHint(id))

  it(`shows with ${INTRO_AUSWAHL_MIN_OPEN} cards in Offen and an empty Jetzt, not with fewer, not with a card in Jetzt`, () => {
    const { hints, settings, tasksStore } = setup(openCards(INTRO_AUSWAHL_MIN_OPEN - 1))
    ended(settings, 'start', 'weiter')
    expect(hints.current.value).toBeNull()
    tasksStore.setTasks(openCards(INTRO_AUSWAHL_MIN_OPEN))
    expect(hints.current.value).toBe('auswahl')
    tasksStore.setTasks([...openCards(INTRO_AUSWAHL_MIN_OPEN), task('j', TaskStatus.Progress)])
    expect(hints.current.value).toBeNull()
  })

  it('ends once cards are stacked, on screen or not, and stays ended when stacking is switched off again', async () => {
    const { hints, settings } = setup(openCards(INTRO_AUSWAHL_MIN_OPEN))
    ended(settings, 'start', 'weiter')
    const board = useBoardStore()
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(hints.current.value).toBe('auswahl')
    board.setGroupingEnabled(true)
    await nextTick()
    expect(answered(settings, 'auswahl')).toBe(true)
    board.setGroupingEnabled(false)
    await nextTick()
    expect(hints.current.value).toBeNull()
    scope.stop()
  })
})

describe('"Erneut zeigen" while a step is already done (#804)', () => {
  const ended = (settings: ReturnType<typeof useSettingsStore>, ...ids: string[]) => ids.forEach((id) => settings.answerIntroHint(id))

  it('answers "Auswahl" again when stacking is already on, so the hint does not show with a button that changes nothing', async () => {
    const { hints, settings } = setup(openCards(INTRO_AUSWAHL_MIN_OPEN))
    const board = useBoardStore()
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    board.setGroupingEnabled(true)
    await nextTick()
    expect(answered(settings, 'auswahl')).toBe(true)
    settings.restartIntroHints()
    ended(settings, 'start', 'weiter')
    await nextTick()
    expect(answered(settings, 'auswahl')).toBe(true)
    expect(hints.current.value).toBeNull()
    scope.stop()
  })

  it('answers "Start" again when a card is in Jetzt, so a restart does not bring "Start" back after the card leaves', async () => {
    const { settings, tasksStore } = setup([task('j', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    await nextTick()
    expect(answered(settings, 'start')).toBe(true)
    settings.restartIntroHints()
    await nextTick()
    expect(answered(settings, 'start')).toBe(true)
    tasksStore.setTasks(openCards(2))
    expect(useIntroHints().current.value).not.toBe('start')
    scope.stop()
  })
})

describe('the hint "Abschluss" (#801)', () => {
  const ended = (settings: ReturnType<typeof useSettingsStore>) => ['start', 'weiter', 'auswahl'].forEach((id) => settings.answerIntroHint(id))

  it('shows when something is done today and Jetzt is empty', () => {
    const { hints, settings } = setup([done('d')])
    ended(settings)
    expect(hints.current.value).toBe('abschluss')
  })

  it('does not show with nothing done today, nor with a card in Jetzt, nor for a card done on an earlier day', () => {
    const none = setup([task('a', TaskStatus.Open)])
    ended(none.settings)
    expect(none.hints.current.value).toBeNull()
    none.tasksStore.setTasks([done('d'), task('j', TaskStatus.Progress)])
    expect(none.hints.current.value).toBeNull() // a card in Jetzt: not the moment of "Abschluss"
    none.tasksStore.setTasks([done('old', new Date(Date.now() - 3 * 86_400_000))])
    expect(none.hints.current.value).toBeNull()
  })

  it('ends when "Tag abschließen" is opened, by any way in, and does not return', async () => {
    const { hints, settings } = setup([done('d')])
    ended(settings)
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(hints.current.value).toBe('abschluss')
    dayCloseOpen.value = true
    await nextTick()
    expect(answered(settings, 'abschluss')).toBe(true)
    dayCloseOpen.value = false
    await nextTick()
    expect(hints.current.value).toBeNull()
    scope.stop()
  })
})

describe('several hints are due together (#801)', () => {
  it('"Auswahl" comes before "Abschluss", and "Abschluss" follows on the next day after "Schließen"', () => {
    const { hints, settings } = setup([done('d'), ...openCards(INTRO_AUSWAHL_MIN_OPEN)])
    settings.answerIntroHint('start')
    settings.answerIntroHint('weiter')
    expect(hints.current.value).toBe('auswahl')
    hints.close()
    expect(hints.current.value).toBeNull() // quiet for the rest of the day
    const day = settings.introHints?.quietDay
    expect(day).toBeTruthy()
    settings.introHints!.quietDay = '2000-01-01' // the next day: no longer quiet
    expect(hints.current.value).toBe('abschluss')
  })
})

describe('the hint "Die Aufgaben des Tages planen" (#803): the planning note of "Alle"', () => {
  const notPlanned = (id: string): Task => ({ ...task(id, TaskStatus.Open), notPlanned: true } as Task)

  it('is due with tasks to pick under "Alle", for a user of the hints, on any place', () => {
    const { hints } = setup([notPlanned('a')])
    expect(hints.planDue.value).toBe(true)
    setCurrentBoardPath('/all')
    expect(hints.planDue.value).toBe(true)
  })

  it('is not due with nothing to pick, for a user without hints, with hints off, or on the quiet day', () => {
    expect(setup([task('a', TaskStatus.Open)]).hints.planDue.value).toBe(false)
    setActivePinia(createPinia())
    expect(setup([notPlanned('a')], false).hints.planDue.value).toBe(false)
    setActivePinia(createPinia())
    const { hints, settings } = setup([notPlanned('a')])
    settings.setIntroHintsOn(false)
    expect(hints.planDue.value).toBe(false)
    settings.setIntroHintsOn(true)
    settings.closeIntroHint('start', dayKey(new Date()))
    expect(hints.planDue.value).toBe(false)
  })

  it.each([
    ['the fresh-start notice', () => { noticeShown.value = true }],
    ['the question about time after midnight', () => { timeOffer.value = { taskId: 'a' } }],
    ['the recap', () => { recapOpen.value = true }],
    ['the day close', () => { dayCloseOpen.value = true }],
  ])('waits while %s is up', (_name, raise) => {
    const { hints } = setup([notPlanned('a')])
    raise()
    expect(hints.planDue.value).toBe(false)
  })

  it('is never due once the old note was answered (the #711 flag keeps counting) or the hint ended', () => {
    const { hints, settings } = setup([notPlanned('a')])
    settings.answerIntroHint('planen')
    expect(hints.planDue.value).toBe(false)
    setActivePinia(createPinia())
    const again = setup([notPlanned('a')])
    useDayRecapStore().markPlanNoteSeen()
    expect(again.hints.planDue.value).toBe(false)
  })

  it('is never the overlay\'s hint, and the overlay\'s hints never show on "Alle": two hints are not up together', () => {
    const { hints } = setup([notPlanned('a'), task('b', TaskStatus.Open)])
    expect(hints.current.value).toBe('start')
    setCurrentBoardPath('/all')
    expect(hints.current.value).toBeNull()
    expect(hints.planDue.value).toBe(true)
  })

  it('ends with a card planned into Offen or Jetzt, on screen or not; a Wartet card ends nothing', async () => {
    const { settings, tasksStore } = setup([notPlanned('a')])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(settings.introHints?.hints.planen).toBeUndefined()
    tasksStore.setTasks([notPlanned('a'), task('w', TaskStatus.Waiting)])
    await nextTick()
    expect(settings.introHints?.hints.planen).toBeUndefined()
    tasksStore.setTasks([task('a', TaskStatus.Open), task('w', TaskStatus.Waiting)])
    await nextTick()
    expect(settings.introHints?.hints.planen?.answered).toBe(true)
    scope.stop()
  })
})

describe('the welcome (#853)', () => {
  const notPlanned = (id: string): Task => ({ ...task(id, TaskStatus.Open), notPlanned: true } as Task)
  const fresh = (tasks: Task[]) => setup(tasks, true, true)

  it('comes before every step hint and before the planning note, on "Heute" and on "Alle"', () => {
    const { hints } = fresh([task('a', TaskStatus.Open), notPlanned('n')])
    expect(hints.welcome.value).toMatchObject({ shape: 'tour', scenario: 'today' })
    expect(hints.current.value).toBeNull()
    expect(hints.planDue.value).toBe(false)
    setCurrentBoardPath('/all')
    expect(hints.welcome.value).toMatchObject({ shape: 'note' })
    expect(hints.planDue.value).toBe(false)
  })

  it('never shows for an install from before it, with or without a hints record', () => {
    expect(setup([task('a', TaskStatus.Open)], false).hints.welcome.value).toBeNull()
    setActivePinia(createPinia())
    const settings = useSettingsStore()
    settings.introHints = { on: true, quietDay: null, hints: {} }
    useTasksStore().setTasks([task('a', TaskStatus.Open)])
    const hints = useIntroHints()
    expect(hints.welcome.value).toBeNull()
    expect(hints.current.value).toBe('start')
  })

  it('does not show under a task sheet or while a board notice is up, and keeps the step hints waiting meanwhile', () => {
    const { hints } = fresh([task('a', TaskStatus.Open)])
    setCurrentBoardPath('/tasks/a')
    expect(hints.welcome.value).toBeNull()
    expect(hints.current.value).toBeNull()
    setCurrentBoardPath('/tasks')
    noticeShown.value = true
    expect(hints.welcome.value).toBeNull()
    noticeShown.value = false
    expect(hints.welcome.value).not.toBeNull()
  })

  it('waits for the first load of a board with a connection, and reads the board once it has ended', () => {
    resetFirstFetchEnded()
    const { hints, tasksStore } = fresh([])
    useBoardStore().boardConfig.sources = { connected: ['notion'], default: 'notion' }
    expect(hints.welcome.value).toBeNull()
    tasksStore.setTasks([task('a', TaskStatus.Open)])
    markFirstFetchEnded()
    expect(hints.welcome.value).toMatchObject({ shape: 'tour', scenario: 'today' })
    resetFirstFetchEnded()
  })

  it('after the tour "Start" counts as said: no step hint repeats it', () => {
    const { hints, settings } = fresh([task('a', TaskStatus.Open)])
    hints.endWelcome()
    expect(hints.welcome.value).toBeNull()
    expect(answered(settings, 'start')).toBe(true)
    expect(hints.current.value).toBeNull()
    expect(settings.introHints?.quietDay).toBeNull()
  })

  it('after the welcome on "Alle" with tasks the planning note counts as said, also by its older flag', () => {
    const { hints, settings } = fresh([notPlanned('n')])
    setCurrentBoardPath('/all')
    hints.endWelcome()
    expect(answered(settings, 'planen')).toBe(true)
    expect(useDayRecapStore().validPlanNoteSeen).toBe(true)
    expect(hints.planDue.value).toBe(false)
  })

  it('after the note on an empty "Heute" the step hints follow on the same day', () => {
    const { hints, settings, tasksStore } = fresh([])
    expect(hints.welcome.value).toMatchObject({ shape: 'note', scenario: 'empty' })
    hints.endWelcome()
    expect(answered(settings, 'start')).not.toBe(true)
    tasksStore.setTasks([task('a', TaskStatus.Open)])
    expect(hints.current.value).toBe('start')
  })

  it('a single note that was on screen ends with the first card on "Heute"; a note not yet seen, and a tour, do not', async () => {
    const { hints, settings, tasksStore } = fresh([])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    // Not seen yet (the sample board loads before the first render): the cards arriving end nothing
    tasksStore.setTasks([task('a', TaskStatus.Open)])
    await nextTick()
    expect(hints.welcome.value).toMatchObject({ shape: 'tour' })
    // A tour on screen stays when another card comes
    hints.markWelcomeShown()
    tasksStore.setTasks([task('a', TaskStatus.Open), task('b', TaskStatus.Open)])
    await nextTick()
    expect(hints.welcome.value).not.toBeNull()
    // The note of an empty board, seen: the first card ends it
    tasksStore.setTasks([])
    await nextTick()
    expect(hints.welcome.value).toMatchObject({ shape: 'note' })
    tasksStore.setTasks([task('c', TaskStatus.Open)])
    await nextTick()
    expect(answered(settings, 'welcome')).toBe(true)
    expect(hints.current.value).toBe('start')
    scope.stop()
  })

  it('"Weiter" waits for the user\'s own card in Jetzt: a card the board starts with shows no hint', () => {
    const { hints, settings } = fresh([task('j', TaskStatus.Progress)])
    hints.endWelcome()
    expect(hints.current.value).toBeNull()
    settings.markOwnJetzt()
    expect(hints.current.value).toBe('weiter')
  })

  it('a card in Jetzt, on any page, notes that Jetzt was used', async () => {
    const { settings, tasksStore } = setup([task('a', TaskStatus.Open)], false)
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(settings.jetztUsed).toBe(false)
    tasksStore.setTasks([task('a', TaskStatus.Progress)])
    await nextTick()
    expect(settings.jetztUsed).toBe(true)
    tasksStore.setTasks([])
    await nextTick()
    expect(settings.jetztUsed).toBe(true)
    scope.stop()
  })
})
