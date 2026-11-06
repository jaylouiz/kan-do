import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBoardStore, DONE_CONFIRMATION_MS } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'

describe('store/board done confirmation (#124)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags a task for the confirmation and clears it after the duration', () => {
    const store = useBoardStore()

    store.startConfirmation('task-1')

    expect(store.confirmingTaskIds).toEqual(['task-1'])
    vi.advanceTimersByTime(DONE_CONFIRMATION_MS - 1)
    expect(store.confirmingTaskIds).toEqual(['task-1'])
    vi.advanceTimersByTime(1)
    expect(store.confirmingTaskIds).toEqual([])
  })

  it('keeps a timer per task id', () => {
    const store = useBoardStore()

    store.startConfirmation('task-1')
    vi.advanceTimersByTime(500)
    store.startConfirmation('task-2')
    expect(store.confirmingTaskIds).toEqual(['task-1', 'task-2'])

    vi.advanceTimersByTime(DONE_CONFIRMATION_MS - 500)
    expect(store.confirmingTaskIds).toEqual(['task-2'])

    vi.advanceTimersByTime(500)
    expect(store.confirmingTaskIds).toEqual([])
  })

  it('restarts the timer when the same task is confirmed again', () => {
    const store = useBoardStore()

    store.startConfirmation('task-1')
    vi.advanceTimersByTime(500)
    store.startConfirmation('task-1')
    expect(store.confirmingTaskIds).toEqual(['task-1'])

    vi.advanceTimersByTime(DONE_CONFIRMATION_MS - 1)
    expect(store.confirmingTaskIds).toEqual(['task-1'])
    vi.advanceTimersByTime(1)
    expect(store.confirmingTaskIds).toEqual([])
  })

  it('clearConfirmation cancels only that task (undo)', () => {
    const store = useBoardStore()

    store.startConfirmation('task-1')
    store.startConfirmation('task-2')
    store.clearConfirmation('task-1')

    expect(store.confirmingTaskIds).toEqual(['task-2'])
    vi.advanceTimersByTime(DONE_CONFIRMATION_MS)
    expect(store.confirmingTaskIds).toEqual([])
  })

  it('clearConfirmation is a no-op for a task that is not confirming', () => {
    const store = useBoardStore()

    store.clearConfirmation('missing')

    expect(store.confirmingTaskIds).toEqual([])
  })
})

describe('store/board', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reconcileColumnsWithTasks removes stale taskOrder entries and restores missing valid ones', () => {
    const store = useBoardStore()

    store.columns = [
      {
        idClassSuffix: 'open',
        taskStatus: TaskStatus.Open,
        taskOrder: ['open-1', 'waiting-1'],
        taskPositions: { 'open-1': 0, 'waiting-1': 1000 },
        sorting: { field: 'manual', direction: 'asc' },
      },
      {
        idClassSuffix: 'progress',
        taskStatus: TaskStatus.Progress,
        taskOrder: ['waiting-1'],
        taskPositions: { 'waiting-1': 0 },
        sorting: { field: 'manual', direction: 'asc' },
      },
      {
        idClassSuffix: 'waiting',
        taskStatus: TaskStatus.Waiting,
        taskOrder: ['waiting-2'],
        taskPositions: { 'waiting-2': 0 },
        sorting: { field: 'manual', direction: 'asc' },
      },
      {
        idClassSuffix: 'done',
        taskStatus: TaskStatus.Done,
        taskOrder: [],
        taskPositions: {},
        sorting: { field: 'manual', direction: 'asc' },
      },
    ]

    const changed = store.reconcileColumnsWithTasks([
      { id: 'open-1', source: 'local', externalId: null, title: 'Open', status: TaskStatus.Open, priority: 1, notes: null, activity: null, topic: null, topicColorCode: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null },
      { id: 'waiting-1', source: 'local', externalId: null, title: 'Waiting 1', status: TaskStatus.Waiting, priority: 1, notes: null, activity: null, topic: null, topicColorCode: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null },
      { id: 'waiting-2', source: 'local', externalId: null, title: 'Waiting 2', status: TaskStatus.Waiting, priority: 1, notes: null, activity: null, topic: null, topicColorCode: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null },
    ])

    expect(changed).toBe(true)
    expect(store.columns[0]?.taskOrder).toEqual(['open-1'])
    expect(store.columns[0]?.taskPositions).toEqual({ 'open-1': 0 })
    expect(store.columns[1]?.taskOrder).toEqual([])
    expect(store.columns[1]?.taskPositions).toEqual({})
    expect(store.columns[2]?.taskOrder).toEqual(['waiting-2', 'waiting-1'])
  })
})
