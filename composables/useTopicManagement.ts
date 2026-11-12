/**
 * @composable useTopicManagement
 * @description Everything the topic editor and `/settings/topics` need to list, count and rename topics and
 * activities (#430). The rename runs through one synchronous pass over every store that holds the name (tasks of
 * every status and the undo-window snapshots, the trash, the statistics records, the option lists) and, for a
 * topic, moves the colour/symbol entry. It never calls upstream: no adapter, no `pendingSync`. That is also why a
 * name a source owns is refused: Notion would bring the old name back on the next fetch.
 *
 * Pure rules (matching, merge, verdict) live in `lib/topicNames.ts`.
 */
import { computed } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { usePropertyOptionsStore } from '~/store/propertyOptions'
import { useTopicStylesStore } from '~/store/topicStyles'
import { collectNames, isMerge, renameVerdict, trimName, type NameKind } from '~/lib/topicNames'

export type RenameResult =
  | { ok: true; name: string; merged: boolean }
  | { ok: false; reason: 'empty' | 'unchanged' | 'owned' }

export function useTopicManagement() {
  const tasksStore = useTasksStore()
  const trashStore = useTrashStore()
  const statistics = useTaskStatisticsStore()
  const options = usePropertyOptionsStore()
  const styles = useTopicStylesStore()
  const boardStore = useBoardStore()

  const namesOf = (kind: NameKind): string[] => collectNames(
    kind === 'topic' ? options.getTopicOptions : options.getActivityOptions,
    tasksStore.tasks.map(task => task[kind]),
    trashStore.entries.map(entry => entry.task[kind]),
    statistics.completionRecords.map(record => record[kind]),
  )

  /** Every topic, used or not, including names only the trash or the statistics still carry. */
  const topics = computed(() => namesOf('topic'))
  const activities = computed(() => namesOf('activity'))

  /** Tasks of every status that carry the name; the trash and a delete inside its undo window are not counted. */
  const countOf = (kind: NameKind, name: string): number => {
    const target = trimName(name)
    return tasksStore.tasks.filter(task => trimName(task[kind]) === target).length
  }

  /** A name the Notion schema lists, or that any non-Local task carries, belongs to its source. */
  const isSourceOwned = (kind: NameKind, name: string): boolean => {
    const target = trimName(name)
    return options.isSchemaOption(kind, target)
      || tasksStore.tasks.some(task => task.source !== 'local' && trimName(task[kind]) === target)
  }

  /** The existing name a rename of `from` to `to` would merge into, or `null`. */
  const mergeTarget = (kind: NameKind, from: string, to: string): string | null =>
    isMerge(namesOf(kind), from, to) ? trimName(to) : null

  /** Renames or merges `from` into `to` everywhere; refuses an empty, unchanged or source-owned `from`. */
  function rename(kind: NameKind, from: string, to: string): RenameResult {
    const source = trimName(from)
    const target = trimName(to)
    const verdict = renameVerdict(source, target)
    if (verdict !== 'ok') return { ok: false, reason: verdict }
    if (isSourceOwned(kind, source)) return { ok: false, reason: 'owned' }
    const merged = isMerge(namesOf(kind), source, target)
    tasksStore.renameValue(kind, source, target)
    trashStore.renameValue(kind, source, target)
    statistics.renameValue(kind, source, target)
    options.renameOption(kind, source, target)
    if (kind === 'topic') {
      styles.renameStyle(source, target, merged)
      boardStore.renameFocusTopic(source, target) // an active focus (#161) follows the rename or merge
    }
    return { ok: true, name: target, merged }
  }

  return { topics, activities, countOf, isSourceOwned, mergeTarget, rename } as const
}
