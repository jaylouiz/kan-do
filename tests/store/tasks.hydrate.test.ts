/**
 * #376: Date-typed fields come back from storage as ISO strings; the stores revive them in `afterHydrate`,
 * on web (localStorage) and on desktop (data-file envelope) alike.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Task } from '~/types/task'

vi.mock('~/composables/useStatisticsBackfill', () => ({
  useStatisticsBackfill: () => ({ runConfigChangeBackfill: vi.fn().mockResolvedValue(undefined) }),
}))

const COMPLETED = new Date(2026, 9, 26, 15, 4, 5, 678)
const CREATED = new Date(2026, 9, 20, 8, 0, 0, 1)
const UPDATED = new Date(2026, 9, 26, 15, 4, 6, 7)
const ARCHIVED = new Date(2026, 9, 27, 7, 30, 0, 0)
const SYNCED = new Date(2026, 9, 27, 7, 31, 0, 0)
const ATTEMPTED = new Date(2026, 9, 27, 7, 32, 0, 0)

const BOARD = { boardConfig: { sources: { connected: ['notion'], default: 'notion' } } }

/** What `JSON.stringify` of a live task leaves in storage: every Date as an ISO string. */
function storedTask(overrides: Record<string, unknown> = {}) {
  return JSON.parse(JSON.stringify({
    id: 'page-1', source: 'notion', externalId: 'page-1', title: 'Done yesterday', status: 3,
    completedAt: COMPLETED, createdAt: CREATED, updatedAt: UPDATED, archivedAt: ARCHIVED,
    ...overrides,
  })) as Record<string, unknown>
}

function storedTasksStore(overrides: Record<string, unknown> = {}) {
  return JSON.parse(JSON.stringify({
    tasks: [storedTask()],
    pendingDeletes: {
      'page-2': {
        taskId: 'page-2', carryOver: null, state: 'waiting', requestedAt: 1_700_000_000_000,
        task: storedTask({ id: 'page-2', externalId: 'page-2' }),
      },
    },
    lastSyncTimestamp: SYNCED,
    pendingTimeUpdates: {
      'page-1': { taskId: 'page-1', timeSpentSeconds: 60, createdAt: CREATED, lastAttemptAt: ATTEMPTED, attemptCount: 1, status: 'failed' },
    },
    ...overrides,
  })) as Record<string, unknown>
}

async function freshPinia(mode: 'web' | 'desktop', stores: Record<string, unknown>) {
  vi.resetModules()
  let storage: Storage | typeof import('~/lib/dataStorage').appStorage = localStorage
  let setCalls = (): string[] => []
  if (mode === 'desktop') {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    const { createFakeDataBackend } = await import('../helpers/fakeDataBackend')
    const { CURRENT_SCHEMA_VERSION } = await import('~/utils/dataFile/envelope')
    const backend = createFakeDataBackend({
      needsInit: false,
      envelope: { schemaVersion: CURRENT_SCHEMA_VERSION, writtenAt: '2026-01-01T00:00:00.000Z', writtenBy: 'd', appVersion: '0.1.0', stores },
    })
    const { appStorage, initDataStorage } = await import('~/lib/dataStorage')
    await initDataStorage({ backend, source: null })
    storage = appStorage
    setCalls = () => backend.calls.filter(call => call.startsWith('set:'))
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    for (const [key, value] of Object.entries(stores)) localStorage.setItem(key, JSON.stringify(value))
  }
  const { createPinia, setActivePinia } = await import('pinia')
  const { createPersistedState } = await import('pinia-plugin-persistedstate')
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage }))
  const { createApp } = await import('vue')
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const { useBoardStore } = await import('~/store/board')
  const { useTasksStore } = await import('~/store/tasks')
  const { useTaskStatisticsStore } = await import('~/store/taskStatistics')
  useBoardStore()
  const tasks = useTasksStore()
  const statistics = useTaskStatisticsStore()
  await nextTick()
  return { tasks, statistics, setCalls }
}

