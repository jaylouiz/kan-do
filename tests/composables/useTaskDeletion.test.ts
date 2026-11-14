import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useTaskDeletion, resetTaskDeletionState, DELETE_UNDO_WINDOW_MS } from '~/composables/useTaskDeletion'
import { GAP_CLOSE_MS } from '~/lib/deleteGapState'
import { liveTimeSpent } from '~/lib/liveTime'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTrashStore } from '~/store/trash'
import { useDeletedGaps } from '~/composables/useDeletedGaps'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { mapHelpers } from '~/utils/mapHelpers'
import { useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import { armedTaskTimerIds, disarmAllTaskTimers } from '~/lib/taskTimers'

const statistics = { syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn(), recordDiscardedTime: vi.fn(), removeDiscardedTime: vi.fn(), openWorkSession: vi.fn(() => 0), extendWorkSession: vi.fn() }
vi.mock('~/store/taskStatistics', () => ({ useTaskStatisticsStore: () => statistics }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock }),
}))
const archiveTaskMock = vi.fn()
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({
    isConfigured: { value: true },
    createInstance: () => ({ archiveTask: archiveTaskMock }),
  }),
}))
const todoistDeleteMock = vi.fn()
vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return { deleteTask: todoistDeleteMock }
  }),
}))

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

