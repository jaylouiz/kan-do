import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { armTaskTimer, isTaskTimerArmed } from '~/lib/taskTimers'
import { toastAddMock } from '../mocks/nuxt-imports'

// --- Mocks (must be defined before importing SUT) ---

const taskMock = vi.fn()
const updateTaskMock = vi.fn()
const addPendingTimeUpdateMock = vi.fn()
const removeTaskMock = vi.fn()
const tasksDoneMock = ref<Task[]>([])
const tasksProgressMock = ref<Task[]>([])

vi.mock('~/store/tasks', () => ({
  useTasksStore: () => ({
    task: taskMock,
    updateTask: updateTaskMock,
    addPendingTimeUpdate: addPendingTimeUpdateMock,
    removeTask: removeTaskMock,
    get tasksDone() { return tasksDoneMock.value },
    get tasksProgress() { return tasksProgressMock.value },
  }),
}))

const updateTaskPositionMock = vi.fn()
const startTimeboxNudgeMock = vi.fn()
const startConfirmationMock = vi.fn()
vi.mock('~/store/board', () => ({
  useBoardStore: () => ({
    updateTaskPosition: updateTaskPositionMock,
    startTimeboxNudge: startTimeboxNudgeMock,
    startConfirmation: startConfirmationMock,
  }),
}))

const updateTaskStatusMock = vi.fn()
const syncPendingChangesMock = vi.fn()
vi.mock('~/composables/useTaskSync', () => ({
  useTaskSync: () => ({
    updateTaskStatus: updateTaskStatusMock,
    syncPendingChanges: syncPendingChangesMock,
  }),
}))

const captureCompletionSnapshotMock = vi.fn((taskId: string) => ({ taskId }))
const notifyCompletedMock = vi.fn()
vi.mock('~/composables/useCompletionUndo', () => ({
  useCompletionUndo: () => ({
    captureCompletionSnapshot: captureCompletionSnapshotMock,
    notifyCompleted: notifyCompletedMock,
  }),
}))

const handleErrorMock = vi.fn()
const deleteTaskWithUndoMock = vi.fn()
vi.mock('~/composables/useTaskDeletion', () => ({
  useTaskDeletion: () => ({ deleteTaskWithUndo: deleteTaskWithUndoMock }),
}))

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: handleErrorMock,
  }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', source: 'local', externalId: null,
    title: 'Test Task',
    status: TaskStatus.Open,
    activity: null,
    topic: null,
    topicColorCode: null,
    priority: 1,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    ...overrides,
  }
}

