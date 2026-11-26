/**
 * #800: the rules of the intro hints. The order, the three-day rule (days away do not count), the quiet day after
 * "Schließen", and the tolerant reader of the stored record.
 */
import { describe, it, expect } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'
import { currentIntroHint, freshIntroHints, INTRO_HINT_ORDER, INTRO_PLAN_HINT, introHintTextKey, introHintTitleKey, isIntroHintEnded, isIntroWelcomeLive, resolveIntroWelcome, type IntroWelcome, type IntroWelcomeBoard, isIntroHintLive, needsShownDay, sanitizeIntroHints, type IntroHintId, type IntroHintsRecord } from '~/lib/introHints'

const due = () => true
/** Only "Start" has its moment: the rules of one hint, whatever follows it in the order */
const onlyStart = (id: IntroHintId) => id === 'start'
const record = (over: Partial<IntroHintsRecord> = {}): IntroHintsRecord => ({ ...freshIntroHints(), ...over })

describe('currentIntroHint', () => {
  it('shows nothing while the hints never started (every install from before #800)', () => {
    expect(currentIntroHint(null, '2026-11-24', due)).toBeNull()
  })

  it('shows the first due hint of a started record', () => {
    expect(currentIntroHint(record(), '2026-11-24', due)).toBe('start')
    expect(currentIntroHint(record(), '2026-11-24', () => false)).toBeNull()
  })

  it('shows nothing while the hints are off', () => {
    expect(currentIntroHint(record({ on: false }), '2026-11-24', due)).toBeNull()
  })

  it('is quiet for the rest of the day "Schließen" was used, and not the day after', () => {
    const quiet = record({ quietDay: '2026-11-24' })
    expect(currentIntroHint(quiet, '2026-11-24', due)).toBeNull()
    expect(currentIntroHint(quiet, '2026-11-25', due)).toBe('start')
  })

  it('never returns an answered hint', () => {
    const answered = record({ hints: { start: { answered: true, days: [] } } })
    expect(currentIntroHint(answered, '2026-11-24', onlyStart)).toBeNull()
    expect(currentIntroHint(answered, '2027-01-01', onlyStart)).toBeNull()
  })
})

describe('the order of the hints (#801)', () => {
  it('is Start, Weiter, Auswahl, Abschluss', () => {
    expect([...INTRO_HINT_ORDER]).toEqual(['start', 'weiter', 'auswahl', 'abschluss'])
  })

  it('shows the first due hint that has not ended: "Auswahl" before "Abschluss" when both are due', () => {
    const bothDue = (id: IntroHintId) => id === 'auswahl' || id === 'abschluss'
    const answered = { answered: true, days: [] }
    expect(currentIntroHint(record({ hints: { start: answered, weiter: answered } }), '2026-11-24', bothDue)).toBe('auswahl')
    expect(currentIntroHint(record({ hints: { start: answered, weiter: answered, auswahl: answered } }), '2026-11-24', bothDue)).toBe('abschluss')
  })

  it('an ended hint is skipped even while its moment is still there', () => {
    const answered = { answered: true, days: [] }
    expect(currentIntroHint(record({ hints: { start: answered } }), '2026-11-24', due)).toBe('weiter')
  })

  it('reads a record from an older build that holds only "start", and keeps an id this build does not know', () => {
    const stored = { on: true, quietDay: null, hints: { start: { answered: true, days: [] }, planen: { answered: false, days: [] } } }
    const read = sanitizeIntroHints(stored)
    expect(read).toEqual(stored)
    expect(currentIntroHint(read, '2026-11-24', due)).toBe('weiter')
  })
})

describe('the three-day rule', () => {
  const days = ['2026-11-20', '2026-11-23', '2026-11-24']

  it('keeps a hint through its third day and ends it on the next', () => {
    const entry = { answered: false, days }
    expect(isIntroHintEnded(entry, '2026-11-24')).toBe(false)
    expect(isIntroHintEnded(entry, '2026-11-25')).toBe(true)
    expect(isIntroHintEnded(entry, '2026-12-24')).toBe(true)
  })

  it('does not count days away: two shown days with a gap of weeks are still two', () => {
    const entry = { answered: false, days: ['2026-11-01', '2026-11-24'] }
    expect(isIntroHintEnded(entry, '2026-12-24')).toBe(false)
    expect(needsShownDay(record({ hints: { start: entry } }), 'start', '2026-12-24')).toBe(true)
  })

  it('stores a day once and never a fourth', () => {
    const shown = record({ hints: { start: { answered: false, days } } })
    expect(needsShownDay(shown, 'start', '2026-11-24')).toBe(false)
    expect(needsShownDay(shown, 'start', '2026-11-25')).toBe(false)
    expect(needsShownDay(record(), 'start', '2026-11-24')).toBe(true)
    expect(needsShownDay(null, 'start', '2026-11-24')).toBe(false)
  })

  it('an ended hint is not current', () => {
    expect(currentIntroHint(record({ hints: { start: { answered: false, days } } }), '2026-11-25', onlyStart)).toBeNull()
  })
})

