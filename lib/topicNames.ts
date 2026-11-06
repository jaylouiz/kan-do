/**
 * @module topicNames
 * @description Pure name logic for editing topics and activities (#430): which field a kind lives in, how a
 * value is matched and rewritten, and how option lists change on a rename or merge. No Pinia here, so the rules
 * are testable on their own; the stores and `useTopicManagement` call these.
 *
 * Names are case-sensitive and compared trimmed (like `useTopicColor`). A rename of `from` to `to` rewrites
 * every value that equals `from` after trimming; a value that already equals `to` makes it a merge.
 */

export type NameKind = 'topic' | 'activity'

/** The name as compared and stored: surrounding whitespace removed. */
export function trimName(name: string | null | undefined): string {
  return typeof name === 'string' ? name.trim() : ''
}

/**
 * Returns `item` with its `kind` field rewritten from `from` to `to`, or the very same object when the field
 * does not hold `from` (so callers can tell nothing changed and skip a write).
 */
export function renameField<T extends { topic?: string | null; activity?: string | null }>(
  item: T,
  kind: NameKind,
  from: string,
  to: string,
): T {
  const current = item[kind]
  if (typeof current !== 'string' || current.trim() !== from) return item
  return { ...item, [kind]: to }
}

/**
 * Rewrites `from` to `to` in a list of option names: a target that is already there makes the entries one,
 * the result stays sorted. Returns the same array when `from` is not in it.
 */
export function renameInList(list: readonly string[], from: string, to: string): readonly string[] {
  if (!list.some(name => name.trim() === from)) return list
  return [...new Set(list.map(name => (name.trim() === from ? to : name)))].sort()
}

/** Whether renaming `from` to `to` joins an existing name instead of creating a new one. */
export function isMerge(names: readonly string[], from: string, to: string): boolean {
  const target = trimName(to)
  return target !== trimName(from) && names.some(name => trimName(name) === target)
}

export type RenameVerdict = 'ok' | 'unchanged' | 'empty'

/** Whether `to` may be saved over `from` (before the ownership gate, which needs the tasks). */
export function renameVerdict(from: string, to: string): RenameVerdict {
  const target = trimName(to)
  if (!target) return 'empty'
  return target === trimName(from) ? 'unchanged' : 'ok'
}

/** Union of name sources, trimmed, without empties, sorted. */
export function collectNames(...sources: ReadonlyArray<Iterable<string | null | undefined>>): string[] {
  const names = new Set<string>()
  for (const source of sources) {
    for (const name of source) {
      const trimmed = trimName(name)
      if (trimmed) names.add(trimmed)
    }
  }
  return [...names].sort()
}
