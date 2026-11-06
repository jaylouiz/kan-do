/**
 * #344: a Todoist reopen made while the source was unreachable is replayed from the `pendingSync` marker, also
 * after a restart. The marker records whether Todoist holds the task as completed (`upstreamDone`), so the replay
 * needs no in-memory `previousStatus`. A restart is simulated by serialising the persisted tasks into a fresh Pinia.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { switchSource, sourceOf } from '../helpers/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn() }),
}))

// Only the SDK is replaced. While `unreachable`, every request fails like a lost connection.
const sdkCalls: string[] = []
let unreachable = false
let duringRequest: (() => void) | null = null
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function () {
    const request = (name: string) => async (id: string) => {
      if (unreachable) throw new Error('Failed to fetch')
      duringRequest?.()
      sdkCalls.push(`${name}:${id}`)
      return true
    }
    return { closeTask: request('close'), reopenTask: request('reopen'), deleteTask: request('delete') }
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { normalizeTasks } from '~/lib/taskSources'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
/* eslint-enable import/first */

const addTask = (id: string, status: TaskStatus) =>
  useTasksStore().addTask({
    id, ...sourceOf(id), title: id, notes: null, status,
    priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topicColorCode: null, topic: null, timerId: null,
    activity: null,
  })

/** What a restart does to the tasks: what was persisted is read back, nothing else survives. */
function restart(): void {
  const persisted = JSON.parse(JSON.stringify(useTasksStore().tasks)) as Task[]
  setActivePinia(createPinia())
  switchSource('todoist')
  useBoardStore().boardConfig.todoistApiToken = 'token'
  useTasksStore().setTasks(normalizeTasks(persisted, 'todoist'))
}

describe('Todoist: a status change made while the source was unreachable is replayed from the marker (#344)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sdkCalls.length = 0
    unreachable = false
    duringRequest = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    switchSource('todoist')
    useBoardStore().boardConfig.todoistApiToken = 'token'
  })
  afterEach(() => vi.restoreAllMocks())

  it('Done -> Offen while unreachable -> restart -> reconnect: the task is reopened exactly once', async () => {
    addTask('t1', TaskStatus.Done)
    unreachable = true
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    expect(useTasksStore().task('t1')?.pendingSync).toMatchObject({ upstreamDone: true, attempts: 1 })

    restart()
    expect(useTasksStore().task('t1')?.pendingSync?.upstreamDone).toBe(true)
    unreachable = false
    await useTaskSync().syncPendingChanges()

    expect(sdkCalls).toEqual(['reopen:t1'])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
    await useTaskSync().syncPendingChanges()
    expect(sdkCalls).toEqual(['reopen:t1'])
  })

  it('Done -> Offen while unreachable -> reconnect without a restart: reopened once', async () => {
    addTask('t1', TaskStatus.Done)
    unreachable = true
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    unreachable = false
    await useTaskSync().syncPendingChanges()
    await useTaskSync().syncPendingChanges()

    expect(sdkCalls).toEqual(['reopen:t1'])
  })

  it('Offen -> Done while unreachable -> restart -> reconnect: completed once, never reopened', async () => {
    addTask('t1', TaskStatus.Open)
    unreachable = true
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    expect(useTasksStore().task('t1')?.pendingSync?.upstreamDone).toBe(false)

    restart()
    unreachable = false
    await useTaskSync().syncPendingChanges()
    await useTaskSync().syncPendingChanges()

    expect(sdkCalls).toEqual(['close:t1'])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('Done -> Offen -> Done while unreachable: the replay completes, it does not reopen', async () => {
    addTask('t1', TaskStatus.Done)
    unreachable = true
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    unreachable = false
    await useTaskSync().syncPendingChanges()

    expect(sdkCalls).toEqual(['close:t1'])
  })

  it('Offen -> Done -> Offen while unreachable: the source never held Done, so the replay sends no reopen', async () => {
    addTask('t1', TaskStatus.Open)
    unreachable = true
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    unreachable = false
    await useTaskSync().syncPendingChanges()

    expect(sdkCalls).toEqual([])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('a replay for an unchanged status sends no status write and clears the marker', async () => {
    addTask('t1', TaskStatus.Open)
    useTasksStore().markPendingSync('t1') // a change the source has no status for; the push never ran
    expect(useTasksStore().task('t1')?.pendingSync?.upstreamDone).toBe(false)
    restart()
    unreachable = false
    await useTaskSync().syncPendingChanges()

    expect(sdkCalls).toEqual([])
    expect(useTasksStore().task('t1')?.pendingSync).toBeUndefined()
  })

  it('a reopen that went through while a later change kept the marker leaves the marker saying open', async () => {
    addTask('t1', TaskStatus.Done)
    unreachable = true
    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    unreachable = false
    useIntegrationHealthStore().markHealthy('todoist')
    duringRequest = () => { useTasksStore().markPendingSync('t1') } // an edit while the reopen is in flight

    await useTaskSync().syncPendingChanges()

    expect(sdkCalls).toEqual(['reopen:t1'])
    expect(useTasksStore().task('t1')?.pendingSync?.upstreamDone).toBe(false)
    await useTaskSync().syncPendingChanges()
    expect(sdkCalls).toEqual(['reopen:t1'])
  })
})

describe('a fetch corrects the marker (#344)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    switchSource('todoist')
  })

  it('a task reopened in Todoist meanwhile is not reopened again by the replay', () => {
    const tasks = useTasksStore()
    addTask('t1', TaskStatus.Open)
    tasks.markPendingSync('t1', true)

    tasks.mergeTasks('todoist', [{ ...tasks.task('t1')!, pendingSync: undefined, status: TaskStatus.Open }])

    expect(tasks.task('t1')?.pendingSync?.upstreamDone).toBe(false)
  })
})
