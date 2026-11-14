/**
 * #286: the timer driver writes the seconds a timer collected in one step (`addTrackedSeconds`), whatever the
 * task's status is at that moment (the stop flush runs after the status changed), and the user's absolute time
 * edit replaces the total including the seconds a running timer has not written yet.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { addLiveSecond, clearAllLiveSeconds, liveTimeSpent } from '~/lib/liveTime'

function task(id: string, overrides: Partial<Task> = {}): Task {
  const source = overrides.source ?? 'notion'
  return {
    id, source, externalId: source === 'local' ? null : id, title: id, notes: null, status: TaskStatus.Progress, priority: 1,
    activity: null, timeBoxSeconds: null, timeSpentSeconds: 0, topic: null, topicColorCode: null, timerId: null,
    ...overrides,
  }
}

describe('addTrackedSeconds (#286)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    clearAllLiveSeconds()
    vi.restoreAllMocks()
  })

  it('adds the seconds and queues the new total for a source that stores time', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 60 }))

    expect(store.addTrackedSeconds('a', 10)).toBe(true)

    expect(store.task('a')?.timeSpentSeconds).toBe(70)
    expect(store.pendingTimeUpdates['a']?.timeSpentSeconds).toBe(70)
  })

  it('queues also when the task has already left Jetzt (the stop flush runs after the status change)', () => {
    const store = useTasksStore()
    store.addTask(task('a', { timeSpentSeconds: 60, status: TaskStatus.Waiting }))

    store.addTrackedSeconds('a', 3)

    expect(store.task('a')?.timeSpentSeconds).toBe(63)
    expect(store.pendingTimeUpdates['a']?.timeSpentSeconds).toBe(63)
  })

  it('queues nothing for a Local task', () => {
    const store = useTasksStore()
    store.addTask(task('l', { source: 'local' }))

    store.addTrackedSeconds('l', 10)

    expect(store.task('l')?.timeSpentSeconds).toBe(10)
    expect(Object.keys(store.pendingTimeUpdates)).toEqual([])
  })

  it('keeps an absolute entry of a user edit absolute', () => {
    const store = useTasksStore()
    store.addTask(task('a', { status: TaskStatus.Open }))
    store.setTimeSpent('a', 600)

    store.addTrackedSeconds('a', 5)

    expect(store.pendingTimeUpdates['a']).toMatchObject({ timeSpentSeconds: 605, absolute: true })
  })

  it('returns false for an unknown task, a zero or a negative count and writes nothing', () => {
    const store = useTasksStore()
    store.addTask(task('a'))

    expect(store.addTrackedSeconds('nope', 5)).toBe(false)
    expect(store.addTrackedSeconds('a', 0)).toBe(false)
    expect(store.addTrackedSeconds('a', -3)).toBe(false)
    expect(store.task('a')?.timeSpentSeconds).toBe(0)
  })
})

describe('setTimeSpent with a running timer (#286)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    clearAllLiveSeconds()
    vi.restoreAllMocks()
  })

  it('the edit is the new total: the seconds the timer had collected are not added on top', () => {
    const store = useTasksStore()
    store.addTask(task('a', { source: 'local', timeSpentSeconds: 600 }))
    addLiveSecond('a')
    addLiveSecond('a')
    expect(liveTimeSpent(store.task('a')!)).toBe(602)

    store.setTimeSpent('a', 1800)

    expect(liveTimeSpent(store.task('a')!)).toBe(1800)
  })

  it('a rejected edit keeps the collected seconds', () => {
    const store = useTasksStore()
    store.addTask(task('a', { source: 'local', timeSpentSeconds: 600 }))
    addLiveSecond('a')

    expect(store.setTimeSpent('a', -5)).toBe(false)

    expect(liveTimeSpent(store.task('a')!)).toBe(601)
  })
})
