/**
 * #340 N1: `fetchTasks` with the real `TodoistIntegration` and only the SDK and the network replaced. The
 * Sync API request for the tasks completed today answers 410 text/plain (retired endpoint, #343) and must
 * not decide the fetch; the active tasks request does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), syncExistingDoneTasks: vi.fn() }),
}))

const getLabelsMock = vi.fn()
const getProjectsMock = vi.fn()
const getTasksMock = vi.fn()
vi.mock('@doist/todoist-api-typescript', () => ({
  TodoistApi: vi.fn().mockImplementation(function () {
    return { getLabels: getLabelsMock, getProjects: getProjectsMock, getTasks: getTasksMock, getTask: vi.fn() }
  }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useSyncValidation, resetSyncValidation } from '~/composables/useSyncValidation'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const sdkTask = { id: 'td-1', content: 'A', description: '', checked: false, priority: 1, labels: [], projectId: 'p1' }

describe('useIntegrationManager with the real TodoistIntegration (#340 N1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetSyncValidation()
    handleErrorMock.mockReset()
    getLabelsMock.mockResolvedValue({ results: [] })
    getProjectsMock.mockResolvedValue({ results: [] })
    getTasksMock.mockResolvedValue({ results: [sdkTask] })
    // The retired Sync API: 410, text/plain, so the body is not JSON
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      statusText: 'Gone',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => Promise.resolve('This endpoint is deprecated'),
    }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['todoist'], default: 'todoist' })
    useBoardStore().boardConfig.todoistApiToken = 'token'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('a failing completed-tasks request still syncs the active tasks and marks Todoist healthy', async () => {
    const health = useIntegrationHealthStore()

    await useIntegrationManager().fetchTasks()

    expect(useTasksStore().tasks.map((t) => [t.id, t.source])).toEqual([['td-1', 'todoist']])
    expect(health.statusOf('todoist')).toBe('healthy')
    expect(health.healthOf('todoist').lastSuccessfulSync).not.toBeNull()
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('a failing active-tasks request is not healthy, keeps the tasks, and stays quiet on every refresh', async () => {
    const health = useIntegrationHealthStore()
    await useIntegrationManager().fetchTasks()
    const firstSync = health.healthOf('todoist').lastSuccessfulSync

    getTasksMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await useIntegrationManager().fetchTasks()
    await useIntegrationManager().fetchTasks() // the second refresh must stay as quiet as the first

    expect(health.statusOf('todoist')).not.toBe('healthy')
    expect(health.healthOf('todoist').lastSuccessfulSync).toBe(firstSync)
    expect(useTasksStore().tasks.map((t) => t.id)).toEqual(['td-1']) // not emptied
    expect(useSyncValidation().showWarningModal.value).toBe(false)
    expect(handleErrorMock).not.toHaveBeenCalled()

    getTasksMock.mockResolvedValue({ results: [sdkTask] })
    await useIntegrationManager().fetchTasks()
    expect(health.statusOf('todoist')).toBe('healthy')
  })
})
