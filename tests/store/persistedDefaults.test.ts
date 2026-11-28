/**
 * Guard for the additive-field rule of the persisted stores: a stored blob that holds none of a store's newer fields
 * (data from an older release) hydrates to the state a fresh install has, and hydrating it writes nothing. Runs over
 * `PERSISTED_KEYS`, so a new persisted store joins it without an edit. Malformed values are covered per field by the
 * store's own hydrate test.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import type { Store } from 'pinia'
import { PERSISTED_KEYS } from '~/lib/dataStorage'

async function hydrate(stores: Record<string, unknown>) {
  vi.resetModules()
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  const { createFakeDataBackend } = await import('../helpers/fakeDataBackend')
  const { CURRENT_SCHEMA_VERSION } = await import('~/utils/dataFile/envelope')
  const backend = createFakeDataBackend({
    needsInit: false,
    envelope: { schemaVersion: CURRENT_SCHEMA_VERSION, writtenAt: '2026-01-01T00:00:00.000Z', writtenBy: 'd', appVersion: '0.1.0', stores },
  })
  const { createPinia, setActivePinia } = await import('pinia')
  const { createPersistedState } = await import('pinia-plugin-persistedstate')
  const { appStorage, initDataStorage } = await import('~/lib/dataStorage')
  await initDataStorage({ backend, source: null })
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: appStorage }))
  const { createApp } = await import('vue')
  createApp({}).use(pinia)
  setActivePinia(pinia)

  const modules = import.meta.glob('../../store/*.ts') as Record<string, () => Promise<Record<string, unknown>>>
  const states: Record<string, string> = {}
  for (const load of Object.values(modules)) {
    for (const [name, value] of Object.entries(await load())) {
      if (/^use\w+Store$/.test(name) && typeof value === 'function') states[name] = JSON.stringify((value as () => Store)().$state)
    }
  }
  await nextTick()
  return { backend, states }
}

/** The stored shape of a release before any additive field. A blob with no `sources` at all is the pre-#318 shape, which is rewritten on purpose. */
const OLDER_BLOB: Record<string, unknown> = { 'integration-health-store': { sources: {} } }

describe('older persisted data hydrates to the defaults of a fresh install', () => {
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

  it.each([...PERSISTED_KEYS])('%s: a stored blob without any field changes nothing and writes nothing', async (key) => {
    const fresh = await hydrate({})
    const old = await hydrate({ [key]: OLDER_BLOB[key] ?? {} })
    expect(old.states).toEqual(fresh.states)
    expect(old.backend.calls.filter(c => c.startsWith('set:'))).toEqual([])
  })
})
