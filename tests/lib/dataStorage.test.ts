import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appStorage, dataState, freezeWrites, initDataStorage, isWritesFrozen, PERSISTED_KEYS, resetDataStorage, snapshotMirror, unfreezeWrites, withoutPersistence } from '~/lib/dataStorage'
import { nextTick } from 'vue'
import { createFakeDataBackend } from '../helpers/fakeDataBackend'
import { CURRENT_SCHEMA_VERSION } from '~/utils/dataFile/envelope'

const envelope = (stores: Record<string, unknown>, schemaVersion = CURRENT_SCHEMA_VERSION) => ({
  schemaVersion,
  writtenAt: '2026-01-01T00:00:00.000Z',
  writtenBy: 'device-1',
  appVersion: '0.1.0',
  stores,
})

beforeEach(() => {
  localStorage.clear()
  resetDataStorage()
})
afterEach(() => resetDataStorage())

describe('appStorage on web', () => {
  it('delegates to localStorage, evaluated at call time', () => {
    appStorage.setItem('tasks-store', '{"a":1}')
    expect(localStorage.getItem('tasks-store')).toBe('{"a":1}')
    expect(appStorage.getItem('tasks-store')).toBe('{"a":1}')
    expect(appStorage.getItem('missing')).toBeNull()
  })

  it('does nothing without a desktop shell', async () => {
    expect(await initDataStorage()).toBeNull()
    expect(dataState.available).toBe(false)
  })
})

