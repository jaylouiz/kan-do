/**
 * @module lib/duplicateDraft
 * @description The draft of a duplicated task (#296): what the card menu's "Duplicate" hands to
 * `useTaskSync().createTask`. Content fields carry over; identity, status, time, done and sync state start fresh,
 * so the copy is a plain new task in Offen. No title suffix.
 */
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

export function duplicateDraft(task: Task): Partial<Task> {
  return {
    title: task.title,
    status: TaskStatus.Open,
    activity: task.activity,
    topic: task.topic,
    topicColorCode: task.topicColorCode,
    priority: task.priority,
    notes: task.notes,
    timeBoxSeconds: task.timeBoxSeconds,
    timeSpentSeconds: 0,
    isUnplanned: task.isUnplanned ?? false,
  }
}
