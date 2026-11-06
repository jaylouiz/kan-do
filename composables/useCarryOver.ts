/**
 * @composable useCarryOver
 * @description Carried-over cue (#99). `useCarryOverTracking` counts board days (on board load,
 * after every task-set or status change, e.g. a merge, and when the tab becomes visible again;
 * no timers). `useTaskCarryOver` exposes one task's count, the display day (#121) and the nudge state.
 * @responsibility Counter bookkeeping and derived display state; never deletes or moves tasks.
 */
import { computed, onBeforeUnmount, onMounted, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { carryOverDisplayDay, isCarryOverNudgeDue, isCarryOverVisible, localDateKey } from '~/utils/carryOver'
import { mapHelpers } from '~/utils/mapHelpers'

/** Mount once on the board page. Counts the current day for every not-done card. */
export function useCarryOverTracking(now: () => Date = () => new Date()) {
  const tasksStore = useTasksStore()

  const record = () => tasksStore.recordCarryOver(localDateKey(now()))

  // A merge, add, delete or status change alters this signature; the record call is idempotent per day.
  const signature = () => tasksStore.tasks.map(t => `${t.id}:${t.status}`).join('|')
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

/** Carried-over state for one task. */
export function useTaskCarryOver(task: MaybeRefOrGetter<Task | null | undefined>) {
  const tasksStore = useTasksStore()

  const entry = computed(() => {
    const current = toValue(task)
    if (!current || current.status === TaskStatus.Done) return null
    return mapHelpers.get(tasksStore.carryOverByTaskId, current.id) ?? null
  })

  /** Day number to show (days + 1); 0 without an entry (Done card, not yet counted, pending sync). */
  const displayDay = computed(() => (entry.value ? carryOverDisplayDay(entry.value.days) : 0))
  /** Whether the cue shows at all (day 2+); the single visibility rule for every template. */
  const isVisible = computed(() => isCarryOverVisible(displayDay.value))

  /** Nudge only for Offen/Jetzt: waiting on someone else is legitimate. */
  const isNudgeDue = computed(() => {
    const current = toValue(task)
    if (!current || current.status === TaskStatus.Waiting || current.status === TaskStatus.Done) return false
    return isCarryOverNudgeDue(entry.value)
  })

  const keep = () => {
    const current = toValue(task)
    if (current) tasksStore.keepCarryOver(current.id)
  }

  return { entry, displayDay, isVisible, isNudgeDue, keep }
}