describe('useTaskOperations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    taskMock.mockReset()
    updateTaskMock.mockReset()
    addPendingTimeUpdateMock.mockReset()
    removeTaskMock.mockReset()
    updateTaskPositionMock.mockReset()
    startTimeboxNudgeMock.mockReset()
    startConfirmationMock.mockReset()
    updateTaskStatusMock.mockReset().mockResolvedValue(undefined)
    syncPendingChangesMock.mockReset()
    handleErrorMock.mockReset()
    tasksDoneMock.value = []
    tasksProgressMock.value = []
  })

  describe('validateTask', () => {
    it('returns error when title is missing', () => {
      const { validateTask } = useTaskOperations()
      const errors = validateTask({ title: '' })
      expect(errors).toContain('Aufgabentitel ist erforderlich')
    })

    it('returns error when title is whitespace only', () => {
      const { validateTask } = useTaskOperations()
      const errors = validateTask({ title: '   ' })
      expect(errors).toContain('Aufgabentitel ist erforderlich')
    })

    it('returns error for negative timeBoxSeconds', () => {
      const { validateTask } = useTaskOperations()
      const errors = validateTask({ title: 'Valid', timeBoxSeconds: -1 })
      expect(errors).toContain('Timebox kann nicht negativ sein')
    })

    it('returns error for negative timeSpentSeconds', () => {
      const { validateTask } = useTaskOperations()
      const errors = validateTask({ title: 'Valid', timeSpentSeconds: -5 })
      expect(errors).toContain('Aufgewendete Zeit kann nicht negativ sein')
    })

    it('returns no errors for a valid task', () => {
      const { validateTask } = useTaskOperations()
      const errors = validateTask({ title: 'Valid Task', timeBoxSeconds: 3600, timeSpentSeconds: 0 })
      expect(errors).toHaveLength(0)
    })

    it('returns multiple errors for multiple violations', () => {
      const { validateTask } = useTaskOperations()
      const errors = validateTask({ title: '', timeBoxSeconds: -1, timeSpentSeconds: -1 })
      expect(errors).toHaveLength(3)
    })
  })

  describe('stopTimer', () => {
    it('calls handleError when task not found', () => {
      taskMock.mockReturnValue(undefined)
      const { stopTimer } = useTaskOperations()
      stopTimer('missing-id')
      expect(handleErrorMock).toHaveBeenCalledWith(expect.any(String), 'task_operation')
    })

    it('does nothing when task has no active timer', () => {
      taskMock.mockReturnValue(makeTask({ timerId: null }))
      const { stopTimer } = useTaskOperations()
      stopTimer('task-1')
      expect(updateTaskMock).not.toHaveBeenCalled()
      expect(syncPendingChangesMock).not.toHaveBeenCalled()
    })

    it('stops the registry timer, resets timerId and calls syncPendingChanges when a timer is running', () => {
      vi.useFakeTimers()
      const tick = vi.fn()
      const handle = armTaskTimer('task-1', tick)
      taskMock.mockReturnValue(makeTask({ timerId: handle }))
      const { stopTimer } = useTaskOperations()

      stopTimer('task-1')
      vi.advanceTimersByTime(3000)

      expect(tick).not.toHaveBeenCalled()
      expect(isTaskTimerArmed('task-1')).toBe(false)
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { timerId: null })
      expect(syncPendingChangesMock).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('never calls clearInterval with a persisted timerId the registry did not make', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
      taskMock.mockReturnValue(makeTask({ timerId: 42 }))
      const { stopTimer } = useTaskOperations()

      stopTimer('task-1')

      expect(clearIntervalSpy).not.toHaveBeenCalledWith(42)
      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { timerId: null })
      clearIntervalSpy.mockRestore()
    })
  })

  describe('toggleTaskCompletion', () => {
    it('moves a Done task to Open', async () => {
      const task = makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Done })
      taskMock.mockReturnValue(task)
      const { toggleTaskCompletion } = useTaskOperations()

      await toggleTaskCompletion('task-1')

      expect(updateTaskStatusMock).toHaveBeenCalledWith({ taskId: 'task-1', status: TaskStatus.Open })
    })

    it('moves an Open task to Done', async () => {
      const task = makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open })
      taskMock.mockReturnValue(task)
      const { toggleTaskCompletion } = useTaskOperations()

      await toggleTaskCompletion('task-1')

      expect(updateTaskStatusMock).toHaveBeenCalledWith({ taskId: 'task-1', status: TaskStatus.Done })
    })

    it('calls handleError when task not found', async () => {
      taskMock.mockReturnValue(undefined)
      const { toggleTaskCompletion } = useTaskOperations()

      await toggleTaskCompletion('missing-id')

      expect(handleErrorMock).toHaveBeenCalledWith(expect.any(String), 'task_operation')
    })
  })

  describe('moveTaskToStatus', () => {
    it('updates board position and syncs status', async () => {
      const task = makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open })
      taskMock.mockReturnValue(task)
      const { moveTaskToStatus } = useTaskOperations()

      await moveTaskToStatus('task-1', TaskStatus.Done)

      expect(updateTaskPositionMock).toHaveBeenCalledWith('task-1', TaskStatus.Done, TaskStatus.Open)
      expect(updateTaskStatusMock).toHaveBeenCalledWith({ taskId: 'task-1', status: TaskStatus.Done })
    })

    it('offers the undo toast only when moving into Done', async () => {
      taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open }))
      const { moveTaskToStatus } = useTaskOperations()

      await moveTaskToStatus('task-1', TaskStatus.Waiting)
      expect(notifyCompletedMock).toHaveBeenCalledWith(null)

      await moveTaskToStatus('task-1', TaskStatus.Done)
      expect(captureCompletionSnapshotMock).toHaveBeenCalledWith('task-1')
      expect(notifyCompletedMock).toHaveBeenLastCalledWith({ taskId: 'task-1' })
    })

    it('starts the in-card done confirmation (#611) only for a move into Done', async () => {
      taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open }))
      const { moveTaskToStatus } = useTaskOperations()

      await moveTaskToStatus('task-1', TaskStatus.Waiting)
      expect(startConfirmationMock).not.toHaveBeenCalled()

      await moveTaskToStatus('task-1', TaskStatus.Done)
      expect(startConfirmationMock).toHaveBeenCalledExactlyOnceWith('task-1')
    })

    it('does not start the confirmation when the task is already Done (no-op move)', async () => {
      taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Done }))
      const { moveTaskToStatus } = useTaskOperations()

      await moveTaskToStatus('task-1', TaskStatus.Done)
      expect(startConfirmationMock).not.toHaveBeenCalled()
    })

    it('does nothing when new status equals current status', async () => {
      const task = makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Done })
      taskMock.mockReturnValue(task)
      const { moveTaskToStatus } = useTaskOperations()

      await moveTaskToStatus('task-1', TaskStatus.Done)

      expect(updateTaskPositionMock).not.toHaveBeenCalled()
      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })

    it('refuses a move into a full Jetzt and tells the user why', async () => {
      taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open }))
      tasksProgressMock.value = [makeTask({ id: 'other', source: 'local', externalId: null, status: TaskStatus.Progress })]
      const { moveTaskToStatus } = useTaskOperations()

      const moved = await moveTaskToStatus('task-1', TaskStatus.Progress)

      expect(moved).toBe(false)
      expect(updateTaskPositionMock).not.toHaveBeenCalled()
      expect(updateTaskStatusMock).not.toHaveBeenCalled()
      expect(toastAddMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'wip-limit' }))
    })

    it('moves into an empty Jetzt', async () => {
      taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open }))
      const { moveTaskToStatus } = useTaskOperations()

      expect(await moveTaskToStatus('task-1', TaskStatus.Progress)).toBe(true)
      expect(updateTaskStatusMock).toHaveBeenCalledWith({ taskId: 'task-1', status: TaskStatus.Progress })
    })

    describe('timebox nudge (#389)', () => {
      it('asks for a timebox on a card that moves into Jetzt (the store decides whether it has one)', async () => {
        taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open }))
        const { moveTaskToStatus } = useTaskOperations()

        await moveTaskToStatus('task-1', TaskStatus.Progress)

        expect(startTimeboxNudgeMock).toHaveBeenCalledWith('task-1')
        // after the board and the status changed, so the store guard sees a Jetzt card
        expect(updateTaskStatusMock.mock.invocationCallOrder[0]!).toBeLessThan(startTimeboxNudgeMock.mock.invocationCallOrder[0]!)
      })

      it.each([TaskStatus.Open, TaskStatus.Waiting, TaskStatus.Done])('does not nudge for a move into status %s', async (status) => {
        taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Progress }))
        const { moveTaskToStatus } = useTaskOperations()

        await moveTaskToStatus('task-1', status)

        expect(startTimeboxNudgeMock).not.toHaveBeenCalled()
      })

      it('does not nudge when a full Jetzt refuses the move', async () => {
        taskMock.mockReturnValue(makeTask({ id: 'task-1', source: 'local', externalId: null, status: TaskStatus.Open }))
        tasksProgressMock.value = [makeTask({ id: 'other', source: 'local', externalId: null, status: TaskStatus.Progress })]
        const { moveTaskToStatus } = useTaskOperations()

        await moveTaskToStatus('task-1', TaskStatus.Progress)

        expect(startTimeboxNudgeMock).not.toHaveBeenCalled()
      })
    })

    it('calls handleError when task not found', async () => {
      taskMock.mockReturnValue(undefined)
      const { moveTaskToStatus } = useTaskOperations()

      await moveTaskToStatus('missing-id', TaskStatus.Done)

      expect(handleErrorMock).toHaveBeenCalledWith(expect.any(String), 'task_operation')
    })
  })

  describe('deleteTask', () => {
    it('delegates to the shared upstream-aware delete', () => {
      taskMock.mockReturnValue(makeTask({ timerId: null }))
      const { deleteTask } = useTaskOperations()

      deleteTask('task-1')

      expect(deleteTaskWithUndoMock).toHaveBeenCalledWith('task-1')
    })

    it('calls handleError when task not found', () => {
      taskMock.mockReturnValue(undefined)
      const { deleteTask } = useTaskOperations()

      deleteTask('missing-id')

      expect(handleErrorMock).toHaveBeenCalledWith(expect.any(String), 'task_operation')
      expect(deleteTaskWithUndoMock).not.toHaveBeenCalled()
    })
  })

  describe('bulkUpdateTasks', () => {
    it('updates each task in the list', async () => {
      taskMock.mockImplementation((id: string) => makeTask({ id }))
      const { bulkUpdateTasks } = useTaskOperations()

      await bulkUpdateTasks(['task-1', 'task-2'], { status: TaskStatus.Done })

      expect(updateTaskMock).toHaveBeenCalledWith('task-1', { status: TaskStatus.Done })
      expect(updateTaskMock).toHaveBeenCalledWith('task-2', { status: TaskStatus.Done })
    })

    it('calls handleError when a task is not found', async () => {
      taskMock.mockReturnValue(undefined)
      const { bulkUpdateTasks } = useTaskOperations()

      await bulkUpdateTasks(['missing-1'], { status: TaskStatus.Done })

      expect(handleErrorMock).toHaveBeenCalled()
    })
  })
})
