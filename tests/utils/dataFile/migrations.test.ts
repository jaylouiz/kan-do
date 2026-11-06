import { describe, expect, it, vi } from 'vitest'
import { CURRENT_SCHEMA_VERSION, isDataEnvelope, storesToMirror, type DataEnvelope } from '~/utils/dataFile/envelope'
import { MIGRATIONS, migrateTaskSources, runMigrations, type Migration } from '~/utils/dataFile/migrations'
import { legacyTaskSource, normalizeBoardConfig, normalizeTasks } from '~/lib/taskSources'

const envelope = (schemaVersion: number, stores: Record<string, unknown> = {}): DataEnvelope => ({
  schemaVersion,
  writtenAt: '2026-01-01T00:00:00.000Z',
  writtenBy: 'device',
  appVersion: '0.1.0',
  stores,
})

describe('envelope', () => {
  it('recognises an envelope and rejects anything else', () => {
    expect(isDataEnvelope(envelope(1))).toBe(true)
    expect(isDataEnvelope({ schemaVersion: 0, stores: {} })).toBe(false)
    expect(isDataEnvelope({ schemaVersion: 1.5, stores: {} })).toBe(false)
    expect(isDataEnvelope({ schemaVersion: 1, stores: [] })).toBe(false)
    expect(isDataEnvelope(null)).toBe(false)
  })

  it('serialises stores the way the persist plugin reads them', () => {
    const mirror = storesToMirror({ 'tasks-store': { tasks: [1] } })
    expect(JSON.parse(mirror.get('tasks-store') as string)).toEqual({ tasks: [1] })
  })

  it('has one step per version above the baseline of 1', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2)
    expect(MIGRATIONS.map(step => [step.from, step.to])).toEqual([[1, 2]])
  })
})

describe('runMigrations', () => {
  const steps: Migration[] = [
    { from: 1, to: 2, up: e => ({ ...e, stores: { ...e.stores, a: 'one-to-two' } }) },
    { from: 2, to: 3, up: e => ({ ...e, stores: { ...e.stores, b: `${String(e.stores.a)}+two-to-three` } }) },
  ]

  it('leaves a current file alone and does not call beforeMigrate', async () => {
    const beforeMigrate = vi.fn()
    const raw = envelope(CURRENT_SCHEMA_VERSION)
    const outcome = await runMigrations(raw, { beforeMigrate })
    expect(outcome).toEqual({ kind: 'current', envelope: raw })
    expect(beforeMigrate).not.toHaveBeenCalled()
  })

  it('hydrates a higher schema read-only and never down-migrates it', async () => {
    const beforeMigrate = vi.fn()
    const raw = envelope(99, { x: 1 })
    const outcome = await runMigrations(raw, { migrations: steps, current: 3, beforeMigrate })
    expect(outcome.kind).toBe('read-only')
    expect(outcome.envelope).toBe(raw)
    expect(beforeMigrate).not.toHaveBeenCalled()
  })

  it('runs every step in order from the file version to the current one', async () => {
    const outcome = await runMigrations(envelope(1), { migrations: steps, current: 3, beforeMigrate: vi.fn() })
    expect(outcome.kind).toBe('migrated')
    expect(outcome.envelope.schemaVersion).toBe(3)
    expect(outcome.envelope.stores).toEqual({ a: 'one-to-two', b: 'one-to-two+two-to-three' })
  })

  it('starts at the file version, not at the first step', async () => {
    const outcome = await runMigrations(envelope(2, { a: 'kept' }), { migrations: steps, current: 3, beforeMigrate: vi.fn() })
    expect(outcome.envelope.stores).toEqual({ a: 'kept', b: 'kept+two-to-three' })
  })

  it('calls beforeMigrate once with the untouched raw file before the first step', async () => {
    const order: string[] = []
    const raw = envelope(1, { keep: true })
    const recording = steps.map(step => ({ ...step, up: (e: DataEnvelope) => { order.push(`up${step.from}`); return step.up(e) } }))
    await runMigrations(raw, {
      migrations: recording,
      current: 3,
      beforeMigrate: (seen) => { order.push('before'); expect(seen).toBe(raw); expect(seen.schemaVersion).toBe(1) },
    })
    expect(order).toEqual(['before', 'up1', 'up2'])
    expect(raw.schemaVersion).toBe(1)
    expect(raw.stores).toEqual({ keep: true })
  })

  it('fails loudly when a step is missing', async () => {
    await expect(runMigrations(envelope(1), { migrations: [], current: 2, beforeMigrate: vi.fn() })).rejects.toThrow(/schema 1/)
  })

  it('waits for the backup and stops the migration when it fails', async () => {
    const up = vi.fn((e: DataEnvelope) => e)
    const failing = vi.fn(() => Promise.reject(new Error('backup failed')))
    await expect(
      runMigrations(envelope(1), { migrations: [{ from: 1, to: 2, up }], current: 2, beforeMigrate: failing }),
    ).rejects.toThrow('backup failed')
    expect(up).not.toHaveBeenCalled()
  })

  it('refuses to migrate without a backup hook', async () => {
    const up = vi.fn((e: DataEnvelope) => e)
    await expect(runMigrations(envelope(1), { migrations: [{ from: 1, to: 2, up }], current: 2 })).rejects.toThrow(/backup/)
    expect(up).not.toHaveBeenCalled()
  })
})

