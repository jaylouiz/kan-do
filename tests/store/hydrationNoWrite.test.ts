/**
 * Guard for #273: hydrating a persisted store never sends a `data_set` on its own (ADR 011, "never
 * defaults at hydration"). With an empty mirror (unreadable data file / folder-unavailable) a hydration
 * write would turn the store `dirty` although the user changed nothing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import type { Store } from 'pinia'

vi.mock('~/composables/useStatisticsBackfill', () => ({
  useStatisticsBackfill: () => ({ runConfigChangeBackfill: vi.fn().mockResolvedValue(undefined) }),
}))

const sets = (calls: string[]) => calls.filter(c => c.startsWith('set:'))

async function desktopPinia(stores: Record<string, unknown>) {
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
  return backend
}

async function instantiateAll() {
  const modules = import.meta.glob('../../store/*.ts') as Record<string, () => Promise<Record<string, unknown>>>
  const created: Record<string, Store> = {}
  for (const load of Object.values(modules)) {
    for (const [name, value] of Object.entries(await load())) {
      if (/^use\w+Store$/.test(name) && typeof value === 'function') created[name] = (value as () => Store)()
    }
  }
  return created
}

describe('hydration writes nothing (#273)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

  it('an empty mirror produces no data_set for any persisted store, a later mutation does', async () => {
    const backend = await desktopPinia({})
    const created = await instantiateAll()
    await nextTick()

    expect(Object.keys(created).length).toBeGreaterThanOrEqual(6)
    expect(sets(backend.calls)).toEqual([])

    ;(created.useBoardStore as unknown as { setSingleSource: (s: string) => void }).setSingleSource('local')
    await nextTick()
    expect(sets(backend.calls).length).toBeGreaterThan(0)
  })

  it('a stored or missing day-recap-store is not written back at hydration (#385)', async () => {
    for (const stores of [{}, { 'day-recap-store': { lastShownDay: '2026-10-21', archiveDone: false } }, { 'day-recap-store': { lastShownDay: 'garbage' } }]) {
      const backend = await desktopPinia(stores)
      const created = await instantiateAll()
      await nextTick()
      expect(created.useDayRecapStore).toBeDefined()
      expect(sets(backend.calls)).toEqual([])
    }
  })

  it('a clean stored board-store is not written back at hydration', async () => {
    const backend = await desktopPinia({ 'board-store': { boardConfig: { sources: { connected: [], default: 'local' } } } })
    await instantiateAll()
    await nextTick()
    expect(sets(backend.calls)).toEqual([])
  })

  it('settings-store (#394): nothing stored and a stored value are both left alone at hydration, a toggle is written', async () => {
    const empty = await desktopPinia({})
    const store = (await instantiateAll()).useSettingsStore as unknown as { focusEnabled: boolean; setFocusEnabled: (v: boolean) => void }
    await nextTick()
    expect(store.focusEnabled).toBe(true)
    expect(sets(empty.calls)).not.toContain('set:settings-store')

    const stored = await desktopPinia({ 'settings-store': { focusEnabled: false } })
    const hydrated = (await instantiateAll()).useSettingsStore as unknown as { focusEnabled: boolean; setFocusEnabled: (v: boolean) => void }
    await nextTick()
    expect(hydrated.focusEnabled).toBe(false)
    expect(sets(stored.calls)).toEqual([])

    hydrated.setFocusEnabled(true)
    await nextTick()
    expect(sets(stored.calls)).toContain('set:settings-store')
  })

  it('topic-styles (#431): a data file without the key, with styles, with unknown hue/symbol keys or garbage is never written at hydration', async () => {
    for (const stores of [
      {},
      { 'tasks-store': { tasks: [] }, 'trash-store': { entries: [] }, taskStatistics: { completionRecords: [] }, propertyOptions: {} },
      { 'topic-styles': { styles: { Work: { hue: 'blue', symbol: 'briefcase' } } } },
      { 'topic-styles': { styles: { Work: { hue: 'teal', symbol: 'unicorn' } } } },
      { 'topic-styles': { styles: null } },
      { 'topic-styles': { styles: ['x'] } },
    ]) {
      const backend = await desktopPinia(stores)
      const created = await instantiateAll()
      await nextTick()
      expect(created.useTopicStylesStore).toBeDefined()
      expect(sets(backend.calls)).not.toContain('set:topic-styles')
      expect(sets(backend.calls)).toEqual([])
    }
  })

  it('topic-styles (#431): an edit is written under topic-styles', async () => {
    const backend = await desktopPinia({})
    const created = await instantiateAll()
    ;(created.useTopicStylesStore as unknown as { setStyle: (name: string, patch: { hue: string }) => void }).setStyle('Work', { hue: 'blue' })
    await nextTick()
    expect(sets(backend.calls)).toContain('set:topic-styles')
    expect(backend.sets['topic-styles']).toEqual({ styles: { Work: { hue: 'blue', symbol: null } } })
  })

  it('a stored board without a pendingSourceSwitch is not written back, nor is one with the marker', async () => {
    for (const boardConfig of [
      { sources: { connected: ['notion'], default: 'notion' } },
      { sources: { connected: ['notion'], default: 'notion' }, pendingSourceSwitch: true },
    ]) {
      const backend = await desktopPinia({ 'board-store': { boardConfig } })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls)).toEqual([])
    }
  })

  it('a stored blob with legacy Linear state is written back once, without the key', async () => {
    const backend = await desktopPinia({ 'board-store': { boardConfig: { taskService: 'linear', linearApiKey: 'lin_secret' } } })
    await instantiateAll()
    await nextTick()
    expect(sets(backend.calls)).toEqual(['set:board-store'])
    expect(JSON.stringify(backend.sets['board-store'])).not.toContain('lin_secret')
  })

  describe('task sources (#326)', () => {
    const legacyBoard = { boardConfig: { taskService: 'notion' } }
    const legacyTasks = { tasks: [{ id: 'page-1', title: 'A', status: 0 }], pendingDeletes: {} }

    it('stamps legacy tasks from the legacy board config and writes each store back once', async () => {
      const backend = await desktopPinia({ 'board-store': legacyBoard, 'tasks-store': legacyTasks })
      await instantiateAll()
      await nextTick()
      // board-store may be written again when the tasks hydrate and fill the column order (not part of #326)
      expect(sets(backend.calls)).toContain('set:board-store')
      expect(sets(backend.calls).filter(call => call === 'set:tasks-store')).toHaveLength(1)
      expect(backend.sets['board-store']).toMatchObject({ boardConfig: { sources: { connected: ['notion'], default: 'notion' } } })
      expect((backend.sets['tasks-store'] as { tasks: unknown[] }).tasks[0]).toMatchObject({ id: 'page-1', source: 'notion', externalId: 'page-1' })
    })

    it('stamps legacy tasks of a Local board without an externalId', async () => {
      const backend = await desktopPinia({ 'board-store': { boardConfig: { taskService: 'local' } }, 'tasks-store': legacyTasks })
      await instantiateAll()
      await nextTick()
      expect((backend.sets['tasks-store'] as { tasks: unknown[] }).tasks[0]).toMatchObject({ source: 'local', externalId: null })
    })

    it('writes nothing for tasks that already carry their source', async () => {
      const backend = await desktopPinia({
        'board-store': { boardConfig: { sources: { connected: ['notion'], default: 'notion' } } },
        'tasks-store': { tasks: [{ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A', status: 0 }], pendingDeletes: {} },
      })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls)).not.toContain('set:tasks-store')
    })
  })
  describe('legacy sourceData (#334)', () => {
    const board = { boardConfig: { sources: { connected: ['notion'], default: 'notion' } } }
    const upstream = { id: 'page-1', properties: { Name: { title: [{ plain_text: 'A' }] } } }

    it('drops the stored upstream payload of a task and writes the tasks store back once', async () => {
      const backend = await desktopPinia({
        'board-store': board,
        'tasks-store': { tasks: [{ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A', status: 0, sourceData: upstream }], pendingDeletes: {} },
      })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls).filter(call => call === 'set:tasks-store')).toHaveLength(1)
      const stored = (backend.sets['tasks-store'] as { tasks: Array<Record<string, unknown>> }).tasks[0]
      expect(stored).toMatchObject({ id: 'page-1', title: 'A' })
      expect(stored).not.toHaveProperty('sourceData')
    })

    it('writes nothing for a store that no longer carries it', async () => {
      const backend = await desktopPinia({
        'board-store': board,
        'tasks-store': { tasks: [{ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A', status: 0 }], pendingDeletes: {} },
      })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls)).not.toContain('set:tasks-store')
    })
  })

  describe('stored dates (#376)', () => {
    const board = { boardConfig: { sources: { connected: ['notion'], default: 'notion' } } }
    const iso = '2026-10-26T15:04:05.678Z'
    const task = { id: 'page-1', source: 'notion', externalId: 'page-1', title: 'A', status: 3, completedAt: iso, createdAt: iso, updatedAt: iso, archivedAt: iso }
    const dated = { tasks: [task], pendingDeletes: {}, lastSyncTimestamp: iso, pendingTimeUpdates: { 'page-1': { taskId: 'page-1', timeSpentSeconds: 1, createdAt: iso, lastAttemptAt: iso, attemptCount: 0, status: 'pending' } } }

    it('writes nothing for a store holding only ISO-string dates', async () => {
      const backend = await desktopPinia({
        'board-store': board,
        'tasks-store': dated,
        taskStatistics: { completionRecords: [{ taskId: 'page-1', title: 'A', completedAt: iso, timeBoxSeconds: null, actualTimeSpentSeconds: 1, estimationAccuracy: null, topic: null, topicColorCode: null, activity: null, isUnplanned: false }] },
      })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls)).not.toContain('set:tasks-store')
      expect(sets(backend.calls)).not.toContain('set:taskStatistics')
    })

    it('writes nothing for dates in a store with no tasks, only a sync time', async () => {
      const backend = await desktopPinia({ 'board-store': board, 'tasks-store': { tasks: [], pendingDeletes: {}, lastSyncTimestamp: iso } })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls)).toEqual([])
    })

    it('a store that also needs its sources normalised still writes once, with the dates as ISO strings', async () => {
      const { source: _source, externalId: _externalId, ...legacy } = task
      const backend = await desktopPinia({ 'board-store': board, 'tasks-store': { ...dated, tasks: [legacy] } })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls).filter(call => call === 'set:tasks-store')).toHaveLength(1)
      expect(backend.sets['tasks-store']).toMatchObject({ tasks: [{ source: 'notion', completedAt: iso }], lastSyncTimestamp: iso })
    })
  })

  describe('per-source integration health (#318)', () => {
    const sourcesOf = (backend: { sets: Record<string, unknown> }) => backend.sets['integration-health-store'] as Record<string, unknown>

    it('writes a legacy notion status back once as sources.notion, without the old keys', async () => {
      const backend = await desktopPinia({ 'integration-health-store': { notion: 'broken', notionLastErrorReason: '401 Unauthorized' } })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls).filter(call => call === 'set:integration-health-store')).toHaveLength(1)
      expect(sourcesOf(backend)).toEqual({
        sources: {
          notion: { status: 'broken', lastError: '401 Unauthorized', lastSuccessfulSync: null },
          todoist: { status: 'unconfigured', lastError: null, lastSuccessfulSync: null },
        },
      })
    })

    it('seeds sources.notion.lastSuccessfulSync from the stored board last sync when it converts the legacy shape', async () => {
      const backend = await desktopPinia({
        'integration-health-store': { notion: 'healthy', notionLastErrorReason: null },
        'tasks-store': { tasks: [], pendingDeletes: {}, lastSyncTimestamp: '2026-03-01T10:00:00.000Z' },
      })
      await instantiateAll()
      await nextTick()
      expect(sourcesOf(backend)).toMatchObject({
        sources: { notion: { lastSuccessfulSync: Date.parse('2026-03-01T10:00:00.000Z') } },
      })
    })

    it('writes nothing for a state already in the per-source shape', async () => {
      const entry = { status: 'healthy', lastError: null, lastSuccessfulSync: 1_700_000_000_000 }
      const backend = await desktopPinia({
        'integration-health-store': { sources: { notion: entry, todoist: { status: 'unconfigured', lastError: null, lastSuccessfulSync: null } } },
      })
      await instantiateAll()
      await nextTick()
      expect(sets(backend.calls)).not.toContain('set:integration-health-store')
    })
  })
})
