/**
 * @composable useTopicColor
 * @description The one resolver for a topic's mark (#321, #431). Two inputs, both derived when read, never copied
 * onto tasks:
 * - the *source colour*: a task keeps the colour its source gave it; a Local topic without one takes the colour of
 *   a Notion task with the same topic name (exact, trimmed), else none. It follows when Notion connects later or
 *   recolours an option.
 * - the *user's choice* (`store/topicStyles.ts`, keyed by topic name): hue and symbol. A chosen hue wins over the
 *   source colour; `inherited` says the hue shown is the source's. Colours map onto the nine hues
 *   (`lib/topicStyles.ts`), so a hex from another source shows the nearest hue.
 * `markOf` feeds `TopicMark` everywhere (card, sheet, picker, lists, statistics dialog).
 */
import { computed, type ComputedRef } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { useTopicStylesStore } from '~/store/topicStyles'
import { hueOfSourceColor, type TopicHue } from '~/lib/topicStyles'
import type { Task } from '~/types/task'

type TopicTask = Pick<Task, 'source' | 'topic' | 'topicColorCode'>

/** What a mark shows: nothing when `hue` and `symbol` are both null. */
export interface TopicMarkState {
  hue: TopicHue | null
  /** Key of the user's symbol, or null (a dot, or nothing). */
  symbol: string | null
  /** The hue comes from the source, not from a choice of the user. */
  inherited: boolean
}

interface Lookups {
  /** topic name -> colour of the first Notion task that has one: what a Local task of the same name borrows (#321) */
  notion: Map<string, string>
  /** topic name -> source colour of a name without a task at hand: the Notion one, else any task's own colour */
  named: Map<string, string>
}

/** One lookup per Pinia app, shared by every card */
const lookupsByStore = new WeakMap<object, ComputedRef<Lookups>>()

export function useTopicColor() {
  const tasksStore = useTasksStore()
  const styles = useTopicStylesStore()
  let lookup = lookupsByStore.get(tasksStore)
  if (!lookup) {
    lookup = computed(() => {
      const notion = new Map<string, string>()
      const named = new Map<string, string>()
      for (const task of tasksStore.tasks) {
        const topic = task.topic?.trim()
        if (!topic || !task.topicColorCode) continue
        if (task.source === 'notion' && !notion.has(topic)) notion.set(topic, task.topicColorCode)
      }
      for (const task of tasksStore.tasks) {
        const topic = task.topic?.trim()
        if (topic && task.topicColorCode && !named.has(topic)) named.set(topic, notion.get(topic) ?? task.topicColorCode)
      }
      return { notion, named }
    })
    lookupsByStore.set(tasksStore, lookup)
  }
  const colors = lookup

  /** The colour to show for the task's topic, or `null` */
  const topicColorOf = (task: TopicTask | null | undefined): string | null => {
    if (!task) return null
    if (task.topicColorCode) return task.topicColorCode
    if (task.source !== 'local') return null
    const topic = task.topic?.trim()
    return topic ? colors.value.notion.get(topic) ?? null : null
  }

  /**
   * The mark of a topic. With a `task` the source colour is that task's (`topicColorOf`: a Todoist task never
   * borrows a Notion colour); without one (picker, lists, editor) it is the colour a Notion task gave the name, else the colour of any task with it.
   */
  const markOf = (topic: string | null | undefined, task?: TopicTask | null): TopicMarkState => {
    const name = topic?.trim()
    if (!name) return { hue: null, symbol: null, inherited: false }
    const own = styles.styleOf(name)
    const sourceHue = hueOfSourceColor(task ? topicColorOf(task) : colors.value.named.get(name))
    return { hue: own.hue ?? sourceHue, symbol: own.symbol, inherited: !own.hue && sourceHue !== null }
  }

  /** The hue a source gave the topic name (Notion's first, else a task's own colour), whatever the user chose. */
  const sourceHueOf = (topic: string | null | undefined): TopicHue | null => {
    const name = topic?.trim()
    return name ? hueOfSourceColor(colors.value.named.get(name)) : null
  }

  /**
   * The colour a task about to be created with `topic` in `source` stores, so it shows the mark its siblings with
   * that name show (#672). Stored only where the resolver would not derive it anyway: a Local task whose name a
   * Notion task colours stores nothing and keeps following Notion (`topicColorOf`), otherwise it takes the colour
   * a sibling carries; a Notion task takes Notion's (what the source returns anyway); a Todoist task none (a
   * project colour is the project's, never borrowed). `null` for a name without a colour.
   */
  const colorCodeFor = (topic: string | null | undefined, source: Task['source']): string | null => {
    const name = topic?.trim()
    if (!name || source === 'todoist') return null
    if (source === 'notion') return colors.value.notion.get(name) ?? null
    return colors.value.notion.has(name) ? null : colors.value.named.get(name) ?? null
  }

  return { topicColorOf, markOf, sourceHueOf, colorCodeFor } as const
}
