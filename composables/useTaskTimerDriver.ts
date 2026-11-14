/**
 * @composable useTaskTimerDriver
 * @description App-level driver of the task timers (#352): a task in Jetzt is timed by exactly one running
 * timer for exactly as long as it is in Jetzt, whichever page is open. The task's status decides, not a card:
 * `start()` arms every Jetzt task and watches the Jetzt ids, arming a task that enters Jetzt and disarming one
 * that leaves it or is removed. Called once from `app.vue`.
 * @responsibility
 * - Own the arm/disarm decisions; the intervals live in `lib/taskTimers`
 * - Keep `task.timerId` equal to the registry's handle (a persisted `timerId` of an earlier page load is
 *   never cleared, only overwritten: the number may equal a live interval of this page)
 * - Tell the work-session tracker (#600) where a timer is armed and stopped; the tick itself never touches it
 * - A tick writes no store (#286): the second is collected in `lib/liveTime` and written into the store every
 *   `LIVE_CHECKPOINT_SECONDS`, when a timer stops, on `pagehide` and when the page turns hidden
 * - `stopTaskTimer` is the one explicit stop (day close, delete, disconnect); `resumeTaskTimer` undoes it for a
 *   task that stayed in Jetzt because the operation that stopped it failed
 */
import { watch, type WatchStopHandle } from 'vue'
import { armTaskTimer, disarmAllTaskTimers, disarmTaskTimer, isTaskTimerArmed } from '~/lib/taskTimers'
import { LIVE_CHECKPOINT_SECONDS, addLiveSecond, discardLiveSeconds, liveSecondsOf, unsavedLiveSecondsIds } from '~/lib/liveTime'
import { useTasksStore } from '~/store/tasks'
import { beginWorkSession, endAllWorkSessions, endWorkSession } from '~/composables/useWorkSessionTracking'
import { TaskStatus } from '~/types/taskStatus'

/**
 * Writes the seconds a task's timer has collected into the store. A task that is gone has nothing to write them
 * to: they go with it. Whatever the task's status is now (a stop after a move out of Jetzt still counts what
 * the timer ran).
 */
function commitLiveTime(taskId: string): void {
  const seconds = liveSecondsOf(taskId)
  if (seconds <= 0) return
  const tasksStore = useTasksStore()
  if (!tasksStore.task(taskId)) {
    discardLiveSeconds(taskId)
    return
  }
  if (tasksStore.addTrackedSeconds(taskId, seconds)) discardLiveSeconds(taskId)
}

/** Writes the collected seconds of every task: before the page can go away and before anything reads the stored time. */
function flushLiveTime(): void {
  for (const taskId of unsavedLiveSecondsIds()) commitLiveTime(taskId)
}

function onPageHide(): void {
  flushLiveTime()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') flushLiveTime()
}

/**
 * Stops the timer of a task (registry and `timerId`). Does not re-arm while the task stays in Jetzt:
 * the driver arms only on entering Jetzt and at start.
 * @returns whether a timer was running
 */
export function stopTaskTimer(taskId: string): boolean {
  commitLiveTime(taskId)
  const wasArmed = disarmTaskTimer(taskId)
  endWorkSession(taskId)
  const tasksStore = useTasksStore()
  const task = tasksStore.task(taskId)
  if (task && task.timerId !== null) {
    tasksStore.updateTask(taskId, { timerId: null })
    return true
  }
  return wasArmed
}

let stopWatching: WatchStopHandle | null = null

function armJetztTask(taskId: string): void {
  const tasksStore = useTasksStore()
  const handle = armTaskTimer(taskId, () => tick(taskId))
  tasksStore.updateTask(taskId, { timerId: handle })
  beginWorkSession(taskId)
}

/**
 * Restarts the timer of a task that is still in Jetzt after an explicit stop whose operation then failed
 * (a fail-closed disconnect, a refused day close). No-op when the task left Jetzt or is already timed.
 * @returns whether a timer was started
 */
export function resumeTaskTimer(taskId: string): boolean {
  const task = useTasksStore().task(taskId)
  if (!task || task.status !== TaskStatus.Progress || isTaskTimerArmed(taskId)) return false
  armJetztTask(taskId)
  return true
}

/**
 * One second of tracked time, collected outside the store (#286) and written at the checkpoint; a task that is gone
 * or no longer in Jetzt disarms itself.
 */
function tick(taskId: string): void {
  const tasksStore = useTasksStore()
  const task = tasksStore.task(taskId)
  if (!task || task.status !== TaskStatus.Progress) {
    stopTaskTimer(taskId)
    return
  }
  if (addLiveSecond(taskId) >= LIVE_CHECKPOINT_SECONDS) commitLiveTime(taskId)
}

export function useTaskTimerDriver() {
  const tasksStore = useTasksStore()

  function stop(): void {
    flushLiveTime()
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stopWatching?.()
    stopWatching = null
    disarmAllTaskTimers()
    endAllWorkSessions()
  }

  /** Arms every Jetzt task and follows the Jetzt column from here on. Idempotent (a re-run disarms first). */
  function start(): void {
    stop()
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // A persisted handle belongs to an earlier page load and may equal a live interval of this one
    // (app.vue, pages/tasks.vue): overwrite it, never clearInterval it.
    for (const task of tasksStore.tasks) {
      if (task.timerId !== null) tasksStore.updateTask(task.id, { timerId: null })
    }
    for (const task of tasksStore.tasksProgress) armJetztTask(task.id)

    // flush 'sync': a status change cannot produce one more write on a task that already left Jetzt
    stopWatching = watch(
      () => tasksStore.tasksProgress.map((task) => task.id),
      (ids, previous) => {
        const now = new Set(ids)
        const before = new Set(previous)
        for (const id of before) if (!now.has(id)) stopTaskTimer(id)
        // Compared with the previous ids, not the registry: an explicit stop of a task that stays in Jetzt stays stopped
        for (const id of now) if (!before.has(id)) armJetztTask(id)
      },
      { flush: 'sync' },
    )
  }

  return { start, stop }
}
