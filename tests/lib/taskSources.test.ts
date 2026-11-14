import { describe, expect, it } from 'vitest'
import {
  deleteLabelKey,
  externalIdOf,
  normalizeBoardConfig,
  normalizePendingSync,
  normalizePendingDeletes,
  normalizeSources,
  normalizeTasks,
  sourcesFromLegacyService,
  singleSource,
  sourceSyncsTime,
  sourceTaskUrl,
} from '~/lib/taskSources'

describe('sourcesFromLegacyService', () => {
  it('maps notion and todoist to a connected default', () => {
    expect(sourcesFromLegacyService('notion')).toEqual({ connected: ['notion'], default: 'notion' })
    expect(sourcesFromLegacyService('todoist')).toEqual({ connected: ['todoist'], default: 'todoist' })
  })

  it('maps local and example to Local with nothing connected', () => {
    expect(sourcesFromLegacyService('local')).toEqual({ connected: [], default: 'local' })
    expect(sourcesFromLegacyService('example')).toEqual({ connected: [], default: 'local' })
  })

  it('keeps "never onboarded" and drops unknown services (removed Linear)', () => {
    expect(sourcesFromLegacyService(null)).toBeNull()
    expect(sourcesFromLegacyService(undefined)).toBeNull()
    expect(sourcesFromLegacyService('linear')).toBeNull()
  })
})

describe('normalizeSources', () => {
  it('keeps a valid shape unchanged', () => {
    const sources = { connected: ['notion'], default: 'local' }
    expect(normalizeSources(sources)).toEqual(sources)
  })

  it('drops unknown and duplicate connections and repairs a default that is not usable', () => {
    expect(normalizeSources({ connected: ['notion', 'notion', 'linear', 'local'], default: 'todoist' }))
      .toEqual({ connected: ['notion'], default: 'local' })
  })

  it('returns null for anything that is not an object', () => {
    expect(normalizeSources(null)).toBeNull()
    expect(normalizeSources('notion')).toBeNull()
  })
})

describe('normalizeBoardConfig', () => {
  it('migrates a legacy notion config and drops taskService', () => {
    const migrated = normalizeBoardConfig({ taskService: 'notion', notionDatabaseId: 'db' })
    expect(migrated).toEqual({ sources: { connected: ['notion'], default: 'notion' }, notionDatabaseId: 'db' })
    expect('taskService' in migrated).toBe(false)
  })

  it('migrates local and example to Local', () => {
    expect(normalizeBoardConfig({ taskService: 'local' }).sources).toEqual({ connected: [], default: 'local' })
    expect(normalizeBoardConfig({ taskService: 'example' }).sources).toEqual({ connected: [], default: 'local' })
  })

  it('keeps never onboarded as sources: null', () => {
    expect(normalizeBoardConfig({ taskService: null })).toEqual({ sources: null })
    expect(normalizeBoardConfig(undefined)).toEqual({ sources: null })
    expect(normalizeBoardConfig({})).toEqual({ sources: null })
  })

  it('drops removed Linear state', () => {
    expect(normalizeBoardConfig({ taskService: 'linear', linearApiKey: 'lin_secret' })).toEqual({ sources: null })
  })

  it('prefers an existing sources shape over a stale taskService', () => {
    const migrated = normalizeBoardConfig({ taskService: 'local', sources: { connected: ['notion'], default: 'notion' } })
    expect(migrated.sources).toEqual({ connected: ['notion'], default: 'notion' })
  })

  it('treats a half-written sources value as absent and falls back to taskService', () => {
    expect(normalizeBoardConfig({ taskService: 'notion', sources: {} }).sources)
      .toEqual({ connected: ['notion'], default: 'notion' })
    expect(normalizeBoardConfig({ taskService: 'todoist', sources: { connected: ['notion'] } }).sources)
      .toEqual({ connected: ['todoist'], default: 'todoist' })
  })

  it('keeps pendingSourceSwitch only as true next to an integration default, absent stays absent', () => {
    const notion = { sources: { connected: ['notion'], default: 'notion' } }
    expect(normalizeBoardConfig({ ...notion, pendingSourceSwitch: true })).toEqual({ ...notion, pendingSourceSwitch: true })
    expect(normalizeBoardConfig(notion)).not.toHaveProperty('pendingSourceSwitch')
    expect(normalizeBoardConfig({ ...notion, pendingSourceSwitch: 'yes' })).not.toHaveProperty('pendingSourceSwitch')
    expect(normalizeBoardConfig({ sources: { connected: [], default: 'local' }, pendingSourceSwitch: true })).not.toHaveProperty('pendingSourceSwitch')
    expect(normalizeBoardConfig({ taskService: null, pendingSourceSwitch: true })).not.toHaveProperty('pendingSourceSwitch')
  })

  it('is idempotent', () => {
    for (const raw of [{ sources: { connected: ['notion'], default: 'notion' }, pendingSourceSwitch: true }, { taskService: 'notion' }, { taskService: 'local' }, { taskService: null }, {}, undefined]) {
      const once = normalizeBoardConfig(raw)
      expect(normalizeBoardConfig(once)).toEqual(once)
    }
  })
})

