import type { Task } from '~/types/task'
import type { TaskStatus } from '~/types/taskStatus'
import type { CarryOverEntry } from '~/utils/carryOver'

/**
 * One deleted task in the trash (#422, ADR 015 addendum). kan-do owns the trash for every source: the
 * snapshot is what a restore re-creates, whatever the source did with its own copy (Notion archives the page,
 * Todoist deletes the task, Local has nothing upstream).
 */
export interface TrashEntry {
  /** The app-level id of the task (stable: a restore keeps it, also for Todoist where `externalId` is new). */
  taskId: string
  /** The task as it was at delete time, `timerId: null`. */
  task: Task
  /** When the undo window closed and the task moved into the trash (epoch ms). */
  deletedAt: number
  /** The column the task was in; a task from Jetzt is restored into Offen. */
  fromStatus: TaskStatus
  /** The carried-over counter the task had, put back on a restore. */
  carryOver: CarryOverEntry | null
}
