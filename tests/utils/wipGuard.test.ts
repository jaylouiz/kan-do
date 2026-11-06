import { describe, it, expect } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import { checkWipMove } from '~/utils/wipGuard'

describe('checkWipMove', () => {
  it('refuses a second task into Jetzt', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Open, targetStatus: TaskStatus.Progress, progressCount: 1 }))
      .toEqual({ allowed: false, reason: 'progressFull' })
  })
  it('allows the first task into Jetzt', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Waiting, targetStatus: TaskStatus.Progress, progressCount: 0 }).allowed).toBe(true)
  })
  it('allows reordering inside a full Jetzt', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Progress, targetStatus: TaskStatus.Progress, progressCount: 1 }).allowed).toBe(true)
  })
  it('refuses a block of two or more tasks into an empty Jetzt', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Open, targetStatus: TaskStatus.Progress, progressCount: 0, taskCount: 2 }))
      .toEqual({ allowed: false, reason: 'stackTooLarge' })
  })
  it('refuses a block of two or more tasks into an occupied Jetzt', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Open, targetStatus: TaskStatus.Progress, progressCount: 1, taskCount: 3 }).allowed).toBe(false)
  })
  it('treats a block of one like a single task', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Open, targetStatus: TaskStatus.Progress, progressCount: 0, taskCount: 1 }).allowed).toBe(true)
    expect(checkWipMove({ currentStatus: TaskStatus.Open, targetStatus: TaskStatus.Progress, progressCount: 1, taskCount: 1 }))
      .toEqual({ allowed: false, reason: 'progressFull' })
  })
  it('lets a block go to every other column', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Open, targetStatus: TaskStatus.Done, progressCount: 1, taskCount: 4 }).allowed).toBe(true)
  })
  it('never restricts other columns', () => {
    expect(checkWipMove({ currentStatus: TaskStatus.Open, targetStatus: TaskStatus.Done, progressCount: 1 }).allowed).toBe(true)
  })
})
