import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { switchSource, sourceOf } from '../helpers/taskSource'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock }),
}))

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn() }),
}))

// Only the SDK is replaced: TodoistIntegration and useTaskSync are the real ones.
const sdkCalls: string[] = []
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function () {
    const request = (name: string) => async (id: string) => {
      sdkCalls.push(`${name}:${id}`)
      return true
    }
    return { closeTask: request('close'), reopenTask: request('reopen'), deleteTask: request('delete') }
  }),
}))

// Notion: `notionConfigured` is toggled per test; a configured instance echoes the task back
const notionConfigured = ref(false)
const notionUpdateTask = vi.fn()
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({
    isConfigured: notionConfigured,
    createInstance: () => ({ updateTask: notionUpdateTask }),
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

describe('useTaskSync with an unconfigured integration: the write counts as not synced (#188)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    notionUpdateTask.mockReset()
    notionUpdateTask.mockImplementation(async (task: unknown) => task)
    notionConfigured.value = false
    sdkCalls.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Todoist without a token', () => {
    beforeEach(() => {
      switchSource('todoist')
      useBoardStore().boardConfig.todoistApiToken = ''
    })

    it('reports the setup problem once as todoist_setup and keeps the local status', async () => {
      addTask('t1')

      await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })

      expect(handleErrorMock).toHaveBeenCalledTimes(1)
      expect(handleErrorMock).toHaveBeenCalledWith('Todoist API token is not set', 'todoist_setup')
      expect(sdkCalls).toEqual([])
      expect(useTasksStore().task('t1')?.status).toBe(TaskStatus.Done) // no rollback
    })

    it('does not record the unsent completion as upstream: an overlapping reopen sends nothing', async () => {
      addTask('t1')
      const board = useBoardStore()
      // The token is entered while the completion is being reported, before the queued reopen runs
      handleErrorMock.mockImplementationOnce(() => {
        board.boardConfig.todoistApiToken = 'token'
      })
      const { updateTaskStatus } = useTaskSync()

      const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
      const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
      await Promise.all([completion, reopening])

      // Upstream never became Done, so there is nothing to reopen
      expect(sdkCalls).toEqual([])
      expect(handleErrorMock).toHaveBeenCalledTimes(1)
      expect(handleErrorMock).toHaveBeenCalledWith('Todoist API token is not set', 'todoist_setup')
    })

    it('reports the missing token once, not once per write: the source is known to be down after the first (#319)', async () => {
      addTask('t1')
      const { updateTaskStatus } = useTaskSync()

      const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
      const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
      await Promise.all([completion, reopening])

      expect(handleErrorMock).toHaveBeenCalledTimes(1)
      expect(handleErrorMock).toHaveBeenCalledWith('Todoist API token is not set', 'todoist_setup')
      expect(handleErrorMock).not.toHaveBeenCalledWith(expect.anything(), 'task_sync')
    })
  })

  describe('Todoist with a token', () => {
    beforeEach(() => {
      switchSource('todoist')
      useBoardStore().boardConfig.todoistApiToken = 'token'
    })

    it('sends nothing for a move that needs no write and reports nothing', async () => {
      addTask('t1')

      await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Waiting })

      expect(sdkCalls).toEqual([])
      expect(handleErrorMock).not.toHaveBeenCalled()
    })

    it('records a sent write as synced, so a following reopen is sent', async () => {
      addTask('t1')
      const { updateTaskStatus } = useTaskSync()

      await updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
      await updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })

      expect(sdkCalls).toEqual(['close:t1', 'reopen:t1'])
      expect(handleErrorMock).not.toHaveBeenCalled()
    })
  })

  describe('Notion not configured', () => {
    beforeEach(() => {
      switchSource('notion')
    })

    it('reports the setup problem once as notion_setup and sends nothing', async () => {
      addTask('t1')

      await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })

      expect(handleErrorMock).toHaveBeenCalledTimes(1)
      expect(handleErrorMock).toHaveBeenCalledWith('Notion integration is not properly configured', 'notion_setup')
      expect(notionUpdateTask).not.toHaveBeenCalled()
      expect(useTasksStore().task('t1')?.status).toBe(TaskStatus.Done) // no rollback
    })

    it('reports an archive once instead of skipping it silently (#340 review)', async () => {
      addTask('t1')
      addTask('t2')

      await useTaskSync().syncArchiveStatusForTasks(['t1', 't2'])

      expect(handleErrorMock).toHaveBeenCalledTimes(1) // the source's remaining tasks are not retried
      expect(handleErrorMock).toHaveBeenCalledWith('Notion integration is not properly configured', 'notion_setup')
      expect(notionUpdateTask).not.toHaveBeenCalled()
    })

    it('reports the first of two overlapping writes, keeps the marker and records neither as synced', async () => {
      addTask('t1')
      const { updateTaskStatus } = useTaskSync()

      const completion = updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })
      const reopening = updateTaskStatus({ taskId: 't1', status: TaskStatus.Open })
      await Promise.all([completion, reopening])

      expect(handleErrorMock).toHaveBeenCalledTimes(1)
      expect(handleErrorMock).toHaveBeenCalledWith('Notion integration is not properly configured', 'notion_setup')
      expect(notionUpdateTask).not.toHaveBeenCalled()
      expect(useTasksStore().task('t1')?.pendingSync).toMatchObject({ attempts: 2 })
    })
  })

  describe('Notion configured', () => {
    beforeEach(() => {
      switchSource('notion')
      notionConfigured.value = true
    })

    it('sends the write and reports nothing', async () => {
      addTask('t1')

      await useTaskSync().updateTaskStatus({ taskId: 't1', status: TaskStatus.Done })

      expect(notionUpdateTask).toHaveBeenCalledTimes(1)
      expect(handleErrorMock).not.toHaveBeenCalled()
    })
  })
})