describe.each(['web', 'desktop'] as const)('hydrating stored dates (#376, %s)', (mode) => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

  it('revives the four date fields of every task to the stored instants', async () => {
    const { tasks } = await freshPinia(mode, { 'board-store': BOARD, 'tasks-store': storedTasksStore() })
    const [task] = tasks.tasks as Task[]
    expect(task?.completedAt).toBeInstanceOf(Date)
    expect(task?.createdAt).toBeInstanceOf(Date)
    expect(task?.updatedAt).toBeInstanceOf(Date)
    expect(task?.archivedAt).toBeInstanceOf(Date)
    expect(task?.completedAt?.getTime()).toBe(COMPLETED.getTime())
    expect(task?.createdAt?.getTime()).toBe(CREATED.getTime())
    expect(task?.updatedAt?.getTime()).toBe(UPDATED.getTime())
    expect(task?.archivedAt?.getTime()).toBe(ARCHIVED.getTime())
  })

  it('revives the task snapshot of a pending delete, so undo after a reload restores Dates', async () => {
    const { tasks } = await freshPinia(mode, { 'board-store': BOARD, 'tasks-store': storedTasksStore() })
    const snapshot = tasks.pendingDeletes['page-2']?.task
    expect(snapshot?.completedAt).toBeInstanceOf(Date)
    expect(snapshot?.completedAt?.getTime()).toBe(COMPLETED.getTime())
    expect(snapshot?.archivedAt).toBeInstanceOf(Date)
    expect(tasks.pendingDeletes['page-2']?.requestedAt).toBe(1_700_000_000_000)
  })

  it('revives lastSyncTimestamp and the pending time updates', async () => {
    const { tasks } = await freshPinia(mode, { 'board-store': BOARD, 'tasks-store': storedTasksStore() })
    expect(tasks.lastSyncTimestamp).toBeInstanceOf(Date)
    expect(tasks.lastSyncTimestamp?.getTime()).toBe(SYNCED.getTime())
    const update = tasks.pendingTimeUpdates['page-1']
    expect(update?.createdAt).toBeInstanceOf(Date)
    expect(update?.createdAt.getTime()).toBe(CREATED.getTime())
    expect(update?.lastAttemptAt).toBeInstanceOf(Date)
    expect(update?.lastAttemptAt?.getTime()).toBe(ATTEMPTED.getTime())
  })

  it('revives lastSyncTimestamp and the pending time updates of a store with no tasks', async () => {
    const { tasks } = await freshPinia(mode, {
      'board-store': BOARD,
      'tasks-store': storedTasksStore({ tasks: [], pendingDeletes: {} }),
    })
    expect(tasks.lastSyncTimestamp).toBeInstanceOf(Date)
    expect(tasks.pendingTimeUpdates['page-1']?.createdAt).toBeInstanceOf(Date)
  })

  it('hydrates an unparsable completedAt as null without throwing, and a Done task lands in "today"', async () => {
    const { tasks } = await freshPinia(mode, {
      'board-store': BOARD,
      'tasks-store': storedTasksStore({ tasks: [storedTask({ completedAt: 'garbage', archivedAt: null })] }),
    })
    expect(tasks.tasks[0]?.completedAt).toBeNull()
    expect(tasks.tasksDoneToday.map(task => task.id)).toEqual(['page-1'])
  })

  it('revives the completion records of the statistics store', async () => {
    const records = [{ taskId: 'page-1', title: 'A', completedAt: COMPLETED, timeBoxSeconds: null, actualTimeSpentSeconds: 5, estimationAccuracy: null, topic: null, topicColorCode: null, activity: null, isUnplanned: false }]
    const { statistics } = await freshPinia(mode, {
      'board-store': BOARD,
      taskStatistics: JSON.parse(JSON.stringify({ completionRecords: records })),
    })
    const [record] = statistics.completionRecords
    expect(record?.completedAt).toBeInstanceOf(Date)
    expect(record?.completedAt.getTime()).toBe(COMPLETED.getTime())
  })

  it('writes nothing back because of the revive (#273)', async () => {
    const records = [{ taskId: 'page-1', title: 'A', completedAt: COMPLETED, timeBoxSeconds: null, actualTimeSpentSeconds: 5, estimationAccuracy: null, topic: null, topicColorCode: null, activity: null, isUnplanned: false }]
    const stored = {
      'board-store': BOARD,
      'tasks-store': storedTasksStore(),
      taskStatistics: JSON.parse(JSON.stringify({ completionRecords: records })),
    }
    const { setCalls } = await freshPinia(mode, stored)
    // The board store fills its column order when tasks hydrate (not part of the revive)
    expect(setCalls().filter(call => call !== 'set:board-store')).toEqual([])
    // Web: the stored blob is byte-for-byte what was put there
    if (mode === 'web') expect(JSON.parse(localStorage.getItem('tasks-store') as string)).toEqual(stored['tasks-store'])
  })

  it('persists a revived store as the same ISO strings (no stored-shape change)', async () => {
    const stored = storedTasksStore()
    const { tasks, setCalls } = await freshPinia(mode, { 'board-store': BOARD, 'tasks-store': stored })
    tasks.$persist()
    if (mode === 'web') expect(JSON.parse(localStorage.getItem('tasks-store') as string)).toMatchObject(stored)
    else expect(setCalls()).toContain('set:tasks-store')
  })
})

