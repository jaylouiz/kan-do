import { describe, expect, it } from 'vitest'
import { SECRET_STATE_LOCATIONS, SECRET_STATE_PATHS } from '~/lib/secrets'
import { CURRENT_SCHEMA_VERSION } from '~/utils/dataFile/envelope'
import { buildExport, parseImport, stripSecrets } from '~/utils/dataFile/exportImport'

const TOKEN = 'secret-token-value-1234'

/** A realistic state with a token at every path the contract lists. */
function stateWithEverySecret(): Record<string, unknown> {
  const stores: Record<string, unknown> = {
    'tasks-store': { tasks: [{ id: 'a' }, { id: 'b' }] },
    'board-store': { boardConfig: { todoistApiToken: 'x', columns: 4 } },
    notionConfig: { config: { token: 'x', databaseId: 'db' } },
  }
  for (const { storageKey, statePath } of SECRET_STATE_LOCATIONS) {
    let node = stores[storageKey] as Record<string, unknown>
    const keys = statePath.split('.')
    const leaf = keys.pop() as string
    for (const key of keys) node = node[key] as Record<string, unknown>
    node[leaf] = TOKEN
  }
  return stores
}

function valueAt(stores: Record<string, unknown>, path: string): unknown {
  const [storageKey, ...rest] = path.split('.')
  return rest.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], stores[storageKey as string])
}

describe('stripSecrets', () => {
  it('removes every SECRET_STATE_PATHS entry and nothing else, without touching the input', () => {
    const input = stateWithEverySecret()
    expect(SECRET_STATE_PATHS.length).toBeGreaterThan(0)
    for (const path of SECRET_STATE_PATHS) expect(valueAt(input, path)).toBe(TOKEN)

    const clean = stripSecrets(input)
    for (const path of SECRET_STATE_PATHS) expect(valueAt(clean, path), path).toBeUndefined()
    expect(JSON.stringify(clean)).not.toContain(TOKEN)
    expect((clean.notionConfig as { config: { databaseId: string } }).config.databaseId).toBe('db')
    expect((clean['board-store'] as { boardConfig: { columns: number } }).boardConfig.columns).toBe(4)
    for (const path of SECRET_STATE_PATHS) expect(valueAt(input, path), 'input untouched').toBe(TOKEN)
  })
})

describe('buildExport', () => {
  const now = new Date(2026, 9, 27, 9, 12, 30)

  it('writes a plain pretty-printed envelope named after the local date, without any secret', () => {
    const built = buildExport({ stores: stateWithEverySecret(), deviceId: 'device-1', appVersion: '0.1.0' }, now)
    expect(built.fileName).toBe('kan-do-export-2026-10-27.json')
    expect(built.text.endsWith('\n')).toBe(true)
    expect(built.text).toContain('\n  "schemaVersion"')
    expect(built.text).not.toContain(TOKEN)
    const parsed = JSON.parse(built.text)
    expect(parsed).toMatchObject({ schemaVersion: CURRENT_SCHEMA_VERSION, writtenBy: 'device-1', appVersion: '0.1.0' })
    for (const path of SECRET_STATE_PATHS) expect(valueAt(parsed.stores, path), path).toBeUndefined()
  })

  it('round-trips through parseImport', () => {
    const built = buildExport({ stores: stateWithEverySecret(), deviceId: 'device-1', appVersion: '0.1.0' }, now)
    const parsed = parseImport(built.text)
    expect(parsed).toMatchObject({ ok: true, taskCount: 2, schemaVersion: CURRENT_SCHEMA_VERSION })
    if (parsed.ok) expect(JSON.parse(parsed.text).stores['tasks-store']).toEqual({ tasks: [{ id: 'a' }, { id: 'b' }] })
  })
})

