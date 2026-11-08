/**
 * kd#4: a user edit of a task's total time spent. The edit is absolute: it wins over a fetch (Notion's
 * `mergeTasks` otherwise keeps the larger time), survives a later timer tick, and a completed task's
 * statistics record follows it. Work sessions are never written.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { createPendingTimeUpdate } from '~/types/pendingTimeUpdate'
import { mapHelpers } from '~/utils/mapHelpers'

function task(id: string, overrides: Partial<Task> = {}): Task {
  const source = overrides.source ?? 'notion'
  return {
    id, source, externalId: source === 'local' ? null : id, title: id, notes: null, status: TaskStatus.Open, priority: 1,
    activity: null, timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
    ...overrides,
  }
}

describe('setTimeSpent (kd#4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('writes the total locally and queues an absolute entry for a Notion task, whatever its status', () => {
    const store = useTasksStore()
    store.addTask(task('a', { status: TaskStatus.Open, timeSpentSeconds: 600 }))

    expect(store.setTimeSpent('a', 3600)).toBe(true)

    expect(store.task('a')?.timeSpentSeconds).toBe(3600)
    const queued = mapHelpers.get(store.pendingTimeUpdates, 'a')
    expect(queued?.timeSpentSeconds).toBe(3600)
    expect(queued?.absolute).toBe(true)
  })

  it('lowers and clears a total (0 is a valid total)', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 7200 }))

    store.setTimeSpent('a', 1800)
    expect(store.task('a')?.timeSpentSeconds).toBe(1800)
    store.setTimeSpent('a', 0)
    expect(store.task('a')?.timeSpentSeconds).toBe(0)
    expect(mapHelpers.get(store.pendingTimeUpdates, 'a')).toMatchObject({ timeSpentSeconds: 0, absolute: true })
  })

  it('queues nothing for a source that stores no time (Local)', () => {
    const store = useTasksStore()
    store.addTask(task('l', { source: 'local' }))

    store.setTimeSpent('l', 900)

    expect(store.task('l')?.timeSpentSeconds).toBe(900)
    expect(mapHelpers.has(store.pendingTimeUpdates, 'l')).toBe(false)
  })

  it('returns false for an unknown task and rejects negative or non-finite totals', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 60 }))

    expect(store.setTimeSpent('missing', 60)).toBe(false)
    expect(store.setTimeSpent('a', -1)).toBe(false)
    expect(store.setTimeSpent('a', Number.NaN)).toBe(false)
    expect(store.task('a')?.timeSpentSeconds).toBe(60)
  })

  it('keeps the flag when the timer ticks on afterwards', () => {
    const store = useTasksStore()
    store.addTask(task('a', { status: TaskStatus.Progress, timeSpentSeconds: 7200 }))

    store.setTimeSpent('a', 1800)
    store.updateTaskTimespent({ taskId: 'a', timeSpentSeconds: 1801 })

    expect(store.task('a')?.timeSpentSeconds).toBe(1801)
    expect(mapHelpers.get(store.pendingTimeUpdates, 'a')).toMatchObject({ timeSpentSeconds: 1801, absolute: true })
  })

  it('leaves the work sessions alone', () => {
    const statistics = useTaskStatisticsStore()
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 600 }))
    statistics.workSessions = [{ start: 1_000, end: 5_000 }]
    const before = JSON.stringify(statistics.workSessions)

    store.setTimeSpent('a', 60)

    expect(JSON.stringify(statistics.workSessions)).toBe(before)
  })

  it('refreshes the completion record of a done task', async () => {
    const statistics = useTaskStatisticsStore()
    const store = useTasksStore()
    const done = task('d', { status: TaskStatus.Done, timeSpentSeconds: 7200, timeBoxSeconds: 3600, completedAt: new Date() })
    store.addTask(done)
    statistics.recordTaskCompletion(done)

    store.setTimeSpent('d', 1800)

    await vi.waitFor(() => {
      const record = statistics.completionRecords.find((r) => r.taskId === 'd')
      expect(record?.actualTimeSpentSeconds).toBe(1800)
      expect(record?.estimationAccuracy).toBe(50)
    })
  })
})

describe('mergeTasks with an edited total (kd#4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('the edited total wins over a higher fetched value', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 7200 }))
    store.setTimeSpent('a', 1800)

    store.mergeTasks('notion', [task('a', { timeSpentSeconds: 7200 })])

    expect(store.task('a')?.timeSpentSeconds).toBe(1800)
  })

  it('an edit to 0 also wins', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 7200 }))
    store.setTimeSpent('a', 0)

    store.mergeTasks('notion', [task('a', { timeSpentSeconds: 7200 })])

    expect(store.task('a')?.timeSpentSeconds).toBe(0)
  })

  it('without an edit the larger value still wins (unchanged rule)', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 600 }))
    mapHelpers.set(store.pendingTimeUpdates, 'a', createPendingTimeUpdate('a', 600))

    store.mergeTasks('notion', [task('a', { timeSpentSeconds: 7200 })])

    expect(store.task('a')?.timeSpentSeconds).toBe(7200)
  })

  it('a stored entry without the flag (data from before) merges as before', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 100 }))
    store.pendingTimeUpdates = { a: { taskId: 'a', timeSpentSeconds: 300, createdAt: new Date(), lastAttemptAt: null, attemptCount: 0, status: 'pending' } }

    store.mergeTasks('notion', [task('a', { timeSpentSeconds: 200 })])

    expect(store.task('a')?.timeSpentSeconds).toBe(300)
  })

  it('a completed push drops the flag: the next fetch is the max rule again', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 7200 }))
    store.setTimeSpent('a', 1800)
    store.clearPendingSync('a')

    store.mergeTasks('notion', [task('a', { timeSpentSeconds: 3000 })])

    expect(store.task('a')?.timeSpentSeconds).toBe(3000)
  })
})
