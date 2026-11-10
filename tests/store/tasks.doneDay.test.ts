/**
 * kd#131: a corrected done day lives on the task (`completedAt` + `completedAtCorrected`), moves the task between
 * "done today" and "done before today", survives a fetch of its source and ends with the completion it corrected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { buildExport, parseImport } from '~/utils/dataFile/exportImport'

const NOW = new Date()
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate(), 0, 0, 1)
const YESTERDAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 17, 0, 0)

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't1', source: 'local', externalId: null, title: 'Task', status: TaskStatus.Done, activity: null, topic: null,
  topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 600, timerId: null,
  completedAt: TODAY, ...overrides,
})

describe('tasks store: corrected done day (kd#131)', () => {
  let store: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(console, 'log').mockImplementation(() => {})
    store = useTasksStore()
  })

  it('sets the completion time and the marker, and the task moves from done today to done before today', () => {
    store.addTask(makeTask())
    expect(store.tasksDoneToday.map(t => t.id)).toEqual(['t1'])

    expect(store.setCompletedAt('t1', YESTERDAY)).toBe(true)

    expect(store.task('t1')).toMatchObject({ completedAt: YESTERDAY, completedAtCorrected: true, timeSpentSeconds: 600 })
    expect(store.tasksDoneToday).toEqual([])
    expect(store.tasksDonePrevious.map(t => t.id)).toEqual(['t1'])
  })

  it('refuses a task that is not done, an unknown task and an invalid date', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    store.addTask(makeTask({ status: TaskStatus.Open, completedAt: null }))
    expect(store.setCompletedAt('t1', YESTERDAY)).toBe(false)
    expect(store.setCompletedAt('nope', YESTERDAY)).toBe(false)
    store.updateTask('t1', { status: TaskStatus.Done, completedAt: TODAY })
    expect(store.setCompletedAt('t1', new Date('garbage'))).toBe(false)
    expect(store.task('t1')?.completedAtCorrected).toBeUndefined()
  })

  it('a Local task gets no pending-sync marker, an integration task does', () => {
    store.addTask(makeTask())
    store.addTask(makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' }))
    store.setCompletedAt('t1', YESTERDAY)
    store.setCompletedAt('n1', YESTERDAY)
    expect(store.task('t1')?.pendingSync).toBeUndefined()
    expect(store.task('n1')?.pendingSync).toBeDefined()
  })

  it('reopening and completing again drop the marker', () => {
    store.addTask(makeTask())
    store.setCompletedAt('t1', YESTERDAY)
    store.updateTask('t1', { status: TaskStatus.Open, completedAt: null })
    expect(store.task('t1')?.completedAtCorrected).toBeUndefined()

    store.updateTask('t1', { status: TaskStatus.Done, completedAt: TODAY })
    expect(store.task('t1')).toMatchObject({ completedAt: TODAY })
    expect(store.task('t1')?.completedAtCorrected).toBeUndefined()
  })

  it('an edit that does not write the completion time keeps the marker', () => {
    store.addTask(makeTask())
    store.setCompletedAt('t1', YESTERDAY)
    store.updateTask('t1', { title: 'Renamed' })
    expect(store.task('t1')).toMatchObject({ completedAt: YESTERDAY, completedAtCorrected: true })
  })

  describe('against a fetch of the source', () => {
    const fetched = (overrides: Partial<Task> = {}): Task =>
      makeTask({ id: 'page-1', source: 'notion', externalId: 'page-1', completedAt: new Date(), ...overrides })

    beforeEach(() => {
      store.addTask(makeTask({ id: 'n1', source: 'notion', externalId: 'page-1' }))
      store.setCompletedAt('n1', YESTERDAY)
      // The push went through: the fetch is no longer held off by the pending marker
      store.clearPendingSync('n1')
      expect(store.task('n1')?.pendingSync).toBeUndefined()
    })

    it('keeps the corrected day over the time the source reports (a source without a completion date reports "now")', () => {
      store.mergeTasks('notion', [fetched({ title: 'Renamed in Notion' })])
      expect(store.task('n1')).toMatchObject({ title: 'Renamed in Notion', completedAt: YESTERDAY, completedAtCorrected: true })
      expect(store.tasksDonePrevious.map(t => t.id)).toEqual(['n1'])
    })

    it('follows the source again once it reopened the task', () => {
      store.mergeTasks('notion', [fetched({ status: TaskStatus.Open, completedAt: null })])
      expect(store.task('n1')).toMatchObject({ status: TaskStatus.Open, completedAt: null })
      expect(store.task('n1')?.completedAtCorrected).toBeUndefined()
    })

    it('an uncorrected task still takes the completion time of its source', () => {
      store.addTask(makeTask({ id: 'n2', source: 'notion', externalId: 'page-2', completedAt: YESTERDAY }))
      const upstream = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 3, 12)
      store.mergeTasks('notion', [fetched(), fetched({ id: 'page-2', externalId: 'page-2', completedAt: upstream })])
      expect(store.task('n2')?.completedAt).toEqual(upstream)
    })
  })

  it('a stack move out of Erledigt drops the marker', () => {
    vi.useFakeTimers()
    try {
      store.addTask(makeTask())
      store.setCompletedAt('t1', YESTERDAY)
      store.batchUpdateTaskStatus(['t1'], TaskStatus.Open)
      expect(store.task('t1')?.completedAtCorrected).toBeUndefined()
      expect(store.task('t1')?.completedAt).toBeNull()
    } finally {
      vi.runAllTimers()
      vi.useRealTimers()
    }
  })

  it('export and import carry the corrected day and its marker', () => {
    store.addTask(makeTask())
    store.setCompletedAt('t1', YESTERDAY)
    const built = buildExport({ stores: { 'tasks-store': { tasks: JSON.parse(JSON.stringify(store.tasks)) } }, deviceId: 'd', appVersion: '0.1.0' })
    const parsed = parseImport(built.text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const [task] = (JSON.parse(parsed.text) as { stores: { 'tasks-store': { tasks: Array<Record<string, unknown>> } } }).stores['tasks-store'].tasks
    expect(task).toMatchObject({ completedAt: YESTERDAY.toISOString(), completedAtCorrected: true })
  })
})
