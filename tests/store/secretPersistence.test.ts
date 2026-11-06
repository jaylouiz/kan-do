import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import type { DataBackend } from '~/types/dataFile'

vi.mock('~/composables/useStatisticsBackfill', () => ({
  useStatisticsBackfill: () => ({ runConfigChangeBackfill: vi.fn().mockResolvedValue(undefined) }),
}))

const config = {
  token: 'ntn_secret', databaseId: 'db-1', dataSourceId: null,
  propertyMapping: { title: 'Name', status: 'Status' },
  statusMapping: { today: 'Today', doing: 'Doing', done: 'Done' },
}

async function freshStores(desktop: boolean, fileBackend?: DataBackend) {
  vi.resetModules()
  if (desktop) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  // Imported after resetModules so the stores and the test share one pinia instance.
  const { createPinia, setActivePinia } = await import('pinia')
  const { default: piniaPersistedState, createPersistedState } = await import('pinia-plugin-persistedstate')
  const pinia = createPinia()
  if (fileBackend) {
    // As plugins/pinia.ts: the writer is appStorage, here backed by the data-file mirror.
    const { appStorage, initDataStorage } = await import('~/lib/dataStorage')
    await initDataStorage({ backend: fileBackend, source: null })
    pinia.use(createPersistedState({ storage: appStorage }))
  } else {
    pinia.use(piniaPersistedState)
  }
  // Plugins are queued until the pinia instance is installed on an app.
  const { createApp } = await import('vue')
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const { useNotionConfigStore } = await import('~/store/notionConfig')
  const { useBoardStore } = await import('~/store/board')
  return { notion: useNotionConfigStore(), board: useBoardStore() }
}

/** Arms the persist omission the way the bootstrap does once the Keychain holds (or needs) nothing. */
async function armOmission() {
  const { omitFromStorage, SECRET_STATE_LOCATIONS } = await import('~/lib/secrets')
  SECRET_STATE_LOCATIONS.forEach(omitFromStorage)
}