describe('sanitizeIntroHints', () => {
  it.each([['nothing', undefined], ['null', null], ['a string', 'on'], ['an array', []], ['a record without on', { hints: {} }], ['a non-boolean on', { on: 'yes' }]])(
    'reads %s as never started',
    (_name, bad) => expect(sanitizeIntroHints(bad)).toBeNull(),
  )

  it('keeps a valid record, unknown hint ids included', () => {
    const stored = { on: false, quietDay: '2026-11-24', hints: { start: { answered: true, days: ['2026-11-24'] }, later: { answered: false, days: [] } } }
    expect(sanitizeIntroHints(stored)).toEqual(stored)
  })

  it('drops malformed entries and day keys, and caps the days', () => {
    const read = sanitizeIntroHints({
      on: true,
      quietDay: 'yesterday',
      hints: {
        start: { answered: false, days: ['2026-11-20', 'x', 7, '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'] },
        broken: { answered: 'no', days: [] },
        alsoBroken: null,
      },
    })
    expect(read).toEqual({ on: true, quietDay: null, hints: { start: { answered: false, days: ['2026-11-20', '2026-11-21', '2026-11-22'] } } })
  })

  it('reads malformed hints as none', () => {
    expect(sanitizeIntroHints({ on: true, hints: 'none' })).toEqual({ on: true, quietDay: null, hints: {} })
  })
})

describe('introHintTextKey (#804): the help in the settings reads the hints\' own texts', () => {
  const read = (locale: object, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale)

  it.each(INTRO_HINT_ORDER.flatMap((id) => [[id, true], [id, false]] as const))('hint %s has a text in both locales (phone: %s)', (id, phone) => {
    const key = introHintTextKey(id, phone)
    expect(typeof read(de, key), `de ${key}`).toBe('string')
    expect(typeof read(en, key), `en ${key}`).toBe('string')
  })

  it.each(INTRO_HINT_ORDER)('hint %s has a title in the help section in both locales', (id) => {
    expect(typeof read(de, `settings.introHints.entries.${id}`)).toBe('string')
    expect(typeof read(en, `settings.introHints.entries.${id}`)).toBe('string')
  })

  it('only "Start" has a text per width', () => {
    expect(introHintTextKey('start', true)).not.toBe(introHintTextKey('start', false))
    expect(introHintTextKey('weiter', true)).toBe(introHintTextKey('weiter', false))
  })
})

describe('the hint "Die Aufgaben des Tages planen" (#803): a hint of "Alle" outside the overlay\'s order', () => {
  const day = '2026-11-25'
  const entry = (days: string[], answered = false) => ({ answered, days })

  it('is not in the overlay\'s order, so the overlay never returns it', () => {
    expect(INTRO_HINT_ORDER).not.toContain(INTRO_PLAN_HINT)
    expect(currentIntroHint(record(), day, due)).not.toBe(INTRO_PLAN_HINT)
  })

  it('is live for a started record that has no entry for it (a record from before #803)', () => {
    expect(isIntroHintLive(record(), INTRO_PLAN_HINT, day)).toBe(true)
  })

  it.each([
    ['never started', null],
    ['turned off', record({ on: false })],
    ['the quiet day after a "Schließen"', record({ quietDay: day })],
    ['answered', record({ hints: { planen: entry([], true) } })],
    ['unanswered on three earlier days', record({ hints: { planen: entry(['2026-11-20', '2026-11-21', '2026-11-22']) } })],
  ])('is not live: %s', (_name, rec) => {
    expect(isIntroHintLive(rec, INTRO_PLAN_HINT, day)).toBe(false)
  })

  it('is live on its third day and on a quiet day of an earlier date', () => {
    expect(isIntroHintLive(record({ hints: { planen: entry(['2026-11-23', '2026-11-24', day]) } }), INTRO_PLAN_HINT, day)).toBe(true)
    expect(isIntroHintLive(record({ quietDay: '2026-11-24' }), INTRO_PLAN_HINT, day)).toBe(true)
  })

  it('has its text per width, in both locales', () => {
    expect(introHintTextKey(INTRO_PLAN_HINT, true)).not.toBe(introHintTextKey(INTRO_PLAN_HINT, false))
    for (const phone of [true, false]) {
      const key = introHintTextKey(INTRO_PLAN_HINT, phone)
      expect(typeof key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], de), `de ${key}`).toBe('string')
      expect(typeof key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en), `en ${key}`).toBe('string')
    }
  })
})

