/**
 * @module lib/workSessions
 * @description Work sessions (#600): the spans of wall-clock time in which a Jetzt timer ran, as `{ start, end }` in epoch ms.
 * Pure helpers for the `taskStatistics.workSessions` list: validation of stored entries, opening / continuing,
 * extending and pruning. Plain TypeScript, no store and no timers (the tracker in
 * `composables/useWorkSessionTracking` decides when to call them).
 */

/** One span in which a timer ran. Both ends are epoch ms; `end >= start`. */
export interface WorkSession {
  start: number
  end: number
}

/** A new session that starts this soon after the previous one ended continues it (reload, drag out and back). */
export const WORK_SESSION_MERGE_GAP_MS = 3 * 60_000
/** `end` of the open session is persisted this often, never per timer tick. */
export const WORK_SESSION_HEARTBEAT_MS = 60_000
/** A total span shorter than this is a slip (a drag into Jetzt and straight back), not work. */
export const WORK_SESSION_MIN_MS = 30_000

/** Whether a stored entry is a usable session. */
export function isWorkSession(value: unknown): value is WorkSession {
  if (typeof value !== 'object' || value === null) return false
  const { start, end } = value as Record<string, unknown>
  return typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end) && end >= start
}

/** The usable entries of a stored value (anything that is not a list reads as empty). */
export function cleanWorkSessions(value: unknown): WorkSession[] {
  return Array.isArray(value) ? value.filter(isWorkSession) : []
}

/** Whether a session is long enough to count. */
export const isMeaningfulSession = (session: WorkSession): boolean => session.end - session.start >= WORK_SESSION_MIN_MS

/**
 * Opens a session at `at`, or continues the previous one when it ended less than the merge gap ago. Starting a new
 * session also drops a too-short last one (it was never continued) and entries older than `retentionMs`.
 * @returns the new list and the `start` that identifies the open session
 */
export function openSession(sessions: WorkSession[], at: number, retentionMs: number): { sessions: WorkSession[]; start: number } {
  const last = sessions.at(-1)
  if (last && at >= last.start && at - last.end <= WORK_SESSION_MERGE_GAP_MS) {
    return { sessions: sessions.slice(0, -1).concat({ start: last.start, end: Math.max(last.end, at) }), start: last.start }
  }
  const cutoff = at - retentionMs
  const kept = sessions.filter((session, index) => session.end >= cutoff && (index < sessions.length - 1 || isMeaningfulSession(session)))
  return { sessions: [...kept, { start: at, end: at }], start: at }
}

/** Moves the `end` of the session that began at `start` forward to `at` (never back). The list is returned unchanged when it is not found. */
export function extendSession(sessions: WorkSession[], start: number, at: number): WorkSession[] {
  for (let index = sessions.length - 1; index >= 0; index--) {
    const session = sessions[index]!
    if (session.start !== start) continue
    if (at <= session.end) return sessions
    const next = sessions.slice()
    next[index] = { start, end: at }
    return next
  }
  return sessions
}
