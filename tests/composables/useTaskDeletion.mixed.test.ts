import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useTaskDeletion, resetTaskDeletionState, DELETE_UNDO_WINDOW_MS } from '~/composables/useTaskDeletion'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { mapHelpers } from '~/utils/mapHelpers'

/**
 * #325: on a mixed board the delete goes to the task's own source, whichever source the board defaults to.
 * The pending delete carries the source it was stamped with, so the commit never reads the board's setting.
 */

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn(), recordDiscardedTime: vi.fn(), removeDiscardedTime: vi.fn() }),
}))
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))
const archiveTaskMock = vi.fn()
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({
    isConfigured: { value: true },
    createInstance: () => ({ archiveTask: archiveTaskMock }),
  }),
}))

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

describe.each(['local', 'notion'] as const)('delete on a mixed board whose default source is %s (#325)', (defaultSource) => {
  let tasksStore: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    useBoardStore().setSources({ connected: ['notion'], default: defaultSource })
    tasksStore.setTasks([makeTask('n', { source: 'notion', externalId: 'page-n' }), makeTask('l')])
    vi.clearAllMocks()
    archiveTaskMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetTaskDeletionState()
    vi.useRealTimers()
  })

  it('a Notion task, then a Local task: only the Notion page is archived, by its external id, after the window', async () => {
    const { deleteTaskWithUndo } = useTaskDeletion()

    deleteTaskWithUndo('n')
    expect(mapHelpers.get(tasksStore.pendingDeletes, 'n')?.task.source).toBe('notion')
    expect(archiveTaskMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(archiveTaskMock).toHaveBeenCalledTimes(1)
    expect(archiveTaskMock).toHaveBeenCalledWith('page-n')

    deleteTaskWithUndo('l')
    expect(mapHelpers.get(tasksStore.pendingDeletes, 'l')?.task.source).toBe('local')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(archiveTaskMock).toHaveBeenCalledTimes(1)
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'n')).toBe(false)
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'l')).toBe(false)
    expect(tasksStore.task('n')).toBeNull()
    expect(tasksStore.task('l')).toBeNull()
  })

  it('Undo of a Notion delete, then a Local delete: Notion is never reached', async () => {
    const { deleteTaskWithUndo, undoDelete } = useTaskDeletion()

    deleteTaskWithUndo('n')
    undoDelete('n')
    expect(tasksStore.task('n')?.source).toBe('notion')

    deleteTaskWithUndo('l')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS * 2)
    await flushPromises()
    expect(archiveTaskMock).not.toHaveBeenCalled()
    expect(tasksStore.task('n')).not.toBeNull()
  })
})