const TODAY = '2026-11-25'

describe('the welcome (#853): the record', () => {
  it('a fresh record has the welcome ahead; a record from before it never does', () => {
    expect(isIntroWelcomeLive(freshIntroHints(), TODAY)).toBe(true)
    expect(isIntroWelcomeLive({ on: true, quietDay: null, hints: {} }, TODAY)).toBe(false)
    expect(isIntroWelcomeLive(null, TODAY)).toBe(false)
  })

  it('is over once answered, while the hints are off, and after three days on screen', () => {
    expect(isIntroWelcomeLive(record({ hints: { welcome: { answered: true, days: [] } } }), TODAY)).toBe(false)
    expect(isIntroWelcomeLive(record({ on: false }), TODAY)).toBe(false)
    expect(isIntroWelcomeLive(record({ hints: { welcome: { answered: false, days: ['2026-11-20', '2026-11-21', '2026-11-22'] } } }), TODAY)).toBe(false)
    expect(isIntroWelcomeLive(record({ hints: { welcome: { answered: false, days: ['2026-11-20', TODAY] } } }), TODAY)).toBe(true)
  })

  it('reads the version and the own-Jetzt flag tolerantly: only the known values survive, older data has neither', () => {
    expect(sanitizeIntroHints({ on: true, quietDay: null, hints: {}, v: 2, ownJetzt: true })).toEqual({ on: true, quietDay: null, hints: {}, v: 2, ownJetzt: true })
    expect(sanitizeIntroHints({ on: true, quietDay: null, hints: {} })).toEqual({ on: true, quietDay: null, hints: {} })
    expect(sanitizeIntroHints({ on: true, quietDay: null, hints: {}, v: '2', ownJetzt: 'yes' })).toEqual({ on: true, quietDay: null, hints: {} })
    expect(sanitizeIntroHints({ on: true, quietDay: null, hints: {}, v: 3 })).toEqual({ on: true, quietDay: null, hints: {} })
  })
})

