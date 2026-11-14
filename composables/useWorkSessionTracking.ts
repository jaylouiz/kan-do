/**
 * @composable useWorkSessionTracking
 * @description Records when the Jetzt timer runs as work sessions in `taskStatistics.workSessions` (#600). The timer
 * driver calls `beginWorkSession` where it arms a task timer and `endWorkSession` where it stops one; a session is
 * open for as long as at least one timer is armed. The end of the open session is persisted by a 60 s heartbeat and on
 * `pagehide`, never from the per-second tick (which writes no store either since #286: its seconds are collected in `lib/liveTime`).
 * @responsibility
 * - Decide when a session opens, grows and closes; the list and its pruning live in `store/taskStatistics` / `lib/workSessions`
 * - A heartbeat more than 3 minutes after the previous one means the machine slept or the page was frozen: the old session
 *   keeps its last `end` and a new one starts, so sleep is never counted as work
 * - Write nothing while the board is not onboarded, while the desktop data status blocks writes (ADR 011), or for demo tasks
 * - Own the heartbeat interval (not a task timer: it lives here, not in `lib/taskTimers`); it runs only while a timer is
 *   armed (retrying the open while a write is blocked), is cleared when the last timer stops and on HMR dispose
 */
import { useBoardStore } from '~/store/board'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { dataState } from '~/lib/dataStorage'
import { isDemoTaskId } from '~/lib/demoIds'
import { WORK_SESSION_HEARTBEAT_MS, WORK_SESSION_MERGE_GAP_MS } from '~/lib/workSessions'

const armed = new Set<string>()
/** `start` of the open session, null while none is open (also while writes are blocked). */
let openStart: number | null = null
/** When the open session's end was last moved; the sleep check compares the next beat with it. */
let lastBeat = 0
let heartbeat: number | null = null

function onboarded(): boolean {
  return useBoardStore().boardConfig.sources !== null
}

function canWrite(): boolean {
  return onboarded() && !(dataState.available && dataState.status !== 'ok')
}

function stopHeartbeat(): void {
  if (heartbeat !== null) window.clearInterval(heartbeat)
  heartbeat = null
  window.removeEventListener('pagehide', onPageHide)
}

function startHeartbeat(): void {
  if (heartbeat !== null) return
  heartbeat = window.setInterval(beat, WORK_SESSION_HEARTBEAT_MS)
  window.addEventListener('pagehide', onPageHide)
}

/**
 * Opens a session when writes are allowed. While the data status blocks writes (recoverable without a reload, ADR 011)
 * the heartbeat starts anyway and only retries the open, so a session begins as soon as the status is ok again. An
 * un-onboarded board has nothing to track: no session, no interval.
 */
function open(now: number): void {
  if (openStart !== null || !onboarded()) return
  startHeartbeat()
  if (!canWrite()) return
  openStart = useTaskStatisticsStore().openWorkSession(now)
  lastBeat = now
}

function beat(): void {
  const now = Date.now()
  if (armed.size === 0) {
    stopHeartbeat()
    return
  }
  if (openStart === null) {
    open(now)
    return
  }
  if (now - lastBeat > WORK_SESSION_MERGE_GAP_MS) {
    // Slept or frozen: the old session ends at its last beat, a new one starts now (retried per beat while blocked)
    openStart = null
    open(now)
    return
  }
  if (canWrite()) useTaskStatisticsStore().extendWorkSession(openStart, now)
  lastBeat = now
}

function onPageHide(): void {
  if (openStart !== null && canWrite()) useTaskStatisticsStore().extendWorkSession(openStart, Date.now())
}

function closeSession(): void {
  const now = Date.now()
  if (openStart !== null && canWrite()) {
    // A close that comes after a long silent gap would stretch the session over it: end it at the last beat instead
    useTaskStatisticsStore().extendWorkSession(openStart, now - lastBeat > WORK_SESSION_MERGE_GAP_MS ? lastBeat : now)
  }
  openStart = null
  stopHeartbeat()
}

/** A timer was armed for a task: open (or continue) the session. Demo tasks are not work. */
export function beginWorkSession(taskId: string): void {
  if (isDemoTaskId(taskId)) return
  armed.add(taskId)
  open(Date.now())
}

/** The timer of a task stopped: the session closes when it was the last armed one. */
export function endWorkSession(taskId: string): void {
  if (!armed.delete(taskId)) return
  if (armed.size === 0) closeSession()
}

/** The driver stops all timers (page teardown, restart). */
export function endAllWorkSessions(): void {
  armed.clear()
  closeSession()
}

// A Vite HMR re-run replaces this module with empty state: end the old session and clear its interval first
if (import.meta.hot) {
  import.meta.hot.dispose(endAllWorkSessions)
}
