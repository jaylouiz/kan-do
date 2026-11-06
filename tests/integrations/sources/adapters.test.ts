import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { NotionIntegration } from '~/integrations/NotionIntegration'

const todoist = {
  createTask: vi.fn(),
  getActiveBoardTasks: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
}
vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return todoist
  }),
}))

/* eslint-disable import/first -- order-sensitive: the mock must be registered before the adapter is imported */
import { LocalSource } from '~/integrations/sources/LocalSource'
import { NotionSource } from '~/integrations/sources/NotionSource'
import { TodoistSource } from '~/integrations/sources/TodoistSource'
import { SourceNotConfiguredError } from '~/integrations/sources/types'
/* eslint-enable import/first */

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 't1', source: 'notion', externalId: 'page-1', title: 'T', status: TaskStatus.Open, activity: null,
  topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  ...overrides,
})

describe('LocalSource', () => {
  it('fetches the Local tasks it is given, writes nothing upstream and is always healthy', async () => {
    const local = new LocalSource(() => [task({ id: 'l1', source: 'local', externalId: null })])
    expect((await local.fetchActive()).map((t) => t.id)).toEqual(['l1'])
    expect(await local.update()).toBeNull()
    await expect(local.remove()).resolves.toBeUndefined()
    const trashed = task({ source: 'local', externalId: null })
    expect(await local.restore(trashed)).toBe(trashed)
    expect(local.isConfigured()).toBe(true)
    expect(local.health()).toBe('healthy')
    expect(local.syncsTime).toBe(false)
    expect(local.archivesAsStatus()).toBe(false)
  })

  it('creates a Local task with a generated id and no externalId', async () => {
    const created = await new LocalSource(() => []).create({ title: 'New', status: TaskStatus.Open })
    expect(created).toMatchObject({ source: 'local', externalId: null, title: 'New', status: TaskStatus.Open })
    expect(created.id).toMatch(/^local_/)
  })

  it('keeps the activity of the draft (the guided new card asks for it, #649)', async () => {
    const created = await new LocalSource(() => []).create({ title: 'New', status: TaskStatus.Open, activity: 'Planung' })
    expect(created.activity).toBe('Planung')
    expect((await new LocalSource(() => []).create({ title: 'New', status: TaskStatus.Open })).activity).toBeNull()
  })

  it('create gives a task without a priority Normal, and keeps a chosen one (#653)', async () => {
    const local = new LocalSource(() => [])
    expect((await local.create({ title: 'New', status: TaskStatus.Open })).priority).toBe(2)
    expect((await local.create({ title: 'New', status: TaskStatus.Open, priority: 0 })).priority).toBe(2)
    expect((await local.create({ title: 'New', status: TaskStatus.Open, priority: 1 })).priority).toBe(1)
  })
})

describe('NotionSource', () => {
  const integration = {
    fetchActiveBoardTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    archiveTask: vi.fn(),
    unarchiveTask: vi.fn(),
  }
  let configured: boolean
  let dataSource: boolean
  let archive: string | null
  const build = () => new NotionSource({
    isConfigured: () => configured,
    ensureDataSource: async () => dataSource,
    createInstance: () => integration as unknown as NotionIntegration,
    archiveStatus: () => archive,
    health: () => 'offline',
  })

  beforeEach(() => {
    Object.values(integration).forEach((fn) => fn.mockReset())
    configured = true
    dataSource = true
    archive = null
  })

  it('fetches through the throwing variant so a failure is not an empty list', async () => {
    integration.fetchActiveBoardTasks.mockResolvedValue([task()])
    expect(await build().fetchActive()).toHaveLength(1)

    integration.fetchActiveBoardTasks.mockRejectedValue(new Error('boom'))
    await expect(build().fetchActive()).rejects.toThrow('boom')
  })

  it('rejects with SourceNotConfiguredError when Notion is not set up, and with an error without a data source', async () => {
    configured = false
    await expect(build().fetchActive()).rejects.toBeInstanceOf(SourceNotConfiguredError)
    configured = true
    dataSource = false
    await expect(build().fetchActive()).rejects.toThrow('data source is not configured')
    expect(integration.fetchActiveBoardTasks).not.toHaveBeenCalled()
  })

  it('updates the task and resolves to what Notion holds afterwards', async () => {
    const synced = task({ title: 'Synced' })
    integration.updateTask.mockResolvedValue(synced)
    expect(await build().update(task())).toBe(synced)
    expect(integration.updateTask).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'page-1' }))
  })

  it('archives the page by externalId on remove', async () => {
    await build().remove(task())
    expect(integration.archiveTask).toHaveBeenCalledWith('page-1')
  })

  it('refuses to write a Local task: it has no externalId', async () => {
    await expect(build().remove(task({ source: 'local', externalId: null }))).rejects.toThrow('has no externalId')
  })

  it('writes without calling Notion when it is not configured', async () => {
    configured = false
    await expect(build().update(task())).rejects.toMatchObject({ message: 'Notion integration is not properly configured' })
    expect(integration.updateTask).not.toHaveBeenCalled()
  })

  it('reports what it syncs: time, archive-as-status, health', () => {
    expect(build().syncsTime).toBe(true)
    expect(build().archivesAsStatus()).toBe(false)
    archive = 'Archive'
    expect(build().archivesAsStatus()).toBe(true)
    expect(build().health()).toBe('offline')
  })

  it('does not skip the archive write without a configuration, so it reports the missing setup (#340 review)', async () => {
    configured = false
    expect(build().archivesAsStatus()).toBe(true)
    await expect(build().update(task())).rejects.toBeInstanceOf(SourceNotConfiguredError)
  })

  it('creates through the integration', async () => {
    integration.createTask.mockResolvedValue(task({ id: 'new' }))
    expect((await build().create({ title: 'x' })).id).toBe('new')
  })

  describe('restore (#422)', () => {
    it('un-archives the same page, writes the snapshot onto it and keeps id and externalId', async () => {
      integration.unarchiveTask.mockResolvedValue(undefined)
      integration.updateTask.mockResolvedValue(task({ title: 'As Notion holds it' }))
      const restored = await build().restore(task({ status: TaskStatus.Open }))
      expect(integration.unarchiveTask).toHaveBeenCalledWith('page-1')
      expect(integration.updateTask).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'page-1', status: TaskStatus.Open }))
      expect(integration.createTask).not.toHaveBeenCalled()
      expect(restored).toMatchObject({ id: 't1', externalId: 'page-1', source: 'notion' })
    })

    it('creates a new page when Notion no longer has the old one (404), the app id stays', async () => {
      integration.unarchiveTask.mockRejectedValue(Object.assign(new Error('Not found'), { statusCode: 404 }))
      integration.createTask.mockResolvedValue(task({ id: 'page-2', externalId: 'page-2' }))
      const restored = await build().restore(task())
      expect(integration.updateTask).not.toHaveBeenCalled()
      expect(restored).toMatchObject({ id: 't1', externalId: 'page-2' })
    })

    it('a 404 from the write after a successful un-archive rejects: no second page', async () => {
      integration.unarchiveTask.mockResolvedValue(undefined)
      integration.updateTask.mockRejectedValue(Object.assign(new Error('Not found'), { statusCode: 404 }))
      await expect(build().restore(task())).rejects.toThrow('Not found')
      expect(integration.createTask).not.toHaveBeenCalled()
    })

    it('any other failure rejects without creating a second page', async () => {
      integration.unarchiveTask.mockRejectedValue(Object.assign(new Error('Bad Gateway'), { statusCode: 502 }))
      await expect(build().restore(task())).rejects.toThrow('Bad Gateway')
      expect(integration.createTask).not.toHaveBeenCalled()
    })

    it('rejects as not configured without calling Notion', async () => {
      configured = false
      await expect(build().restore(task())).rejects.toBeInstanceOf(SourceNotConfiguredError)
    })
  })
})