describe('useTaskDeletion (upstream-aware delete with deferred commit)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>
  let trashStore: ReturnType<typeof useTrashStore>

  const useService = (service: 'local' | 'notion' | 'todoist') => {
    boardStore.setSingleSource(service)
    boardStore.boardConfig.todoistApiToken = 'todoist-token'
    // The task's own source decides where the delete goes
    for (const task of tasksStore.tasks) {
      tasksStore.updateTask(task.id, { source: service, externalId: service === 'local' ? null : task.id })
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    trashStore = useTrashStore()
    tasksStore.setTasks([makeTask('a'), makeTask('b')])
    tasksStore.recordCarryOver('2026-10-19')
    tasksStore.recordCarryOver('2026-10-20')
    vi.clearAllMocks()
    archiveTaskMock.mockResolvedValue(undefined)
    todoistDeleteMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    resetTaskDeletionState()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('removes the task at once, opens a gap (no toast) and calls Notion only after the undo window', async () => {
    useService('notion')
    const { deleteTaskWithUndo } = useTaskDeletion()

    expect(deleteTaskWithUndo('a')).toBe(true)
    expect(tasksStore.task('a')).toBeNull()
    expect(useDeletedGaps().gaps.value.map(gap => gap.taskId)).toEqual(['a'])
    expect(trashStore.entry('a')).toBeUndefined()
    expect(archiveTaskMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS - 1)
    expect(archiveTaskMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(archiveTaskMock).toHaveBeenCalledWith('a')
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'a')).toBe(false)
    expect(tasksStore.deletedTaskIds).toContain('a')
    expect(trashStore.entry('a')?.task.title).toBe('Task a')
  })

  it('the window end moves the snapshot into the trash with its column and counter; the gap glides shut and goes', async () => {
    useService('local')
    tasksStore.updateTask('a', { status: TaskStatus.Waiting })
    const { deleteTaskWithUndo } = useTaskDeletion()
    const { gaps } = useDeletedGaps()
    deleteTaskWithUndo('a')

    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    const entry = trashStore.entry('a')
    expect(entry?.fromStatus).toBe(TaskStatus.Waiting)
    expect(entry?.carryOver?.days).toBe(1)
    expect(entry?.task.timerId).toBeNull()
    expect(gaps.value.map(gap => [gap.taskId, gap.state])).toEqual([['a', 'closing']])

    vi.advanceTimersByTime(GAP_CLOSE_MS)
    expect(gaps.value).toEqual([])
  })

  it('the window end keeps the tracked time of the task once for the Statistik page; an Undo keeps nothing (#537)', async () => {
    tasksStore.updateTask('a', { timeSpentSeconds: 600 })
    const { deleteTaskWithUndo, undoDelete } = useTaskDeletion()
    deleteTaskWithUndo('a')
    deleteTaskWithUndo('b')
    undoDelete('b')
    expect(statistics.recordDiscardedTime).not.toHaveBeenCalled() // inside the window nothing is kept
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(statistics.recordDiscardedTime).toHaveBeenCalledTimes(1)
    expect(statistics.recordDiscardedTime.mock.calls[0]![0]).toMatchObject({ id: 'a', timeSpentSeconds: 600 })
  })

  it('a delete that fails for good restores the task and takes its discarded time back (#537)', async () => {
    useService('notion')
    tasksStore.updateTask('a', { timeSpentSeconds: 600 })
    archiveTaskMock.mockRejectedValue(new Error('boom'))
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')
    await vi.advanceTimersByTimeAsync(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(statistics.removeDiscardedTime).toHaveBeenCalledWith('a')
  })

  it('hover pauses the window and resuming keeps the time that was left', async () => {
    useService('notion')
    const { deleteTaskWithUndo, pauseDelete, resumeDelete } = useTaskDeletion()
    deleteTaskWithUndo('a')

    vi.advanceTimersByTime(3000)
    pauseDelete('a')
    expect(useDeletedGaps().gaps.value[0]?.paused).toBe(true)
    vi.advanceTimersByTime(60_000)
    await flushPromises()
    expect(archiveTaskMock).not.toHaveBeenCalled()
    expect(trashStore.entry('a')).toBeUndefined()

    resumeDelete('a')
    vi.advanceTimersByTime(1999)
    await flushPromises()
    expect(archiveTaskMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(archiveTaskMock).toHaveBeenCalledWith('a')
  })

  it('Undo puts the card back at its place in the column even after the column order forgot it', () => {
    useService('local')
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
    expect(boardStore.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['a', 'b'])
    const { deleteTaskWithUndo, undoDelete } = useTaskDeletion()

    deleteTaskWithUndo('a')
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks) // what a render or a fetch does while the gap is open
    expect(boardStore.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['b'])
    undoDelete('a')

    expect(boardStore.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['a', 'b'])
  })

  it('deleting several cards in a row gives one gap each with its own window; undoing one leaves the others', async () => {
    useService('local')
    const { deleteTaskWithUndo, undoDelete } = useTaskDeletion()
    deleteTaskWithUndo('a')
    vi.advanceTimersByTime(2000)
    deleteTaskWithUndo('b')
    expect(useDeletedGaps().gaps.value.map(gap => gap.taskId).sort()).toEqual(['a', 'b'])

    undoDelete('a')
    expect(tasksStore.task('a')).not.toBeNull()
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS - 1)
    expect(trashStore.entry('b')).toBeUndefined()
    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(trashStore.entry('b')).toBeDefined()
    expect(trashStore.entry('a')).toBeUndefined()
  })

  it('a gap behind another gap hangs on that gap (the card order is the chain, #477), so both stay in delete order', () => {
    useService('local')
    // The board as it renders: a, b, then the rest; after a is deleted its gap stands in front of b
    const list = document.createElement('div')
    for (const id of ['a', 'b']) {
      const el = document.createElement('div')
      el.className = 'task-wrapper'
      el.dataset.taskId = id
      list.append(el)
    }
    document.body.append(list)
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')
    const gapEl = document.createElement('div')
    gapEl.dataset.gapId = 'a'
    list.querySelector('[data-task-id="b"]')!.before(gapEl)
    deleteTaskWithUndo('b')
    const afterIds = Object.fromEntries(useDeletedGaps().gaps.value.map(gap => [gap.taskId, gap.afterId]))
    expect(afterIds.a).toBeNull()
    expect(afterIds.b).toBe('a')
    document.body.innerHTML = ''
  })

  it('Undo of a task from Jetzt puts it back in Jetzt only while Jetzt is free, otherwise in Offen', () => {
    useService('local')
    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    const { deleteTaskWithUndo, undoDelete } = useTaskDeletion()

    deleteTaskWithUndo('a')
    undoDelete('a')
    expect(tasksStore.task('a')?.status).toBe(TaskStatus.Progress)

    deleteTaskWithUndo('a')
    tasksStore.updateTask('b', { status: TaskStatus.Progress })
    undoDelete('a')
    expect(tasksStore.task('a')?.status).toBe(TaskStatus.Open)
    expect(tasksStore.tasks.filter(task => task.status === TaskStatus.Progress).map(task => task.id)).toEqual(['b'])
  })

  it('deletes the Todoist task after the undo window', async () => {
    useService('todoist')
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')

    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(todoistDeleteMock).toHaveBeenCalledWith('a')
  })

  it('Undo restores the task and its counter and never reaches the integration', async () => {
    useService('todoist')
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')

    useTaskDeletion().undoDelete('a')
    expect(tasksStore.task('a')).not.toBeNull()
    expect(tasksStore.deletedTaskIds).not.toContain('a')
    expect(mapHelpers.get(tasksStore.carryOverByTaskId, 'a')?.days).toBe(1)
    expect(useDeletedGaps().gaps.value).toEqual([])

    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS * 3)
    await flushPromises()
    expect(todoistDeleteMock).not.toHaveBeenCalled()
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'a')).toBe(false)
    expect(trashStore.entry('a')).toBeUndefined()
  })

  it('local tasks never call an integration', async () => {
    useService('local')
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(archiveTaskMock).not.toHaveBeenCalled()
    expect(todoistDeleteMock).not.toHaveBeenCalled()
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'a')).toBe(false)
  })

  it('a failed upstream delete restores the task and reports through useErrorHandler', async () => {
    useService('notion')
    archiveTaskMock.mockRejectedValue(Object.assign(new Error('Bad Gateway'), { statusCode: 502 }))
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')

    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(tasksStore.task('a')).not.toBeNull()
    expect(tasksStore.deletedTaskIds).not.toContain('a')
    expect(mapHelpers.get(tasksStore.carryOverByTaskId, 'a')?.days).toBe(1)
    expect(handleErrorMock).toHaveBeenCalledWith(expect.any(Error), 'task_delete')
    expect(trashStore.entry('a')).toBeUndefined()
  })

  it('treats "not found" upstream as already deleted', async () => {
    useService('notion')
    archiveTaskMock.mockRejectedValue(Object.assign(new Error('Not Found'), { statusCode: 404 }))
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    expect(tasksStore.task('a')).toBeNull()
    expect(handleErrorMock).not.toHaveBeenCalled()
    expect(trashStore.entry('a')).toBeDefined()
  })

  it('offline: queues the delete without calling upstream, then commits on reconnect', async () => {
    useService('notion')
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { deleteTaskWithUndo, resumePendingDeletes } = useTaskDeletion()
    deleteTaskWithUndo('a')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()

    expect(archiveTaskMock).not.toHaveBeenCalled()
    expect(mapHelpers.get(tasksStore.pendingDeletes, 'a')?.state).toBe('queued')
    expect(tasksStore.task('a')).toBeNull()
    // The trash entry exists from the window's close, not from the upstream success
    expect(trashStore.entry('a')).toBeDefined()

    onLine.mockReturnValue(true)
    await resumePendingDeletes()
    expect(archiveTaskMock).toHaveBeenCalledWith('a')
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'a')).toBe(false)
    expect(trashStore.entries.filter(entry => entry.taskId === 'a')).toHaveLength(1)
  })

  it('a network error keeps the delete queued instead of restoring the task', async () => {
    useService('notion')
    archiveTaskMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()

    expect(tasksStore.task('a')).toBeNull()
    expect(mapHelpers.get(tasksStore.pendingDeletes, 'a')?.state).toBe('queued')
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('NotionAPIError with statusCode 0 ("Network error") is queued, not restored', async () => {
    useService('notion')
    archiveTaskMock.mockRejectedValueOnce(Object.assign(new Error('Network error'), { name: 'NotionAPIError', statusCode: 0 }))
    const { deleteTaskWithUndo, resumePendingDeletes } = useTaskDeletion()
    deleteTaskWithUndo('a')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()

    expect(tasksStore.task('a')).toBeNull()
    expect(mapHelpers.get(tasksStore.pendingDeletes, 'a')?.state).toBe('queued')
    expect(handleErrorMock).not.toHaveBeenCalled()

    await resumePendingDeletes()
    expect(archiveTaskMock).toHaveBeenCalledTimes(2)
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'a')).toBe(false)
  })

  it('app closed inside the undo window: the persisted delete is committed on the next start', async () => {
    useService('notion')
    const { deleteTaskWithUndo } = useTaskDeletion()
    deleteTaskWithUndo('a')
    // Simulate a restart: the in-memory undo window is gone, the pending entry is persisted.
    resetTaskDeletionState()

    const { resumePendingDeletes } = useTaskDeletion()
    await resumePendingDeletes()
    expect(archiveTaskMock).toHaveBeenCalledWith('a')
    expect(mapHelpers.has(tasksStore.pendingDeletes, 'a')).toBe(false)
    // A reload inside the window commits the delete: the entry is in the trash after it
    expect(trashStore.entry('a')).toBeDefined()
  })

  it('a queued delete whose trash entry was removed forever does not bring the entry back', async () => {
    useService('notion')
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { deleteTaskWithUndo, resumePendingDeletes } = useTaskDeletion()
    deleteTaskWithUndo('a')
    vi.advanceTimersByTime(DELETE_UNDO_WINDOW_MS)
    await flushPromises()
    trashStore.remove('a')

    onLine.mockReturnValue(true)
    await resumePendingDeletes()
    expect(archiveTaskMock).toHaveBeenCalledWith('a')
    expect(trashStore.entry('a')).toBeUndefined()
  })

  it('resume leaves deletes with an open undo window alone', async () => {
    useService('notion')
    const { deleteTaskWithUndo, resumePendingDeletes } = useTaskDeletion()
    deleteTaskWithUndo('a')
    await resumePendingDeletes()
    expect(archiveTaskMock).not.toHaveBeenCalled()
  })

  describe('with a running timer (#352)', () => {
    afterEach(() => disarmAllTaskTimers())

    it('stops the timer before deleting, and an undo of the delete resumes it with one interval', () => {
      vi.useFakeTimers()
      useService('local')
      tasksStore.updateTask('a', { status: TaskStatus.Progress })
      const driver = useTaskTimerDriver()
      driver.start()
      vi.advanceTimersByTime(2000)
      const spent = liveTimeSpent(tasksStore.task('a')!)
      expect(spent).toBe(2)

      useTaskDeletion().deleteTaskWithUndo('a')
      expect(mapHelpers.get(tasksStore.pendingDeletes, 'a')?.task.timerId).toBeNull()
      expect(armedTaskTimerIds()).toEqual([])
      vi.advanceTimersByTime(3000)

      useTaskDeletion().undoDelete('a')
      vi.advanceTimersByTime(3000)
      expect(liveTimeSpent(tasksStore.task('a')!)).toBe(spent + 3)
      expect(armedTaskTimerIds()).toEqual(['a'])
      driver.stop()
    })

    it('never calls clearInterval with a stale persisted timerId', () => {
      useService('local')
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      tasksStore.updateTask('a', { timerId: 99 })
      useTaskDeletion().deleteTaskWithUndo('a')
      expect(clearIntervalSpy).not.toHaveBeenCalledWith(99)
      expect(mapHelpers.get(tasksStore.pendingDeletes, 'a')?.task.timerId).toBeNull()
    })
  })

  it('returns false for a missing task', () => {
    expect(useTaskDeletion().deleteTaskWithUndo('missing')).toBe(false)
    expect(useDeletedGaps().gaps.value).toEqual([])
  })
})
