/**
 * @composable useStatisticsReview
 * @description The Statistik page's data (#469): the derived review and the completed tasks, read from the completion records.
 * @responsibility
 * - Hold no state of its own; every figure comes from `deriveReview` / `deriveUnfinishedTime` (lib/statisticsReview.ts)
 * - Re-derive when the records change
 */
import { computed, type Ref } from 'vue'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useTasksStore } from '~/store/tasks'
import { deriveReview, deriveUnfinishedTime } from '~/lib/statisticsReview'
import { deriveWorkRhythm } from '~/lib/workRhythm'

/** @param now the moment "today" is read from; defaults to the current time (a test passes a fixed one) */
export function useStatisticsReview(now?: Ref<Date>) {
  const store = useTaskStatisticsStore()
  const tasksStore = useTasksStore()
  const review = computed(() => deriveReview(store.completionRecords, now?.value ?? new Date(), store.dayEndInFlight))
  /** Time on tasks still open and on tasks deleted before completion (#537). */
  const unfinished = computed(() => deriveUnfinishedTime(tasksStore.tasks, tasksStore.archivedTaskIds, store.discardedTime, now?.value ?? new Date()))
  /** When in the day work happens, from the work sessions of the last 8 weeks (#600). */
  const rhythm = computed(() => deriveWorkRhythm(store.workSessions, now?.value ?? new Date()))
  /** Newest first, for the list of all completed tasks. */
  const records = computed(() => store.allCompletions)
  return { review, records, unfinished, rhythm }
}
