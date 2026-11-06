/**
 * @module utils/groupingOptions
 * @description The properties a board can group its columns by (#323).
 *
 * Topic, activity and priority exist on every task (activity is `null` on Todoist tasks, like a topic that was never set). A Notion single-select property exists only on Notion tasks,
 * so a board that holds tasks from 2+ sources offers just the three shared ones: grouping by a property
 * the Local tasks do not have would pile them all into one "no value" group.
 */
import type { GroupingOption } from '~/types/boardGrouping'
import type { NotionCustomPropertyConfig } from '~/types/notion'

export interface GroupingOptionsInput {
  /** Enabled-or-not custom properties of the Notion mapping (only enabled single-selects are offered) */
  customProperties: readonly NotionCustomPropertyConfig[]
  /** `tasksStore.hasMultipleSources`: tasks of two or more sources sit on the board */
  mixedBoard: boolean
  topicLabel: string
  activityLabel: string
  priorityLabel: string
}

export function buildGroupingOptions({ customProperties, mixedBoard, topicLabel, activityLabel, priorityLabel }: GroupingOptionsInput): GroupingOption[] {
  const options: GroupingOption[] = [
    { value: 'topic', label: topicLabel },
    { value: 'activity', label: activityLabel },
    { value: 'priority', label: priorityLabel },
  ]
  if (mixedBoard) return options

  for (const prop of customProperties) {
    if (!prop.enabled) continue
    // Only include single-select properties; multi-select creates ambiguity (which group for multiple values?)
    if (prop.type !== 'select') continue
    options.push({ value: `custom:${prop.key}`, label: prop.label ?? prop.name })
  }
  return options
}
