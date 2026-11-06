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
})
