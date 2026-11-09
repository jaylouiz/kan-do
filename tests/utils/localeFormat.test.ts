import { describe, expect, it } from 'vitest'
import {
  compareText,
  createTranslate,
  formatDateTime,
  formatDuration,
  formatDurationParts,
  formatMinutesAgo,
  formatNumber,
  type DurationStyle,
} from '~/utils/localeFormat'
import { createTestI18n } from '../helpers/i18n'

const tDe = createTranslate(createTestI18n('de').global.t)
const tEn = createTranslate(createTestI18n('en').global.t)

const SECONDS = [0, 1, 45, 59, 60, 61, 3599, 3600, 5400, 86400]

// Expected values were captured from the pre-refactor implementations (German UI).
const GERMAN: Record<DurationStyle, string[]> = {
  spaced: ['0 min', '1s', '45s', '59s', '1 min', '1 min 1s', '59 min 59s', '1 h', '1 h 30 min', '24 h'],
  compact: ['0s', '1s', '45s', '59s', '1min', '1min', '60min', '1h', '1h 30min', '24h'],
  clock: ['0 min', '0 min', '0 min', '0 min', '1 min', '1 min', '59 min', '1 h', '1:30 h', '24:00 h'],
  clockRounded: ['0 min', '0 min', '1 min', '1 min', '1 min', '1 min', '1 h', '1 h', '1:30 h', '24:00 h'],
  clockShort: ['0 min', '0 min', '1 min', '1 min', '1 min', '1 min', '1 h', '1 h', '1:30 h', '24 h'],
}

describe('formatDuration (de, byte-identical to previous formatters)', () => {
  for (const style of Object.keys(GERMAN) as DurationStyle[]) {
    it(`style "${style}"`, () => {
      expect(SECONDS.map((s) => formatDuration(s, style, tDe))).toEqual(GERMAN[style])
    })
  }

  it('spaced style treats null, undefined and negative values as zero', () => {
    expect(formatDuration(null, 'spaced', tDe)).toBe('0 min')
    expect(formatDuration(undefined, 'spaced', tDe)).toBe('0 min')
    expect(formatDuration(-10, 'spaced', tDe)).toBe('0 min')
  })

  it('keeps the quirks of the individual shapes', () => {
    expect(formatDuration(150, 'spaced', tDe)).toBe('2 min 30s')
    expect(formatDuration(150, 'compact', tDe)).toBe('3min')
    expect(formatDuration(7200, 'clock', tDe)).toBe('2:00 h')
    expect(formatDuration(7200, 'clockShort', tDe)).toBe('2 h')
    expect(formatDuration(5430, 'clockRounded', tDe)).toBe('1:31 h')
  })

  it('english uses the same unit symbols', () => {
    expect(formatDuration(5400, 'spaced', tEn)).toBe('1 h 30 min')
    expect(formatDuration(5400, 'compact', tEn)).toBe('1h 30min')
    expect(formatDuration(45, 'spaced', tEn)).toBe('45s')
  })
})

describe('formatDurationParts', () => {
  it('splits value and unit without string surgery', () => {
    expect(formatDurationParts(5400, 'clockShort', tDe)).toEqual({ value: '1:30', unit: 'h' })
    expect(formatDurationParts(7200, 'clockShort', tDe)).toEqual({ value: '2', unit: 'h' })
    expect(formatDurationParts(2700, 'clockShort', tDe)).toEqual({ value: '45', unit: 'min' })
  })
})

describe('remaining / spent labels', () => {
  it('german wording', () => {
    expect(tDe('duration.spentOfTotal', { spent: '30 min', total: '1 h' })).toBe('30 min von 1 h')
  })

  it('english wording', () => {
    expect(tEn('duration.spentOfTotal', { spent: '30 min', total: '1 h' })).toBe('30 min of 1 h')
  })
})

describe('formatMinutesAgo', () => {
  it('german', () => {
    expect(formatMinutesAgo(null, tDe)).toBe('Noch nicht aktualisiert')
    expect(formatMinutesAgo(0, tDe)).toBe('Gerade aktualisiert')
    expect(formatMinutesAgo(1, tDe)).toBe('Vor 1 Minute aktualisiert')
    expect(formatMinutesAgo(5, tDe)).toBe('Vor 5 Minuten aktualisiert')
  })

  it('english', () => {
    expect(formatMinutesAgo(null, tEn)).toBe('Not updated yet')
    expect(formatMinutesAgo(0, tEn)).toBe('Just updated')
    expect(formatMinutesAgo(1, tEn)).toBe('Updated 1 minute ago')
    expect(formatMinutesAgo(5, tEn)).toBe('Updated 5 minutes ago')
  })
})

describe('plural messages', () => {
  it('german: 0 and many use the plural branch, 1 the singular', () => {
    expect(tDe('statistics.taskCount', { n: 0 }, 0)).toBe('0 Aufgaben')
    expect(tDe('statistics.taskCount', { n: 1 }, 1)).toBe('1 Aufgabe')
    expect(tDe('statistics.taskCount', { n: 2 }, 2)).toBe('2 Aufgaben')
  })

  it('english', () => {
    expect(tEn('statistics.taskCount', { n: 0 }, 0)).toBe('0 tasks')
    expect(tEn('statistics.taskCount', { n: 1 }, 1)).toBe('1 task')
  })
})

describe('formatDateTime', () => {
  const instant = new Date('2024-03-05T14:07:09Z')

  it('german presets match the previous de-DE output', () => {
    expect(formatDateTime(instant, 'de', 'dayMonthYearTime', 'UTC')).toBe('05.03.2024, 14:07')
    expect(formatDateTime(instant, 'de', 'dayMonth', 'UTC')).toBe('05.03.')
    expect(formatDateTime(instant, 'de', 'dayMonthYear', 'UTC')).toBe('05.03.2024')
    expect(formatDateTime(instant, 'de', 'mediumDateShortTime', 'UTC')).toBe('05.03.2024, 14:07')
    expect(formatDateTime(instant, 'de', 'longDateUtc')).toBe('5. März 2024')
    expect(formatDateTime(instant, 'de', 'shortDateShortTime', 'UTC')).toBe('05.03.24, 14:07')
  })

  it('accepts ISO strings and timestamps', () => {
    expect(formatDateTime('2024-03-05T14:07:09Z', 'de', 'dayMonthYear', 'UTC')).toBe('05.03.2024')
    expect(formatDateTime(instant.getTime(), 'de', 'dayMonthYear', 'UTC')).toBe('05.03.2024')
  })

  it('english differs from german', () => {
    expect(formatDateTime(instant, 'en', 'longDateUtc')).toBe('March 5, 2024')
  })

  it('returns "Invalid Date" like toLocale*String for unparsable input', () => {
    expect(formatDateTime('nope', 'de', 'dayMonthYear')).toBe('Invalid Date')
  })
})

describe('formatNumber', () => {
  it('german grouping and decimal separators', () => {
    expect(formatNumber(1234567.89, 'de')).toBe('1.234.567,89')
  })
  it('english', () => {
    expect(formatNumber(1234567.89, 'en')).toBe('1,234,567.89')
  })
})

describe('compareText', () => {
  it('sorts with the locale collation', () => {
    expect(['Zebra', 'Äpfel', 'Apfel'].sort((a, b) => compareText(a, b, 'de'))).toEqual(['Apfel', 'Äpfel', 'Zebra'])
    expect(compareText('a', 'b', 'en')).toBeLessThan(0)
  })
})
