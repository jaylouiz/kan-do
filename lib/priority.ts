/**
 * @module priority
 * @description The three priority levels of kan-do (#617) and every mapping from and to them.
 * There is no "none" (#653): a task without a priority (a stored `0`, `null`, a missing or invalid value, an empty
 * upstream select) reads as Normal. A stored `4` (the former "urgent") reads as High. Both are backward-compatible
 * reads, nothing rewrites stored or upstream data by itself.
 * Notion: several select options per level, the first one is written back. Todoist: a fixed table
 * (no connect UI yet, so nothing to configure).
 */
import type { LegacyNotionPriorityMapping, NotionPriorityMapping } from '~/types/notion'

export const LOW = 1
export const REGULAR = 2
export const HIGH = 3

/** What a task without a priority (and a source that holds none) gets (#653). */
export const DEFAULT_PRIORITY = REGULAR

/** The levels a user can pick, lowest first. */
export const PRIORITY_LEVELS = [LOW, REGULAR, HIGH] as const

/** Clamps any stored or fetched value to 1, 2 or 3; a missing, `0` or invalid value is Normal, the former 4 (and above) is High. */
export function normalizePriority(value: unknown): number {
  const n = value === null || value === undefined || value === '' ? NaN : Number(value)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PRIORITY
  return Math.min(Math.floor(n), HIGH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function names(value: unknown): string[] {
  const list = Array.isArray(value) ? value : []
  const seen: string[] = []
  for (const item of list) {
    const name = typeof item === 'string' ? item.trim() : ''
    if (name && !seen.includes(name)) seen.push(name)
  }
  return seen
}

/**
 * Reads a stored Notion priority mapping in either shape. The legacy `{ urgent, high, medium, low }`
 * becomes `high: [high, urgent]` (the former High name stays the one written back), `regular: [medium]`,
 * `low: [low]`. Returns `undefined` when nothing usable is stored.
 */
export function normalizePriorityMapping(raw: unknown): NotionPriorityMapping | undefined {
  if (!isRecord(raw)) return undefined
  if ('urgent' in raw || typeof raw.high === 'string' || typeof raw.medium === 'string' || typeof raw.low === 'string') {
    const legacy = raw as unknown as Partial<LegacyNotionPriorityMapping>
    return {
      high: names([legacy.high, legacy.urgent]),
      regular: names([legacy.medium]),
      low: names([legacy.low]),
    }
  }
  if (!('high' in raw) && !('regular' in raw) && !('low' in raw)) return undefined
  return { high: names(raw.high), regular: names(raw.regular), low: names(raw.low) }
}

/** Whether two mappings list the same options per level in the same order (the first one is what gets written back). */
export function samePriorityMapping(a: NotionPriorityMapping | undefined, b: NotionPriorityMapping | undefined): boolean {
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((value, index) => value === y[index])
  const empty: NotionPriorityMapping = { high: [], regular: [], low: [] }
  const left = a ?? empty
  const right = b ?? empty
  return same(left.high, right.high) && same(left.regular, right.regular) && same(left.low, right.low)
}

/** Name defaults for a select option no mapping lists (a board set up before mappings, or a new option). */
function levelFromName(lower: string): number {
  if (['urgent', 'dringend', 'high', 'hoch'].includes(lower)) return HIGH
  if (['medium', 'mittel', 'normal', 'regular'].includes(lower)) return REGULAR
  return LOW
}

/** The level of a Notion select option: listed options win (the higher level if listed twice), else name defaults, else Low; an empty select is Normal (#653). */
export function notionNameToPriority(name: string | null | undefined, mapping: NotionPriorityMapping | undefined): number {
  const lower = name?.trim().toLowerCase()
  if (!lower) return DEFAULT_PRIORITY
  const has = (list: string[]) => list.some((entry) => entry.toLowerCase() === lower)
  if (mapping) {
    if (has(mapping.high)) return HIGH
    if (has(mapping.regular)) return REGULAR
    if (has(mapping.low)) return LOW
  }
  return levelFromName(lower)
}

/** The select option to write for a level: the first of its list; an empty list falls back (regular → low → high, low → regular → high). */
export function priorityToNotionName(priority: number, mapping: NotionPriorityMapping | undefined): string {
  const level = normalizePriority(priority)
  if (!mapping) return level === HIGH ? 'High' : level === REGULAR ? 'Medium' : 'Low'
  const first = (list: string[]) => list[0]
  if (level === HIGH) return first(mapping.high) ?? first(mapping.regular) ?? first(mapping.low) ?? ''
  if (level === REGULAR) return first(mapping.regular) ?? first(mapping.low) ?? first(mapping.high) ?? ''
  return first(mapping.low) ?? first(mapping.regular) ?? first(mapping.high) ?? ''
}

/** Todoist's API priority (1 normal … 4 = p1) as a level: 1 low, 2 regular, 3 and 4 high; none given is Normal, anything else Low. */
export function todoistToPriority(api: number | null | undefined): number {
  if (api === null || api === undefined) return DEFAULT_PRIORITY
  if (api === 2) return REGULAR
  if (api === 3 || api === 4) return HIGH
  return LOW
}

/** The Todoist API priority to write for a level: low 1, regular 2, high 4. */
export function priorityToTodoist(priority: number): 1 | 2 | 4 {
  const level = normalizePriority(priority)
  return level === HIGH ? 4 : level === REGULAR ? 2 : 1
}
