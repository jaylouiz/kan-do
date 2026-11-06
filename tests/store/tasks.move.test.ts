import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'
import { mapHelpers } from '~/utils/mapHelpers'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

function makeTask(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  const source = overrides.source ?? 'local'
  return {
    title: overrides.id, notes: null, status: TaskStatus.Open, priority: 1, activity: null, timeBoxSeconds: null,
    timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null, source,
    externalId: source === 'local' ? null : overrides.id, ...overrides,
  }
}

describe('tasks store: moving a task between sources (#322)', () => {
  let store: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTasksStore()
  })

  describe('reassignSource', () => {
    it('re-assigns source and externalId in one mutation and keeps everything keyed by id', () => {
      const timerId = 77
      store.setTasks([makeTask({
        id: 'a', status: TaskStatus.Progress, timerId, timeSpentSeconds: 90, topic: 'Home', priority: 2,
        createdAt: new Date('2026-01-01'), notes: 'n', isUnplanned: true,
      })])
      const version = store.getTaskOperationVersion('a')

      const previous = store.reassignSource('a', 'notion')

      expect(previous).toEqual({ pendingSync: undefined })
      expect(store.task('a')).toMatchObject({
        id: 'a', source: 'notion', externalId: null, status: TaskStatus.Progress, timerId, timeSpentSeconds: 90,
        topic: 'Home', priority: 2, notes: 'n', isUnplanned: true,
        pendingMove: { fromSource: 'local', fromExternalId: null, toSource: 'notion' },
      })
      expect(store.task('a')?.createdAt).toEqual(new Date('2026-01-01'))
      expect(store.task('a')?.pendingSync).toMatchObject({ attempts: 0, lastError: null })
      expect(store.getTaskOperationVersion('a')).toBeGreaterThan(version)
    })

    it('to Local carries a pendingMove from the integration and no marker', () => {
      store.setTasks([makeTask({ id: 'n', source: 'notion', externalId: 'page-1' })])

      store.reassignSource('n', 'local')

      const moved = store.task('n')!
      expect(moved).toMatchObject({ source: 'local', externalId: null, pendingMove: { fromSource: 'notion', fromExternalId: 'page-1', toSource: 'local' } })
      expect(moved.pendingSync).toBeUndefined()
    })

    it('drops time queued for the origin', () => {
      store.setTasks([makeTask({ id: 'n', source: 'notion', status: TaskStatus.Progress })])
      store.addPendingTimeUpdate('n', 30)

      store.reassignSource('n', 'local')

      expect(mapHelpers.has(store.pendingTimeUpdates, 'n')).toBe(false)
    })

    it('refuses a task that is not there, is already in the target, or has an outstanding move', () => {
      store.setTasks([makeTask({ id: 'a' }), makeTask({ id: 'n', source: 'notion' })])
      expect(store.reassignSource('missing', 'notion')).toBeNull()
      expect(store.reassignSource('a', 'local')).toBeNull()
      expect(store.reassignSource('a', 'notion')).not.toBeNull()
      expect(store.reassignSource('a', 'local')).toBeNull()
    })
  })

  describe('restoreMoveOrigin (undo and a rejected create)', () => {
    it('puts source and externalId back exactly and removes marker and move', () => {
      store.setTasks([makeTask({ id: 'n', source: 'notion', externalId: 'page-1' })])
      const previous = store.reassignSource('n', 'local')!

      store.restoreMoveOrigin('n', previous)

      const task = store.task('n')!
      expect(task).toMatchObject({ source: 'notion', externalId: 'page-1' })
      expect(task.pendingMove).toBeUndefined()
      expect(task.pendingSync).toBeUndefined()
    })

    it('restores the marker the task carried before the move', () => {
      const marker = { since: 5, attempts: 2, lastError: 'boom' }
      store.setTasks([makeTask({ id: 'n', source: 'notion', externalId: 'page-1', pendingSync: marker })])
      const previous = store.reassignSource('n', 'local')!
      expect(store.task('n')?.pendingSync).toBeUndefined()

      store.restoreMoveOrigin('n', previous)

      expect(store.task('n')?.pendingSync).toEqual(marker)
    })

    it('after a rejected create (no snapshot) an integration origin gets a fresh marker for what changed since', () => {
      store.setTasks([makeTask({ id: 'n', source: 'notion', externalId: 'page-1' })])
      store.reassignSource('n', 'local')

      store.restoreMoveOrigin('n')

      expect(store.task('n')?.pendingSync).toMatchObject({ attempts: 0 })
    })

    it('does nothing for a task without an outstanding move', () => {
      store.setTasks([makeTask({ id: 'a' })])
      store.restoreMoveOrigin('a')
      expect(store.task('a')).toMatchObject({ source: 'local', externalId: null })
    })
  })

  describe('completeMoveCreate', () => {
    it('stores the externalId, keeps the move and the marker, and drops a racing duplicate of the new page', () => {
      store.setTasks([makeTask({ id: 'a', createdAt: new Date('2026-01-01') })])
      store.reassignSource('a', 'notion')
      // A fetch returned the new page before the create response was stored: it became its own card
      store.mergeTasks('notion', [makeTask({ id: 'page-9', source: 'notion', title: 'a' })])
      expect(store.tasks.map(t => t.id).sort()).toEqual(['a', 'page-9'])

      const dropped = store.completeMoveCreate('a', 'page-9')

      expect(dropped).toEqual(['page-9'])
      expect(store.tasks.map(t => t.id)).toEqual(['a'])
      expect(store.task('a')).toMatchObject({ source: 'notion', externalId: 'page-9' })
      expect(store.task('a')?.pendingMove).toBeDefined()
      expect(store.task('a')?.pendingSync).toBeDefined()
    })

    it('does not drop a task that has a different source or externalId', () => {
      store.setTasks([makeTask({ id: 'a' }), makeTask({ id: 'other', source: 'notion' })])
      store.reassignSource('a', 'notion')
      expect(store.completeMoveCreate('a', 'page-9')).toEqual([])
      expect(store.task('other')).not.toBeNull()
    })
  })

  describe('clearPendingMove', () => {
    it('removes the move and keeps the marker; clearPendingSync keeps the move', () => {
      store.setTasks([makeTask({ id: 'a' })])
      store.reassignSource('a', 'notion')
      store.completeMoveCreate('a', 'page-9')

      store.clearPendingSync('a')
      expect(store.task('a')?.pendingSync).toBeUndefined()
      expect(store.task('a')?.pendingMove).toBeDefined()

      store.clearPendingMove('a')
      expect(store.task('a')?.pendingMove).toBeUndefined()
    })
  })

  describe('undo window hold', () => {
    it('tracks which moves are inside their undo window', () => {
      store.holdMove('a')
      expect(store.isMoveHeld('a')).toBe(true)
      store.releaseMove('a')
      expect(store.isMoveHeld('a')).toBe(false)
    })
  })

  describe('mergeTasks while a move is outstanding', () => {
    it('does not show the origin page a second time (origin still fetched)', () => {
      store.setTasks([makeTask({ id: 'page-1', source: 'notion', externalId: 'page-1', title: 'Moved' })])
      store.reassignSource('page-1', 'local')

      store.mergeTasks('notion', [makeTask({ id: 'page-1', source: 'notion', title: 'Moved' }), makeTask({ id: 'page-2', source: 'notion' })])

      expect(store.tasks.map(t => t.id).sort()).toEqual(['page-1', 'page-2'])
      expect(store.task('page-1')).toMatchObject({ source: 'local', externalId: null })
    })

    it('the guard is gone once the move is cleared', () => {
      store.setTasks([makeTask({ id: 'page-1', source: 'notion', externalId: 'page-1' })])
      store.reassignSource('page-1', 'local')
      store.clearPendingMove('page-1')

      store.mergeTasks('notion', [makeTask({ id: 'page-1', source: 'notion' })])

      expect(store.tasks.length).toBe(2)
    })

    it('keeps the moved task through a fetch of the target that does not know it yet', () => {
      store.setTasks([makeTask({ id: 'a' })])
      store.reassignSource('a', 'notion')

      store.mergeTasks('notion', [])

      expect(store.task('a')).toMatchObject({ source: 'notion', externalId: null })
    })

    it('keeps the earlier local createdAt when the target reports its own creation time', () => {
      store.setTasks([makeTask({ id: 'a', createdAt: new Date('2026-01-01T00:00:00Z') })])
      store.reassignSource('a', 'notion')
      store.completeMoveCreate('a', 'page-9')
      store.clearPendingSync('a')
      store.clearPendingMove('a')

      store.mergeTasks('notion', [makeTask({ id: 'page-9', source: 'notion', createdAt: new Date('2026-10-28T00:00:00Z') })])

      expect(store.task('a')?.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'))
    })

    it('keeps the earlier createdAt when the stored value is a string (hydrated from JSON)', () => {
      store.setTasks([makeTask({ id: 'n', source: 'notion', externalId: 'page-9', createdAt: '2026-01-01T00:00:00.000Z' as unknown as Date })])

      store.mergeTasks('notion', [makeTask({ id: 'page-9', source: 'notion', createdAt: new Date('2026-10-28T00:00:00Z') })])

      expect(new Date(store.task('n')!.createdAt as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    })

    it('takes the fetched createdAt when it is earlier or the local one is missing', () => {
      store.setTasks([makeTask({ id: 'n', source: 'notion', externalId: 'page-9' }), makeTask({ id: 'm', source: 'notion', externalId: 'page-8', createdAt: new Date('2026-05-01') })])

      store.mergeTasks('notion', [
        makeTask({ id: 'page-9', source: 'notion', createdAt: new Date('2026-02-01') }),
        makeTask({ id: 'page-8', source: 'notion', createdAt: new Date('2026-03-01') }),
      ])

      expect(store.task('n')?.createdAt).toEqual(new Date('2026-02-01'))
      expect(store.task('m')?.createdAt).toEqual(new Date('2026-03-01'))
    })
  })

  describe('column position survives the move', () => {
    it('the board keeps the task in its column order', () => {
      const board = useBoardStore()
      store.setTasks([makeTask({ id: 'a' }), makeTask({ id: 'b' })])
      board.reconcileColumnsWithTasks(store.tasks)
      const before = board.columnByTaskStatus(TaskStatus.Open)?.taskOrder.slice()

      store.reassignSource('b', 'notion')
      store.mergeTasks('notion', [])

      expect(board.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(before)
    })
  })
})
