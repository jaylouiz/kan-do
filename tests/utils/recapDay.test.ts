import { describe, expect, it } from 'vitest'
import { dayKey, dayMonthName, isRecapDue, isValidDayKey, recapWhen } from '~/utils/recapDay'

describe('dayKey', () => {
  it('is the local calendar day, zero padded', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(dayKey(new Date(2026, 9, 22, 0, 0))).toBe('2026-10-22')
  })
})

describe('isValidDayKey', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(isValidDayKey('2026-10-22')).toBe(true)
    for (const bad of [null, undefined, '', '2026-1-2', '22.10.2026', '2026-10-22T10:00', 20261022]) {
      expect(isValidDayKey(bad)).toBe(false)
    }
  })
})

describe('isRecapDue', () => {
  it('is due when the marker is a day before today', () => {
    expect(isRecapDue('2026-10-21', '2026-10-22')).toBe(true)
    expect(isRecapDue('2025-12-31', '2026-01-01')).toBe(true)
  })

  it('is not due on the same day or when the clock was set back', () => {
    expect(isRecapDue('2026-10-22', '2026-10-22')).toBe(false)
    expect(isRecapDue('2026-10-25', '2026-10-22')).toBe(false)
  })

  it('is never due without a valid marker (baseline case)', () => {
    expect(isRecapDue(null, '2026-10-22')).toBe(false)
    expect(isRecapDue('yesterday', '2026-10-22')).toBe(false)
  })
})

describe('recapWhen', () => {
  const today = new Date(2026, 9, 22) // Thursday
  const back = (days: number, hour = 15) => new Date(2026, 9, 22 - days, hour)

  it('names 0 and 1 day back "yesterday", 2 "dayBefore", 3 to 4 "weekday", 5 and more "date"', () => {
    expect(recapWhen(back(0), today).kind).toBe('yesterday')
    expect(recapWhen(back(1), today).kind).toBe('yesterday')
    expect(recapWhen(back(2), today).kind).toBe('dayBefore')
    expect(recapWhen(back(3), today).kind).toBe('weekday')
    expect(recapWhen(back(4), today).kind).toBe('weekday')
    expect(recapWhen(back(5), today).kind).toBe('date')
    expect(recapWhen(back(40), today).kind).toBe('date')
  })

  it('clamps a completion ahead of the clock to "yesterday"', () => {
    expect(recapWhen(new Date(2026, 9, 24), today).kind).toBe('yesterday')
  })

  it('counts local calendar days, not 24h windows, across a DST change', () => {
    // Europe/Berlin ends DST on 2026-10-25: the day has 25 hours. Sunday late evening to Wednesday early morning is 3 days.
    const wednesday = new Date(2026, 9, 28, 0, 30)
    expect(recapWhen(new Date(2026, 9, 25, 23, 30), wednesday).kind).toBe('weekday')
    expect(recapWhen(new Date(2026, 9, 26, 23, 30), wednesday).kind).toBe('dayBefore')
    expect(recapWhen(new Date(2026, 9, 27, 0, 10), wednesday).kind).toBe('yesterday')
    expect(recapWhen(new Date(2026, 9, 27, 23, 50), wednesday).kind).toBe('yesterday')
  })
})

describe('dayMonthName', () => {
  it('has no year and follows the locale', () => {
    const date = new Date(2026, 9, 14)
    expect(dayMonthName(date, 'de')).toBe('14. Oktober')
    expect(dayMonthName(date, 'en')).toBe('October 14')
  })
})
