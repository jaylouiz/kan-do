import { describe, expect, it } from 'vitest'
import { PERSISTED_KEYS } from '~/lib/dataStorage'
import { SECRET_STATE_PATHS } from '~/lib/secrets'
import { importLocalStorage } from '~/utils/dataFile/importLocalStorage'
import { stripSecretPaths } from '~/utils/dataFile/stripSecrets'

const storageOf = (items: Record<string, string>) => ({ getItem: (key: string) => items[key] ?? null })

describe('importLocalStorage', () => {
  it('copies the six persisted keys as parsed objects', () => {
    const items = Object.fromEntries(PERSISTED_KEYS.map(key => [key, JSON.stringify({ marker: key })]))
    const stores = importLocalStorage(storageOf(items), PERSISTED_KEYS)
    expect(Object.keys(stores).sort()).toEqual([...PERSISTED_KEYS].sort())
    expect(stores['tasks-store']).toEqual({ marker: 'tasks-store' })
  })

  it('ignores other localStorage keys, missing keys and unparsable blobs', () => {
    const stores = importLocalStorage(
      storageOf({ 'kando-locale': 'en', 'statistics-backfill-state': '{}', 'tasks-store': '{ broken', 'board-store': '{"a":1}' }),
      PERSISTED_KEYS,
    )
    expect(stores).toEqual({ 'board-store': { a: 1 } })
  })

  it('imports a realistic Notion config without its token', () => {
    const notionConfig = { config: { token: 'ntn_secret_0000', databaseId: 'db-1', dataSourceId: 'ds-1' }, isConfigured: true }
    const board = { boardConfig: { sources: { connected: ['notion'], default: 'notion' }, todoistApiToken: 'todoist-secret' }, columns: [] }
    const stores = importLocalStorage(
      storageOf({ notionConfig: JSON.stringify(notionConfig), 'board-store': JSON.stringify(board) }),
      PERSISTED_KEYS,
    )
    expect(JSON.stringify(stores)).not.toContain('ntn_secret_0000')
    expect(JSON.stringify(stores)).not.toContain('todoist-secret')
    expect((stores.notionConfig as { config: Record<string, unknown> }).config).toEqual({ databaseId: 'db-1', dataSourceId: 'ds-1' })
  })

  it('leaves localStorage untouched', () => {
    const items = { notionConfig: JSON.stringify({ config: { token: 'ntn_x' } }) }
    const before = JSON.stringify(items)
    importLocalStorage(storageOf(items), PERSISTED_KEYS)
    expect(JSON.stringify(items)).toBe(before)
  })
})

describe('stripSecretPaths', () => {
  it('removes every SECRET_STATE_PATHS leaf from the matching store only', () => {
    expect(SECRET_STATE_PATHS).toContain('notionConfig.config.token')
    const notion = { config: { token: 't', keep: 1 } }
    expect(stripSecretPaths('notionConfig', notion)).toBe(true)
    expect(notion).toEqual({ config: { keep: 1 } })
    const other = { config: { token: 't' } }
    expect(stripSecretPaths('tasks-store', other)).toBe(false)
    expect(other.config.token).toBe('t')
  })

  it('copes with missing parents', () => {
    expect(stripSecretPaths('notionConfig', { config: null })).toBe(false)
    expect(stripSecretPaths('board-store', {})).toBe(false)
    expect(stripSecretPaths('board-store', null)).toBe(false)
  })
})