describe('migration 1 -> 2: task sources (#326)', () => {
  const legacyTask = (id: string) => ({ id, title: id, status: 0 })
  const v1 = (service: unknown, taskIds: string[] = ['a', 'b']) => envelope(1, {
    'board-store': { boardConfig: { taskService: service, notionDatabaseId: 'db-1' }, columns: [], grouping: { enabled: false, key: null } },
    'tasks-store': {
      tasks: taskIds.map(legacyTask),
      deletedTaskIds: ['gone'],
      pendingDeletes: { a: { taskId: 'a', service, task: legacyTask('a'), carryOver: null, state: 'queued', requestedAt: 1 } },
    },
  })
  const run = (raw: DataEnvelope) => runMigrations(raw, { beforeMigrate: vi.fn() })

  it('maps a Notion board: connected notion, tasks stamped with their id as externalId', async () => {
    const { envelope: migrated, kind } = await run(v1('notion'))
    expect(kind).toBe('migrated')
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.stores['board-store']).toMatchObject({
      boardConfig: { sources: { connected: ['notion'], default: 'notion' }, notionDatabaseId: 'db-1' },
      columns: [],
    })
    expect('taskService' in (migrated.stores['board-store'] as { boardConfig: object }).boardConfig).toBe(false)
    const tasksStore = migrated.stores['tasks-store'] as { tasks: unknown[]; deletedTaskIds: string[]; pendingDeletes: Record<string, unknown> }
    expect(tasksStore.tasks).toEqual([
      { id: 'a', title: 'a', status: 0, source: 'notion', externalId: 'a' },
      { id: 'b', title: 'b', status: 0, source: 'notion', externalId: 'b' },
    ])
    expect(tasksStore.deletedTaskIds).toEqual(['gone'])
    expect(tasksStore.pendingDeletes.a).toEqual({
      taskId: 'a', task: { id: 'a', title: 'a', status: 0, source: 'notion', externalId: 'a' }, carryOver: null, state: 'queued', requestedAt: 1,
    })
  })

  it.each(['local', 'example'])('maps a %s board to Local with no externalId', async (service) => {
    const { envelope: migrated } = await run(v1(service))
    expect((migrated.stores['board-store'] as { boardConfig: { sources: unknown } }).boardConfig.sources).toEqual({ connected: [], default: 'local' })
    expect((migrated.stores['tasks-store'] as { tasks: unknown[] }).tasks).toEqual([
      { id: 'a', title: 'a', status: 0, source: 'local', externalId: null },
      { id: 'b', title: 'b', status: 0, source: 'local', externalId: null },
    ])
  })

  it('keeps "never onboarded" as sources: null', async () => {
    const { envelope: migrated } = await run(v1(null, []))
    expect((migrated.stores['board-store'] as { boardConfig: { sources: unknown } }).boardConfig.sources).toBeNull()
  })

  it('changes a store even for an otherwise empty file, so Rust rewrites it at version 2', async () => {
    const { envelope: migrated } = await run(envelope(1, {}))
    expect(migrated.stores['board-store']).toEqual({ boardConfig: { sources: null } })
  })

  it('drops the stored upstream payload (sourceData) of an older export (#334)', async () => {
    const raw = v1('notion')
    const store = raw.stores['tasks-store'] as { tasks: Array<Record<string, unknown>> }
    store.tasks[0] = { ...store.tasks[0], sourceData: { id: 'a', properties: {} } }
    const { envelope: migrated } = await run(raw)
    const tasks = (migrated.stores['tasks-store'] as { tasks: Array<Record<string, unknown>> }).tasks
    expect(tasks[0]).toEqual({ id: 'a', title: 'a', status: 0, source: 'notion', externalId: 'a' })
  })

  it('is idempotent: migrating the result again changes nothing', () => {
    const once = migrateTaskSources(v1('notion'))
    expect(migrateTaskSources(once)).toEqual(once)
  })

  it('gives the same result as the hydrate-time normalisation of the same data', () => {
    const raw = v1('notion')
    const migrated = migrateTaskSources(raw)
    const board = raw.stores['board-store'] as { boardConfig: unknown }
    const tasks = (raw.stores['tasks-store'] as { tasks: unknown[] }).tasks
    const hydratedBoard = normalizeBoardConfig(board.boardConfig)
    const hydratedTasks = normalizeTasks(tasks, legacyTaskSource(hydratedBoard.sources))
    expect((migrated.stores['board-store'] as { boardConfig: unknown }).boardConfig).toEqual(hydratedBoard)
    expect((migrated.stores['tasks-store'] as { tasks: unknown[] }).tasks).toEqual(hydratedTasks)
  })
})
