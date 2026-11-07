/**
 * @module integrations/sources/NotionSource
 * @description Thin adapter over `NotionIntegration`. The class is created per call from the current
 * Notion config (`useNotionIntegration`), so a changed config is picked up without a new adapter.
 */
import type { Task } from '~/types/task'
import type { IntegrationHealth } from '~/types/integration'
import type { NotionIntegration } from '~/integrations/NotionIntegration'
import { externalIdOf, sourceSyncsTime } from '~/lib/taskSources'
import { SourceNotConfiguredError, type TaskSourceAdapter } from './types'

export interface NotionSourceDeps {
  isConfigured: () => boolean
  /** Resolves a missing data source selection for a legacy config; `false` when it cannot. */
  ensureDataSource: () => Promise<boolean>
  createInstance: () => NotionIntegration
  /** The Notion status an archived task is written as; `null` when none is mapped. */
  archiveStatus: () => string | null
  health: () => IntegrationHealth
}

const NOT_CONFIGURED = 'Notion integration is not properly configured'

export class NotionSource implements TaskSourceAdapter {
  readonly id = 'notion' as const
  readonly syncsTime = sourceSyncsTime('notion')

  constructor(private readonly deps: NotionSourceDeps) {}

  isConfigured(): boolean {
    return this.deps.isConfigured()
  }

  private instance(): NotionIntegration {
    if (!this.deps.isConfigured()) throw new SourceNotConfiguredError('notion', NOT_CONFIGURED)
    return this.deps.createInstance()
  }

  async fetchActive(): Promise<Task[]> {
    if (!this.deps.isConfigured()) throw new SourceNotConfiguredError('notion', NOT_CONFIGURED)
    if (!(await this.deps.ensureDataSource())) {
      throw new Error('Notion data source is not configured')
    }
    return this.deps.createInstance().fetchActiveBoardTasks()
  }

  async create(draft: Partial<Task>): Promise<Task> {
    // `createInstance` rejects an unconfigured Notion with the localized setup error the add form shows
    return this.deps.createInstance().createTask(draft)
  }

  async update(task: Task, change: { timeEdited?: boolean } = {}): Promise<Task | null> {
    return change.timeEdited ? this.instance().updateTask(task, { timeEdited: true }) : this.instance().updateTask(task)
  }

  async remove(task: Task): Promise<void> {
    await this.instance().archiveTask(externalIdOf(task))
  }

  /**
   * Un-archives the task's page and writes the snapshot onto it (the page kept the properties of the last
   * upstream write, which may differ from the snapshot). A page Notion no longer has (404) is created anew.
   */
  async restore(task: Task): Promise<Task> {
    const notion = this.instance()
    if (task.externalId !== null) {
      let gone = false
      try {
        await notion.unarchiveTask(externalIdOf(task))
      } catch (error) {
        // Only the un-archive says "gone"; a 404 from the write below must not create a second page
        if ((error as { statusCode?: number } | null)?.statusCode !== 404) throw error
        gone = true
      }
      if (!gone) {
        const held = await notion.updateTask(task)
        return { ...task, ...(held ?? {}), id: task.id, source: 'notion', externalId: task.externalId }
      }
    }
    const created = await notion.createTask(task)
    return { ...task, ...created, id: task.id, source: 'notion', externalId: created.externalId ?? created.id }
  }

  /** Without a configuration the mapping is unknown: answer yes, so the write fails once as not configured. */
  archivesAsStatus(): boolean {
    return !this.deps.isConfigured() || this.deps.archiveStatus() !== null
  }

  health(): IntegrationHealth {
    return this.deps.health()
  }
}
