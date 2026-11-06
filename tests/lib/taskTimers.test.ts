import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  armTaskTimer,
  armedTaskTimerIds,
  disarmAllTaskTimers,
  disarmTaskTimer,
  isTaskTimerArmed,
} from '~/lib/taskTimers'

describe('taskTimers registry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    disarmAllTaskTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('ticks once a second until disarmed', () => {
    const tick = vi.fn()
    armTaskTimer('a', tick)
    vi.advanceTimersByTime(3000)
    expect(tick).toHaveBeenCalledTimes(3)

    expect(disarmTaskTimer('a')).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(tick).toHaveBeenCalledTimes(3)
    expect(isTaskTimerArmed('a')).toBe(false)
  })

  it('arming a task again replaces its timer: one interval, never two', () => {
    const first = vi.fn()
    const second = vi.fn()
    armTaskTimer('a', first)
    armTaskTimer('a', second)
    vi.advanceTimersByTime(2000)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(2)
    expect(armedTaskTimerIds()).toEqual(['a'])
    expect(vi.getTimerCount()).toBe(1)
  })

  it('disarm of an unknown task is a no-op and calls no clearInterval', () => {
    const clear = vi.spyOn(window, 'clearInterval')
    expect(disarmTaskTimer('ghost')).toBe(false)
    expect(clear).not.toHaveBeenCalled()
  })

  it('clearInterval only ever sees handles the registry made', () => {
    const clear = vi.spyOn(window, 'clearInterval')
    const handleA = armTaskTimer('a', vi.fn())
    const handleB = armTaskTimer('b', vi.fn())
    disarmTaskTimer('a')
    disarmAllTaskTimers()
    expect(clear.mock.calls.map(([handle]) => handle)).toEqual([handleA, handleB])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('timers of different tasks run independently', () => {
    const a = vi.fn()
    const b = vi.fn()
    armTaskTimer('a', a)
    armTaskTimer('b', b)
    vi.advanceTimersByTime(1000)
    disarmTaskTimer('a')
    vi.advanceTimersByTime(2000)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(3)
  })
})
