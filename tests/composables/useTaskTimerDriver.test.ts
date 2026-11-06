import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { toRaw } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskTimerDriver, stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { useTasksStore } from '~/store/tasks'
import { armedTaskTimerIds, disarmAllTaskTimers } from '~/lib/taskTimers'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

describe('useTaskTimerDriver (#352)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let driver: ReturnType<typeof useTaskTimerDriver>

  const spent = (id: string) => tasksStore.task(id)!.timeSpentSeconds

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    tasksStore = useTasksStore()
    driver = useTaskTimerDriver()
  })

  afterEach(() => {
    driver.stop()
    disarmAllTaskTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('start arms every task in Jetzt and counts from the saved time', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress, timeSpentSeconds: 40 }), makeTask('b')])
    driver.start()
    vi.advanceTimersByTime(3000)

    expect(spent('a')).toBe(43)
    expect(spent('b')).toBe(0)
    expect(armedTaskTimerIds()).toEqual(['a'])
    expect(tasksStore.task('a')!.timerId).not.toBeNull()
    expect(tasksStore.task('b')!.timerId).toBeNull()
  })

  it('start overwrites a stale persisted timerId without ever calling clearInterval on it', () => {
    tasksStore.setTasks([
      makeTask('a', { status: TaskStatus.Progress, timerId: 7 }),
      makeTask('b', { status: TaskStatus.Waiting, timerId: 8 }),
    ])
    const clear = vi.spyOn(window, 'clearInterval')
    driver.start()

    expect(clear).not.toHaveBeenCalledWith(7)
    expect(clear).not.toHaveBeenCalledWith(8)
    expect(tasksStore.task('b')!.timerId).toBeNull()
    expect(tasksStore.task('a')!.timerId).not.toBe(7)
    expect(armedTaskTimerIds()).toEqual(['a'])
  })

  it('a stale timerId that equals a live interval of the page does not kill that interval', () => {
    const other = vi.fn()
    const liveHandle = window.setInterval(other, 1000)
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Waiting, timerId: liveHandle })])
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(other).toHaveBeenCalledTimes(2)
    window.clearInterval(liveHandle)
  })

  it('a task entering Jetzt starts counting at once, one that leaves stops at once with timerId null', () => {
    tasksStore.setTasks([makeTask('a')])
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(spent('a')).toBe(0)

    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(2000)
    expect(spent('a')).toBe(2)

    tasksStore.updateTask('a', { status: TaskStatus.Waiting })
    expect(tasksStore.task('a')!.timerId).toBeNull()
    expect(armedTaskTimerIds()).toEqual([])
    vi.advanceTimersByTime(5000)
    expect(spent('a')).toBe(2)
  })

  it('Offen -> Jetzt -> Wartet -> Jetzt resumes from the kept time with one interval', () => {
    tasksStore.setTasks([makeTask('a')])
    driver.start()
    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Waiting })
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(3000)

    expect(spent('a')).toBe(5)
    expect(vi.getTimerCount()).toBe(1)
    expect(armedTaskTimerIds()).toEqual(['a'])
  })

  it('Jetzt -> Erledigt -> undo (back to Jetzt) resumes with one interval', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Done })
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(2000)

    expect(spent('a')).toBe(4)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('a removed task disarms; re-adding it (undo of a delete) arms one interval again', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    const snapshot = { ...tasksStore.task('a')!, timerId: null }
    tasksStore.removeTask('a')
    expect(armedTaskTimerIds()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    tasksStore.addTask(snapshot)
    vi.advanceTimersByTime(2000)
    expect(spent('a')).toBe(2)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('an explicit stop of a task that stays in Jetzt is not re-armed, not even by another task entering Jetzt', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress }), makeTask('b')])
    driver.start()
    vi.advanceTimersByTime(1000)

    expect(stopTaskTimer('a')).toBe(true)
    expect(tasksStore.task('a')!.timerId).toBeNull()
    tasksStore.updateTask('b', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(3000)

    expect(spent('a')).toBe(1)
    expect(spent('b')).toBe(3)
    expect(armedTaskTimerIds()).toEqual(['b'])
    expect(stopTaskTimer('a')).toBe(false)
  })

  it('a tick for a task that vanished disarms itself: no write, no console error', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const update = vi.spyOn(tasksStore, 'updateTaskTimespent')
    // Through the raw array, so the Jetzt watcher never sees it: only the tick guard can notice
    toRaw(tasksStore.tasks).splice(0, 1)
    vi.advanceTimersByTime(1000)

    expect(update).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(armedTaskTimerIds()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a tick whose task left Jetzt unseen by the watcher disarms, clears timerId and writes no time', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    const update = vi.spyOn(tasksStore, 'updateTaskTimespent')
    toRaw(tasksStore.task('a')!).status = TaskStatus.Waiting
    vi.advanceTimersByTime(1000)

    expect(update).not.toHaveBeenCalled()
    expect(armedTaskTimerIds()).toEqual([])
    expect(tasksStore.task('a')!.timerId).toBeNull()
  })

  it('start twice (HMR re-run) leaves exactly one interval per Jetzt task', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    driver.start()
    vi.advanceTimersByTime(3000)
    expect(spent('a')).toBe(3)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('stop disarms everything and stops following the board', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress }), makeTask('b')])
    driver.start()
    driver.stop()
    tasksStore.updateTask('b', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(3000)
    expect(vi.getTimerCount()).toBe(0)
    expect(spent('a')).toBe(0)
    expect(spent('b')).toBe(0)
  })

  it('queues tracked time of a Notion task as a pending update and none for a Local task', () => {
    tasksStore.setTasks([
      makeTask('n', { status: TaskStatus.Progress, source: 'notion', externalId: 'page-n' }),
    ])
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(tasksStore.pendingTimeUpdates['n']?.timeSpentSeconds).toBe(2)
    driver.stop()

    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    tasksStore.setTasks([makeTask('l', { status: TaskStatus.Progress })])
    driver = useTaskTimerDriver()
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(Object.keys(tasksStore.pendingTimeUpdates)).toEqual([])
  })
})