describe('normalizeTasks', () => {
  it('stamps legacy notion tasks with their id as externalId', () => {
    const [task] = normalizeTasks([{ id: 'page-1', title: 'A' }], 'notion')
    expect(task).toMatchObject({ id: 'page-1', source: 'notion', externalId: 'page-1' })
  })

  it('stamps legacy local tasks without an externalId', () => {
    const [task] = normalizeTasks([{ id: 'abc', title: 'A' }], 'local')
    expect(task).toMatchObject({ id: 'abc', source: 'local', externalId: null })
  })

  it('leaves tasks that already carry a source alone, including their externalId', () => {
    const task = { id: 'abc', source: 'notion', externalId: 'page-9' }
    expect(normalizeTasks([task], 'local')).toEqual([task])
  })

  it('completes a half-migrated task from its own source', () => {
    const [notion] = normalizeTasks([{ id: 'p', source: 'notion' }], 'local')
    const [local] = normalizeTasks([{ id: 'l', source: 'local', externalId: 'stale' }], 'notion')
    expect(notion).toMatchObject({ source: 'notion', externalId: 'p' })
    expect(local).toMatchObject({ source: 'local', externalId: null })
  })

  it('returns the same array when nothing changes, so hydration can skip the write', () => {
    const tasks = [{ id: 'a', source: 'local', externalId: null }]
    expect(normalizeTasks(tasks, 'local')).toBe(tasks)
  })

  it('is idempotent', () => {
    const once = normalizeTasks([{ id: 'a' }, { id: 'b' }], 'notion')
    expect(normalizeTasks(once, 'local')).toBe(once)
  })
})

