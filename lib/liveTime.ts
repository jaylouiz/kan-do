/**
 * @module lib/liveTime
 * @description The running seconds of a timed task (#286). A task in Jetzt gains a second every second, but the
 * tasks store is serialised, persisted and watched as a whole, so a store write per second costs more the more
 * tasks are stored. The seconds therefore collect here, in runtime-only reactive state, and the timer driver writes
 * them into the store every `LIVE_CHECKPOINT_SECONDS` and wherever the stored value is read or the page may go away.
 * What the user sees (card chip, sheet, capacity) is `liveTimeSpent(task)`: stored time plus these seconds.
 * Plain TypeScript, imports no store; never persisted, never part of a store's state.
 */
import { reactive } from 'vue'
import { mapHelpers } from '~/utils/mapHelpers'

/** Seconds a timer collects before the driver writes them into the store; also the most a hard crash can lose. */
export const LIVE_CHECKPOINT_SECONDS = 10

/** Unsaved seconds per task id. Exported for the reactivity check in tests only. */
export const liveSecondsState = reactive<Record<string, number>>({})

/** Adds one second to a task and returns the seconds collected for it now. */
export function addLiveSecond(taskId: string): number {
  const next = (liveSecondsState[taskId] ?? 0) + 1
  liveSecondsState[taskId] = next
  return next
}

/** The seconds collected for a task and not yet written to the store. */
export function liveSecondsOf(taskId: string): number {
  return liveSecondsState[taskId] ?? 0
}

/** Stored time plus the collected seconds: the time to show. */
export function liveTimeSpent(task: { id: string; timeSpentSeconds?: number | null }): number {
  return (task.timeSpentSeconds ?? 0) + liveSecondsOf(task.id)
}

/** Returns the collected seconds of a task and clears them. */
export function takeLiveSeconds(taskId: string): number {
  const seconds = liveSecondsState[taskId] ?? 0
  mapHelpers.delete(liveSecondsState, taskId)
  return seconds
}

/** Drops the collected seconds of a task without writing them (a total the user set, a task that is gone). */
export function discardLiveSeconds(taskId: string): void {
  mapHelpers.delete(liveSecondsState, taskId)
}

export function unsavedLiveSecondsIds(): string[] {
  return Object.keys(liveSecondsState).filter((id) => liveSecondsState[id]! > 0)
}

export function clearAllLiveSeconds(): void {
  for (const id of Object.keys(liveSecondsState)) mapHelpers.delete(liveSecondsState, id)
}

// A Vite HMR re-run replaces this module with an empty overlay: the old seconds would be lost silently, so the
// driver (which flushes on `stop()`) runs first; here only the state of the replaced module is dropped
if (import.meta.hot) {
  import.meta.hot.dispose(clearAllLiveSeconds)
}
