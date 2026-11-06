/**
 * @module lib/taskMoveEvents
 * @description A move that the target refused for good is reported to the user wherever it was committed:
 * after its undo window, on the next start or on a reconnect (#322). `useTaskSync` commits and raises this event,
 * `useTaskMove` listens and shows the failure toast with its "Erneut versuchen" action. A module of its own
 * because the two composables import each other's world (the retry runs a new move).
 */
import type { SourceId } from '~/types/taskSource'

export interface TaskMoveRejection {
  taskId: string
  title: string
  /** Where the task is back */
  fromSource: SourceId
  /** The source that refused it */
  toSource: SourceId
  error: unknown
}

type Listener = (rejection: TaskMoveRejection) => void

const listeners = new Set<Listener>()

/** Subscribes to rejected moves; returns the unsubscribe function. */
export function onTaskMoveRejected(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyTaskMoveRejected(rejection: TaskMoveRejection): void {
  for (const listener of listeners) listener(rejection)
}