describe('initDataStorage on desktop', () => {
  it('fills the mirror from the file before any store reads it', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({ 'tasks-store': { tasks: [{ id: 'a' }] } }) })
    await initDataStorage({ backend })
    expect(JSON.parse(appStorage.getItem('tasks-store') as string)).toEqual({ tasks: [{ id: 'a' }] })
    expect(appStorage.getItem('board-store')).toBeNull()
  })

  it('switches appStorage from localStorage to the mirror at call time', async () => {
    localStorage.setItem('tasks-store', '"from-localStorage"')
    expect(appStorage.getItem('tasks-store')).toBe('"from-localStorage"')
    await initDataStorage({ backend: createFakeDataBackend({ envelope: envelope({ 'tasks-store': 'from-file' }) }) })
    expect(appStorage.getItem('tasks-store')).toBe('"from-file"')
  })

  it('keeps keys outside the data file in localStorage', async () => {
    await initDataStorage({ backend: createFakeDataBackend({ envelope: envelope({}) }) })
    appStorage.setItem('kando-locale', 'en')
    expect(localStorage.getItem('kando-locale')).toBe('en')
  })

  it('writes go to the mirror and to Rust, never to localStorage', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })
    appStorage.setItem('board-store', '{"columns":[1]}')
    expect(appStorage.getItem('board-store')).toBe('{"columns":[1]}')
    expect(backend.sets['board-store']).toEqual({ columns: [1] })
    expect(localStorage.getItem('board-store')).toBeNull()
  })

  it('imports every persisted key from localStorage on the first run and leaves localStorage untouched', async () => {
    for (const key of PERSISTED_KEYS) localStorage.setItem(key, JSON.stringify({ from: key }))
    localStorage.setItem('kando-locale', 'de')
    const before = { ...localStorage }
    const backend = createFakeDataBackend({ needsInit: true })
    await initDataStorage({ backend })

    expect(Object.keys(backend.initStores ?? {}).sort()).toEqual([...PERSISTED_KEYS].sort())
    expect(JSON.parse(appStorage.getItem('propertyOptions') as string)).toEqual({ from: 'propertyOptions' })
    expect(PERSISTED_KEYS).toContain('day-recap-store')
    expect(PERSISTED_KEYS).toContain('trash-store')
    expect(PERSISTED_KEYS).toContain('topic-styles')
    expect(JSON.parse(appStorage.getItem('day-recap-store') as string)).toEqual({ from: 'day-recap-store' })
    expect({ ...localStorage }).toEqual(before)
  })

  it('imports the dogfooding Notion config without its token', async () => {
    localStorage.setItem('notionConfig', JSON.stringify({ config: { token: 'ntn_leak', databaseId: 'db-1' } }))
    const backend = createFakeDataBackend({ needsInit: true })
    await initDataStorage({ backend })
    expect(JSON.stringify(backend.initStores)).not.toContain('ntn_leak')
    expect(appStorage.getItem('notionConfig')).not.toContain('ntn_leak')
    expect(localStorage.getItem('notionConfig')).toContain('ntn_leak')
  })

  it('reports a failed first write as write-failed and keeps the imported data in memory', async () => {
    localStorage.setItem('tasks-store', '{"tasks":[1]}')
    const status = await initDataStorage({ backend: createFakeDataBackend({ needsInit: true, failInit: true }) })
    expect(status?.status).toBe('write-failed')
    expect(dataState.status).toBe('write-failed')
    expect(appStorage.getItem('tasks-store')).toBe('{"tasks":[1]}')
  })

  it('hydrates a newer-schema file read-only without touching it', async () => {
    const backend = createFakeDataBackend({
      status: 'read-only-newer-schema',
      envelope: envelope({ 'tasks-store': { tasks: [7] } }, 99),
    })
    await initDataStorage({ backend })
    expect(dataState.status).toBe('read-only-newer-schema')
    expect(JSON.parse(appStorage.getItem('tasks-store') as string)).toEqual({ tasks: [7] })
    expect(backend.calls).not.toContain('set:tasks-store')
  })

  it('hydrates empty for a missing or unreadable file', async () => {
    await initDataStorage({ backend: createFakeDataBackend({ status: 'missing-file' }) })
    expect(dataState.status).toBe('missing-file')
    expect(appStorage.getItem('tasks-store')).toBeNull()
    expect(snapshotMirror()).toEqual({})
  })

  it('mirrors status events into the reactive state', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })
    await Promise.resolve()
    backend.emit({ status: 'write-failed', error: 'disk full' })
    expect(dataState.status).toBe('write-failed')
    backend.emit({ status: 'ok', error: null })
    expect(dataState.status).toBe('ok')
  })

  it('mirrors the cloud upload state and clears it when the payload has none (#271)', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })
    await Promise.resolve()
    expect(dataState.cloudSync).toBeNull()
    const cloudSync = { state: 'error' as const, message: 'offline', since: '2026-10-27T10:00:00.000Z', visible: true }
    backend.emit({ cloudSync })
    expect(dataState.cloudSync).toEqual(cloudSync)
    backend.emit({ cloudSync: null })
    expect(dataState.cloudSync).toBeNull()
  })

  it('runs read-only with the notice when data_load itself fails, instead of falling back to localStorage', async () => {
    localStorage.setItem('tasks-store', '"frozen-first-run-copy"')
    const backend = createFakeDataBackend()
    backend.load = () => Promise.reject(new Error('ipc down'))
    const status = await initDataStorage({ backend })

    expect(status?.status).toBe('read-only-corrupt')
    expect(dataState.available).toBe(true)
    expect(dataState.status).toBe('read-only-corrupt')
    expect(dataState.error).toContain('unavailable')
    // The stale localStorage copy is not hydrated and edits go nowhere (neither the file nor localStorage).
    expect(appStorage.getItem('tasks-store')).toBeNull()
    appStorage.setItem('tasks-store', '"edit"')
    expect(localStorage.getItem('tasks-store')).toBe('"frozen-first-run-copy"')
    expect(backend.calls.filter(call => call.startsWith('set:'))).toEqual([])
  })
})

