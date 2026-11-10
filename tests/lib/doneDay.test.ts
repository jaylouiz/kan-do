/** kd#131: the days a done task may be moved to, and the completion time stored for a chosen day. */
import { describe, expect, it } from 'vitest'
import { completedAtForDay, doneDayBounds } from '~/lib/doneDay'

const NOW = new Date(2026, 10, 10, 9, 30, 0, 0) // Tue 10 Nov 2026, 09:30
const CREATED = new Date(2026, 10, 6, 14, 0, 0, 0) // Fri 6 Nov, 14:00

describe('doneDayBounds', () => {
  it('runs from the creation day to today', () => {
    expect(doneDayBounds({ createdAt: CREATED }, NOW)).toEqual({ min: '2026-11-06', max: '2026-11-10' })
  })

  it('has no lower limit without a creation time', () => {
    expect(doneDayBounds({ createdAt: null }, NOW).min).toBeNull()
    expect(doneDayBounds({}, NOW).min).toBeNull()
  })

  it('a creation time ahead of the clock leaves today selectable', () => {
    expect(doneDayBounds({ createdAt: new Date(2026, 10, 12) }, NOW)).toEqual({ min: '2026-11-10', max: '2026-11-10' })
  })
})

describe('completedAtForDay', () => {
  const task = { createdAt: CREATED, completedAt: new Date(2026, 10, 10, 8, 15, 20, 0) }

  it('keeps the time of day of the completion on the chosen day', () => {
    expect(completedAtForDay(task, '2026-11-09', NOW)).toEqual(new Date(2026, 10, 9, 8, 15, 20, 0))
  })

  it('refuses a future day, a day before the creation day and a malformed or impossible day', () => {
    expect(completedAtForDay(task, '2026-11-11', NOW)).toBeNull()
    expect(completedAtForDay(task, '2026-11-05', NOW)).toBeNull()
    expect(completedAtForDay(task, '9.11.2026', NOW)).toBeNull()
    expect(completedAtForDay({ createdAt: null, completedAt: task.completedAt }, '2026-02-31', NOW)).toBeNull()
  })

  it('never lands ahead of the clock: back on today, a later time of day becomes now', () => {
    const lateYesterday = { createdAt: CREATED, completedAt: new Date(2026, 10, 9, 23, 0, 0, 0) }
    expect(completedAtForDay(lateYesterday, '2026-11-10', NOW)).toEqual(NOW)
  })

  it('never lands before the task was created: on the creation day, an earlier time of day becomes the creation time', () => {
    expect(completedAtForDay(task, '2026-11-06', NOW)).toEqual(CREATED)
  })

  it('accepts any past day for a task without a creation time', () => {
    expect(completedAtForDay({ createdAt: null, completedAt: task.completedAt }, '2026-10-01', NOW)).toEqual(new Date(2026, 9, 1, 8, 15, 20, 0))
  })

  it('takes now as the time of day when the task has no completion time yet', () => {
    expect(completedAtForDay({ createdAt: CREATED, completedAt: null }, '2026-11-09', NOW)).toEqual(new Date(2026, 10, 9, 9, 30, 0, 0))
  })

  it('reads stored ISO strings', () => {
    const stored = { createdAt: CREATED.toISOString(), completedAt: task.completedAt.toISOString() } as unknown as typeof task
    expect(completedAtForDay(stored, '2026-11-09', NOW)).toEqual(new Date(2026, 10, 9, 8, 15, 20, 0))
  })
})
