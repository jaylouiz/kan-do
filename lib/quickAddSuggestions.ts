/**
 * @module quickAddSuggestions
 * @description Pure suggestion logic of the guided new-card flow (#649): which two values a step offers as pills and
 * which stay behind "all options". No Pinia here, so the rules are testable on their own; `NewCardFlow` feeds
 * it the tasks and the option pools.
 *
 * Rule: a value is ranked by how often tasks use it (ties keep the pool's order), values that no task uses follow
 * from the pool. Activities rank within the chosen topic first. Timebox: the history-based suggestion first (when
 * there is one), then the presets 15, 30 and 60 min; the full list is the presets 15, 30, 45, 60, 90, 120.
 */

/** Pills shown per step; everything else sits behind "all options" */
export const SUGGESTION_COUNT = 2

/** The full timebox list behind "all options", in minutes */
export const TIMEBOX_MINUTES = [15, 30, 45, 60, 90, 120] as const
/** Presets offered when there is no history-based suggestion */
const TIMEBOX_PRESETS = [15, 30, 60] as const

export interface SuggestionStep {
  /** All values of the step in ranked order */
  all: string[]
  /** The pills (first `SUGGESTION_COUNT` values) */
  suggestions: string[]
  /** What "···" opens: all values (the picked pills stay in the list), empty when no third pill is needed */
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

export function topicStep(tasks: readonly TaskLike[], pool: readonly string[]): SuggestionStep {
  return toStep(rankValues(tasks.map((task) => task.topic), pool))
}

/** Activities used under `topic` come first, then the board-wide ranking, then the pool. */
export function activityStep(tasks: readonly TaskLike[], pool: readonly string[], topic: string | null): SuggestionStep {
  const scoped = topic ? tasks.filter((task) => task.topic?.trim() === topic) : []
  const first = rankValues(scoped.map((task) => task.activity), [])
  return toStep([...new Set([...first, ...rankValues(tasks.map((task) => task.activity), pool)])])
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