describe('persisted state vs secrets', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

  it('web keeps both tokens in the persisted blobs (unchanged behaviour)', async () => {
    const { notion, board } = await freshStores(false)
    notion.setConfig(config)
    board.setTodoistApiToken('td_secret')
    await nextTick()

    expect(JSON.parse(localStorage.getItem('notionConfig') ?? '{}').config.token).toBe('ntn_secret')
    expect(JSON.parse(localStorage.getItem('board-store') ?? '{}').boardConfig.todoistApiToken).toBe('td_secret')
  })

  it('desktop omits both tokens from the persisted blobs but keeps them in memory', async () => {
    const { notion, board } = await freshStores(true)
    await armOmission()
    notion.setConfig(config)
    board.setTodoistApiToken('td_secret')
    await nextTick()

    const notionBlob = localStorage.getItem('notionConfig') ?? ''
    const boardBlob = localStorage.getItem('board-store') ?? ''
    expect(notionBlob).not.toContain('ntn_secret')
    expect(boardBlob).not.toContain('td_secret')
    expect(JSON.parse(notionBlob).config.databaseId).toBe('db-1')
    expect(notion.config?.token).toBe('ntn_secret')
    expect(board.boardConfig.todoistApiToken).toBe('td_secret')
    expect(notion.isConfigured).toBe(true)
  })

  it('web hydrates the stored token as before', async () => {
    localStorage.setItem('notionConfig', JSON.stringify({ config }))
    const { notion } = await freshStores(false)
    expect(notion.config?.token).toBe('ntn_secret')
    expect(notion.isConfigured).toBe(true)
  })

  it('migrates the legacy Todoist and Notion tokens after the stores hydrated (#223 H1)', async () => {
    // board.ts afterHydrate calls $persist(); that write must not strip a token the bootstrap has not read yet.
    localStorage.setItem('board-store', JSON.stringify({ boardConfig: { sources: { connected: ['todoist'], default: 'todoist' }, todoistApiToken: 'td_legacy' } }))
    localStorage.setItem('notionConfig', JSON.stringify({ config }))
    const { notion, board } = await freshStores(true)
    const { bootstrapSecrets } = await import('~/lib/secretsBootstrap')
    const keychain: Record<string, string> = {}
    const result = await bootstrapSecrets({
      storage: localStorage,
      secrets: {
        get: async entry => keychain[entry] ?? null,
        set: async (entry, value) => { keychain[entry] = value },
      },
      applyToken: (entry, token) => {
        if (entry === 'notion-token' && notion.config) notion.config = { ...notion.config, token }
        else board.setTodoistApiToken(token)
      },
    })
    await nextTick()

    expect(result.outcomes).toEqual({ 'notion-token': 'migrated', 'todoist-token': 'migrated' })
    expect(keychain).toEqual({ 'notion-token': 'ntn_secret', 'todoist-token': 'td_legacy' })
    expect(localStorage.getItem('board-store')).not.toContain('td_legacy')
    expect(localStorage.getItem('notionConfig')).not.toContain('ntn_secret')
    // From now on the blobs stay token-free.
    board.setTodoistApiToken('td_new')
    await nextTick()
    expect(localStorage.getItem('board-store')).not.toContain('td_new')
  })

  it('isConfigured is true right after the bootstrap applied the Keychain token', async () => {
    localStorage.setItem('notionConfig', JSON.stringify({ config: { ...config, token: undefined } }))
    const { notion } = await freshStores(true)
    expect(notion.isConfigured).toBe(false)
    const { bootstrapSecrets } = await import('~/lib/secretsBootstrap')
    await bootstrapSecrets({
      storage: localStorage,
      secrets: { get: async entry => (entry === 'notion-token' ? 'ntn_keychain' : null), set: async () => undefined },
      applyToken: (entry, token) => {
        if (entry === 'notion-token' && notion.config) notion.config = { ...notion.config, token }
      },
    })
    expect(notion.isConfigured).toBe(true)
  })

  it('a bootstrap that throws leaves the persisted blob and the appStorage mirror token-free (#245 N4)', async () => {
    localStorage.setItem('board-store', JSON.stringify({ boardConfig: { sources: { connected: ['todoist'], default: 'todoist' }, todoistApiToken: 'td_legacy' } }))
    localStorage.setItem('notionConfig', JSON.stringify({ config }))
    const { createFakeDataBackend } = await import('../helpers/fakeDataBackend')
    const backend = createFakeDataBackend({ needsInit: false, envelope: { schemaVersion: 1, writtenAt: '2026-01-01T00:00:00.000Z', writtenBy: 'd', appVersion: '0.1.0', stores: {} } })
    const { notion, board } = await freshStores(true, backend)
    const { bootstrapSecrets } = await import('~/lib/secretsBootstrap')
    const { appStorage } = await import('~/lib/dataStorage')

    const result = await bootstrapSecrets({
      storage: localStorage,
      secrets: { get: async () => { throw new Error('locked') }, set: async () => undefined },
      applyToken: () => { throw new Error('store broken') },
    })
    expect(result.failed).toBe(true)
    expect(result.outcomes).toEqual({ 'notion-token': 'error', 'todoist-token': 'error' })

    notion.setConfig(config)
    board.setTodoistApiToken('td_secret')
    await nextTick()

    expect(Object.keys(backend.sets)).toEqual(expect.arrayContaining(['notionConfig', 'board-store']))
    expect(JSON.stringify(backend.sets)).not.toMatch(/ntn_secret|td_secret/)
    expect(appStorage.getItem('notionConfig') ?? '').not.toContain('ntn_secret')
    expect(appStorage.getItem('board-store') ?? '').not.toContain('td_secret')
    expect(notion.config?.token).toBe('ntn_secret')
    // The legacy localStorage copy is never deleted on this path: the next start retries.
    expect(localStorage.getItem('notionConfig')).toContain('ntn_secret')
    expect(localStorage.getItem('board-store')).toContain('td_legacy')
  })

  it('the bootstrap applies a Keychain Todoist token without any data_set, an edit after it is persisted (#255 N1)', async () => {
    const { createFakeDataBackend } = await import('../helpers/fakeDataBackend')
    // Unreadable file: empty mirror, so the Todoist token exists only in the Keychain.
    const backend = createFakeDataBackend({ needsInit: false, envelope: { schemaVersion: 1, writtenAt: '2026-01-01T00:00:00.000Z', writtenBy: 'd', appVersion: '0.1.0', stores: {} } })
    const { notion, board } = await freshStores(true, backend)
    const { bootstrapSecrets } = await import('~/lib/secretsBootstrap')
    const { withoutPersistence } = await import('~/lib/dataStorage')
    await nextTick()
    const setsBefore = backend.calls.filter(c => c.startsWith('set:')).length

    const result = await bootstrapSecrets({
      storage: localStorage,
      secrets: { get: async entry => (entry === 'todoist-token' ? 'td_keychain' : null), set: async () => undefined },
      applyToken: (entry, token) => withoutPersistence(() => {
        if (entry === 'notion-token' && notion.config) notion.config = { ...notion.config, token }
        else if (entry === 'todoist-token') board.setTodoistApiToken(token)
      }),
    })
    await nextTick()

    expect(result.outcomes['todoist-token']).toBe('loaded')
    expect(board.boardConfig.todoistApiToken).toBe('td_keychain')
    expect(backend.calls.filter(c => c.startsWith('set:')).length).toBe(setsBefore)

    board.setTodoistApiToken('td_edit')
    board.setSingleSource('local')
    await nextTick()
    expect(backend.calls.filter(c => c.startsWith('set:')).length).toBeGreaterThan(setsBefore)
    expect(JSON.stringify(backend.sets['board-store'])).not.toContain('td_')
  })
})
