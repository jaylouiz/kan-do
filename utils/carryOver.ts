/**
 * @module carryOver
 * @description Pure helpers for the carried-over cue (#99): how many board days a not-done card
 * has stayed on the board, and when the triage nudge is due.
 */

/** Carried days at which the triage nudge appears; Keep re-arms it after the same number of further days. */
export const CARRY_OVER_NUDGE_DAYS = 4

/** Dots shown on a card before the rest collapses into a "+". */
export const CARRY_OVER_DOT_CAP = 6

/** Per-task counter, keyed by task id in the tasks store (never a field on Task: merges would drop it). */
export interface CarryOverEntry {
  /** Local date key (YYYY-MM-DD) of the first board day the task was seen not done. */
  firstOn: string
  /** Board days carried over: days the board was opened after `firstOn` while the task was not done. */
  days: number
  /** Local date key of the last board day that was counted. */
  lastOn: string
  /** `days` at the moment the user chose Keep, or null when never kept. */
  keptAtDays: number | null
}

/**
 * Day number shown to the user (#121): the first board day is day 1 and stays silent, so a stored
 * `days` of 1 reads "Tag 2". The single place that adds 1; every surface maps through here.
 */
export function carryOverDisplayDay(days: number): number {
  return days + 1
}

/** True when the cue shows at all: from day 2 on. */
export function isCarryOverVisible(displayDay: number): boolean {
  return displayDay >= 2
}

/** Local calendar date as YYYY-MM-DD (not UTC: a day ends at the user's midnight). */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Fresh counter for a task first seen on `today`. */
export function createCarryOverEntry(today: string): CarryOverEntry {
  return { firstOn: today, days: 0, lastOn: today, keptAtDays: null }
}

/**
 * Counts one board day when `today` is later than the last counted day.
 * Keys compare lexicographically; a clock set back never counts a day twice.
 */
export function advanceCarryOverEntry(entry: CarryOverEntry, today: string): CarryOverEntry {
  if (today <= entry.lastOn) return entry
  return { ...entry, days: entry.days + 1, lastOn: today }
}

/** True when the triage nudge is due: N >= threshold and, after Keep, threshold further days. */
export function isCarryOverNudgeDue(entry: CarryOverEntry | null | undefined): boolean {
  if (!entry || entry.days < CARRY_OVER_NUDGE_DAYS) return false
  if (entry.keptAtDays === null) return true
  return entry.days - entry.keptAtDays >= CARRY_OVER_NUDGE_DAYS
}
