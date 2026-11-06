import { describe, it, expect, beforeEach, vi } from 'vitest'
import { bootstrapSecrets, type BootstrapDeps } from '~/lib/secretsBootstrap'
import { persistOmitFor, SECRET_STATE_LOCATIONS, SECRET_STATE_PATHS } from '~/lib/secrets'
import type { ReadableSecretEntry } from '~/lib/secrets'

class MemoryStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

const NOTION_BLOB = { config: { token: 'ntn_legacy', databaseId: 'db-1' } }
const BOARD_BLOB = { boardConfig: { sources: { connected: ['todoist'], default: 'todoist' }, todoistApiToken: 'td_legacy' }, columns: [] }

function setup(options: {
  keychain?: Partial<Record<ReadableSecretEntry, string>>
  stored?: boolean
  failGet?: boolean
  failSet?: boolean
  corruptSet?: boolean
} = {}) {
  const storage = new MemoryStorage()
  if (options.stored !== false) {
    storage.setItem('notionConfig', JSON.stringify(NOTION_BLOB))
    storage.setItem('board-store', JSON.stringify(BOARD_BLOB))
  }
  const keychain: Partial<Record<ReadableSecretEntry, string>> = { ...options.keychain }
  const order: string[] = []
  const applied: Partial<Record<ReadableSecretEntry, string>> = {}
  const deps: BootstrapDeps = {
    storage,
    secrets: {
      get: vi.fn(async (entry: ReadableSecretEntry) => {
        if (options.failGet) throw new Error('locked')
        return keychain[entry] ?? null
      }),
      set: vi.fn(async (entry: ReadableSecretEntry, value: string) => {
        if (options.failSet) throw new Error('denied')
        order.push(`set:${entry}`)
        keychain[entry] = options.corruptSet ? `${value}-corrupt` : value
      }),
    },
    applyToken: (entry, token) => { applied[entry] = token },
  }
  return { deps, storage, keychain, applied, order }
}

const blobOf = (storage: MemoryStorage, key: string) => JSON.parse(storage.getItem(key) ?? 'null')

describe('bootstrapSecrets', () => {
  beforeEach(() => {
    // Fresh, disarmed omit lists (as after a store definition).
    persistOmitFor('notionConfig')
    persistOmitFor('board-store')
  })

  it('migrates stored tokens: verified Keychain write first, then strips the blob', async () => {
    const { deps, storage, keychain, applied } = setup()
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes).toEqual({ 'notion-token': 'migrated', 'todoist-token': 'migrated' })
    expect(result.failed).toBe(false)
    expect(keychain).toEqual({ 'notion-token': 'ntn_legacy', 'todoist-token': 'td_legacy' })
    expect(applied).toEqual({ 'notion-token': 'ntn_legacy', 'todoist-token': 'td_legacy' })
    expect(blobOf(storage, 'notionConfig')).toEqual({ config: { databaseId: 'db-1' } })
    expect(blobOf(storage, 'board-store')).toEqual({ boardConfig: { sources: { connected: ['todoist'], default: 'todoist' } }, columns: [] })
  })

  it('reads the Keychain back and compares before deleting the stored copy', async () => {
    const { deps, storage, keychain } = setup({ corruptSet: true })
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes['notion-token']).toBe('migration-failed')
    expect(keychain['notion-token']).toBe('ntn_legacy-corrupt')
    expect(blobOf(storage, 'notionConfig').config.token).toBe('ntn_legacy')
  })

  it('on a Keychain write failure keeps the stored token working and reports the failure', async () => {
    const { deps, storage, applied } = setup({ failSet: true })
    const result = await bootstrapSecrets(deps)

    expect(result.failed).toBe(true)
    expect(result.outcomes).toEqual({ 'notion-token': 'migration-failed', 'todoist-token': 'migration-failed' })
    expect(applied['notion-token']).toBe('ntn_legacy')
    expect(blobOf(storage, 'notionConfig').config.token).toBe('ntn_legacy')
  })

  it('on a Keychain read failure keeps the stored token and leaves the omission disarmed', async () => {
    const omit = persistOmitFor('notionConfig')
    const { deps, storage, applied } = setup({ failGet: true })
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes['notion-token']).toBe('migration-failed')
    expect(applied['notion-token']).toBe('ntn_legacy')
    expect(blobOf(storage, 'notionConfig').config.token).toBe('ntn_legacy')
    expect(omit).toEqual([])
  })

  it('arms the persist omission only for entries the Keychain now holds or that have nothing to migrate', async () => {
    const notionOmit = persistOmitFor('notionConfig')
    const boardOmit = persistOmitFor('board-store')
    await bootstrapSecrets(setup().deps)
    expect(notionOmit).toEqual(['config.token'])
    expect(boardOmit).toEqual(['boardConfig.todoistApiToken'])

    const failedNotion = persistOmitFor('notionConfig')
    await bootstrapSecrets(setup({ failSet: true }).deps)
    expect(failedNotion).toEqual([])

    const emptyNotion = persistOmitFor('notionConfig')
    await bootstrapSecrets(setup({ stored: false }).deps)
    expect(emptyNotion).toEqual(['config.token'])
  })

  it('a Keychain error with no stored copy is "unavailable", never "missing"', async () => {
    const { deps, applied } = setup({ failGet: true, stored: false })
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes).toEqual({ 'notion-token': 'unavailable', 'todoist-token': 'unavailable' })
    expect(result.unavailable).toEqual(['notion-token', 'todoist-token'])
    expect(result.failed).toBe(true)
    expect(applied).toEqual({})
  })

  it('a missing entry with no stored copy is plainly missing', async () => {
    const { deps } = setup({ stored: false })
    const result = await bootstrapSecrets(deps)
    expect(result.outcomes).toEqual({ 'notion-token': 'none', 'todoist-token': 'none' })
    expect(result.failed).toBe(false)
    expect(result.unavailable).toEqual([])
  })

  it('the Keychain wins when both exist, and the stored copy is stripped', async () => {
    const { deps, storage, keychain, applied, order } = setup({ keychain: { 'notion-token': 'ntn_keychain' } })
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes['notion-token']).toBe('stripped')
    expect(applied['notion-token']).toBe('ntn_keychain')
    expect(keychain['notion-token']).toBe('ntn_keychain')
    expect(order).not.toContain('set:notion-token')
    expect(blobOf(storage, 'notionConfig').config.token).toBeUndefined()
  })

  it('loads a Keychain-only token without touching storage', async () => {
    const { deps, storage, applied } = setup({
      stored: false,
      keychain: { 'notion-token': 'ntn_keychain', 'todoist-token': 'td_keychain' },
    })
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes).toEqual({ 'notion-token': 'loaded', 'todoist-token': 'loaded' })
    expect(applied).toEqual({ 'notion-token': 'ntn_keychain', 'todoist-token': 'td_keychain' })
    expect(storage.data.size).toBe(0)
  })

  it('ignores unparsable blobs', async () => {
    const { deps, storage } = setup({ stored: false })
    storage.setItem('notionConfig', '{not json')
    const result = await bootstrapSecrets(deps)
    expect(result.outcomes['notion-token']).toBe('none')
  })
})

