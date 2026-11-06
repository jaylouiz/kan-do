import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { switchSource, sourceOf } from '../helpers/taskSource'
import { setActivePinia, createPinia } from 'pinia'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock }),
}))

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn() }),
}))

// Only the SDK is replaced: TodoistIntegration and useTaskSync are the real ones.
// `failing` holds the calls ("close:t1") that fail with an HTTP 500, like the SDK's rewrapped request error.
const sdkCalls: string[] = []
const failing = new Set<string>()
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function () {
    const request = (name: string) => async (id: string) => {
      sdkCalls.push(`${name}:${id}`)
      if (failing.has(`${name}:${id}`)) throw new Error('HTTP 500: Internal Server Error')
      return true
    }
    return { closeTask: request('close'), reopenTask: request('reopen'), deleteTask: request('delete') }
  }),
}))

// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useTaskSync } from '~/composables/useTaskSync'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useTasksStore } from '~/store/tasks'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useBoardStore } from '~/store/board'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { TaskStatus } from '~/types/taskStatus'

const addTask = (id: string) =>
  useTasksStore().addTask({
    id, ...sourceOf(id), title: id, notes: null, status: TaskStatus.Open,
    priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topicColorCode: null, topic: null, timerId: null,
    activity: null,
  })

describe('useTaskSync with the real TodoistIntegration: a failing status write (#168)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    sdkCalls.length = 0
    failing.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    switchSource('todoist')
    useBoardStore().boardConfig.todoistApiToken = 'token'
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports a failed close once as task_sync and keeps the local status', async () => {
    addTask('t1')
    failing.add('close:t1')

    await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })

    expect(handleErrorMock).toHaveBeenCalledTimes(1)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.stringContaining('Todoist: HTTP 500'), 'task_sync', { source: 'todoist' })
    expect(useTasksStore().task('t1')?.status).toBe(TaskStatus.Done) // no rollback
  })

  it('does not send a reopen after a failed close: upstream is still open', async () => {
    addTask('t1')
    failing.add('close:t1')
    const { updateTaskStatus } = useTaskSync()

    const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    await Promise.all([completion, reopening])

    expect(sdkCalls).toEqual(['close:t1'])
    expect(handleErrorMock).toHaveBeenCalledTimes(1)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.stringContaining('Todoist'), 'task_sync', { source: 'todoist' })
  })

  it('still sends the close after a failed reopen: upstream is still done', async () => {
    addTask('t1')
    useTasksStore().updateTask('t1', { status: TaskStatus.Done })
    failing.add('reopen:t1')
    const { updateTaskStatus } = useTaskSync()

    const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await Promise.all([reopening, completion])

    expect(sdkCalls).toEqual(['reopen:t1', 'close:t1'])
    expect(handleErrorMock).toHaveBeenCalledTimes(1)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.stringContaining('Todoist'), 'task_sync', { source: 'todoist' })
  })

  it('records a successful write as synced, so a following reopen is sent', async () => {
    addTask('t1')
    const { updateTaskStatus } = useTaskSync()

    await updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })

    expect(sdkCalls).toEqual(['close:t1', 'reopen:t1'])
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('reports a failed stack member and still writes the other members', async () => {
    addTask('t1')
    addTask('t2')
    addTask('t3')
    failing.add('close:t2')

    await useTaskSync().updateTaskStatuses(['t1', 't2', 't3'], TaskStatus.Done)

    expect(sdkCalls).toEqual(['close:t1', 'close:t2', 'close:t3'])
    expect(handleErrorMock).toHaveBeenCalledTimes(1)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.stringContaining('Todoist'), 'task_sync', { source: 'todoist' })
  })
})
