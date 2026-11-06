/**
 * #318: on a board with Local and Notion tasks side by side every per-task operation goes to the adapter of
 * the task's own source: fetch, status change, time update, archive and delete. The Notion integration is a
 * stub that records what it is asked; a Local task must never reach it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(),
    recordDiscardedTime: vi.fn(), removeDiscardedTime: vi.fn(),
  }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  archiveTask: vi.fn<(externalId: string) => Promise<void>>(),
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: 'Archive' as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useIntegrationManager } from '~/composables/useIntegrationManager'
import { useTaskDeletion, resetTaskDeletionState, DELETE_UNDO_WINDOW_MS } from '~/composables/useTaskDeletion'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { mapHelpers } from '~/utils/mapHelpers'
/* eslint-enable import/first */

function task(id: string, source: Task['source'], overrides: Partial<Task> = {}): Task {
  return {
    id, source, externalId: source === 'local' ? null : `page-${id}`,
    title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...overrides,
  }
}

describe('a mixed Local + Notion board: operations go to the task\'s own source (#318)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    Object.values(notion).forEach((fn) => fn.mockReset())
    notion.updateTask.mockImplementation(async (t) => t)
    notion.archiveTask.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'local' })
    useTasksStore().setTasks([task('l1', 'local'), task('n1', 'notion')])
  })

  afterEach(() => {
    resetTaskDeletionState()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fetch: only the Notion source is fetched, and only its tasks are replaced', async () => {
    vi.useRealTimers()
    notion.fetchActiveBoardTasks.mockResolvedValue([task('n1', 'notion', { title: 'From Notion' }), task('n2', 'notion')])

    await useIntegrationManager().fetchTasks()

    const tasks = useTasksStore().tasks
    expect(tasks.map((t) => t.id).sort()).toEqual(['l1', 'n1', 'n2'])
    expect(tasks.find((t) => t.id === 'l1')?.source).toBe('local')
    expect(tasks.find((t) => t.id === 'n1')?.title).toBe('From Notion')
  })

  it('status change: Notion gets its own task by externalId, the Local task never reaches it', async () => {
    const { updateTaskStatus } = useTaskSync()

    await updateTaskStatus({ taskId: 'l1', status: TaskStatus.Progress })
    expect(notion.updateTask).not.toHaveBeenCalled()
    expect(useTasksStore().task('l1')?.status).toBe(TaskStatus.Progress)

    await updateTaskStatus({ taskId: 'n1', status: TaskStatus.Progress })
    expect(notion.updateTask).toHaveBeenCalledTimes(1)
    expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', externalId: 'page-n1', status: TaskStatus.Progress }))
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('time update: pending time of both tasks, only the Notion one is written upstream and cleared', async () => {
    const tasksStore = useTasksStore()
    tasksStore.updateTask('l1', { timeSpentSeconds: 30 })
    tasksStore.updateTask('n1', { timeSpentSeconds: 60 })
    tasksStore.addPendingTimeUpdate('l1', 30)
    tasksStore.addPendingTimeUpdate('n1', 60)

    await useTaskSync().syncPendingChanges()

    expect(notion.updateTask).toHaveBeenCalledTimes(1)
    expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
    expect(mapHelpers.has(tasksStore.pendingTimeUpdates, 'n1')).toBe(false)
    expect(tasksStore.task('l1')?.timeSpentSeconds).toBe(30) // the Local task keeps its time
  })

  it('archive: only the Notion task is written as archived', async () => {
    const tasksStore = useTasksStore()
    tasksStore.updateTask('l1', { status: TaskStatus.Done })
    tasksStore.updateTask('n1', { status: TaskStatus.Done })

    await useTaskSync().syncArchiveStatusForTasks(['l1', 'n1'])

    expect(notion.updateTask).toHaveBeenCalledTimes(1)
    expect(notion.updateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }))
  })

  it('delete: Notion archives the page by externalId after the undo window, Local sends nothing upstream', async () => {
    const tasksStore = useTasksStore()
    const { deleteTaskWithUndo } = useTaskDeletion()

    expect(deleteTaskWithUndo('l1')).toBe(true)
    expect(deleteTaskWithUndo('n1')).toBe(true)
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS + 1)

    expect(notion.archiveTask).toHaveBeenCalledTimes(1)
    expect(notion.archiveTask).toHaveBeenCalledWith('page-n1')
    expect(tasksStore.task('l1')).toBeNull()
    expect(tasksStore.task('n1')).toBeNull()
    expect(Object.keys(tasksStore.pendingDeletes)).toEqual([])
    expect(handleErrorMock).not.toHaveBeenCalled()
  })
})
