/**
 * @module lib/trash
 * @description Pure helpers of the trash (#422): retention, the Heute / Gestern / Früher grouping and the
 * "Gelöscht vor …" parts. No store, no i18n: the callers translate.
 */
import type { TrashEntry } from '~/types/trash'

/** Entries older than this are purged (fixed, no setting; #422 D3). */
export const TRASH_RETENTION_DAYS = 30
/** The trash keeps at most this many entries, the newest. */
export const TRASH_MAX_ENTRIES = 100
/** How many entries the trash sheet shows. */
export const TRASH_SHEET_LIMIT = 3

const DAY_MS = 86_400_000

/**
 * The entries that survive retention and the cap, newest first (input order is not trusted: a hand-edited
 * file or an import may hold any order). Returns the input array itself when nothing was purged and the order
 * already was newest first, so a hydrate can tell whether it must write (#273).
 */
export function pruneTrash(entries: TrashEntry[], now: number): TrashEntry[] {
  const oldest = now - TRASH_RETENTION_DAYS * DAY_MS
  const valid = entries.filter(entry => Number.isFinite(entry?.deletedAt) && entry.deletedAt >= oldest)
  const sorted = valid.every((entry, index) => index === 0 || (valid[index - 1]?.deletedAt ?? 0) >= entry.deletedAt)
    ? valid
    : [...valid].sort((a, b) => b.deletedAt - a.deletedAt)
  const capped = sorted.length > TRASH_MAX_ENTRIES ? sorted.slice(0, TRASH_MAX_ENTRIES) : sorted
  return capped.length === entries.length && capped.every((entry, index) => entry === entries[index]) ? entries : capped
}

export type TrashDayGroup = 'today' | 'yesterday' | 'earlier'

/** Which day bucket a deletion falls in, by local calendar day. */
export function trashDayGroup(deletedAt: number, now: number): TrashDayGroup {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (deletedAt >= startOfToday) return 'today'
  const startOfYesterday = new Date(startOfToday - DAY_MS / 2).setHours(0, 0, 0, 0)
  return deletedAt >= startOfYesterday ? 'yesterday' : 'earlier'
}

/** The entries split into non-empty day groups, in display order, each keeping the newest-first order. */
export function groupTrashByDay(entries: TrashEntry[], now: number): Array<{ group: TrashDayGroup; entries: TrashEntry[] }> {
  const buckets: Record<TrashDayGroup, TrashEntry[]> = { today: [], yesterday: [], earlier: [] }
  for (const entry of entries) buckets[trashDayGroup(entry.deletedAt, now)].push(entry)
  return (['today', 'yesterday', 'earlier'] as const)
    .filter(group => buckets[group].length > 0)
    .map(group => ({ group, entries: buckets[group] }))
}

export type TrashAgo = { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; n: number }

/** How long ago an entry was deleted, rounded down to minutes, hours or days ("now" below a minute). */
export function trashAgo(deletedAt: number, now: number): TrashAgo {
  const minutes = Math.max(0, Math.floor((now - deletedAt) / 60_000))
  if (minutes < 1) return { unit: 'now' }
  if (minutes < 60) return { unit: 'minutes', n: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hours', n: hours }
  return { unit: 'days', n: Math.floor(hours / 24) }
}
