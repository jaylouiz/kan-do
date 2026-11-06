import { describe, it, expect } from 'vitest'
import { deriveWorkRhythm, RHYTHM } from '~/lib/workRhythm'
import type { WorkSession } from '~/lib/workSessions'

// Tuesday 3 Nov 2026, 18:00 local
const NOW = new Date(2026, 10, 3, 18, 0, 0)
const at = (daysAgo: number, hour: number, minute = 0) => new Date(2026, 10, 3 - daysAgo, hour, minute).getTime()
const span = (daysAgo: number, from: [number, number?], to: [number, number?]): WorkSession => ({ start: at(daysAgo, from[0], from[1] ?? 0), end: at(daysAgo, to[0], to[1] ?? 0) })

/** Mo 2 Nov to Fr 30 Oct and earlier: one 9:00-12:00 session on each of the last `n` weekdays before today. */
function weekdaySessions(n: number): WorkSession[] {
  const list: WorkSession[] = []
  for (let ago = 1; list.length < n; ago++) {
    const date = new Date(2026, 10, 3 - ago)
    if (date.getDay() === 0 || date.getDay() === 6) continue
    list.push(span(ago, [9], [12]))
  }
  return list.reverse()
}

describe('deriveWorkRhythm (#600)', () => {
  it('is thin with fewer than 5 days with tracked time and counts the days', () => {
    const rhythm = deriveWorkRhythm(weekdaySessions(4), NOW)
    expect(rhythm.state).toBe('thin')
    expect(rhythm.days).toBe(4)
    expect(rhythm.peak).toBeNull()
  })

  it('reads anything that is not a list, and malformed or too-short entries, as no data', () => {
    for (const wrong of [null, undefined, 'x', 3, {}]) expect(deriveWorkRhythm(wrong, NOW)).toMatchObject({ state: 'thin', days: 0 })
    const junk = [null, { start: 5, end: 1 }, { start: at(1, 9), end: at(1, 9) + 10_000 }, ...weekdaySessions(3)]
    expect(deriveWorkRhythm(junk, NOW).days).toBe(3)
  })

  it('a day needs 5 minutes in total to count', () => {
    const sessions = [...weekdaySessions(4), span(0, [9], [9, 4])]
    expect(deriveWorkRhythm(sessions, NOW).state).toBe('thin')
    expect(deriveWorkRhythm([...weekdaySessions(4), span(0, [9], [9, 6])], NOW).state).toBe('normal')
  })

  it('finds the 3-hour peak window with its share, the usual start and end, and the visible hour bars', () => {
    const rhythm = deriveWorkRhythm(weekdaySessions(10), NOW)
    expect(rhythm.state).toBe('normal')
    expect(rhythm.peak).toEqual({ from: 9, to: 12, share: 100 })
    expect(rhythm.start).toEqual({ minutes: 540, scope: 'workdays' })
    expect(rhythm.end).toEqual({ minutes: 720 })
    expect(rhythm.hourSeconds).toHaveLength(RHYTHM.hours)
    expect(rhythm.hourSeconds[9 - RHYTHM.firstHour]).toBeGreaterThan(0)
    expect(rhythm.hourSeconds[13 - RHYTHM.firstHour]).toBe(0)
    expect(rhythm.outsideShare).toBe(0)
  })

  it('reports the share outside the visible hours and keeps it in the peak share denominator', () => {
    const sessions = [...weekdaySessions(10), ...[1, 2, 3, 4, 5].map(ago => span(ago, [23], [23, 59]))]
    const rhythm = deriveWorkRhythm(sessions, NOW)
    expect(rhythm.outsideShare).toBeGreaterThanOrEqual(RHYTHM.outsideNoteShare - 1)
    expect(rhythm.peak!.share).toBeLessThan(100)
  })

  it('splits a session at hour boundaries, and across midnight into two days', () => {
    // 22:30 yesterday to 00:30 today: 90 minutes yesterday (22 h and 23 h) and 30 minutes today (0 h), all outside the grid
    const night: WorkSession = { start: at(1, 22, 30), end: at(0, 0, 30) }
    const rhythm = deriveWorkRhythm([...weekdaySessions(5), night], NOW)
    expect(rhythm.totalSeconds).toBe(5 * 3 * 3600 + 2 * 3600)
    expect(rhythm.outsideShare).toBe(Math.round((2 * 3600 / rhythm.totalSeconds) * 100))
  })

  it('splits correctly on a daylight-saving day (no hour lost or doubled)', () => {
    // 2026-03-29: Europe/Berlin springs forward at 02:00; local Date arithmetic must stay consistent in any zone
    const now = new Date(2026, 2, 30, 20, 0)
    const sessions = Array.from({ length: 6 }, (_, i) => {
      const start = new Date(2026, 2, 24 + i, 8, 0).getTime()
      return { start, end: new Date(2026, 2, 24 + i, 11, 0).getTime() }
    })
    const rhythm = deriveWorkRhythm(sessions, now)
    expect(rhythm.totalSeconds).toBe(6 * 3 * 3600)
  })

  it('uses all days for the start when fewer than 3 weekdays have time', () => {
    // Sat 31 Oct, Sun 1 Oct... build 5 weekend-ish days: weekends only over 4 weeks gives 8 days
    const sessions: WorkSession[] = []
    for (let ago = 1; ago <= 28; ago++) {
      const date = new Date(2026, 10, 3 - ago)
      if (date.getDay() === 6 || date.getDay() === 0) sessions.push(span(ago, [10], [11]))
    }
    const rhythm = deriveWorkRhythm(sessions, NOW)
    expect(rhythm.start).toEqual({ minutes: 600, scope: 'all' })
  })

  it('names the longest weekday only when at least two weekdays have time; ties go to the earlier one', () => {
    const one = Array.from({ length: 6 }, (_, i) => span(7 * (i + 1) - 1, [9], [10])) // 6 Mondays
    expect(deriveWorkRhythm(one, NOW).longestWeekday).toBeNull()
    const sessions = weekdaySessions(15)
    expect(deriveWorkRhythm(sessions, NOW).longestWeekday).toBe(0)
  })

  it('divides by the occurrences of the weekday since the first tracked day, so a young history is not diluted', () => {
    const rhythm = deriveWorkRhythm(weekdaySessions(5), NOW)
    // 5 weekdays back from Tue 3 Nov: Mo 2 Nov, Fr 30, Th 29, We 28, Tu 27 (one week of data, one Monday since the first day)
    expect(rhythm.grid[0]![9 - RHYTHM.firstHour]).toBeCloseTo(60, 5)
  })

  it('ignores sessions outside the 56-day window and future time', () => {
    const old: WorkSession[] = Array.from({ length: 6 }, (_, i) => span(60 + i, [9], [12]))
    expect(deriveWorkRhythm(old, NOW).days).toBe(0)
    const future = deriveWorkRhythm([...weekdaySessions(5), { start: NOW.getTime(), end: NOW.getTime() + 3600_000 }], NOW)
    expect(future.totalSeconds).toBe(5 * 3 * 3600)
  })
})
