/**
 * @module lib/deleteGapState
 * @description In-memory, never persisted state of the delete flow's motion (#422): the gaps that glide shut after
 * their undo window, and the cards that play the grow-back after an undo. Kept apart from `useTaskDeletion`
 * so a card can ask `isTaskReturning` without pulling in the sync layer.
 */
import { reactive } from 'vue'
import type { PendingTaskDelete } from '~/store/tasks'
import { mapHelpers } from '~/utils/mapHelpers'

/** How long a closing gap glides shut (ms); the gap component's CSS uses the same value. */
export const GAP_CLOSE_MS = 280
/** How long a card that came back from an undo plays its grow-back (ms). */
export const UNDO_RETURN_MS = 180

/** Gaps whose undo window has closed and which glide shut, by task id. */
export const closingGaps = reactive<Record<string, PendingTaskDelete>>({})
/** Tasks that just came back from an undo and play the grow-back. */
const returning = reactive<Record<string, true>>({})

/** Whether the card just came back from an undo (it plays the grow-back). */
export const isTaskReturning = (taskId: string): boolean => returning[taskId] === true

/** Starts the grow-back of a card for the length of the animation. */
export function markTaskReturning(taskId: string): void {
  returning[taskId] = true
  setTimeout(() => { mapHelpers.delete(returning, taskId) }, UNDO_RETURN_MS)
}

/**
 * Keeps a gap on the board while it glides shut. `onGone` runs once the gap has left the board, with the gap
 * as it was then (its slot may have been re-anchored meanwhile): the caller re-anchors the gaps that hung on it (#438).
 */
export function holdClosingGap(pending: PendingTaskDelete, onGone?: (gone: PendingTaskDelete) => void): void {
  closingGaps[pending.taskId] = pending
  setTimeout(() => {
    const gone = closingGaps[pending.taskId] ?? pending
    mapHelpers.delete(closingGaps, pending.taskId)
    onGone?.(gone)
  }, GAP_CLOSE_MS)
}

/**
 * Moves every closing gap that hangs on `fromId` to `toAfterId` (#438); the rest of its slot stays. `accept` narrows
 * it to the gaps that may move (same column, no cycle).
 */
export function reanchorClosingGaps(fromId: string, toAfterId: string | null | undefined, accept: (gap: PendingTaskDelete) => boolean = () => true): void {
  for (const [id, gap] of Object.entries(closingGaps)) {
    if (gap.slot?.afterId !== fromId || !accept(gap)) continue
    closingGaps[id] = { ...gap, slot: withAfterId(gap.slot, toAfterId) }
  }
}

/** A slot with another anchor; an undefined anchor drops the key (the column end). */
export function withAfterId(slot: NonNullable<PendingTaskDelete['slot']>, afterId: string | null | undefined): NonNullable<PendingTaskDelete['slot']> {
  return afterId === undefined ? { height: slot.height } : { ...slot, afterId }
}

/** Test helper: forgets all motion state between tests. */
export function resetDeleteGapState(): void {
  for (const key of Object.keys(closingGaps)) mapHelpers.delete(closingGaps, key)
  for (const key of Object.keys(returning)) mapHelpers.delete(returning, key)
}