describe('bootstrapSecrets fails closed on unexpected throws (#245 N4)', () => {
  let notionOmit: string[]
  let boardOmit: string[]
  beforeEach(() => {
    notionOmit = persistOmitFor('notionConfig')
    boardOmit = persistOmitFor('board-store')
  })

  it('a throwing storage read for one entry arms both omissions, lists it unavailable and still handles the other', async () => {
    const { deps, storage, keychain, applied } = setup()
    const getItem = storage.getItem.bind(storage)
    storage.getItem = (key: string) => {
      if (key === 'notionConfig') throw new Error('storage broken')
      return getItem(key)
    }
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes).toEqual({ 'notion-token': 'error', 'todoist-token': 'migrated' })
    expect(result.failed).toBe(true)
    expect(result.unavailable).toEqual(['notion-token'])
    expect(notionOmit).toEqual(['config.token'])
    expect(boardOmit).toEqual(['boardConfig.todoistApiToken'])
    expect(applied).toEqual({ 'todoist-token': 'td_legacy' })
    expect(keychain).toEqual({ 'todoist-token': 'td_legacy' })
  })

  it('a throwing applyToken for one entry arms both omissions, never deletes the legacy copy and still handles the other', async () => {
    const { deps, storage, applied } = setup()
    deps.applyToken = (entry, token) => {
      if (entry === 'notion-token') throw new Error('store broken')
      applied[entry] = token
    }
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes).toEqual({ 'notion-token': 'error', 'todoist-token': 'migrated' })
    expect(result.failed).toBe(true)
    expect(result.unavailable).toEqual(['notion-token'])
    expect(notionOmit).toEqual(['config.token'])
    expect(boardOmit).toEqual(['boardConfig.todoistApiToken'])
    expect(blobOf(storage, 'notionConfig').config.token).toBe('ntn_legacy')
    expect(applied['todoist-token']).toBe('td_legacy')
  })

  it('a throw after a legacy copy was read still applies it, so the app keeps working', async () => {
    const { deps, storage, applied } = setup({ keychain: { 'notion-token': 'ntn_keychain' } })
    const setItem = storage.setItem.bind(storage)
    let strips = 0
    storage.setItem = (key: string, value: string) => {
      if (key === 'notionConfig' && ++strips === 1) throw new Error('disk full')
      setItem(key, value)
    }
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes['notion-token']).toBe('error')
    expect(result.unavailable).toEqual([])
    expect(applied['notion-token']).toBe('ntn_keychain')
    expect(notionOmit).toEqual(['config.token'])
    expect(blobOf(storage, 'notionConfig').config.token).toBe('ntn_legacy')
  })

  it('applies the legacy copy when the Keychain token could not be applied', async () => {
    const { deps, applied } = setup({ keychain: { 'notion-token': 'ntn_keychain' } })
    deps.applyToken = vi.fn((entry: ReadableSecretEntry, token: string) => {
      if (token === 'ntn_keychain') throw new Error('store broken')
      applied[entry] = token
    })
    const result = await bootstrapSecrets(deps)

    expect(result.outcomes['notion-token']).toBe('error')
    expect(result.unavailable).toEqual([])
    expect(applied['notion-token']).toBe('ntn_legacy')
  })
})

describe('SECRET_STATE_PATHS', () => {
  it('lists the persisted secret paths as <storage key>.<state path>', () => {
    expect([...SECRET_STATE_PATHS]).toEqual(['notionConfig.config.token', 'board-store.boardConfig.todoistApiToken'])
    expect(SECRET_STATE_LOCATIONS.map(l => l.entry)).toEqual(['notion-token', 'todoist-token'])
  })
})
