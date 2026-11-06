/**
 * @module integrations/sources/TodoistSource
 * @description Thin adapter over `TodoistIntegration`. Not wired to any UI as a second source yet (#320).
 * Every call rejects on failure, a fetch included (`fetchActiveBoardTasks`), so a failed Todoist fetch is
 * distinguishable from an empty one.
 */
import type { Task } from '~/types/task'
import type { IntegrationHealth } from '~/types/integration'
import { TaskStatus } from '~/types/taskStatus'
import { TodoistIntegration } from '~/integrations/TodoistIntegration'
import { externalIdOf } from '~/lib/taskSources'
import { SourceNotConfiguredError, type TaskSourceAdapter } from './types'

export interface TodoistSourceDeps {
  apiToken: () => string | null | undefined
  health: () => IntegrationHealth
}

const NO_TOKEN = 'Todoist API token is not set'

export class TodoistSource implements TaskSourceAdapter {
  readonly id = 'todoist' as const
  readonly syncsTime = false

  constructor(private readonly deps: TodoistSourceDeps) {}

  isConfigured(): boolean {
    return !!this.deps.apiToken()
  }

  private instance(): TodoistIntegration {
    const token = this.deps.apiToken()
    if (!token) throw new SourceNotConfiguredError('todoist', NO_TOKEN)
    return new TodoistIntegration(token)
  }

  async fetchActive(): Promise<Task[]> {
    return this.instance().fetchActiveBoardTasks()
  }

  create(): Promise<Task> {
    return Promise.reject(new Error('Creating tasks in Todoist is not supported'))
  }

  async update(task: Task, change: { previousStatus?: TaskStatus } = {}): Promise<Task | null> {
    const todoist = this.instance()
    if (task.status === TaskStatus.Done) {
      await todoist.completeTask(externalIdOf(task))
    } else if (change.previousStatus === TaskStatus.Done) {
      await todoist.reopenTask(externalIdOf(task))
    }
    return null
  }

  async remove(task: Task): Promise<void> {
    await this.instance().deleteTask(externalIdOf(task))
  }

  /** Todoist deleted the task for good: restoring creates it anew (new `externalId`, the app `id` stays). */
  async restore(task: Task): Promise<Task> {
    const created = await this.instance().createTask(task)
    return { ...task, ...created, id: task.id, source: 'todoist', externalId: created.externalId ?? created.id }
  }

  archivesAsStatus(): boolean {
    return false
  }

  health(): IntegrationHealth {
    return this.deps.health()
  }
}