describe('data file never contains a secret (defense in depth)', () => {
  it('strips every SECRET_STATE_PATHS leaf in the writer, even when a store still carries the token', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })

    const notionConfig = { config: { token: 'ntn_realistic_token_1234', databaseId: 'db-1', dataSourceId: 'ds-1' }, isConfigured: true }
    const board = { boardConfig: { sources: { connected: ['notion'], default: 'notion' }, todoistApiToken: 'todoist-realistic-5678' }, columns: [] }
    appStorage.setItem('notionConfig', JSON.stringify(notionConfig))
    appStorage.setItem('board-store', JSON.stringify(board))

    const written = JSON.stringify(backend.sets)
    expect(written).not.toContain('ntn_realistic_token_1234')
    expect(written).not.toContain('todoist-realistic-5678')
    expect(backend.sets.notionConfig).toEqual({ config: { databaseId: 'db-1', dataSourceId: 'ds-1' }, isConfigured: true })
    expect(appStorage.getItem('notionConfig')).not.toContain('ntn_realistic_token_1234')
    expect(appStorage.getItem('board-store')).not.toContain('todoist-realistic-5678')
  })
})

describe('withoutPersistence (#255 N1)', () => {
  it('drops writes for the stores that carry a secret while fn runs and until the next tick', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })

    await withoutPersistence(async () => {
      appStorage.setItem('board-store', '{"columns":[1]}')
      appStorage.setItem('notionConfig', '{"config":null}')
      // Pinia's watcher fires after the synchronous part: still inside the window.
      await Promise.resolve()
      queueMicrotask(() => appStorage.setItem('board-store', '{"columns":[2]}'))
    })
    expect(backend.calls.filter(c => c.startsWith('set:'))).toEqual([])
    expect(appStorage.getItem('board-store')).toBeNull()
  })

  it('still persists the other stores', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })
    await withoutPersistence(() => appStorage.setItem('tasks-store', '{"tasks":[]}'))
    expect(backend.sets['tasks-store']).toEqual({ tasks: [] })
  })

  it('persists a normal edit right after the window', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })
    await withoutPersistence(() => appStorage.setItem('board-store', '{"columns":[1]}'))
    appStorage.setItem('board-store', '{"columns":[2]}')
    expect(backend.sets['board-store']).toEqual({ columns: [2] })
  })

  it('closes the window when fn throws, and passes the error on', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })
    await expect(withoutPersistence(() => { throw new Error('boom') })).rejects.toThrow('boom')
    appStorage.setItem('board-store', '{"columns":[3]}')
    expect(backend.sets['board-store']).toEqual({ columns: [3] })
    await nextTick()
  })

  it('nested windows stay closed until the outer one ends', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({}) })
    await initDataStorage({ backend })
    await withoutPersistence(async () => {
      await withoutPersistence(() => undefined)
      appStorage.setItem('board-store', '{"columns":[4]}')
    })
    expect(backend.sets['board-store']).toBeUndefined()
  })
})

