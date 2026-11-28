/**
 * Guard for the additive-field rule of the persisted stores: a stored blob without a store's newer fields (data from an
 * older release) loads its fields, leaves every newer field at the default its setup store declares and writes nothing. Runs over
 * `PERSISTED_KEYS`, so a new persisted store joins it without an edit. Malformed values are covered per field by the
 * store's own hydrate test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import type { Store } from 'pinia'
import { PERSISTED_KEYS } from '~/lib/dataStorage'

/** `persist: false` builds the stores without the persistence plugin: the defaults the setup stores declare, no hydration reader runs. */
async function hydrate(stores: Record<string, unknown>, persist = true) {
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
  if (persist) pinia.use(createPersistedState({ storage: appStorage }))
  const { createApp } = await import('vue')
  createApp({}).use(pinia)
  setActivePinia(pinia)

  const modules = import.meta.glob('../../store/*.ts') as Record<string, () => Promise<Record<string, unknown>>>
  const states: Record<string, unknown> = {}
  for (const load of Object.values(modules)) {
    for (const [name, value] of Object.entries(await load())) {
      if (/^use\w+Store$/.test(name) && typeof value === 'function') states[name] = JSON.parse(JSON.stringify((value as () => Store)().$state))
    }
  }
  await nextTick()
  return { backend, states }
}

/**
 * Per persisted key: the store, and a blob in the shape of a release before the store's additive fields. Each blob is
 * non-empty and holds non-default values, so the stored fields are applied while every newer field is missing and has
 * to come from the store's own default (`loads: false`: the reader completes the stored fields in memory instead, so
 * the state is the fresh one). Add the pre-change shape here when a store gains a field.
 */
const OLDER: Record<(typeof PERSISTED_KEYS)[number], { store: string, blob: Record<string, unknown>, loads?: false }> = {
  // before the markers stamp, the pending deletes, the carry-over ledger and the after-midnight record
  'tasks-store': { store: 'useTasksStore', blob: { tasks: [], archivedTaskIds: ['old-1'], deletedTaskIds: ['old-2'], pendingTimeUpdates: {} } },
  // before the topic focus (#161) and the order of not planned tasks (#354)
  'board-store': { store: 'useBoardStore', blob: { grouping: { enabled: true, key: 'topic' } } },
  // before Apple Reminders (#551): no entry for it. A blob with no `sources` at all is the pre-#318 shape, rewritten on purpose
  'integration-health-store': { store: 'useIntegrationHealthStore', blob: { sources: { notion: { status: 'unconfigured', lastError: null, lastSuccessfulSync: null }, todoist: { status: 'unconfigured', lastError: null, lastSuccessfulSync: null } } }, loads: false },
  // before the day-end tracking (#537) and the work sessions (#600)
  taskStatistics: { store: 'useTaskStatisticsStore', blob: { completionRecords: [] } },
  // before the not-planned limit (#357)
  notionConfig: { store: 'useNotionConfigStore', blob: { config: null } },
  // before the list roles and the done-occurrence ledger (#551)
  remindersConfig: { store: 'useRemindersConfigStore', blob: {} },
  propertyOptions: { store: 'usePropertyOptionsStore', blob: { lastSyncTimestamp: 1_700_000_000_000 } },
  // before the floating timer (#383), the update check (#746), the intro hints (#800) and `jetztUsed` (#853)
  'settings-store': { store: 'useSettingsStore', blob: { focusEnabled: false, uiScale: 110, workingHoursMinutes: null } },
  // before the new day (#356, #387) and the plan note (#711)
  'day-recap-store': { store: 'useDayRecapStore', blob: { lastShownDay: '2026-01-01', closedTaskIds: ['old-1'] } },
  'trash-store': { store: 'useTrashStore', blob: { entries: [] } },
  'topic-styles': { store: 'useTopicStylesStore', blob: { styles: {} } },
}

describe('older persisted data hydrates to the declared defaults', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

  it('lists an older blob for every persisted key', () => {
    expect(Object.keys(OLDER).sort()).toEqual([...PERSISTED_KEYS].sort())
  })

  it.each([...PERSISTED_KEYS])('%s: the stored fields load, every newer field keeps its default, nothing is written', async (key) => {
    const { store, blob, loads } = OLDER[key]
    const defaults = await hydrate({}, false)
    const old = await hydrate({ [key]: blob })
    const expected = { ...defaults.states, [store]: loads === false ? defaults.states[store] : { ...(defaults.states[store] as object), ...blob } }
    expect(old.states).toEqual(expected)
    expect(old.backend.calls.filter(c => c.startsWith('set:'))).toEqual([])
  })
})
