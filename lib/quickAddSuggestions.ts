/**
 * @module quickAddSuggestions
 * @description Pure suggestion logic of the guided new-card flow (#649, #16): which values a step offers as pills and
 * which stay behind "all options" (Thema and Aktivität: three pills and the Mehr cell with a search and "Neu", Timebox: two pills and "···"). No Pinia here, so the rules are testable on their own; `NewCardFlow` feeds
 * it the tasks and the option pools.
 *
 * Rule: a value is ranked by how often tasks use it (ties keep the pool's order), values that no task uses follow
 * from the pool. Activities rank within the chosen topic first. Timebox: the history-based suggestion first (when
 * there is one), then the presets 15, 30 and 60 min; the full list is the presets 15, 30, 45, 60, 90, 120.
 */

/** Pills shown on the Timebox step; everything else sits behind "all options" */
export const SUGGESTION_COUNT = 2

/** Pills shown on Thema and Aktivität (#16): the fourth grid cell is Mehr, which opens the rest with a search */
export const ENTRY_PILL_COUNT = 3

/** The full timebox list behind "all options", in minutes */
export const TIMEBOX_MINUTES = [15, 30, 45, 60, 90, 120] as const
/** Presets offered when there is no history-based suggestion */
const TIMEBOX_PRESETS = [15, 30, 60] as const

export interface SuggestionStep {
  /** All values of the step in ranked order */
  all: string[]
  /** The pills (first `SUGGESTION_COUNT` values) */
  suggestions: string[]
  /**
   * What the list behind the pills holds. Timebox ("···"): all values, the picked pills stay in it, empty when no third
   * pill is needed. Thema and Aktivität (Mehr, #16): only the values that are not pills.
   */
  rest: string[]
}

/** Most used first; unused values follow in pool order. Blank values are ignored. */
export function rankValues(used: (string | null | undefined)[], pool: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const raw of used) {
    const value = raw?.trim()
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const ranked = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
  return [...new Set([...ranked, ...pool.map((value) => value.trim()).filter(Boolean)])]
}

/** Splits a ranked list into pills and the "all options" remainder (no third pill with 2 or fewer values). */
export function toStep(all: string[]): SuggestionStep {
  const suggestions = all.slice(0, SUGGESTION_COUNT)
  return { all, suggestions, rest: all.length > SUGGESTION_COUNT ? all : [] }
}

interface TaskLike {
  topic?: string | null
  activity?: string | null
}

/** Thema and Aktivität (#16): three pills, the Mehr list holds the values after them. */
function toEntryStep(all: string[]): SuggestionStep {
  return { all, suggestions: all.slice(0, ENTRY_PILL_COUNT), rest: all.slice(ENTRY_PILL_COUNT) }
}

export function topicStep(tasks: readonly TaskLike[], pool: readonly string[]): SuggestionStep {
  return toEntryStep(rankValues(tasks.map((task) => task.topic), pool))
}

/** Activities used under `topic` come first, then the board-wide ranking, then the pool. */
export function activityStep(tasks: readonly TaskLike[], pool: readonly string[], topic: string | null): SuggestionStep {
  const scoped = topic ? tasks.filter((task) => task.topic?.trim() === topic) : []
  const first = rankValues(scoped.map((task) => task.activity), [])
  return toEntryStep([...new Set([...first, ...rankValues(tasks.map((task) => task.activity), pool)])])
}

/** Minutes as strings (the step's value type); `suggested` (history) leads when it is a sensible number. */
export function timeboxStep(suggested: number | null): SuggestionStep {
  const lead = suggested && suggested > 0 ? [suggested] : []
  const all = [...new Set([...lead, ...TIMEBOX_PRESETS, ...TIMEBOX_MINUTES])].map(String)
  const pills = [...new Set([...lead, ...TIMEBOX_PRESETS])].slice(0, SUGGESTION_COUNT).map(String)
  // Behind "···": the full list in ascending order, with a history value in its place
  const list = [...new Set([...TIMEBOX_MINUTES, ...lead])].sort((a, b) => a - b).map(String)
  return { all, suggestions: pills, rest: list }
}

/** What a source accepts as a new Thema or Aktivität (`SourceFields.newValues`); `null` there = the source has no free values */
export interface NewValueRules {
  /** Longest name the source keeps (Notion: 100); `null` = no limit */
  maxLength: number | null
  /** The source rejects a comma in an option name (Notion `select`/`multi_select`): it becomes a space */
  stripCommas: boolean
}

/** The text a new value would be created with: trimmed, spaces collapsed, then the source's rules. Empty when nothing is left. */
export function cleanNewValue(raw: string, rules: NewValueRules): string {
  let value = rules.stripCommas ? raw.replace(/,/g, ' ') : raw
  value = value.replace(/\s+/g, ' ').trim()
  if (rules.maxLength !== null && value.length > rules.maxLength) value = value.slice(0, rules.maxLength).trim()
  return value
}

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/** The existing value a typed text names (any case), with its own spelling, or `null` */
export function existingValueFor(query: string, all: readonly string[], rules: NewValueRules | null): string | null {
  const text = rules ? cleanNewValue(query, rules) : query.replace(/\s+/g, ' ').trim()
  return (text && all.find((value) => same(value, text))) || null
}

/** The "Neu: «text»" row: the cleaned text when the source allows new values and no existing value has that name, else `null` */
export function newValueFor(query: string, all: readonly string[], rules: NewValueRules | null): string | null {
  if (!rules) return null
  const text = cleanNewValue(query, rules)
  return text && !all.some((value) => same(value, text)) ? text : null
}

/** The values of the Mehr list that contain the typed text (any case); everything when it is blank */
export function filterRest(rest: readonly string[], query: string): string[] {
  const text = query.replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  return text ? rest.filter((value) => value.toLocaleLowerCase().includes(text)) : [...rest]
}
