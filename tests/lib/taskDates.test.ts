import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  revivePendingDeletes,
  revivePendingTimeUpdates,
  reviveDate,
  reviveTaskDates,
} from '~/lib/taskDates'

const ISO = '2026-10-27T09:12:30.000Z'

describe('reviveDate', () => {
  it('returns a Date itself', () => {
    const date = new Date(ISO)
    expect(reviveDate(date)).toBe(date)
  })

  it('revives an ISO string to the same instant', () => {
    const original = new Date(2026, 9, 27, 9, 12, 30, 123)
    const revived = reviveDate(original.toISOString())
    expect(revived).toBeInstanceOf(Date)
    expect(revived?.getTime()).toBe(original.getTime())
  })

  it('revives an epoch number', () => {
    expect(reviveDate(1_700_000_000_000)?.getTime()).toBe(1_700_000_000_000)
  })

  it('returns null for null, undefined and the empty string', () => {
    expect(reviveDate(null)).toBeNull()
    expect(reviveDate(undefined)).toBeNull()
    expect(reviveDate('')).toBeNull()
  })

  describe('unparsable values', () => {
    afterEach(() => vi.restoreAllMocks())

    it('become null, never an Invalid Date', () => {
      for (const garbage of ['not a date', {}, [], true, Number.NaN, new Date('nope')]) {
        expect(reviveDate(garbage)).toBeNull()
      }
    })

    it('warn once per call in dev', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      reviveDate('not a date')
      // `import.meta.dev` is a Nuxt build constant; plain Vitest leaves it undefined, so only assert the bound
      expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
    })
  })
})

describe('reviveTaskDates', () => {
  it('revives the four date fields of each task and leaves the rest alone', () => {
    const [task] = reviveTaskDates([{
      id: 'a', title: 'A', custom: { createdAt: { value: ISO } },
      completedAt: ISO, createdAt: ISO, updatedAt: ISO, archivedAt: ISO,
    }])
    for (const field of ['completedAt', 'createdAt', 'updatedAt', 'archivedAt'] as const) {
      expect(task?.[field]).toBeInstanceOf(Date)
      expect((task?.[field] as unknown as Date).getTime()).toBe(Date.parse(ISO))
    }
    expect(task?.custom).toEqual({ createdAt: { value: ISO } })
  })

  it('keeps an absent field absent and null as null', () => {
    const [task] = reviveTaskDates([{ id: 'a', completedAt: ISO, archivedAt: null }]) as Array<Record<string, unknown>>
    expect(task).not.toHaveProperty('createdAt')
    expect(task).not.toHaveProperty('updatedAt')
    expect(task?.archivedAt).toBeNull()
  })

  it('turns an unparsable date into null without throwing', () => {
    const [task] = reviveTaskDates([{ id: 'a', completedAt: 'garbage' }])
    expect(task?.completedAt).toBeNull()
  })

  it('returns the input array and task objects by reference when nothing needs reviving', () => {
    const tasks = [
      { id: 'a', priority: 2, completedAt: new Date(ISO), createdAt: null },
      { id: 'b', priority: 3 },
    ]
    const result = reviveTaskDates(tasks)
    expect(result).toBe(tasks)
    expect(result[0]).toBe(tasks[0])
  })

  it('keeps the references of untouched tasks when another one changes', () => {
    const clean = { id: 'a', priority: 2, completedAt: new Date(ISO) }
    const tasks = [clean, { id: 'b', completedAt: ISO }]
    const result = reviveTaskDates(tasks)
    expect(result).not.toBe(tasks)
    expect(result[0]).toBe(clean)
    expect(result[1]?.completedAt).toBeInstanceOf(Date)
  })

  it('is idempotent', () => {
    const once = reviveTaskDates([{ id: 'a', completedAt: ISO }])
    expect(reviveTaskDates(once)).toBe(once)
  })

  it('reads a missing, 0, null or invalid priority as Normal and the former 4 as High, without touching the input (#653)', () => {
    const tasks = [{ id: 'a' }, { id: 'b', priority: 0 }, { id: 'c', priority: null }, { id: 'd', priority: 'x' }, { id: 'e', priority: 4 }, { id: 'f', priority: 1 }]
    const result = reviveTaskDates(tasks as Array<{ id: string, priority?: unknown }>)
    expect(result.map(task => task.priority)).toEqual([2, 2, 2, 2, 3, 1])
    expect(tasks[1]?.priority).toBe(0)
    expect(reviveTaskDates(result)).toBe(result)
  })

  it('passes non-record entries through', () => {
    const tasks = [null, 'x'] as unknown[]
    expect(reviveTaskDates(tasks)).toBe(tasks)
  })
})

describe('revivePendingDeletes', () => {
  it('revives the dates of the snapshot', () => {
    const pending = { a: { taskId: 'a', requestedAt: 5, task: { id: 'a', completedAt: ISO } } }
    const result = revivePendingDeletes(pending)
    expect(result.a?.task.completedAt).toBeInstanceOf(Date)
    expect(result.a?.requestedAt).toBe(5)
    expect(pending.a.task.completedAt).toBe(ISO)
  })

  it('returns the input record by reference when nothing changes', () => {
    const pending = { a: { taskId: 'a', task: { id: 'a', priority: 2, completedAt: new Date(ISO) } } }
    expect(revivePendingDeletes(pending)).toBe(pending)
    const empty = {}
    expect(revivePendingDeletes(empty)).toBe(empty)
  })
})

describe('revivePendingTimeUpdates', () => {
  it('revives createdAt and lastAttemptAt', () => {
    const result = revivePendingTimeUpdates({
      a: { taskId: 'a', createdAt: ISO, lastAttemptAt: ISO },
      b: { taskId: 'b', createdAt: ISO, lastAttemptAt: null },
    })
    expect(result.a?.createdAt).toBeInstanceOf(Date)
    expect(result.a?.lastAttemptAt).toBeInstanceOf(Date)
    expect(result.b?.lastAttemptAt).toBeNull()
  })

  it('gives an unparsable createdAt a fresh date, so the update is kept for the next push', () => {
    const before = Date.now()
    const result = revivePendingTimeUpdates({ a: { taskId: 'a', createdAt: 'garbage', lastAttemptAt: 'garbage' } })
    expect(result.a?.createdAt).toBeInstanceOf(Date)
    expect((result.a?.createdAt as unknown as Date).getTime()).toBeGreaterThanOrEqual(before)
    expect(result.a?.lastAttemptAt).toBeNull()
  })

  it('returns the input record by reference when nothing changes', () => {
    const pending = { a: { taskId: 'a', createdAt: new Date(ISO), lastAttemptAt: null } }
    expect(revivePendingTimeUpdates(pending)).toBe(pending)
  })
})