describe('legacy sourceData (#334)', () => {
  const upstream = { id: 'page-1', properties: { Name: { title: [] } } }

  it('drops the raw upstream payload of a stored task and keeps the rest', () => {
    const [task] = normalizeTasks([{ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A', sourceData: upstream }], 'notion')
    expect(task).not.toHaveProperty('sourceData')
    expect(task).toEqual({ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A' })
  })

  it('drops it together with the source stamp of a legacy task, and from other sources', () => {
    const [legacy, todoist] = normalizeTasks([
      { id: 'a', title: 'A', sourceData: upstream },
      { id: 't', source: 'todoist', externalId: 't', sourceData: { id: 't' } },
    ], 'notion')
    expect(legacy).toMatchObject({ source: 'notion', externalId: 'a' })
    expect(legacy).not.toHaveProperty('sourceData')
    expect(todoist).not.toHaveProperty('sourceData')
  })

  it('is idempotent and returns the same array once it is gone, so hydration does not write', () => {
    const once = normalizeTasks([{ id: 'a', source: 'notion', externalId: 'a', sourceData: upstream }], 'notion')
    expect(normalizeTasks(once, 'notion')).toBe(once)
    const clean = [{ id: 'b', source: 'notion', externalId: 'b' }]
    expect(normalizeTasks(clean, 'notion')).toBe(clean)
  })

  it('also cleans the task snapshot of a pending delete', () => {
    const result = normalizePendingDeletes(
      { a: { taskId: 'a', task: { id: 'a', source: 'notion', externalId: 'a', sourceData: upstream }, state: 'queued' } },
      'notion',
    )
    expect(result.a?.task).toEqual({ id: 'a', source: 'notion', externalId: 'a' })
  })
})

describe('normalizePendingDeletes', () => {
  it('derives the snapshot source from the legacy service field and drops the field', () => {
    const result = normalizePendingDeletes(
      { 'p-1': { taskId: 'p-1', service: 'notion', task: { id: 'p-1' }, state: 'queued' } },
      'local',
    )
    expect(result['p-1']).toEqual({ taskId: 'p-1', task: { id: 'p-1', source: 'notion', externalId: 'p-1' }, state: 'queued' })
  })

  it('is a no-op on the new shape', () => {
    const pending = { a: { taskId: 'a', task: { id: 'a', source: 'local', externalId: null }, state: 'waiting' } }
    expect(normalizePendingDeletes(pending, 'local')).toBe(pending)
  })
})

describe('helpers', () => {
  it('singleSource builds the config for one source', () => {
    expect(singleSource('local')).toEqual({ connected: [], default: 'local' })
    expect(singleSource('notion')).toEqual({ connected: ['notion'], default: 'notion' })
  })

  it('externalIdOf returns the id an integration receives and fails loudly for Local tasks', () => {
    expect(externalIdOf({ id: 'a', source: 'notion', externalId: 'page' })).toBe('page')
    expect(() => externalIdOf({ id: 'a', source: 'local', externalId: null })).toThrow(/externalId/)
  })
})

describe('pendingSync marker (#319)', () => {
  const marker = { since: 1700000000000, attempts: 2, lastError: 'offline' }

  it('keeps a valid marker and returns the very same array, so hydration does not write', () => {
    const tasks = [{ id: 'a', source: 'notion', externalId: 'a', pendingSync: marker }]
    expect(normalizeTasks(tasks, 'notion')).toBe(tasks)
    expect(normalizePendingSync(marker)).toBe(marker)
  })

  it('keeps upstreamDone (#344) without a write, and drops a value that is not a boolean', () => {
    const withNote = { ...marker, upstreamDone: true }
    const tasks = [{ id: 'a', source: 'todoist', externalId: 'a', pendingSync: withNote }]
    expect(normalizeTasks(tasks, 'todoist')).toBe(tasks)
    expect(normalizePendingSync(withNote)).toBe(withNote)
    expect(normalizePendingSync({ ...marker, upstreamDone: 'yes' })).toEqual(marker)
  })

  it('repairs a half-written marker so the task still gets pushed', () => {
    const [task] = normalizeTasks([{ id: 'a', source: 'notion', externalId: 'a', pendingSync: { since: 5 } }], 'notion') as Array<{ pendingSync: unknown }>
    expect(task?.pendingSync).toEqual({ since: 5, attempts: 0, lastError: null })
  })

  it('drops a marker on a Local task (no upstream) but keeps its move (the origin copy is still to be removed)', () => {
    const pendingMove = { fromSource: 'notion', fromExternalId: 'p1', toSource: 'local' }
    const [local] = normalizeTasks([
      { id: 'l', source: 'local', externalId: null, pendingSync: marker, pendingMove },
    ], 'local') as Array<Record<string, unknown>>
    expect(local).not.toHaveProperty('pendingSync')
    expect(local).toHaveProperty('pendingMove', pendingMove)
  })

  it('keeps a move without a marker (the page is created, the origin copy is queued for removal)', () => {
    const pendingMove = { fromSource: 'local', fromExternalId: null, toSource: 'notion' }
    const tasks = [{ id: 'm', source: 'notion', externalId: 'page-9', pendingMove }]
    expect(normalizeTasks(tasks, 'notion')).toBe(tasks)
  })

  it('does not stamp an externalId on a moved task whose page is not created yet', () => {
    const pendingMove = { fromSource: 'local', fromExternalId: null, toSource: 'notion' }
    const [moved] = normalizeTasks([{ id: 'm', source: 'notion', externalId: null, pendingMove }], 'notion')
    expect(moved).toMatchObject({ externalId: null, pendingMove })
  })

  it('keeps a valid move next to its marker', () => {
    const pendingMove = { fromSource: 'local', fromExternalId: null, toSource: 'notion' }
    const tasks = [{ id: 'm', source: 'notion', externalId: 'm', pendingSync: marker, pendingMove }]
    expect(normalizeTasks(tasks, 'notion')).toBe(tasks)
  })

  it('leaves the externalId of a task created offline null, but still stamps a legacy task without a marker', () => {
    const [created] = normalizeTasks([{ id: 'n', source: 'notion', externalId: null, pendingSync: marker }], 'notion')
    const [legacy] = normalizeTasks([{ id: 'p', source: 'notion', externalId: null }], 'notion')
    expect(created).toMatchObject({ externalId: null, pendingSync: marker })
    expect(legacy).toMatchObject({ externalId: 'p' })
  })

  it('only Notion stores time spent', () => {
    expect(['local', 'notion', 'todoist'].map((id) => sourceSyncsTime(id as 'local'))).toEqual([false, true, false])
  })
})

describe('deleteLabelKey', () => {
  it('names the upstream for Notion and Todoist and stays plain for Local', () => {
    expect(deleteLabelKey('local')).toBe('task.delete.local')
    expect(deleteLabelKey('notion')).toBe('task.delete.notion')
    expect(deleteLabelKey('todoist')).toBe('task.delete.todoist')
  })
})

describe('sourceTaskUrl (#296)', () => {
  it('builds the Notion page URL from the external id, dashes removed', () => {
    expect(sourceTaskUrl({ source: 'notion', externalId: '1a2b3c4d-1111-2222-3333-444455556666' })).toBe('https://www.notion.so/1a2b3c4d111122223333444455556666')
  })

  it('builds the Todoist task URL from the external id', () => {
    expect(sourceTaskUrl({ source: 'todoist', externalId: '6Xc9Q' })).toBe('https://app.todoist.com/app/task/6Xc9Q')
  })

  it('has none for a Local task or a task whose create is still pending', () => {
    expect(sourceTaskUrl({ source: 'local', externalId: null })).toBeNull()
    expect(sourceTaskUrl({ source: 'local', externalId: 'x' })).toBeNull()
    expect(sourceTaskUrl({ source: 'notion', externalId: null })).toBeNull()
    expect(sourceTaskUrl({ source: 'todoist', externalId: null })).toBeNull()
  })
})
