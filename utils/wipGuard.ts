/**
 * @module wipGuard
 * @description The single WIP rule for the board: "Jetzt" holds at most one task.
 * Context menu, detail sheet, command palette (all via `useTaskOperations.moveTaskToStatus`)
 * and drag-and-drop (`useBoardDndKit`) all ask this function.
 */
import { TaskStatus } from '~/types/taskStatus'

/** Maximum tasks allowed in "Jetzt". */
export const MAX_TASKS_IN_PROGRESS = 1

export type WipVerdict =
  | { allowed: true }
  | { allowed: false, reason: 'progressFull' | 'stackTooLarge' }

export interface WipMoveInput {
  currentStatus: TaskStatus
  targetStatus: TaskStatus
  /** Number of tasks currently in "Jetzt" (including the moved task if it is already there). */
  progressCount: number
  /** Tasks moving together (a whole stack, #150); defaults to 1. A block of 2+ never fits "Jetzt". */
  taskCount?: number
}

/** Pure check: may `taskCount` tasks go from `currentStatus` to `targetStatus`? */
export function checkWipMove({ currentStatus, targetStatus, progressCount, taskCount = 1 }: WipMoveInput): WipVerdict {
  if (targetStatus !== TaskStatus.Progress) return { allowed: true }
  // Reordering inside "Jetzt" and no-op moves never add a task
  if (currentStatus === TaskStatus.Progress) return { allowed: true }
  if (taskCount > MAX_TASKS_IN_PROGRESS) return { allowed: false, reason: 'stackTooLarge' }
  if (progressCount >= MAX_TASKS_IN_PROGRESS) return { allowed: false, reason: 'progressFull' }
  return { allowed: true }
}

export interface SwapInput {
  /** Where the task that wants to run now sits. */
  incomingStatus: TaskStatus
  /** Number of tasks currently in "Jetzt". */
  progressCount: number
  /** Tasks moving together (a whole stack, #150); defaults to 1. */
  taskCount?: number
}

/**
 * Pure check (#162): may one task from Offen or Wartet take over a "Jetzt" that holds exactly one other
 * task, which then moves to Wartet? Only for a single card: a stack never fits "Jetzt", and a task
 * from Erledigt stays refused (its completion, statistics and undo are not part of a swap).
 * `checkWipMove` is unchanged: menus, the palette and the add flow still refuse a full "Jetzt".
 */
export function canSwapIntoProgress({ incomingStatus, progressCount, taskCount = 1 }: SwapInput): boolean {
  if (taskCount !== 1) return false
  if (incomingStatus !== TaskStatus.Open && incomingStatus !== TaskStatus.Waiting) return false
  return progressCount === MAX_TASKS_IN_PROGRESS
}
