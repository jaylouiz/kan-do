/**
 * #600: the timer driver opens, grows and closes work sessions. The per-second tick never writes a session.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskTimerDriver, stopTaskTimer, resumeTaskTimer } from '~/composables/useTaskTimerDriver'
import { endAllWorkSessions } from '~/composables/useWorkSessionTracking'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { disarmAllTaskTimers } from '~/lib/taskTimers'
import { clearAllLiveSeconds, liveTimeSpent } from '~/lib/liveTime'
import { dataState } from '~/lib/dataStorage'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const T0 = new Date(2026, 10, 3, 9, 0, 0).getTime()
const SEC = 1000
const MIN = 60 * SEC

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

describe('work sessions written by the timer driver (#600)', () => {
  let tasks: ReturnType<typeof useTasksStore>
  let stats: ReturnType<typeof useTaskStatisticsStore>
  let driver: ReturnType<typeof useTaskTimerDriver>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    dataState.available = false
    dataState.status = 'ok'
    useBoardStore().setSources({ connected: [], default: 'local' })
    tasks = useTasksStore()
    stats = useTaskStatisticsStore()
    driver = useTaskTimerDriver()
  })

  afterEach(() => {
    driver.stop()
    endAllWorkSessions()
    disarmAllTaskTimers()
    clearAllLiveSeconds()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens a session when a Jetzt timer starts, grows its end every minute and closes it when the timer stops', () => {
    const baseline = vi.getTimerCount()
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 }])

    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + MIN }])
    vi.advanceTimersByTime(90 * SEC)
    stopTaskTimer('a')
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 150 * SEC }])

    vi.advanceTimersByTime(10 * MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 150 * SEC }])
    expect(vi.getTimerCount()).toBe(baseline)
  })

  it('the per-second tick writes no session: the session list changes once per heartbeat only', () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    const open = vi.spyOn(stats, 'openWorkSession')
    const extend = vi.spyOn(stats, 'extendWorkSession')
    vi.advanceTimersByTime(59 * SEC)
    expect(extend).not.toHaveBeenCalled()
    // Stored time is checkpointed every 10 s (#286); the 59th second is still open
    expect(tasks.task('a')!.timeSpentSeconds).toBe(50)
    expect(liveTimeSpent(tasks.task('a')!)).toBe(59)
    vi.advanceTimersByTime(3 * MIN)
    expect(extend).toHaveBeenCalledTimes(3)
    expect(open).not.toHaveBeenCalled()
  })

  it('a task leaving Jetzt closes the session; coming back within 3 minutes continues it, later starts a new one', () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(5 * MIN)
    tasks.updateTask('a', { status: TaskStatus.Waiting })
    vi.advanceTimersByTime(2 * MIN)
    tasks.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(2 * MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 9 * MIN }])

    tasks.updateTask('a', { status: TaskStatus.Waiting })
    vi.advanceTimersByTime(10 * MIN)
    tasks.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 9 * MIN }, { start: T0 + 19 * MIN, end: T0 + 20 * MIN }])
  })

  it('resumeTaskTimer after a failed stop continues the same session', () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(10 * SEC)
    stopTaskTimer('a')
    vi.advanceTimersByTime(5 * SEC)
    expect(resumeTaskTimer('a')).toBe(true)
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toHaveLength(1)
    expect(stats.workSessions[0]).toEqual({ start: T0, end: T0 + 75 * SEC })
  })

  it('a reload (driver restart) within 3 minutes continues the session', () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(5 * MIN)
    driver.stop()
    vi.advanceTimersByTime(MIN)
    driver.start()
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 7 * MIN }])
  })

  it('a heartbeat that comes more than 3 minutes late (sleep) does not stretch the session over the gap', () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(2 * MIN)
    // The machine sleeps for an hour: timers are frozen, the clock jumps
    vi.setSystemTime(T0 + 62 * MIN)
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 2 * MIN }, { start: T0 + 63 * MIN, end: T0 + 63 * MIN }])
  })

  it('writes nothing for demo tasks, an un-onboarded board or while the data status blocks writes', () => {
    tasks.setTasks([makeTask('demo-1', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(2 * MIN)
    expect(stats.workSessions).toEqual([])
    driver.stop()

    dataState.available = true
    dataState.status = 'conflict' as typeof dataState.status
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(2 * MIN)
    expect(stats.workSessions).toEqual([])
    driver.stop()
    dataState.available = false
    dataState.status = 'ok'

    useBoardStore().boardConfig.sources = null
    driver.start()
    vi.advanceTimersByTime(2 * MIN)
    expect(stats.workSessions).toEqual([])
  })

  it('a session blocked at arm time opens at the next heartbeat once writes are allowed again', () => {
    dataState.available = true
    dataState.status = 'conflict' as typeof dataState.status
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(2 * MIN)
    expect(stats.workSessions).toEqual([])

    // The conflict is resolved without a reload while the timer keeps running
    dataState.status = 'ok'
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0 + 3 * MIN, end: T0 + 3 * MIN }])
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0 + 3 * MIN, end: T0 + 4 * MIN }])
    stopTaskTimer('a')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a re-open after sleep that is blocked is retried at the next heartbeat', () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(2 * MIN)
    dataState.available = true
    dataState.status = 'folder-unavailable' as typeof dataState.status
    vi.setSystemTime(T0 + 62 * MIN)
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 2 * MIN }])

    dataState.status = 'ok'
    vi.advanceTimersByTime(MIN)
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 2 * MIN }, { start: T0 + 64 * MIN, end: T0 + 64 * MIN }])
  })

  it('pagehide persists the current end', () => {
    tasks.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(20 * SEC)
    window.dispatchEvent(new Event('pagehide'))
    expect(stats.workSessions).toEqual([{ start: T0, end: T0 + 20 * SEC }])
  })
})