describe('export and import carry the trash (#422)', () => {
  it('keeps the trash-store entries through buildExport and parseImport', () => {
    const entries = [{ taskId: 'gone', deletedAt: 1_700_000_000_000, fromStatus: 2, carryOver: null, task: { id: 'gone', source: 'notion', externalId: 'page-1', title: 'Weg' } }]
    const built = buildExport({ stores: { 'tasks-store': { tasks: [] }, 'trash-store': { entries } }, deviceId: 'device-1', appVersion: '0.1.0' }, new Date(2026, 9, 27))
    const parsed = parseImport(built.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(JSON.parse(parsed.text).stores['trash-store']).toEqual({ entries })
  })
})

describe('parseImport', () => {
  const file = (patch: Record<string, unknown> = {}) =>
    JSON.stringify({ schemaVersion: 1, writtenAt: '2026-10-24T09:12:00.000Z', writtenBy: 'other', appVersion: '0.1.0', stores: { 'tasks-store': { tasks: [] } }, ...patch })

  it('strips secrets again: an edited file with a token never reaches the data file', () => {
    const parsed = parseImport(file({ stores: stateWithEverySecret() }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.text).not.toContain(TOKEN)
    for (const path of SECRET_STATE_PATHS) expect(valueAt(JSON.parse(parsed.text).stores, path), path).toBeUndefined()
  })

  it('drops store keys the app does not persist', () => {
    const parsed = parseImport(file({ stores: { 'tasks-store': { tasks: [] }, unrelated: { x: 1 } } }))
    expect(parsed.ok && JSON.parse(parsed.text).stores).toEqual({ 'tasks-store': { tasks: [] } })
  })

  it('rejects junk, non-kan-do files and a newer schema', () => {
    expect(parseImport('nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseImport('[]')).toEqual({ ok: false, reason: 'not-kan-do' })
    expect(parseImport(JSON.stringify({ hello: 'world' }))).toEqual({ ok: false, reason: 'not-kan-do' })
    expect(parseImport(file({ stores: { unrelated: {} } }))).toEqual({ ok: false, reason: 'not-kan-do' })
    expect(parseImport(file({ schemaVersion: 0 }))).toEqual({ ok: false, reason: 'not-kan-do' })
    expect(parseImport(file({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }))).toEqual({ ok: false, reason: 'newer-schema' })
  })

  it('accepts an older schema (it is migrated on load) and counts the tasks', () => {
    const parsed = parseImport(file({ schemaVersion: 1, stores: { 'tasks-store': { tasks: [1, 2, 3] } } }), 2)
    expect(parsed).toMatchObject({ ok: true, schemaVersion: 1, taskCount: 3, writtenAt: '2026-10-24T09:12:00.000Z' })
  })

  it('reports no task count when the tasks store has none', () => {
    expect(parseImport(file({ stores: { 'board-store': {} } }))).toMatchObject({ ok: true, taskCount: null })
  })
})

describe('a mixed Local + Notion board (#325)', () => {
  const stores = () => ({
    'tasks-store': {
      tasks: [
        { id: 'page-1', source: 'notion', externalId: 'page-1', title: 'Notion task' },
        { id: 'local_1', source: 'local', externalId: null, title: 'Local task' },
      ],
    },
    'board-store': { boardConfig: { sources: { connected: ['notion'], default: 'local' }, todoistApiToken: TOKEN } },
    notionConfig: { config: { token: TOKEN, databaseId: 'db-1' } },
  })

  it('exports and re-imports each task with its source and the sources config, and never a token', () => {
    const built = buildExport({ stores: stores(), deviceId: 'device-1', appVersion: '0.1.0' })
    expect(built.text).not.toContain(TOKEN)

    const parsed = parseImport(built.text)
    expect(parsed).toMatchObject({ ok: true, taskCount: 2 })
    if (!parsed.ok) return
    const back = JSON.parse(parsed.text).stores
    expect(back['tasks-store'].tasks).toEqual(stores()['tasks-store'].tasks)
    expect(back['board-store'].boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
    expect(back.notionConfig.config).toEqual({ databaseId: 'db-1' })
  })
})
