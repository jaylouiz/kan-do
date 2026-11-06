import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sourceOf, switchSource } from '../helpers/taskSource'
import { setActivePinia, createPinia } from 'pinia'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock }),
}))

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn() }),
}))

// Only the SDK is replaced: TodoistIntegration, its timeout fetch and useTaskSync are the real ones.
// Like the real SDK, a failed request is rewrapped as a plain Error that keeps only the message.
const sdkCalls: string[] = []
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function (_token: string, options: { customFetch: (url: string, init?: RequestInit & { timeout?: number }) => Promise<unknown> }) {
    const request = (name: string) => async (id: string) => {
      sdkCalls.push(`${name}:${id}`)
      try {
        await options.customFetch(`https://api.todoist.com/api/v1/tasks/${id}/${name}`, { method: 'POST', timeout: 30000 })
        return true
      } catch (error) {
        throw new Error((error as Error).message, { cause: error })
      }
    }
    return { closeTask: request('close'), reopenTask: request('reopen'), deleteTask: request('delete') }
  }),
}))

// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useTaskSync } from '~/composables/useTaskSync'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { TODOIST_TIMEOUT_MS } from '~/integrations/TodoistIntegration'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useTasksStore } from '~/store/tasks'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { useBoardStore } from '~/store/board'
// eslint-disable-next-line import/first -- order-sensitive: mocks must be defined before importing SUT
import { TaskStatus } from '~/types/taskStatus'

/** Todoist never answers: the request settles only through the abort of the integration's timeout. */
const stubHangingFetch = () => {
  vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  })))
}

const addTask = (id: string) =>
  useTasksStore().addTask({
    id, source: 'todoist', externalId: id, title: id, notes: null, status: TaskStatus.Open,
    priority: 1, timeBoxSeconds: 0, timeSpentSeconds: 0, topicColorCode: null, topic: null, timerId: null,
    activity: null,
  })

describe('useTaskSync with the real TodoistIntegration: a request that times out (#159)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    sdkCalls.length = 0
    stubHangingFetch()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    switchSource('todoist')
    useBoardStore().boardConfig.todoistApiToken = 'token'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('does not record a timed-out completion as synced, so the next write does not assume Done upstream', async () => {
    addTask('t1')
    const { updateTaskStatus } = useTaskSync()

    const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
    await vi.advanceTimersByTimeAsync(0)
    // Queued behind the hung completion: moves the task back before the completion is acknowledged
    const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    await vi.advanceTimersByTimeAsync(TODOIST_TIMEOUT_MS)
    await Promise.all([completion, reopening])

    // Completion timed out (not acknowledged): upstream is still open, so nothing is reopened
    expect(sdkCalls).toEqual(['close:t1'])
    expect(handleErrorMock).toHaveBeenCalledTimes(1)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.stringContaining('timeout'), 'task_sync', { source: 'todoist' })
  })

  it('reports a timed-out reopen once through the sync error path', async () => {
    addTask('t1')
    useTasksStore().updateTask('t1', { status: TaskStatus.Done })

    const reopening = useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
    await vi.advanceTimersByTimeAsync(TODOIST_TIMEOUT_MS)
    await reopening

    expect(sdkCalls).toEqual(['reopen:t1'])
    expect(handleErrorMock).toHaveBeenCalledTimes(1)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.stringContaining('timeout'), 'task_sync', { source: 'todoist' })
  })

  it('queues a timed-out delete for the next reconnect instead of restoring the task', async () => {
    addTask('t1')
    const tasks = useTasksStore()
    tasks.addPendingDelete({
      taskId: 't1', task: tasks.task('t1')!, carryOver: null, state: 'waiting', requestedAt: Date.now(),
    })

    const committed = useTaskSync().commitTaskDelete('t1')
    await vi.advanceTimersByTimeAsync(TODOIST_TIMEOUT_MS)

    await expect(committed).resolves.toBe('queued')
    expect(tasks.pendingDeletes['t1']?.state).toBe('queued')
    expect(handleErrorMock).not.toHaveBeenCalled()
  })
})
