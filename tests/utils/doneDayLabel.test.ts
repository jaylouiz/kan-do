import { describe, expect, it } from 'vitest'
import { doneDayLabel, newestCompletedAt, weekdayName } from '~/utils/doneDayLabel'

// Local-time constructors on purpose: the rule is about the user's calendar days.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min)

describe('doneDayLabel', () => {
  // 2026-10-22 is a Thursday
  const thursday = at(2026, 10, 22, 9)

  it('previous calendar day is "yesterday"', () => {
    expect(doneDayLabel(at(2026, 10, 21, 16), thursday)).toEqual({ kind: 'yesterday' })
  })

  it('across midnight: 23:59 yesterday vs 00:01 today', () => {
    expect(doneDayLabel(at(2026, 10, 21, 23, 59), at(2026, 10, 22, 0, 1))).toEqual({ kind: 'yesterday' })
    expect(doneDayLabel(at(2026, 10, 21, 0, 0), at(2026, 10, 22, 23, 59))).toEqual({ kind: 'yesterday' })
  })

  it('across a weekend: Monday morning with Friday tasks gives the weekday', () => {
    const monday = at(2026, 10, 26, 8)
    const friday = at(2026, 10, 23, 17)
    expect(doneDayLabel(friday, monday)).toEqual({ kind: 'weekday', date: friday })
  })

  it('2 to 6 days ago gives the weekday', () => {
    expect(doneDayLabel(at(2026, 10, 20), thursday).kind).toBe('weekday')
    expect(doneDayLabel(at(2026, 10, 16), thursday).kind).toBe('weekday')
  })

  it('7 or more days ago is "recent"', () => {
    expect(doneDayLabel(at(2026, 10, 15), thursday)).toEqual({ kind: 'recent' })
    expect(doneDayLabel(at(2026, 9, 1), thursday)).toEqual({ kind: 'recent' })
  })

  it('stays correct across a DST change (EU 2026-10-25)', () => {
    expect(doneDayLabel(at(2026, 10, 24, 22), at(2026, 10, 25, 7))).toEqual({ kind: 'yesterday' })
    expect(doneDayLabel(at(2026, 10, 24, 22), at(2026, 10, 26, 7)).kind).toBe('weekday')
  })

  it('no timestamp falls back to "recent"', () => {
    expect(doneDayLabel(null, thursday)).toEqual({ kind: 'recent' })
  })

  it('a completedAt ahead of the device clock is clamped to "yesterday" (distance <= 1)', () => {
    expect(doneDayLabel(at(2026, 10, 23), thursday)).toEqual({ kind: 'yesterday' })
    expect(doneDayLabel(at(2026, 12, 1), thursday)).toEqual({ kind: 'yesterday' })
  })

  it('years 0-99 are not mapped to 1900+ (Date.UTC quirk)', () => {
    const ancient = new Date(2026, 0, 1)
    ancient.setFullYear(50)
    expect(doneDayLabel(ancient, thursday)).toEqual({ kind: 'recent' })
  })
})

describe('newestCompletedAt', () => {
  it('picks the newest and accepts strings', () => {
    const newest = newestCompletedAt([
      { completedAt: at(2026, 10, 20) },
      { completedAt: at(2026, 10, 21).toISOString() as unknown as Date },
      { completedAt: null },
    ])
    expect(newest?.getTime()).toBe(at(2026, 10, 21).getTime())
  })
  it('returns null without timestamps', () => {
    expect(newestCompletedAt([{ completedAt: null }])).toBeNull()
    expect(newestCompletedAt([])).toBeNull()
  })
})

describe('weekdayName', () => {
  it('uses the locale', () => {
    const friday = at(2026, 10, 23)
    expect(weekdayName(friday, 'de')).toBe('Freitag')
    expect(weekdayName(friday, 'en')).toBe('Friday')
  })
})