describe('the welcome (#853): what it says per scenario and place', () => {
  const board = (over: Partial<IntroWelcomeBoard> = {}): IntroWelcomeBoard =>
    ({ place: 'today', onToday: 0, underAll: 0, connected: false, sample: false, jetzt: false, phone: false, ...over })
  const keys = (welcome: IntroWelcome) => welcome.steps.map((step) => [step.titleKey, step.textKey])
  const read = (locale: object, key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locale)

  it('S1, an empty board on "Heute": one note, in the wording of the width', () => {
    const welcome = resolveIntroWelcome(board())
    expect(welcome).toMatchObject({ scenario: 'empty', shape: 'note', toAll: false, says: [] })
    expect(keys(welcome)).toEqual([['board.welcome.empty.title', 'board.welcome.empty.today.desktop']])
    expect(keys(resolveIntroWelcome(board({ phone: true })))).toEqual([['board.welcome.empty.title', 'board.welcome.empty.today.phone']])
  })

  it('S2, a connection without tasks: one note that names the connection, on both places', () => {
    for (const place of ['today', 'all'] as const) {
      const welcome = resolveIntroWelcome(board({ connected: true, place }))
      expect(welcome).toMatchObject({ scenario: 'connectedEmpty', shape: 'note', toAll: false, says: [] })
      expect(keys(welcome)).toEqual([['board.welcome.empty.title', 'board.welcome.connectedEmpty.text']])
    }
  })

  it('S3, tasks only under "Alle": on "Heute" one note whose button leads to "Alle"', () => {
    const welcome = resolveIntroWelcome(board({ underAll: 3, connected: true }))
    expect(welcome).toMatchObject({ scenario: 'underAll', shape: 'note', toAll: true, says: [] })
    expect(keys(welcome)).toEqual([['board.welcome.underAll.title', 'board.welcome.underAll.today']])
  })

  it('S4, cards already on "Heute": the tour of three, which stands for "Start"', () => {
    const welcome = resolveIntroWelcome(board({ onToday: 2, underAll: 1, connected: true }))
    expect(welcome).toMatchObject({ scenario: 'today', shape: 'tour', toAll: false, says: ['start'] })
    expect(keys(welcome)).toEqual([
      ['board.welcome.tour.today.title', 'board.welcome.tour.today.text.desktop'],
      ['board.welcome.tour.one.title', 'board.welcome.tour.one.empty.desktop'],
      ['board.welcome.tour.done.title', 'board.welcome.tour.done.text'],
    ])
  })

  it('S4 on a phone: note 1 names the swipe to "Offen" only when Jetzt is filled (the phone opens on Offen otherwise)', () => {
    const empty = resolveIntroWelcome(board({ onToday: 2, phone: true }))
    expect(keys(empty)[0]).toEqual(['board.welcome.tour.today.title', 'board.welcome.tour.today.text.phoneOpen'])
    const filled = resolveIntroWelcome(board({ onToday: 2, phone: true, jetzt: true }))
    expect(keys(filled)[0]).toEqual(['board.welcome.tour.today.title', 'board.welcome.tour.today.text.phone'])
  })

  it('S5, the sample board: the tour starts with the sample note; note 2 explains the card that lies in Jetzt', () => {
    const welcome = resolveIntroWelcome(board({ onToday: 6, sample: true, jetzt: true }))
    expect(welcome).toMatchObject({ scenario: 'sample', shape: 'tour', says: ['start'] })
    expect(keys(welcome).slice(0, 2)).toEqual([
      ['board.welcome.tour.sample.title', 'board.welcome.tour.sample.text.desktop'],
      ['board.welcome.tour.one.title', 'board.welcome.tour.one.filled'],
    ])
    const phone = resolveIntroWelcome(board({ onToday: 6, sample: true, phone: true }))
    expect(keys(phone).slice(0, 2)).toEqual([
      ['board.welcome.tour.sample.title', 'board.welcome.tour.sample.text.phoneOpen'],
      ['board.welcome.tour.one.title', 'board.welcome.tour.one.empty.phone'],
    ])
    const phoneFilled = resolveIntroWelcome(board({ onToday: 6, sample: true, phone: true, jetzt: true }))
    expect(keys(phoneFilled)[0]).toEqual(['board.welcome.tour.sample.title', 'board.welcome.tour.sample.text.phone'])
  })

  it('S6, on "Alle" it is always one note: the empty board\'s, or with any task the one that stands for the planning note', () => {
    expect(keys(resolveIntroWelcome(board({ place: 'all' })))).toEqual([['board.welcome.empty.title', 'board.welcome.empty.all']])
    for (const over of [{ underAll: 2 }, { onToday: 2 }, { onToday: 6, sample: true, jetzt: true }]) {
      const welcome = resolveIntroWelcome(board({ place: 'all', ...over }))
      expect(welcome).toMatchObject({ shape: 'note', toAll: false, says: [INTRO_PLAN_HINT] })
      expect(keys(welcome)).toEqual([['board.welcome.underAll.title', 'board.welcome.underAll.all.desktop']])
    }
  })

  it('every key it can return exists in both locales', () => {
    const boards = [true, false].flatMap((phone) => (['today', 'all'] as const).flatMap((place) => [
      board({ phone, place }), board({ phone, place, connected: true }), board({ phone, place, underAll: 1 }),
      board({ phone, place, onToday: 1 }), board({ phone, place, onToday: 1, jetzt: true }), board({ phone, place, onToday: 1, sample: true }),
    ]))
    for (const key of new Set(boards.flatMap((b) => keys(resolveIntroWelcome(b)).flat()))) {
      expect(typeof read(de, key), `de ${key}`).toBe('string')
      expect(typeof read(en, key), `en ${key}`).toBe('string')
    }
  })

  it('every hint and the planning note have a title in both locales', () => {
    for (const id of [...INTRO_HINT_ORDER, INTRO_PLAN_HINT] as const) {
      for (const key of [introHintTitleKey(id), introHintTextKey(id, true), introHintTextKey(id, false)]) {
        expect(typeof read(de, key), `de ${key}`).toBe('string')
        expect(typeof read(en, key), `en ${key}`).toBe('string')
      }
    }
  })
})