describe('a hydrated task reaches the integrations and the export (#376)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('NotionIntegration.updateTask writes the completion date of a hydrated Done task without throwing', async () => {
    const { tasks } = await freshPinia('web', { 'board-store': BOARD, 'tasks-store': storedTasksStore() })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, properties: {} }) })
    vi.stubGlobal('fetch', fetchMock)
    const { NotionIntegration } = await import('~/integrations/NotionIntegration')
    const notion = new NotionIntegration(
      'tkn', 'db1',
      { title: 'Name', status: 'Status', completedDate: 'Done on' } as never,
      { today: 'Heute', doing: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' } as never,
      undefined, 'ds-123',
    )

    await expect(notion.updateTask(tasks.tasks[0] as Task)).resolves.not.toThrow()

    const patch = fetchMock.mock.calls.map(([, init]) => init as { method?: string, body?: string }).find(init => init?.method === 'PATCH')
    expect(JSON.parse(patch?.body as string).properties['Done on']).toEqual({ date: { start: COMPLETED.toISOString() } })
  })

  it('export -> import keeps the ISO strings on disk and hydrates Dates in memory', async () => {
    const { buildExport, parseImport } = await import('~/utils/dataFile/exportImport')
    const stored = storedTasksStore()
    const built = buildExport({ stores: { 'board-store': BOARD, 'tasks-store': stored }, deviceId: 'd', appVersion: '0.1.0' })
    const parsed = parseImport(built.text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const imported = JSON.parse(parsed.text).stores as Record<string, unknown>
    expect(imported['tasks-store']).toEqual(stored)

    const { tasks } = await freshPinia('web', imported)
    expect(tasks.tasks[0]?.completedAt).toBeInstanceOf(Date)
    expect(tasks.tasks[0]?.completedAt?.toISOString()).toBe(COMPLETED.toISOString())
    expect(tasks.lastSyncTimestamp?.toISOString()).toBe(SYNCED.toISOString())
  })

  it('web replace: a blob planned from an import hydrates to the same instants', async () => {
    const { planReplace, commitReplace } = await import('~/utils/dataFile/webReplace')
    const { PERSISTED_KEYS } = await import('~/lib/dataStorage')
    const stored = storedTasksStore()
    const plan = planReplace(Object.fromEntries(PERSISTED_KEYS.map(key => [key, null])), { 'board-store': BOARD, 'tasks-store': stored })
    commitReplace(localStorage, plan)
    expect(JSON.parse(localStorage.getItem('tasks-store') as string)).toEqual(stored)

    const { tasks } = await freshPinia('web', {})
    expect(tasks.tasks[0]?.completedAt?.getTime()).toBe(COMPLETED.getTime())
  })
})

describe.each(['web', 'desktop'] as const)('hydrating a stored priority above 3 (#617, %s)', (mode) => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

  it('reads the former 4th level (urgent) as High and no priority (0) as Normal, in tasks and in a pending delete snapshot, and keeps 1-3', async () => {
    const stored = storedTasksStore({
      tasks: [0, 1, 2, 3, 4].map(priority => storedTask({ id: `p${priority}`, externalId: `p${priority}`, priority })),
      pendingDeletes: {
        'page-2': { taskId: 'page-2', carryOver: null, state: 'waiting', requestedAt: 1, task: storedTask({ id: 'page-2', externalId: 'page-2', priority: 4 }) },
      },
    })
    const { tasks } = await freshPinia(mode, { 'board-store': BOARD, 'tasks-store': stored })
    expect((tasks.tasks as Task[]).map(task => task.priority)).toEqual([2, 1, 2, 3, 3])
    expect(tasks.pendingDeletes['page-2']?.task.priority).toBe(3)
  })

  it('does not write anything because of the clamp (#273): an old 4 stays in storage until the task is saved', async () => {
    const stored = storedTasksStore({ tasks: [storedTask({ id: 'p4', externalId: 'p4', priority: 4 })], pendingDeletes: {} })
    const { tasks, setCalls } = await freshPinia(mode, { 'board-store': BOARD, 'tasks-store': stored })
    expect((tasks.tasks as Task[])[0]?.priority).toBe(3)
    if (mode === 'desktop') {
      expect(setCalls()).not.toContain('set:tasks-store')
    } else {
      expect(JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks[0].priority).toBe(4)
    }
  })

  it('a stored 0, null or missing priority reads as Normal and is not rewritten (#653, #273)', async () => {
    const missing = storedTask({ id: 'pm', externalId: 'pm', priority: 2 }) as unknown as Record<string, unknown>
    delete missing.priority
    const stored = storedTasksStore({
      tasks: [storedTask({ id: 'p0', externalId: 'p0', priority: 0 }), storedTask({ id: 'pn', externalId: 'pn', priority: null as unknown as number }), missing as never],
      pendingDeletes: {},
    })
    const { tasks, setCalls } = await freshPinia(mode, { 'board-store': BOARD, 'tasks-store': stored })
    expect((tasks.tasks as Task[]).map(task => task.priority)).toEqual([2, 2, 2])
    if (mode === 'desktop') {
      expect(setCalls()).not.toContain('set:tasks-store')
    } else {
      expect(JSON.parse(localStorage.getItem('tasks-store') ?? '{}').tasks[0].priority).toBe(0)
    }
  })
})
