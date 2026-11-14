/**
 * @module useDayCapacity
 * @description The key of the Offen list item after which the day is full (#132), for the capacity divider. Reads
 * Jetzt and Wartet from the tasks store and the tracked work sessions from the statistics store; the maths is in
 * `lib/dayCapacity`. Wartet follows the topic focus like the Offen list does, so one scope is counted (Jetzt never hides). Off (null) when `enabled` is false. Recomputes with the board, the sessions and the day.
 */
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { capacityLineAfter, plannedMinutes, remainingDayMinutes } from '~/lib/dayCapacity'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useTasksStore } from '~/store/tasks'
import type { ColumnItem } from '~/types/columnItem'
import { useBoardFocus } from '~/composables/useBoardFocus'
import { useToday } from '~/composables/useToday'

export function useDayCapacity(items: MaybeRefOrGetter<ColumnItem[]>, enabled: MaybeRefOrGetter<boolean>) {
  const tasks = useTasksStore()
  const statistics = useTaskStatisticsStore()
  const { today } = useToday()
  const { applyFocus } = useBoardFocus()

  const lineAfterKey = computed<string | null>(() => {
    if (!toValue(enabled)) return null
    void today.value
    return capacityLineAfter(toValue(items), {
      usedMinutes: plannedMinutes([...tasks.tasksProgress, ...applyFocus(tasks.tasksWaiting)]),
      capacityMinutes: remainingDayMinutes(statistics.workSessions, new Date()),
    })
  })

  return { lineAfterKey }
}
