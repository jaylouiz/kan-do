/**
 * @module lib/workRhythm
 * @description The "Wann arbeite ich?" figures of the Statistik page (#600), derived from the work sessions of the
 * last 56 days: hour totals, a weekday x hour grid of average minutes, the 3-hour window with most time, the usual
 * start and end of a day and the weekday with the most time. Pure; `now` is passed in. Sessions are split at local
 * hour and midnight boundaries with `Date` (DST-safe); a session belongs to the day it started for start / end.
 */
import { addDays, median, startOfDay } from '~/lib/statisticsReview'
import { dayKey } from '~/utils/recapDay'
import { isMeaningfulSession, isWorkSession, type WorkSession } from '~/lib/workSessions'

export const RHYTHM = {
  /** Window in calendar days, today included (8 weeks). */
  windowDays: 56,
  /** A day counts as "with tracked time" from this many minutes. */
  minDayMinutes: 5,
  /** The tile shows figures from this many such days. */
  minDays: 5,
  /** First visible hour and number of visible hours (6:00 to 22:00). */
  firstHour: 6,
  hours: 16,
  /** Length of the peak window in hours. */
  peakHours: 3,
  /** The outside-window clause appears from this share of the tracked time (percent). */
  outsideNoteShare: 10,
  /** Start and end use Monday to Friday only from this many such days. */
  minWorkdays: 3,
  /** The longest weekday needs time on at least this many weekdays. */
  minWeekdays: 2,
} as const

export type RhythmState = 'thin' | 'normal'

export interface WorkRhythm {
  state: RhythmState
  /** Days with tracked time in the window. */
  days: number
  /** Tracked seconds in the window, all hours. */
  totalSeconds: number
  /** Seconds per visible hour over the window (the bars). */
  hourSeconds: number[]
  /** Average minutes per weekday (Monday first) and visible hour. */
  grid: number[][]
  gridMax: number
  /** The 3 consecutive visible hours with most time; `to` is exclusive. */
  peak: { from: number; to: number; share: number } | null
  /** Share of the tracked time before the first or after the last visible hour (percent, rounded). */
  outsideShare: number
  /** Median start of the day in minutes after local midnight; `scope` says which days were used. */
  start: { minutes: number; scope: 'workdays' | 'all' } | null
  /** Median end of the day in minutes after local midnight of the start day (can pass 1440). */
  end: { minutes: number } | null
  /** Weekday (0 = Monday) with the largest average total. */
  longestWeekday: number | null
}

const weekdayOf = (date: Date): number => (date.getDay() + 6) % 7

function empty(state: RhythmState, days: number): WorkRhythm {
  return {
    state,
    days,
    totalSeconds: 0,
    hourSeconds: Array.from({ length: RHYTHM.hours }, () => 0),
    grid: Array.from({ length: 7 }, () => Array.from({ length: RHYTHM.hours }, () => 0)),
    gridMax: 0,
    peak: null,
    outsideShare: 0,
    start: null,
    end: null,
    longestWeekday: null,
  }
}

