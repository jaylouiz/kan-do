import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { isHue, symbolOf, type TopicHue, type TopicStyle } from '~/lib/topicStyles'

/**
 * The colour and symbol the user gave a topic (#431), keyed by the trimmed topic name. App-local: never written to
 * Notion or Todoist, carried by export/import and the desktop data file (`topic-styles`, ADR 016).
 *
 * An entry exists only while it holds a hue or a symbol. Hydration never writes (#273) and nothing is validated
 * into the state: an unknown hue or symbol key, or a state that is not a record at all, reads as "no choice" and
 * is left as stored until the user edits that topic.
 */
export const useTopicStylesStore = defineStore('topicStyles', () => {
  const styles = ref<Record<string, Partial<TopicStyle>>>({})

  /** The record to write into; a stored value that is not a plain object is replaced on the first edit. */
  function table(): Record<string, Partial<TopicStyle>> {
    const current: unknown = styles.value
    if (!current || typeof current !== 'object' || Array.isArray(current)) styles.value = {}
    return styles.value
  }

  /** The user's choice for `name`, validated at read time: an unknown key reads as none. */
  function styleOf(name: string | null | undefined): TopicStyle {
    const key = name?.trim()
    const entry: unknown = key && styles.value && typeof styles.value === 'object' && Object.hasOwn(styles.value, key)
      ? styles.value[key]
      : undefined
    if (!entry || typeof entry !== 'object') return { hue: null, symbol: null }
    const { hue, symbol } = entry as Record<string, unknown>
    return { hue: isHue(hue) ? hue : null, symbol: symbolOf(symbol) ? (symbol as string) : null }
  }

  /**
   * Writes `entry` for `key` (or removes it) on a copy of the record. A topic name is user text: only own keys count
   * (`constructor` and `toString` are not entries), and a computed key creates `__proto__` as a plain entry where
   * an assignment would replace the prototype.
   */
  function put(key: string, entry: Partial<TopicStyle> | null): void {
    const record = table()
    if (!entry && !Object.hasOwn(record, key)) return
    const rest = Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
    styles.value = entry ? { ...rest, [key]: entry } : rest
  }

  /** Changes hue and/or symbol of a topic; an entry left with neither is removed. */
  function setStyle(name: string, patch: Partial<TopicStyle>): void {
    const key = name.trim()
    if (!key) return
    const previous = styleOf(key)
    const hue: TopicHue | null = 'hue' in patch ? patch.hue ?? null : previous.hue
    const symbol = 'symbol' in patch ? patch.symbol ?? null : previous.symbol
    put(key, !hue && !symbol ? null : { hue, symbol })
  }

  /**
   * Moves the entry of `from` to `to`. A merge (`to` is an existing topic) keeps the target's style entirely, even
   * when it has none: the source entry is only dropped (#430 "Accepted trade-offs"). A plain rename overwrites any
   * stale entry a vanished topic of that name left behind.
   */
  function renameStyle(from: string, to: string, merged: boolean): void {
    const source = from.trim()
    const target = to.trim()
    if (!source || !target || source === target) return
    const record = table()
    if (!Object.hasOwn(record, source)) return
    const entry = record[source]!
    put(source, null)
    if (!merged) put(target, entry)
  }

  return { styles, styleOf, setStyle, renameStyle }
}, {
  persist: { key: 'topic-styles', pick: ['styles'] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTopicStylesStore, import.meta.hot))
}

