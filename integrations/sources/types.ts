/**
 * @module integrations/sources/types
 * @description The task source adapter: one interface for Local, Notion and Todoist (#318, epic #264 D3).
 *
 * `useTaskSync` routes a task's operation to the adapter of `task.source`, and the integration manager
 * fetches every connected source through its adapter. Adapters are thin wrappers: the integration classes
 * keep their behaviour. Adapters receive tasks, never ids: an integration is addressed by `externalIdOf(task)`.
 */
import type { Task } from '~/types/task'
import type { TaskStatus } from '~/types/taskStatus'
import type { IntegrationHealth } from '~/types/integration'
import type { SourceId } from '~/types/taskSource'

/** The source cannot be called: its credentials or configuration are missing. */
export class SourceNotConfiguredError extends Error {
  readonly source: SourceId

  constructor(source: SourceId, message: string) {
    super(message)
    this.name = 'SourceNotConfiguredError'
    this.source = source
  }
}

export interface TaskSourceAdapter {
  readonly id: SourceId
  /** Whether time spent is written upstream (Notion). Todoist has no such field, Local has no upstream. */
  readonly syncsTime: boolean

  /** Whether the source can be called (credentials and configuration present). Local always can. */
  isConfigured(): boolean

  /**
   * The source's active tasks. Rejects on any failure (`SourceNotConfiguredError` when it is not set up),
   * so a caller can tell a failed fetch from an empty one. Local returns the Local tasks of the board.
   */
  fetchActive(): Promise<Task[]>

  /** Creates a task upstream and resolves to it, source and externalId stamped. */
  create(draft: Partial<Task>): Promise<Task>

  /**
   * Writes the task's current state upstream. `change.previousStatus` is the status the source held before
   * (Todoist completes, or reopens when it was `Done`; `useTaskSync` takes it from the task's `pendingSync.upstreamDone`
   * when there is one, so a replay after a restart reopens too, #344). Resolves to the task as the source now holds it (Notion), or
   * `null` when the source returns nothing to merge back (Todoist, Local).
   */
  update(task: Task, change?: { previousStatus?: TaskStatus }): Promise<Task | null>

  /** Removes the task upstream: Notion archives the page, Todoist deletes the task, Local has nothing upstream. */
  remove(task: Task): Promise<void>

  /**
   * Brings a trashed task (#422) back to the source and resolves to it as the source now holds it, `id` kept
   * (the app-level identity never changes), `externalId` as the source knows it now. The caller passes the
   * snapshot with the status it is restored with. Local: nothing upstream. Notion: un-archives the same page
   * and writes the snapshot, creating a new page when the old one is gone. Todoist: creates a new task
   * (a new `externalId`; comments and other data kan-do never stored are not restored). Rejects on failure.
   */
  restore(task: Task): Promise<Task>

  /**
   * Whether archiving a task is a status write on the source's side (Notion with an archive status mapped, or
   * not configured: the write then fails as not configured and is reported once).
   */
  archivesAsStatus(): boolean

  /** Current health of the source (Local is always healthy). */
  health(): IntegrationHealth
}
