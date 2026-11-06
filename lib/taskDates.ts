/**
 * @module lib/taskDates
 * @description Revives the Date-typed fields of persisted objects (#376).
 *
 * `JSON.stringify` stores a `Date` as an ISO string and nothing converted it back, so a task restored
 * from storage lied about its type until a fetch merge replaced it. The stores call these in `afterHydrate`.
 * Same contract as `lib/taskSources.ts`: pure, idempotent, the input reference comes back when nothing
 * needs to change. Unlike those normalisers this is not a stored-shape change (the storage already holds
 * ISO strings), so reviving never counts as "changed" and never triggers a write (#273).
 * Fields are revived by explicit path, never by name across `custom` (Notion slugs may be `createdAt`).
 */

import { normalizePriority } from '~/lib/priority'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isValidDate = (value: unknown): value is Date => value instanceof Date && !Number.isNaN(value.getTime())

/**
 * A stored date as a `Date`: a `Date` itself, an ISO string or epoch number revived, `null` for
 * nothing (`null`, `undefined`, `''`) and for anything unparsable (never an `Invalid Date`).
 */
export function reviveDate(value: unknown): Date | null {
  if (isValidDate(value)) return value
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  if (import.meta.dev) console.warn('[taskDates] Unparsable date dropped:', value)
  return null
}

/** Copy of `record` with the given fields revived; the record itself when each is a `Date`/`null`/absent already. */
function reviveFields<T>(record: T, fields: readonly string[], fallback?: () => Date): T {
  if (!isRecord(record)) return record
  let next: Record<string, unknown> | null = null
  for (const field of fields) {
    const value = record[field]
    if (value === undefined || value === null || isValidDate(value)) continue
    next ??= { ...record }
    next[field] = reviveDate(value) ?? fallback?.() ?? null
  }
  return (next ?? record) as T
}

const TASK_DATE_FIELDS = ['completedAt', 'createdAt', 'updatedAt', 'archivedAt'] as const

/**
 * Tasks with `completedAt`, `createdAt`, `updatedAt` and `archivedAt` as Dates; an absent field stays absent.
 * Also reads a stored priority above 3 (the former "urgent", #617) as High and a missing, `0` or invalid one
 * as Normal (#653), in memory only: like the dates this is not a stored-shape change, so it never triggers a
 * write (#273); the next save of the task stores the level.
 */
export function reviveTaskDates<T>(tasks: T[]): T[] {
  let changed = false
  const next = tasks.map((task) => {
    let revived = reviveFields(task, TASK_DATE_FIELDS)
    if (isRecord(revived) && normalizePriority(revived.priority) !== revived.priority) {
      revived = { ...revived, priority: normalizePriority(revived.priority) } as T
    }
    if (revived !== task) changed = true
    return revived
  })
  return changed ? next : tasks
}

/** Maps each entry of a record through `revive`; the record itself when no entry changed. */
function reviveEntries<T>(record: Record<string, T>, revive: (entry: T) => T): Record<string, T> {
  let changed = false
  const next: Record<string, T> = {}
  for (const [key, entry] of Object.entries(record)) {
    const revived = revive(entry)
    if (revived !== entry) changed = true
    next[key] = revived
  }
  return changed ? next : record
}

/** Pending deletes whose `task` snapshot (restored on undo) has Dates. */
export function revivePendingDeletes<T>(pending: Record<string, T>): Record<string, T> {
  return reviveEntries(pending, (entry) => {
    if (!isRecord(entry)) return entry
    const [task] = reviveTaskDates([entry.task])
    return task === entry.task ? entry : { ...entry, task }
  })
}

/**
 * Pending time updates with `createdAt` and `lastAttemptAt` as Dates. An unparsable `createdAt` becomes
 * now, so the update is neither dropped as stale nor left without a date.
 */
export function revivePendingTimeUpdates<T>(pending: Record<string, T>): Record<string, T> {
  return reviveEntries(pending, (entry) => {
    if (!isRecord(entry)) return entry
    const revived = reviveFields(entry, ['lastAttemptAt'])
    return reviveFields(revived, ['createdAt'], () => new Date()) as T
  })
}
