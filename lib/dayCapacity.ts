/**
 * @module lib/dayCapacity
 * @description How much of the day the Offen list uses up (#132). Planned time is the remaining time box of a card
 * (a card without a box counts as `UNBOXED_MINUTES`); the day's capacity is the typical tracked day of the last 8 weeks
 * (learned from `taskStatistics.workSessions`, today excluded) minus what was tracked today, with a default while there
 * is too little history. `capacityLineAfter` finds the list item after which Jetzt, Wartet and the Offen cards so far
 * fill that capacity. Pure: `now` is passed in, nothing is stored.
 */
import { addDays, startOfDay } from '~/lib/statisticsReview'
import { deriveWorkRhythm } from '~/lib/workRhythm'
import { isMeaningfulSession, isWorkSession } from '~/lib/workSessions'
import type { ColumnItem } from '~/types/columnItem'
import type { Task } from '~/types/task'

/** A card without a time box counts this long (minutes). */
export const UNBOXED_MINUTES = 30

/** The day length in minutes: used while the history is too thin, and the bounds of a learned value. */
export const DAY_MINUTES = { fallback: 360, min: 120, max: 600 } as const

type Timed = Pick<Task, 'timeBoxSeconds' | 'timeSpentSeconds'>

/** Minutes a card still needs: its box minus the time spent, never below 0; no box counts as 30 minutes. */
export function taskMinutes(task: Timed): number {
  if (!task.timeBoxSeconds || task.timeBoxSeconds <= 0) return UNBOXED_MINUTES
  return Math.max(task.timeBoxSeconds - (task.timeSpentSeconds || 0), 0) / 60
}

/** Minutes the given cards still need. */
export const plannedMinutes = (tasks: readonly Timed[]): number => tasks.reduce((sum, task) => sum + taskMinutes(task), 0)

/** Minutes of tracked work sessions that fall into today (up to `now`). */
export function workedTodayMinutes(sessions: unknown, now: Date): number {
  const dayStart = startOfDay(now).getTime()
  const dayEnd = addDays(startOfDay(now), 1).getTime()
  const list = Array.isArray(sessions) ? sessions.filter(isWorkSession).filter(isMeaningfulSession) : []
  const ms = list.reduce((sum, session) => sum + Math.max(Math.min(session.end, now.getTime(), dayEnd) - Math.max(session.start, dayStart), 0), 0)
  return Math.round(ms / 60_000)
}

/**
 * The usual tracked minutes per day: the average over the days with tracked time in the last 8 weeks, today left out
 * (a half day would pull it down), at least 5 such days, clamped to 2-10 hours. Fewer days: the default.
 */
export function learnedDayMinutes(sessions: unknown, now: Date): number {
  const dayStart = startOfDay(now).getTime()
  const earlier = Array.isArray(sessions) ? sessions.filter(isWorkSession).filter(session => session.end < dayStart) : []
  const rhythm = deriveWorkRhythm(earlier, now)
  if (rhythm.state !== 'normal' || rhythm.days === 0) return DAY_MINUTES.fallback
  const average = rhythm.totalSeconds / rhythm.days / 60
  return Math.min(Math.max(Math.round(average), DAY_MINUTES.min), DAY_MINUTES.max)
}

/** What is left of the day: the learned day minus today's tracked work, never below 0. */
export const remainingDayMinutes = (sessions: unknown, now: Date): number =>
  Math.max(learnedDayMinutes(sessions, now) - workedTodayMinutes(sessions, now), 0)

type LineItem = Pick<ColumnItem, 'kind' | 'key'> & { task?: Timed; tasks?: readonly Timed[] }

/**
 * The key of the list item after which the day is full, or null when it fits. `usedMinutes` is what Jetzt and Wartet
 * need; the Offen items are added in order, and the line sits after the first item that reaches `capacityMinutes`
 * (exactly full counts). A collapsed stack counts as a whole, an expanded one is a list of cards, so the line can sit
 * between its members; gaps and stack headers carry no time.
 */
export function capacityLineAfter(
  items: readonly LineItem[],
  { usedMinutes, capacityMinutes }: { usedMinutes: number; capacityMinutes: number },
): string | null {
  let sum = usedMinutes
  for (const item of items) {
    const cards = item.kind === 'stack' ? item.tasks ?? [] : item.kind === 'card' && item.task ? [item.task] : []
    if (cards.length === 0) continue
    sum += plannedMinutes(cards)
    if (sum >= capacityMinutes) return item.key
  }
  return null
}
