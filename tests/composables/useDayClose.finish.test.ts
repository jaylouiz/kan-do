import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useDayClose } from '~/composables/useDayClose'
import { TaskStatus } from '~/types/taskStatus'
import { armedTaskTimerIds, disarmAllTaskTimers } from '~/lib/taskTimers'
import { useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import type { Task } from '~/types/task'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

const calls: string[] = []
const stopTimerMock = vi.fn((id: string) => { calls.push(`stop:${id}`) })
const moveTaskToStatusMock = vi.fn(async (id: string, status: TaskStatus) => { calls.push(`move:${id}:${status}`); return true })
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ stopTimer: stopTimerMock, moveTaskToStatus: moveTaskToStatusMock }),
}))

const deleteTaskWithUndoMock = vi.fn((id: string) => {
  calls.push(`delete:${id}`)
  useTasksStore().removeTask(id)
  return true
})
vi.mock('~/composables/useTaskDeletion', () => ({
  useTaskDeletion: () => ({ deleteTaskWithUndo: deleteTaskWithUndoMock }),
}))

const makeTask = (id: string, status: TaskStatus, extra: Partial<Task> = {}): Task => ({
  id, source: 'local', externalId: null, title: `Task ${id}`, status, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

describe('useDayClose finish (Fertig)', () => {
  beforeEach(() => {
    localStorage.clear()
    calls.length = 0
    stopTimerMock.mockClear()
    moveTaskToStatusMock.mockClear()
    deleteTaskWithUndoMock.mockClear()
    setActivePinia(createPinia())
    useDayClose().close()
  })

  afterEach(() => {
    vi.useRealTimers()
    disarmAllTaskTimers()
  })

  it('stops the timer, then moves the Jetzt task to Offen through the shared move path, then closes', async () => {
    const store = useTasksStore()
    store.addTask(makeTask('p', TaskStatus.Progress, { timerId: 7, timeSpentSeconds: 1800 }))
    store.addTask(makeTask('o', TaskStatus.Open))
    const dayClose = useDayClose()
    dayClose.open()
    await dayClose.finish()
    expect(calls).toEqual([`stop:p`, `move:p:${TaskStatus.Open}`])
    expect(moveTaskToStatusMock).toHaveBeenCalledTimes(1)
    expect(dayClose.isOpen.value).toBe(false)
  })

  it('moves a Jetzt task without a running timer too, without stopping anything', async () => {
    useTasksStore().addTask(makeTask('p', TaskStatus.Progress))
    await useDayClose().finish()
    expect(moveTaskToStatusMock).toHaveBeenCalledWith('p', TaskStatus.Open)
  })

  it('only closes when nothing is in Jetzt', async () => {
    useTasksStore().addTask(makeTask('w', TaskStatus.Waiting))
    const dayClose = useDayClose()
    dayClose.open()
    await dayClose.finish()
    expect(stopTimerMock).not.toHaveBeenCalled()
    expect(moveTaskToStatusMock).not.toHaveBeenCalled()
    expect(dayClose.isOpen.value).toBe(false)
  })

  it('plain close() stays side-effect free', () => {
    useTasksStore().addTask(makeTask('p', TaskStatus.Progress, { timerId: 7 }))
    const dayClose = useDayClose()
    dayClose.open()
    dayClose.close()
    expect(stopTimerMock).not.toHaveBeenCalled()
    expect(moveTaskToStatusMock).not.toHaveBeenCalled()
  })

  it('closes first so a slow upstream sync never keeps the dialog open', async () => {
    useTasksStore().addTask(makeTask('p', TaskStatus.Progress))
    moveTaskToStatusMock.mockImplementationOnce(() => new Promise(() => {}))
    const dayClose = useDayClose()
    dayClose.open()
    void dayClose.finish()
    expect(dayClose.isOpen.value).toBe(false)
    expect(moveTaskToStatusMock).toHaveBeenCalled()
  })

  it('a move that fails leaves the Jetzt task counting; one that goes through leaves no timer (#352)', async () => {
    vi.useFakeTimers()
    const store = useTasksStore()
    store.addTask(makeTask('p', TaskStatus.Progress))
    const driver = useTaskTimerDriver()
    driver.start()
    vi.advanceTimersByTime(2000)
    // Mocked: stopTimer does not stop the real timer, so stop it as the real one does
    const { stopTaskTimer } = await import('~/composables/useTaskTimerDriver')
    stopTimerMock.mockImplementationOnce((id: string) => { stopTaskTimer(id) })
    moveTaskToStatusMock.mockRejectedValueOnce(new Error('move failed'))

    await expect(useDayClose().finish()).rejects.toThrow('move failed')
    expect(store.task('p')?.status).toBe(TaskStatus.Progress)
    expect(armedTaskTimerIds()).toEqual(['p'])
    vi.advanceTimersByTime(3000)
    expect(store.task('p')?.timeSpentSeconds).toBe(5)

    // The move goes through: the task leaves Jetzt and nothing is armed afterwards
    stopTimerMock.mockImplementationOnce((id: string) => { stopTaskTimer(id) })
    moveTaskToStatusMock.mockImplementationOnce(async (id: string, status: TaskStatus) => { store.updateTask(id, { status }); return true })
    await useDayClose().finish()
    vi.advanceTimersByTime(3000)
    expect(armedTaskTimerIds()).toEqual([])
    expect(store.task('p')?.timeSpentSeconds).toBe(5)
    driver.stop()
  })

  describe('deselected tasks (#237)', () => {
    it('deletes a deselected Offen task through the upstream-aware delete and leaves the selected ones alone', async () => {
      const store = useTasksStore()
      store.addTask(makeTask('o1', TaskStatus.Open))
      store.addTask(makeTask('o2', TaskStatus.Open))
      store.addTask(makeTask('w', TaskStatus.Waiting))
      const dayClose = useDayClose()
      dayClose.open()
      dayClose.setKept('o1', false)
      dayClose.setKept('w', false)
      await dayClose.finish()
      expect(calls).toEqual(['delete:o1', 'delete:w'])
      expect(moveTaskToStatusMock).not.toHaveBeenCalled()
      expect(store.task('o2')?.status).toBe(TaskStatus.Open)
      expect(dayClose.isOpen.value).toBe(false)
    })

    it('a deselected Jetzt task is deleted, not put back to Offen; a selected one still goes back', async () => {
      const store = useTasksStore()
      store.addTask(makeTask('p', TaskStatus.Progress, { timerId: 7 }))
      const dayClose = useDayClose()
      dayClose.open()
      dayClose.setKept('p', false)
      await dayClose.finish()
      expect(calls).toEqual(['delete:p'])
      expect(stopTimerMock).not.toHaveBeenCalled()
      expect(moveTaskToStatusMock).not.toHaveBeenCalled()

      store.addTask(makeTask('p2', TaskStatus.Progress))
      calls.length = 0
      dayClose.open()
      await dayClose.finish()
      expect(calls).toEqual(['stop:p2', `move:p2:${TaskStatus.Open}`])
      expect(deleteTaskWithUndoMock).toHaveBeenCalledTimes(1)
    })

    it('nothing deselected deletes nothing; a second Fertig deletes nothing again', async () => {
      const store = useTasksStore()
      store.addTask(makeTask('o1', TaskStatus.Open))
      store.addTask(makeTask('o2', TaskStatus.Open))
      const dayClose = useDayClose()
      dayClose.open()
      await dayClose.finish()
      expect(deleteTaskWithUndoMock).not.toHaveBeenCalled()

      dayClose.open()
      dayClose.setKept('o1', false)
      await dayClose.finish()
      await dayClose.finish()
      expect(deleteTaskWithUndoMock).toHaveBeenCalledTimes(1)
    })

    it('the selection starts fresh on every open, a new task defaults to selected, a vanished one is ignored', async () => {
      const store = useTasksStore()
      store.addTask(makeTask('o1', TaskStatus.Open))
      const dayClose = useDayClose()
      dayClose.open()
      dayClose.setKept('o1', false)
      dayClose.setKept('gone', false)
      expect(dayClose.isKept('o1')).toBe(false)
      expect(dayClose.isKept('late')).toBe(true)
      dayClose.setKept('o1', true)
      expect(dayClose.isKept('o1')).toBe(true)
      dayClose.setKept('o1', false)
      dayClose.close()
      dayClose.open()
      expect(dayClose.isKept('o1')).toBe(true)

      dayClose.setKept('gone', false)
      await dayClose.finish()
      expect(deleteTaskWithUndoMock).not.toHaveBeenCalled()
    })

    it('plain close() deletes nothing even with a deselection', () => {
      useTasksStore().addTask(makeTask('o1', TaskStatus.Open))
      const dayClose = useDayClose()
      dayClose.open()
      dayClose.setKept('o1', false)
      dayClose.close()
      expect(deleteTaskWithUndoMock).not.toHaveBeenCalled()
    })
  })
})
