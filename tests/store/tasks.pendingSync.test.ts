/**
 * #319: the `pendingSync` marker on a task. Set before a push, cleared by its success, kept by a change made
 * during the push, kept by a fetch of the source (local state wins until it is pushed), persisted and read
 * back without a write on hydration (#273).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { mapHelpers } from '~/utils/mapHelpers'

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, source: 'notion', externalId: id, title: id, notes: null, status: TaskStatus.Open, priority: 1,
    activity: null, timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
    ...overrides,
  }
}

describe('pendingSync marker in the tasks store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('marks a task once: the first change keeps `since`, every change bumps the revision', () => {
    const store = useTasksStore()
    store.addTask(task('a'))
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValue(5000)

    const first = store.markPendingSync('a')
    const second = store.markPendingSync('a')

    expect(store.task('a')?.pendingSync).toEqual({ since: 1000, attempts: 0, lastError: null, upstreamDone: false })
    expect(second).toBe(first + 1)
  })

  it('notes whether the source holds the task as completed: set by the first change, then kept (#344)', () => {
    const store = useTasksStore()
    store.addTask(task('a', { status: TaskStatus.Open }))

    store.markPendingSync('a', true) // moved out of Done: the source still holds it completed
    store.markPendingSync('a', false) // a later change does not tell what the source holds
    expect(store.task('a')?.pendingSync?.upstreamDone).toBe(true)

    const revision = store.markPendingSync('a')
    expect(store.clearPendingSync('a', revision - 1, false)).toBe(false) // a change meanwhile keeps the marker...
    expect(store.task('a')?.pendingSync?.upstreamDone).toBe(false) // ...and notes what the push left upstream
  })

  it('never marks a Local task: nothing upstream can lag behind', () => {
    const store = useTasksStore()
    store.addTask(task('l', { source: 'local', externalId: null }))

    expect(store.markPendingSync('l')).toBe(0)
    expect(store.task('l')?.pendingSync).toBeUndefined()
    expect(store.isSyncPending('l')).toBe(false)
  })

  it('clears the marker, its move and the queued time when the push succeeded', () => {
    const store = useTasksStore()
    store.addTask(task('a'))
    store.addPendingTimeUpdate('a', 30)
    const revision = store.markPendingSync('a')

    expect(store.clearPendingSync('a', revision)).toBe(true)

    expect(store.task('a')?.pendingSync).toBeUndefined()
    expect(mapHelpers.has(store.pendingTimeUpdates, 'a')).toBe(false)
    expect(store.isSyncPending('a')).toBe(false)
  })

  it('keeps the marker when the task changed again while the push was in flight', () => {
    const store = useTasksStore()
    store.addTask(task('a'))
    const revision = store.markPendingSync('a')
    store.markPendingSync('a') // an edit during the write

    expect(store.clearPendingSync('a', revision)).toBe(false)
    expect(store.task('a')?.pendingSync).toBeDefined()
  })

  it('counts failed attempts and keeps the last reason', () => {
    const store = useTasksStore()
    store.addTask(task('a'))
    store.markPendingSync('a')
    store.recordPendingSyncFailure('a', 'offline')
    store.recordPendingSyncFailure('a', 'still offline')

    expect(store.task('a')?.pendingSync).toMatchObject({ attempts: 2, lastError: 'still offline' })
  })

  it('treats queued time as a reason for pending sync, without freezing the task against a fetch', () => {
    const store = useTasksStore()
    store.addTask(task('a', { title: 'old', timeSpentSeconds: 10 }))
    store.addPendingTimeUpdate('a', 10)

    expect(store.isSyncPending('a')).toBe(true)
    expect(store.pendingSyncTasks.map((t) => t.id)).toEqual(['a'])

    store.mergeTasks('notion', [task('a', { title: 'renamed upstream' })])
    expect(store.task('a')?.title).toBe('renamed upstream')
  })

  it('queues no time for a source that stores none (Local, Todoist): nothing lingers until the stale cleanup (#336)', () => {
    const store = useTasksStore()
    store.addTask(task('l', { source: 'local', externalId: null }))
    store.addTask(task('t', { source: 'todoist' }))

    store.addPendingTimeUpdate('l', 5)
    store.addPendingTimeUpdate('t', 5)
    store.mergeTasks('todoist', [task('t', { source: 'todoist', timeSpentSeconds: 0 })])

    expect(mapHelpers.size(store.pendingTimeUpdates)).toBe(0)
    expect(store.hasPendingSync).toBe(false)
  })

  describe('a fetch of the source', () => {
    it('keeps the local state of a task with unpushed changes and adopts the source for the rest', () => {
      const store = useTasksStore()
      store.addTask(task('a', { status: TaskStatus.Done }))
      store.addTask(task('b', { title: 'b local' }))
      store.markPendingSync('a')

      store.mergeTasks('notion', [task('a', { status: TaskStatus.Open }), task('b', { title: 'b upstream' })])

      expect(store.task('a')?.status).toBe(TaskStatus.Done)
      expect(store.task('a')?.pendingSync).toBeDefined()
      expect(store.task('b')?.title).toBe('b upstream')
    })

    it('does not lose a task made while the source was unreachable', () => {
      const store = useTasksStore()
      store.addTask(task('local_1', { externalId: null }))
      store.markPendingSync('local_1')

      store.mergeTasks('notion', [task('remote')])

      expect(store.tasks.map((t) => t.id).sort()).toEqual(['local_1', 'remote'])
    })

    it('still drops a task the source no longer has when it carries no marker', () => {
      const store = useTasksStore()
      store.addTask(task('gone'))

      store.mergeTasks('notion', [task('remote')])

      expect(store.tasks.map((t) => t.id)).toEqual(['remote'])
    })
  })

  it('completeCreate gives the task the source\'s id, keeps its own id and clears the marker', () => {
    const store = useTasksStore()
    store.addTask(task('local_1', { externalId: null }))
    const revision = store.markPendingSync('local_1')

    store.completeCreate('local_1', { externalId: 'page-1' }, revision)

    expect(store.task('local_1')).toMatchObject({ id: 'local_1', externalId: 'page-1' })
    expect(store.task('local_1')?.pendingSync).toBeUndefined()
  })

  it('adoptAsLocal drops the marker: nothing goes upstream to a source the user left', () => {
    const store = useTasksStore()
    store.addTask(task('a'))
    store.markPendingSync('a')

    store.adoptAsLocal(null)

    expect(store.task('a')).toMatchObject({ source: 'local', externalId: null })
    expect(store.task('a')?.pendingSync).toBeUndefined()
  })
})

describe('pendingSync survives a restart', () => {
  async function hydrate() {
    const { createApp } = await import('vue')
    const { createPersistedState } = await import('pinia-plugin-persistedstate')
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
  }

  afterEach(() => {
    localStorage.removeItem('tasks-store')
    localStorage.removeItem('board-store')
    vi.restoreAllMocks()
  })

  it('persists the marker with the task and reads it back unchanged without writing', async () => {
    const { useTasksStore } = await import('~/store/tasks')
    const marker = { since: 1700000000000, attempts: 3, lastError: 'Network error' }
    const stored = JSON.stringify({ tasks: [task('a', { pendingSync: marker })] })
    localStorage.setItem('tasks-store', stored)
    const writes = vi.spyOn(Storage.prototype, 'setItem')

    await hydrate()
    const store = useTasksStore()

    expect(store.task('a')?.pendingSync).toEqual(marker)
    expect(store.isSyncPending('a')).toBe(true)
    expect(writes).not.toHaveBeenCalledWith('tasks-store', expect.anything())
    expect(localStorage.getItem('tasks-store')).toBe(stored)
  })

  it('writes the marker out when the task is marked', async () => {
    const { useTasksStore } = await import('~/store/tasks')
    await hydrate()
    const store = useTasksStore()
    store.addTask(task('a'))
    store.markPendingSync('a')
    await Promise.resolve()

    const saved = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks: Task[] }
    expect(saved.tasks[0]?.pendingSync).toMatchObject({ attempts: 0, lastError: null })
  })

  it('a task created offline keeps no externalId across the restart', async () => {
    const { useTasksStore } = await import('~/store/tasks')
    const marker = { since: 1, attempts: 1, lastError: 'Network error' }
    localStorage.setItem('tasks-store', JSON.stringify({ tasks: [task('local_1', { externalId: null, pendingSync: marker })] }))

    await hydrate()

    expect(useTasksStore().task('local_1')?.externalId).toBeNull()
  })
})
