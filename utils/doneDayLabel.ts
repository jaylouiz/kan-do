/**
 * @module doneDayLabel
 * @description Honest day label for the "yesterday" note in the Done column. Based on the newest
 * `completedAt` of the group, compared in local calendar days (never 24h windows, so midnight and
 * DST changes stay correct).
 */
import type { AppLocale } from '~/utils/localeResolution'

export type DoneDayLabel =
  | { kind: 'yesterday' }
  | { kind: 'weekday'; date: Date }
  | { kind: 'recent' }

/** Weekday names are used for 2..6 days ago; older groups read "recently". */
const MAX_WEEKDAY_DISTANCE = 6

/** Local calendar-day number (days since epoch in local time), DST safe. */
export function dayNumber(date: Date): number {
  // setUTCFullYear: Date.UTC maps years 0-99 to 1900-1999
  const utc = new Date(0)
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.floor(utc.getTime() / 86_400_000)
}

/**
 * Classifies the newest completion day relative to `now`.
 * No timestamp yields `recent`. A timestamp ahead of the device clock (clock skew) is clamped:
 * a distance of 1 or less reads as `yesterday`.
 */
export function doneDayLabel(newest: Date | null, now: Date): DoneDayLabel {
  if (!newest) return { kind: 'recent' }
  const distance = dayNumber(now) - dayNumber(newest)
  if (distance <= 1) return { kind: 'yesterday' }
  if (distance >= 2 && distance <= MAX_WEEKDAY_DISTANCE) return { kind: 'weekday', date: newest }
  return { kind: 'recent' }
}

/** Newest valid `completedAt` of the tasks, or null. */
export function newestCompletedAt(tasks: ReadonlyArray<{ completedAt?: Date | string | null }>): Date | null {
  let newest: Date | null = null
  for (const task of tasks) {
    if (!task.completedAt) continue
    const date = new Date(task.completedAt)
    if (Number.isNaN(date.getTime())) continue
    if (!newest || date > newest) newest = date
  }
  return newest
}

/** Long weekday name in the UI locale ("Freitag" / "Friday"). */
export function weekdayName(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
}
