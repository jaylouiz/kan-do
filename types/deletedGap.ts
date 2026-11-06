import type { Task } from '~/types/task'
import type { TaskStatus } from '~/types/taskStatus'

/** A gap on the board (#422): the slot of a deleted card inside its undo window, or gliding shut after it. */
export interface DeletedGap {
  taskId: string
  task: Task
  fromStatus: TaskStatus
  /**
   * The card or gap before this one in the column; null = first; undefined = the column end. The first member of an
   * expanded stack hangs on its group's header key (`stackHeaderKey`, `stack-header:<groupKey>`, #438).
   */
  afterId: string | null | undefined
  /** The card's measured height in px; null = not measured */
  height: number | null
  state: 'open' | 'closing'
  paused: boolean
  requestedAt: number
}
