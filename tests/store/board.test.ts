import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { sanitizeBoardConfig, useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

describe('sanitizeBoardConfig', () => {
  it('resets a persisted linear taskService to "never onboarded" and drops linearApiKey', () => {
    const result = sanitizeBoardConfig({
      taskService: 'linear',
      linearApiKey: 'x',
      todoistApiToken: 'tok',
      notionDatabaseId: 'db-1',
    })
    expect(result.sources).toBeNull()
    expect('linearApiKey' in result).toBe(false)
    expect('taskService' in result).toBe(false)
    expect(result.todoistApiToken).toBe('tok')
    expect(result.notionDatabaseId).toBe('db-1')
  })

  it('drops linearApiKey even when the service is still valid', () => {
    const result = sanitizeBoardConfig({ taskService: 'notion', linearApiKey: 'x' })
    expect(result.sources).toEqual({ connected: ['notion'], default: 'notion' })
    expect('linearApiKey' in result).toBe(false)
  })

  it.each([
    ['notion', { connected: ['notion'], default: 'notion' }],
    ['todoist', { connected: ['todoist'], default: 'todoist' }],
    ['local', { connected: [], default: 'local' }],
    ['example', { connected: [], default: 'local' }],
  ] as const)('maps the legacy %s taskService to sources', (svc, sources) => {
    expect(sanitizeBoardConfig({ taskService: svc }).sources).toEqual(sources)
  })

  it.each([undefined, null, 'str', 42, {}, { taskService: 'bogus' }])('falls back to "never onboarded" for %j', (raw) => {
    expect(sanitizeBoardConfig(raw).sources).toBeNull()
  })

  it('keeps a config that already has sources as it is', () => {
    const config = { sources: { connected: ['notion'], default: 'local' } }
    expect(sanitizeBoardConfig(config)).toEqual(config)
  })
})

describe('board store hydration wiring', () => {
  it('sanitises a legacy linear boardConfig when hydrating from localStorage', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    const { createApp } = await import('vue')
    const { createPersistedState } = await import('pinia-plugin-persistedstate')
    const { useBoardStore } = await import('~/store/board')
    localStorage.setItem('board-store', JSON.stringify({
      boardConfig: { taskService: 'linear', linearApiKey: 'x', todoistApiToken: 'tok' },
      grouping: { enabled: true, key: null },
    }))
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localStorage }))
    // Plugins are queued until the pinia instance is installed on an app.
    createApp({}).use(pinia)
    setActivePinia(pinia)
    const store = useBoardStore()
    expect(store.boardConfig.sources).toBeNull()
    expect('linearApiKey' in store.boardConfig).toBe(false)
    expect(store.boardConfig.todoistApiToken).toBe('tok')
    expect(store.grouping.enabled).toBe(true)
    localStorage.removeItem('board-store')
  })

  it('persists only boardConfig, columns, grouping and focus (not transient state)', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    const { createApp } = await import('vue')
    const { nextTick } = await import('vue')
    const { createPersistedState } = await import('pinia-plugin-persistedstate')
    const { useBoardStore } = await import('~/store/board')
    localStorage.removeItem('board-store')
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
    const store = useBoardStore()
    store.scrollPosition = { top: 123, left: 4 }
    store.grouping = { enabled: true, key: null }
    await nextTick()
    const saved = JSON.parse(localStorage.getItem('board-store') ?? '{}') as Record<string, unknown>
    expect(Object.keys(saved).sort()).toEqual(['boardConfig', 'columns', 'focus', 'grouping'])
    expect('scrollPosition' in saved).toBe(false)
    expect('confirmingTaskIds' in saved).toBe(false)
    localStorage.removeItem('board-store')
  })

  it('hydrates a legacy full-state payload, ignoring transient keys', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    const { createApp } = await import('vue')
    const { createPersistedState } = await import('pinia-plugin-persistedstate')
    const { useBoardStore } = await import('~/store/board')
    localStorage.setItem('board-store', JSON.stringify({
      boardConfig: { sources: { connected: [], default: 'local' } },
      grouping: { enabled: true, key: null },
      scrollPosition: { top: 999, left: 0 },
    }))
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
    const store = useBoardStore()
    expect(store.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    expect(store.grouping.enabled).toBe(true)
    localStorage.removeItem('board-store')
  })

  it('purges the legacy linearConfig key and persists the sanitised config on hydration', async () => {
    const { createPinia, setActivePinia } = await import('pinia')
    const { createApp } = await import('vue')
    const { createPersistedState } = await import('pinia-plugin-persistedstate')
    const { useBoardStore } = await import('~/store/board')
    localStorage.setItem('linearConfig', JSON.stringify({ apiKey: 'lin_secret' }))
    localStorage.setItem('board-store', JSON.stringify({
      boardConfig: { taskService: 'linear', linearApiKey: 'lin_secret', todoistApiToken: 'tok' },
    }))
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
    useBoardStore()
    expect(localStorage.getItem('linearConfig')).toBeNull()
    const raw = localStorage.getItem('board-store') ?? ''
    expect(raw).not.toContain('lin_secret')
    expect(JSON.parse(raw).boardConfig.todoistApiToken).toBe('tok')
    localStorage.removeItem('board-store')
  })

  describe('write-back at hydration (#273)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      localStorage.clear()
    })

    async function hydrate() {
      const { createPinia, setActivePinia } = await import('pinia')
      const { createApp } = await import('vue')
      const { createPersistedState } = await import('pinia-plugin-persistedstate')
      const { useBoardStore } = await import('~/store/board')
      const pinia = createPinia()
      pinia.use(createPersistedState({ storage: localStorage }))
      createApp({}).use(pinia)
      setActivePinia(pinia)
      return useBoardStore()
    }

    it('does not write at hydration when nothing was sanitised', async () => {
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { todoistApiToken: 'tok', sources: { connected: ['todoist'], default: 'todoist' } } }))
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      await hydrate()
      expect(setItem).not.toHaveBeenCalled()
    })

    it('does not write at hydration with empty storage', async () => {
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const board = await hydrate()
      expect(board.boardConfig).toEqual({ sources: null })
      expect(setItem).not.toHaveBeenCalled()
    })

    it('writes back once when the stored blob carried legacy Linear state', async () => {
      localStorage.setItem('board-store', JSON.stringify({
        boardConfig: { taskService: 'linear', linearApiKey: 'lin_secret', todoistApiToken: 'tok' },
      }))
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      await hydrate()
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(setItem.mock.calls[0]?.[0]).toBe('board-store')
      expect(setItem.mock.calls[0]?.[1]).not.toContain('lin_secret')
    })

    it('removes linearConfig even when the config is clean', async () => {
      localStorage.setItem('linearConfig', JSON.stringify({ apiKey: 'lin_secret' }))
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { sources: { connected: [], default: 'local' } } }))
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      await hydrate()
      expect(localStorage.getItem('linearConfig')).toBeNull()
      expect(setItem).not.toHaveBeenCalled()
    })

    it('survives a storage exception while purging linearConfig', async () => {
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { sources: { connected: [], default: 'local' } } }))
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
      const board = await hydrate()
      expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    })

    it('still persists the first mutation after a no-write hydration', async () => {
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { sources: { connected: [], default: 'local' } } }))
      const board = await hydrate()
      board.setSingleSource('todoist')
      const { nextTick } = await import('vue')
      await nextTick()
      expect(JSON.parse(localStorage.getItem('board-store') ?? '{}').boardConfig.sources).toEqual({ connected: ['todoist'], default: 'todoist' })
    })

    it('maps a legacy taskService once and writes the new shape back (#326)', async () => {
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { taskService: 'notion' } }))
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const board = await hydrate()
      expect(board.boardConfig).toEqual({ sources: { connected: ['notion'], default: 'notion' } })
      expect(setItem).toHaveBeenCalledTimes(1)
      expect(JSON.parse(setItem.mock.calls[0]?.[1] as string).boardConfig).toEqual({ sources: { connected: ['notion'], default: 'notion' } })

      // second start reads the new shape: nothing changes, nothing is written
      setItem.mockClear()
      await hydrate()
      expect(setItem).not.toHaveBeenCalled()
    })

    it('keeps "never onboarded" for a legacy null taskService', async () => {
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { taskService: null } }))
      const board = await hydrate()
      expect(board.boardConfig.sources).toBeNull()
      expect(board.isOnboarded).toBe(false)
      expect(board.defaultSource).toBeNull()
    })
  })
})

