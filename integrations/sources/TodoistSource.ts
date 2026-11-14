/**
 * @module integrations/sources/TodoistSource
 * @description Thin adapter over `TodoistIntegration`. Not wired to any UI as a second source yet (#320).
 * Every call rejects on failure, a fetch included (`fetchActiveBoardTasks`), so a failed Todoist fetch is
 * distinguishable from an empty one.
 *
 * The integration (and with it the Todoist SDK, 321 kB) is imported on the first call, never statically (#275):
 * `useTaskSources` imports this adapter on every board, and a board without Todoist must not download the SDK.
 * `tests/config/lazy-sdk.test.ts` fails on a static import.
 */
import type { Task } from '~/types/task'
import type { IntegrationHealth } from '~/types/integration'
import { TaskStatus } from '~/types/taskStatus'
import type { TodoistIntegration } from '~/integrations/TodoistIntegration'
import { externalIdOf } from '~/lib/taskSources'
import { SourceNotConfiguredError, type TaskSourceAdapter } from './types'

export interface TodoistSourceDeps {
  apiToken: () => string | null | undefined
  health: () => IntegrationHealth
}

const NO_TOKEN = 'Todoist API token is not set'

/**
 * One load for every call and every adapter (adapters are built per call, `useTaskSources`). A load that fails (the
 * browser went offline before the chunk was fetched) is forgotten, so the next call tries again; the failure itself is a
 * `TypeError`, which `isNetworkError` already treats as "offline".
 */
let integrationModule: Promise<typeof import('~/integrations/TodoistIntegration')> | null = null
function loadIntegration() {
  integrationModule ??= import('~/integrations/TodoistIntegration').catch((error: unknown) => {
    integrationModule = null
    throw error
  })
  return integrationModule
}

export class TodoistSource implements TaskSourceAdapter {
  readonly id = 'todoist' as const
  readonly syncsTime = false

  constructor(private readonly deps: TodoistSourceDeps) {}

  isConfigured(): boolean {
    return !!this.deps.apiToken()
  }

  /** The token, read when the call is made; throws `SourceNotConfiguredError` without one, before anything is loaded. */
  private token(): string {
    const token = this.deps.apiToken()
    if (!token) throw new SourceNotConfiguredError('todoist', NO_TOKEN)
    return token
  }

  /** Loads the integration (once per page) and builds an instance for `token`. */
  private async load(token: string): Promise<TodoistIntegration> {
    const { TodoistIntegration } = await loadIntegration()
    return new TodoistIntegration(token)
  }

  // Every method reads the token and what it needs from `task` before its first `await`: `task` is the live store
  // object and loading the integration yields, so a second status change made meanwhile must not rewrite this call's
  // write (two quick moves of one card: `useTaskSync.todoistFailure.test.ts`).

  async fetchActive(): Promise<Task[]> {
    return (await this.load(this.token())).fetchActiveBoardTasks()
  }

  create(): Promise<Task> {
    return Promise.reject(new Error('Creating tasks in Todoist is not supported'))
  }

  async update(task: Task, change: { previousStatus?: TaskStatus } = {}): Promise<Task | null> {
    const token = this.token()
    const write = task.status === TaskStatus.Done ? 'complete' : change.previousStatus === TaskStatus.Done ? 'reopen' : null
    if (!write) return null // nothing to write: do not load the SDK chunk (offline it would reject and strand a pendingSync)
    const externalId = externalIdOf(task)
    const todoist = await this.load(token)
    if (write === 'complete' && externalId) await todoist.completeTask(externalId)
    else if (write === 'reopen' && externalId) await todoist.reopenTask(externalId)
    return null
  }

  async remove(task: Task): Promise<void> {
    const token = this.token()
    const externalId = externalIdOf(task)
    await (await this.load(token)).deleteTask(externalId)
  }

  /** Todoist deleted the task for good: restoring creates it anew (new `externalId`, the app `id` stays). */
  async restore(task: Task): Promise<Task> {
    const token = this.token()
    const snapshot = { ...task }
    const created = await (await this.load(token)).createTask(snapshot)
    return { ...snapshot, ...created, id: snapshot.id, source: 'todoist', externalId: created.externalId ?? created.id }
  }

  archivesAsStatus(): boolean {
    return false
  }

  health(): IntegrationHealth {
    return this.deps.health()
  }
}