/** @param sessions the stored list (malformed entries are skipped) @param now the moment "today" is read from */
export function deriveWorkRhythm(sessions: unknown, now: Date): WorkRhythm {
  const today = startOfDay(now)
  const windowStart = addDays(today, -(RHYTHM.windowDays - 1)).getTime()
  const windowEnd = now.getTime()

  // seconds per weekday and hour (all 24), per day, and first / last per day
  const byWeekdayHour = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  const dayTotals = new Map<string, number>()
  const dayBounds = new Map<string, { first: number; last: number; dayStart: number; weekday: number }>()
  let firstDay: Date | null = null

  const list = Array.isArray(sessions) ? sessions.filter(isWorkSession).filter(isMeaningfulSession) : []
  for (const session of list as WorkSession[]) {
    const from = Math.max(session.start, windowStart)
    const to = Math.min(session.end, windowEnd)
    if (to <= from) continue
    let cursor = new Date(from)
    while (cursor.getTime() < to) {
      let boundary = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), cursor.getHours() + 1)
      if (boundary.getTime() <= cursor.getTime()) boundary = new Date(cursor.getTime() + 3_600_000)
      const segmentEnd = Math.min(boundary.getTime(), to)
      const seconds = (segmentEnd - cursor.getTime()) / 1000
      byWeekdayHour[weekdayOf(cursor)]![cursor.getHours()]! += seconds
      const key = dayKey(cursor)
      dayTotals.set(key, (dayTotals.get(key) ?? 0) + seconds)
      cursor = new Date(segmentEnd)
    }
    // start / end belong to the day the session began (the clipped start inside the window)
    const startDate = new Date(from)
    const key = dayKey(startDate)
    const dayStart = startOfDay(startDate)
    const bounds = dayBounds.get(key)
    if (!bounds) dayBounds.set(key, { first: from, last: to, dayStart: dayStart.getTime(), weekday: weekdayOf(startDate) })
    else {
      bounds.first = Math.min(bounds.first, from)
      bounds.last = Math.max(bounds.last, to)
    }
    if (!firstDay || dayStart.getTime() < firstDay.getTime()) firstDay = dayStart
  }

  const qualified = [...dayTotals.entries()].filter(([, seconds]) => seconds >= RHYTHM.minDayMinutes * 60).map(([key]) => key)
  if (qualified.length < RHYTHM.minDays) return empty('thin', qualified.length)

  // Occurrences of each weekday from the first tracked day to today, at most one per week of the window
  const from = firstDay ?? addDays(today, -(RHYTHM.windowDays - 1))
  const occurrences = Array.from({ length: 7 }, () => 0)
  for (let day = from; day.getTime() <= today.getTime(); day = addDays(day, 1)) occurrences[weekdayOf(day)]! += 1

  const grid = byWeekdayHour.map((row, weekday) =>
    Array.from({ length: RHYTHM.hours }, (_, index) => row[RHYTHM.firstHour + index]! / 60 / Math.max(occurrences[weekday]!, 1)))
  const gridMax = Math.max(...grid.flat())
  const hourSeconds = Array.from({ length: RHYTHM.hours }, (_, index) => byWeekdayHour.reduce((sum, row) => sum + row[RHYTHM.firstHour + index]!, 0))
  const totalSeconds = byWeekdayHour.flat().reduce((sum, value) => sum + value, 0)
  const visibleSeconds = hourSeconds.reduce((sum, value) => sum + value, 0)

  let peak: WorkRhythm['peak'] = null
  let best = -1
  for (let index = 0; index + RHYTHM.peakHours <= RHYTHM.hours; index++) {
    const sum = hourSeconds.slice(index, index + RHYTHM.peakHours).reduce((a, b) => a + b, 0)
    if (sum > best) {
      best = sum
      peak = { from: RHYTHM.firstHour + index, to: RHYTHM.firstHour + index + RHYTHM.peakHours, share: Math.round((sum / totalSeconds) * 100) }
    }
  }

  const days = qualified.map(key => dayBounds.get(key)).filter((bounds): bounds is NonNullable<typeof bounds> => bounds !== undefined)
  const workdays = days.filter(bounds => bounds.weekday < 5)
  const useWorkdays = workdays.length >= RHYTHM.minWorkdays
  const used = useWorkdays ? workdays : days
  const startMinutes = median(used.map(bounds => (bounds.first - bounds.dayStart) / 60_000))
  const endMinutes = median(used.map(bounds => (bounds.last - bounds.dayStart) / 60_000))

  const averages = byWeekdayHour.map((row, weekday) => row.reduce((a, b) => a + b, 0) / Math.max(occurrences[weekday]!, 1))
  const withTime = averages.filter(value => value > 0).length
  const longest = withTime >= RHYTHM.minWeekdays ? averages.indexOf(Math.max(...averages)) : -1

  return {
    state: 'normal',
    days: qualified.length,
    totalSeconds,
    hourSeconds,
    grid,
    gridMax,
    peak,
    outsideShare: Math.round(((totalSeconds - visibleSeconds) / totalSeconds) * 100),
    start: startMinutes === null ? null : { minutes: Math.round(startMinutes), scope: useWorkdays ? 'workdays' : 'all' },
    end: endMinutes === null ? null : { minutes: Math.round(endMinutes) },
    longestWeekday: longest >= 0 ? longest : null,
  }
}