describe('board store sources (#326)', () => {
  async function freshBoard() {
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    const { useBoardStore } = await import('~/store/board')
    return useBoardStore()
  }

  it('starts never onboarded', async () => {
    const board = await freshBoard()
    expect(board.boardConfig.sources).toBeNull()
    expect(board.isOnboarded).toBe(false)
    expect(board.defaultSource).toBeNull()
    expect(board.isIntegrationConnected('notion')).toBe(false)
  })

  it('setSingleSource connects an integration as the only source and default', async () => {
    const board = await freshBoard()
    board.setSingleSource('notion')
    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'notion' })
    expect(board.isOnboarded).toBe(true)
    expect(board.defaultSource).toBe('notion')
    expect(board.isIntegrationConnected('notion')).toBe(true)
    expect(board.isIntegrationConnected('todoist')).toBe(false)
  })

  it('Local is a source without a connection, and null resets to never onboarded', async () => {
    const board = await freshBoard()
    board.setSingleSource('local')
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    expect(board.defaultSource).toBe('local')
    board.setSingleSource(null)
    expect(board.isOnboarded).toBe(false)
  })

  it('keeps unrelated board config when the sources change', async () => {
    const board = await freshBoard()
    board.setTodoistApiToken('tok')
    board.setSingleSource('local')
    expect(board.boardConfig.todoistApiToken).toBe('tok')
  })
})