describe('TodoistSource', () => {
  let token: string | null
  const build = () => new TodoistSource({ apiToken: () => token, health: () => 'healthy' })

  beforeEach(() => {
    Object.values(todoist).forEach((fn) => fn.mockReset())
    todoist.completeTask.mockResolvedValue(undefined)
    todoist.reopenTask.mockResolvedValue(undefined)
    todoist.deleteTask.mockResolvedValue(undefined)
    token = 'token'
  })

  const todoistTask = (overrides: Partial<Task> = {}) => task({ source: 'todoist', externalId: 'td-1', ...overrides })

  it('restore (#422) creates a new Todoist task: new externalId, the app id stays', async () => {
    todoist.createTask.mockResolvedValue(todoistTask({ id: 'td-9', externalId: 'td-9' }))
    const restored = await build().restore(todoistTask({ id: 'td-1' }))
    expect(todoist.createTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'td-1', title: 'T' }))
    expect(restored).toMatchObject({ id: 'td-1', externalId: 'td-9', source: 'todoist' })
  })

  it('restore (#422) rejects without a token', async () => {
    token = null
    await expect(build().restore(todoistTask())).rejects.toBeInstanceOf(SourceNotConfiguredError)
  })

  it('completes on Done, reopens when it left Done, and writes nothing otherwise', async () => {
    const source = build()
    expect(await source.update(todoistTask({ status: TaskStatus.Done }), { previousStatus: TaskStatus.Open })).toBeNull()
    expect(todoist.completeTask).toHaveBeenCalledWith('td-1')

    await source.update(todoistTask({ status: TaskStatus.Open }), { previousStatus: TaskStatus.Done })
    expect(todoist.reopenTask).toHaveBeenCalledWith('td-1')

    await source.update(todoistTask({ status: TaskStatus.Progress }), { previousStatus: TaskStatus.Open })
    expect(todoist.completeTask).toHaveBeenCalledTimes(1)
    expect(todoist.reopenTask).toHaveBeenCalledTimes(1)
  })

  it('deletes by externalId on remove', async () => {
    await build().remove(todoistTask())
    expect(todoist.deleteTask).toHaveBeenCalledWith('td-1')
  })

  it('rejects with SourceNotConfiguredError without a token', async () => {
    token = ''
    const source = build()
    expect(source.isConfigured()).toBe(false)
    await expect(source.update(todoistTask({ status: TaskStatus.Done }))).rejects.toMatchObject({
      name: 'SourceNotConfiguredError', message: 'Todoist API token is not set',
    })
    await expect(source.fetchActive()).rejects.toBeInstanceOf(SourceNotConfiguredError)
  })

  it('does not create tasks yet and has no time field', async () => {
    await expect(build().create()).rejects.toThrow('not supported')
    expect(build().syncsTime).toBe(false)
  })
})
