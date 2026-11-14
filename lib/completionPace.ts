import type { Task } from '~/types/task'

/**
 * "Faster than planned" (#295): the task has a timebox and was finished with some time spent below it. A task that never
 * ran (0 s spent) or ended exactly on the box does not count. Read right after the status change into Erledigt, when
 * the time spent is final. Decides the message of the in-card done confirmation (TaskCard) and its length.
 */
export function finishedFasterThanPlan(task: Pick<Task, 'timeBoxSeconds' | 'timeSpentSeconds'> | null | undefined): boolean {
  if (!task) return false
  const box = task.timeBoxSeconds ?? 0
  const spent = task.timeSpentSeconds ?? 0
  return box > 0 && spent > 0 && spent < box
}