describe('updateTaskPosition (#422)', () => {
  it('cleans up the old column also when it is Offen (TaskStatus.Open is 0)', () => {
    setActivePinia(createPinia())
    const board = useBoardStore()
    board.columnByTaskStatus(TaskStatus.Open)!.taskOrder = ['a', 'b', 'c']
    board.updateTaskPosition('a', TaskStatus.Open, TaskStatus.Open)
    expect(board.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['b', 'c', 'a'])
    board.updateTaskPosition('b', TaskStatus.Waiting, TaskStatus.Open)
    expect(board.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['c', 'a'])
    expect(board.columnByTaskStatus(TaskStatus.Waiting)?.taskOrder).toEqual(['b'])
  })

  it('without an old status it only appends', () => {
    setActivePinia(createPinia())
    const board = useBoardStore()
    board.columnByTaskStatus(TaskStatus.Open)!.taskOrder = ['a']
    board.updateTaskPosition('a', TaskStatus.Open)
    board.updateTaskPosition('b', TaskStatus.Open)
    expect(board.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['a', 'b'])
  })
})

describe('timebox nudge flag (#389)', () => {
  const task = (overrides: Partial<Task> = {}): Task =>
    ({
      id: 't1', source: 'local', externalId: null, title: 'Nudge me', status: TaskStatus.Progress,
      activity: null, topic: null, topicColorCode: null, priority: 0, notes: null,
      timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
    }) as Task

  beforeEach(() => setActivePinia(createPinia()))

  it('starts for a Jetzt card without a timebox', () => {
    useTasksStore().addTask(task())
    const board = useBoardStore()
    expect(board.startTimeboxNudge('t1')).toBe(true)
    expect(board.timeboxNudgeTaskId).toBe('t1')
  })

  it('a new card replaces the nudge of the previous one (one at a time)', () => {
    const tasks = useTasksStore()
    tasks.addTask(task({ id: 't1' }))
    tasks.addTask(task({ id: 't2' }))
    const board = useBoardStore()
    board.startTimeboxNudge('t1')
    board.startTimeboxNudge('t2')
    expect(board.timeboxNudgeTaskId).toBe('t2')
  })

  it.each([
    ['an unknown task', 'missing', undefined],
    ['a card outside Jetzt', 't1', { status: TaskStatus.Open }],
    ['a card that has a timebox', 't1', { timeBoxSeconds: 900 }],
  ] as const)('does not start for %s and keeps a running nudge', (_label, id, overrides) => {
    const tasks = useTasksStore()
    tasks.addTask(task({ id: 'running' }))
    if (overrides) tasks.addTask(task({ id: 't1', ...overrides }))
    const board = useBoardStore()
    board.startTimeboxNudge('running')
    expect(board.startTimeboxNudge(id)).toBe(false)
    expect(board.timeboxNudgeTaskId).toBe('running')
  })

  it('ends for its own card only unless called without an id', () => {
    const tasks = useTasksStore()
    tasks.addTask(task({ id: 't1' }))
    const board = useBoardStore()
    board.startTimeboxNudge('t1')
    board.endTimeboxNudge('other')
    expect(board.timeboxNudgeTaskId).toBe('t1')
    board.endTimeboxNudge('t1')
    expect(board.timeboxNudgeTaskId).toBeNull()
    board.startTimeboxNudge('t1')
    board.endTimeboxNudge()
    expect(board.timeboxNudgeTaskId).toBeNull()
  })

  it('is transient: not persisted', async () => {
    const { createApp, nextTick } = await import('vue')
    const { createPersistedState } = await import('pinia-plugin-persistedstate')
    localStorage.removeItem('board-store')
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
    useTasksStore().addTask(task())
    const board = useBoardStore()
    board.startTimeboxNudge('t1')
    board.grouping = { enabled: true, key: null }
    await nextTick()
    const saved = JSON.parse(localStorage.getItem('board-store') ?? '{}') as Record<string, unknown>
    expect('timeboxNudgeTaskId' in saved).toBe(false)
    localStorage.removeItem('board-store')
  })
})