describe('schema migration at start-up', () => {
  it('does not hand anything to Rust when the file is already current', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({ 'tasks-store': {} }) })
    await initDataStorage({ backend })
    expect(backend.calls.filter(call => call.startsWith('set:'))).toEqual([])
  })

  it('survives a rejected backend.set while writing the migrated stores back', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({ 'tasks-store': { tasks: [] } }, 1) })
    backend.set = () => Promise.reject(new Error('ipc down'))
    const migrations = {
      current: 2,
      migrations: [{ from: 1, to: 2, up: (raw: ReturnType<typeof envelope>) => ({ ...raw, stores: { 'tasks-store': { tasks: [], migrated: true } } }) }],
    }

    const status = await initDataStorage({ backend, migrations })

    expect(status?.status).toBe('ok')
    expect(JSON.parse(appStorage.getItem('tasks-store') as string)).toEqual({ tasks: [], migrated: true })
    expect(backend.calls).toContain('flush')
  })

  const step = (raw: ReturnType<typeof envelope>) => ({ ...raw, stores: { 'tasks-store': { tasks: [], migrated: true } } })

  it('takes the pre-migration backup before the first changing step (#224)', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({ 'tasks-store': { tasks: [] } }, 1) })
    const order: string[] = []
    const original = backend.backup
    backend.backup = async (kind) => {
      order.push(`backup:${kind}`)
      return original(kind)
    }
    await initDataStorage({
      backend,
      migrations: { current: 2, migrations: [{ from: 1, to: 2, up: (raw) => { order.push('step'); return step(raw as ReturnType<typeof envelope>) } }] },
    })
    expect(order).toEqual(['backup:pre-migration', 'step'])
    expect(backend.calls.indexOf('backup:pre-migration')).toBeLessThan(backend.calls.indexOf('flush'))
  })

  it('does not migrate when the backup fails: the file stays, nothing is handed to Rust (#224)', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({ 'tasks-store': { tasks: [1] } }, 1), failBackup: true })
    const up = vi.fn(step)
    const status = await initDataStorage({ backend, migrations: { current: 2, migrations: [{ from: 1, to: 2, up }] } })
    expect(up).not.toHaveBeenCalled()
    expect(status?.status).toBe('read-only-corrupt')
    expect(status?.error).toContain('backup_failed')
    expect(backend.calls.filter(call => call.startsWith('set:') || call === 'flush')).toEqual([])
    appStorage.setItem('tasks-store', '{"tasks":[2]}')
    expect(backend.sets).toEqual({})
  })

  it('takes no backup when nothing needs migrating (#224)', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({ 'tasks-store': {} }) })
    await initDataStorage({ backend })
    expect(backend.calls.some(call => call.startsWith('backup:'))).toBe(false)
  })

  it('migrates a v1 file to task sources: backup first, the migrated stores go to Rust (#326)', async () => {
    const backend = createFakeDataBackend({
      envelope: envelope({
        'board-store': { boardConfig: { taskService: 'notion' } },
        'tasks-store': { tasks: [{ id: 'page-1', title: 'A' }] },
      }, 1),
    })
    await initDataStorage({ backend })

    expect(backend.calls.indexOf('backup:pre-migration')).toBeGreaterThanOrEqual(0)
    expect(backend.calls.indexOf('backup:pre-migration')).toBeLessThan(backend.calls.indexOf('flush'))
    expect(backend.sets['board-store']).toMatchObject({ boardConfig: { sources: { connected: ['notion'], default: 'notion' } } })
    expect((backend.sets['tasks-store'] as { tasks: unknown[] }).tasks[0]).toMatchObject({ source: 'notion', externalId: 'page-1' })
    expect(JSON.parse(appStorage.getItem('board-store') as string).boardConfig.taskService).toBeUndefined()
  })

  it('reads the Rust schema constant and the TS one as the same number', async () => {
    const { readFileSync } = await import('node:fs')
    const { CURRENT_SCHEMA_VERSION } = await import('~/utils/dataFile/envelope')
    const rust = readFileSync('src-tauri/src/data_file.rs', 'utf8')
    expect(rust).toMatch(new RegExp(`pub const SCHEMA_VERSION: u64 = ${CURRENT_SCHEMA_VERSION};`))
  })
})

describe('frozen writes (app reset, kd#227)', () => {
  it('web: setItem is dropped for every key until the freeze is lifted', () => {
    appStorage.setItem('tasks-store', '{"a":1}')
    freezeWrites()
    expect(isWritesFrozen()).toBe(true)
    appStorage.setItem('tasks-store', '{"a":2}')
    appStorage.setItem('kando-locale', 'en')
    expect(localStorage.getItem('tasks-store')).toBe('{"a":1}')
    expect(localStorage.getItem('kando-locale')).toBeNull()
    unfreezeWrites()
    appStorage.setItem('tasks-store', '{"a":3}')
    expect(localStorage.getItem('tasks-store')).toBe('{"a":3}')
  })

  it('desktop: neither the mirror nor Rust see a write while frozen', async () => {
    const backend = createFakeDataBackend({ envelope: envelope({ 'tasks-store': { tasks: [] } }) })
    await initDataStorage({ backend })
    freezeWrites()
    appStorage.setItem('tasks-store', '{"tasks":[1]}')
    await Promise.resolve()
    expect(backend.sets['tasks-store']).toBeUndefined()
    expect(JSON.parse(appStorage.getItem('tasks-store') as string)).toEqual({ tasks: [] })
  })

  it('resetDataStorage lifts the freeze (a new page life)', () => {
    freezeWrites()
    resetDataStorage()
    expect(isWritesFrozen()).toBe(false)
  })
})
