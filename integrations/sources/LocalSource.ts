/**
 * @module integrations/sources/LocalSource
 * @description Local tasks live in the app (Pinia) only: nothing is fetched from or written to an upstream.
 */
import type { Task } from '~/types/task'
import { generateTaskId } from '~/lib/taskSources'
import { normalizePriority } from '~/lib/priority'
import type { TaskSourceAdapter } from './types'

export class LocalSource implements TaskSourceAdapter {
  readonly id = 'local' as const
  readonly syncsTime = false

  /** @param localTasks The Local tasks currently on the board */
  constructor(private readonly localTasks: () => Task[]) {}

  isConfigured(): boolean {
    return true
  }

  async fetchActive(): Promise<Task[]> {
    return this.localTasks()
  }

  async create(draft: Partial<Task>): Promise<Task> {
    const now = new Date()
    return {
      id: generateTaskId(),
      source: 'local',
      externalId: null,
      title: draft.title || 'Untitled',
      notes: draft.notes || null,
      status: draft.status!,
      priority: normalizePriority(draft.priority),
      timeBoxSeconds: draft.timeBoxSeconds || null,
      timeSpentSeconds: draft.timeSpentSeconds || 0,
      topic: draft.topic || null,
      topicColorCode: draft.topicColorCode || null,
      activity: draft.activity || null,
      timerId: null,
      custom: draft.custom || {},
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      isUnplanned: draft.isUnplanned || false,
    }
  }

  async update(): Promise<Task | null> {
    return null
  }

  async remove(): Promise<void> {}

  async restore(task: Task): Promise<Task> {
    return task
  }

  archivesAsStatus(): boolean {
    return false
  }

  health() {
    return 'healthy' as const
  }
}
