/**
 * @module lib/doneDay
 * @description The done day a user may give a task that was marked done late (kd#131), in local calendar days.
 *
 * Limits: never a future day, never before the day the task was created (when a creation time exists).
 * The stored value keeps the time of day of the completion it replaces, so the order inside Erledigt
 * ("sort by completed") and the time-of-day statistics stay as close to the user's own gesture as the day
 * allows; it is clamped into `[createdAt, now]`, so a corrected time is never ahead of the clock or before
 * the task existed. Pure: callers pass `now`.
 */
import type { Task } from '~/types/task'
import { dayKey, isValidDayKey } from '~/utils/recapDay'

export interface DoneDayBounds {
  /** Earliest allowed day (`YYYY-MM-DD`); null when the task has no creation time */
  min: string | null
  /** Latest allowed day: today */
  max: string
}

const validDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The days a task's done day may be set to. A creation time ahead of the clock (clock skew) does not close the range. */
export function doneDayBounds(task: Pick<Task, 'createdAt'>, now: Date): DoneDayBounds {
  const max = dayKey(now)
  const created = validDate(task.createdAt)
  const min = created ? dayKey(created) : null
  return { min: min !== null && min > max ? max : min, max }
}

/**
 * The completion time for `day` (`YYYY-MM-DD`, local): that day at the time of day of the task's current
 * completion (now's time of day when it has none), clamped into `[createdAt, now]`.
 * @returns null when `day` is malformed, not a real calendar day or outside `doneDayBounds`
 */
export function completedAtForDay(task: Pick<Task, 'completedAt' | 'createdAt'>, day: string, now: Date): Date | null {
  if (!isValidDayKey(day)) return null
  const bounds = doneDayBounds(task, now)
  if (day > bounds.max || (bounds.min !== null && day < bounds.min)) return null

  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const clock = validDate(task.completedAt) ?? now
  const at = new Date(year, month - 1, date, clock.getHours(), clock.getMinutes(), clock.getSeconds(), clock.getMilliseconds())
  // "2026-02-31" has the shape of a day key but rolls over into March
  if (dayKey(at) !== day) return null

  const created = validDate(task.createdAt)
  if (at.getTime() > now.getTime()) return new Date(now)
  if (created && at.getTime() < created.getTime() && created.getTime() <= now.getTime()) return new Date(created)
  return at
}
