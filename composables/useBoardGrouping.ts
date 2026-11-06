import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBoardStore } from '~/store/board'
import { useNotionConfigStore } from '~/store/notionConfig'
import { useTasksStore } from '~/store/tasks'
import type { GroupKey, GroupingOption } from '~/types/boardGrouping'
import { buildGroupingOptions } from '~/utils/groupingOptions'

/**
 * The grouping options the board offers and the key it renders with (#323).
 *
 * On a mixed board (tasks from 2+ sources) only the properties every source has are offered. The persisted
 * key is never rewritten for that: while it is not offered the board shows the first option (display only),
 * so a Notion `custom:*` choice is back as soon as the board is single-source again. Only an explicit choice
 * in the menu writes the key.
 */
export function useBoardGrouping() {
  const { t } = useI18n()
  const boardStore = useBoardStore()
  const tasksStore = useTasksStore()
  const notionConfigStore = useNotionConfigStore()

  const groupingOptions = computed<GroupingOption[]>(() =>
    buildGroupingOptions({
      customProperties: notionConfigStore.config?.propertyMapping.customProperties ?? [],
      mixedBoard: tasksStore.hasMultipleSources,
      topicLabel: t('board.grouping.topic'),
      activityLabel: t('board.grouping.activity'),
      priorityLabel: t('board.grouping.priority'),
    }),
  )

  const effectiveGroupKey = computed<GroupKey | null>(() => {
    const key = boardStore.grouping.key
    if (!key) return null
    if (groupingOptions.value.some((option) => option.value === key)) return key
    return groupingOptions.value[0]?.value ?? null
  })

  /** Switching stacking on with no key picks the first offered option (the Mehr panel's "Karten stapeln", #470) */
  function setGroupingEnabled(enabled: boolean) {
    boardStore.setGroupingEnabled(enabled)
    if (enabled && !boardStore.grouping.key) {
      const firstOption = groupingOptions.value[0]?.value ?? null
      if (firstOption) boardStore.setGroupingKey(firstOption)
    }
  }

  /** An explicit choice of a group-by chip writes the persisted key */
  function setGroupingKey(key: GroupKey | null) {
    boardStore.setGroupingKey(key)
  }

  return { groupingOptions, effectiveGroupKey, setGroupingEnabled, setGroupingKey }
}
