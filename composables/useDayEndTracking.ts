/**
 * @composable useDayEndTracking
 * @description Remembers how many tasks are still in Offen, Jetzt and Wartet, once per local day (#537): the
 * "things in flight at day end" figure of the Statistik page. The value of a day is the last count the app saw
 * that day, written on the same triggers as the carry-over count (`useCarryOverTracking`: mount, after every task-set
 * or status change, tab visible again; no timers), so closing the day with "Fertig" and every other status change
 * update it without any special case. A day on which the app was never open has no value.
 * @responsibility Decide when a count may be written; the storage and its pruning live in `store/taskStatistics`.
 * Nothing is written while the board is not onboarded, while the desktop data status blocks writes (ADR 011), or
 * while the board holds no real (non-demo) task, so a new user's empty board never logs "0 open".
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { dataState } from '~/lib/dataStorage'
import { isDemoTaskId } from '~/lib/demoIds'
import { TaskStatus } from '~/types/taskStatus'
import { dayKey } from '~/utils/recapDay'

/** Mount once on the board page, next to `useCarryOverTracking`. */
export function useDayEndTracking(now: () => Date = () => new Date()) {
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const statisticsStore = useTaskStatisticsStore()

  function record(): void {
    if (boardStore.boardConfig.sources === null) return
    if (dataState.available && dataState.status !== 'ok') return
    const real = tasksStore.tasks.filter(task => !isDemoTaskId(task.id))
    if (real.length === 0) return
    const inFlight = real.filter(task => task.status === TaskStatus.Open || task.status === TaskStatus.Progress || task.status === TaskStatus.Waiting).length
    const day = dayKey(now())
    if (statisticsStore.dayEndInFlight[day] === inFlight) return
    statisticsStore.recordDayEnd(day, inFlight)
  }

  const signature = () => tasksStore.tasks.map(task => `${task.id}:${task.status}`).join('|')
  watch(signature, record)

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') record()
  }

  onMounted(() => {
    record()
    document.addEventListener('visibilitychange', onVisibilityChange)
  })
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibilityChange))

  return { record }
}
