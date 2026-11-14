import { describe, it, expect } from 'vitest'
import {
  DAY_MINUTES,
  capacityLineAfter,
  learnedDayMinutes,
  plannedMinutes,
  remainingDayMinutes,
  taskMinutes,
  workedTodayMinutes,
} from '~/lib/dayCapacity'
import type { WorkSession } from '~/lib/workSessions'

// Tuesday 3 Nov 2026, 18:00 local
const NOW = new Date(2026, 10, 3, 18, 0, 0)
const at = (daysAgo: number, hour: number, minute = 0) => new Date(2026, 10, 3 - daysAgo, hour, minute).getTime()
const span = (daysAgo: number, from: number, to: number): WorkSession => ({ start: at(daysAgo, from), end: at(daysAgo, to) })

/** One session of `hours` hours (from 8:00) on each of the last `n` days before today. */
const daysOf = (n: number, hours: number): WorkSession[] =>
  Array.from({ length: n }, (_, i) => span(i + 1, 8, 8 + hours))

describe('taskMinutes', () => {
  it('uses the time box minus the time already spent', () => {
    expect(taskMinutes({ timeBoxSeconds: 3600, timeSpentSeconds: 1200 })).toBe(40)
  })
  it('never goes below zero when the box is overrun', () => {
    expect(taskMinutes({ timeBoxSeconds: 600, timeSpentSeconds: 1800 })).toBe(0)
  })
  it('counts a card without a box as 30 minutes, whatever time it has spent', () => {
    expect(taskMinutes({ timeBoxSeconds: null, timeSpentSeconds: 0 })).toBe(30)
    expect(taskMinutes({ timeBoxSeconds: 0, timeSpentSeconds: 900 })).toBe(30)
  })
})

describe('plannedMinutes', () => {
  it('sums the cards', () => {
    expect(plannedMinutes([{ timeBoxSeconds: 3600, timeSpentSeconds: 0 }, { timeBoxSeconds: null, timeSpentSeconds: 0 }])).toBe(90)
    expect(plannedMinutes([])).toBe(0)
  })
})

describe('workedTodayMinutes', () => {
  it('counts the session time of today only', () => {
    const sessions = [span(1, 9, 12), span(0, 9, 10), { start: at(0, 14), end: at(0, 14, 30) }]
    expect(workedTodayMinutes(sessions, NOW)).toBe(90)
  })
  it('clips a session that runs up to now and ignores one that crosses midnight from yesterday', () => {
    expect(workedTodayMinutes([{ start: at(0, 17), end: at(0, 19) }], NOW)).toBe(60)
    expect(workedTodayMinutes([{ start: at(1, 23), end: at(0, 1) }], NOW)).toBe(60)
  })
  it('reads anything that is not a usable list as nothing', () => {
    for (const wrong of [null, undefined, 'x', 3, {}, [null, { start: 'a', end: 1 }]]) expect(workedTodayMinutes(wrong, NOW)).toBe(0)
  })
})

describe('learnedDayMinutes', () => {
  it('falls back to the default without enough days', () => {
    expect(learnedDayMinutes([], NOW)).toBe(DAY_MINUTES.fallback)
    expect(learnedDayMinutes(daysOf(4, 4), NOW)).toBe(DAY_MINUTES.fallback)
  })
  it('averages the tracked minutes per day from five days on', () => {
    expect(learnedDayMinutes(daysOf(5, 4), NOW)).toBe(240)
    const mixed = [...daysOf(3, 3), ...[4, 5, 6].map(ago => span(ago, 8, 13))]
    expect(learnedDayMinutes(mixed, NOW)).toBe(240)
  })
  it('leaves today out, so a half day does not pull the average down', () => {
    expect(learnedDayMinutes([...daysOf(5, 4), span(0, 9, 10)], NOW)).toBe(240)
  })
  it('clamps to 2 and 10 hours', () => {
    expect(learnedDayMinutes(daysOf(6, 1), NOW)).toBe(DAY_MINUTES.min)
    expect(learnedDayMinutes(daysOf(6, 12), NOW)).toBe(DAY_MINUTES.max)
  })
  it('reads malformed sessions as no history', () => {
    expect(learnedDayMinutes('x', NOW)).toBe(DAY_MINUTES.fallback)
    expect(learnedDayMinutes([null, { start: 5, end: 1 }, ...daysOf(2, 4)], NOW)).toBe(DAY_MINUTES.fallback)
  })
})

describe('remainingDayMinutes', () => {
  it('is the learned day minus today\'s tracked work, never below zero', () => {
    expect(remainingDayMinutes(daysOf(5, 4), NOW)).toBe(240)
    expect(remainingDayMinutes([...daysOf(5, 4), span(0, 9, 11)], NOW)).toBe(120)
    expect(remainingDayMinutes([...daysOf(5, 4), span(0, 6, 17)], NOW)).toBe(0)
  })
})

const card = (id: string, minutes: number | null) => ({ kind: 'card' as const, key: id, task: { id, timeBoxSeconds: minutes === null ? null : minutes * 60, timeSpentSeconds: 0 } })
const stack = (key: string, ...minutes: number[]) => ({
  kind: 'stack' as const,
  key,
  tasks: minutes.map((m, i) => ({ id: `${key}-${i}`, timeBoxSeconds: m * 60, timeSpentSeconds: 0 })),
})
const gap = { kind: 'gap' as const, key: 'gap-x' }
const header = { kind: 'stack-header' as const, key: 'stack-header:g' }

describe('capacityLineAfter', () => {
  const run = (items: Parameters<typeof capacityLineAfter>[0], used: number, capacity: number) =>
    capacityLineAfter(items, { usedMinutes: used, capacityMinutes: capacity })

  it('is null for an empty list or when everything fits', () => {
    expect(run([], 0, 360)).toBeNull()
    expect(run([card('a', 60), card('b', 60)], 0, 360)).toBeNull()
  })
  it('sits after the card that reaches the capacity exactly, not only after an overflowing one', () => {
    expect(run([card('a', 60), card('b', 60), card('c', 60)], 0, 120)).toBe('b')
  })
  it('sits after the card that overflows', () => {
    expect(run([card('a', 60), card('b', 90), card('c', 30)], 0, 120)).toBe('b')
  })
  it('counts Jetzt and Wartet first', () => {
    expect(run([card('a', 60), card('b', 60)], 90, 150)).toBe('a')
  })
  it('puts the line after the last card when it is the one that fills the day', () => {
    expect(run([card('a', 60), card('b', 60)], 0, 120)).toBe('b')
  })
  it('sits after the first card when Jetzt and Wartet already fill the day', () => {
    expect(run([card('a', 10), card('b', 10)], 200, 120)).toBe('a')
  })
  it('counts an unboxed card as 30 minutes', () => {
    expect(run([card('a', null), card('b', null), card('c', null)], 0, 60)).toBe('b')
  })
  it('counts a collapsed stack as a whole and puts the line after it', () => {
    expect(run([card('a', 30), stack('s', 30, 30, 30), card('b', 30)], 0, 90)).toBe('s')
  })
  it('puts the line between members of an expanded stack', () => {
    const m1 = card('m1', 60)
    const m2 = card('m2', 60)
    expect(run([header, m1, m2, card('b', 60)], 0, 100)).toBe('m2')
  })
  it('skips items without cards (gaps, stack headers)', () => {
    expect(run([gap, header, card('a', 120)], 0, 60)).toBe('a')
  })
  it('is a no-op when the day has no capacity left and there is nothing in Offen', () => {
    expect(run([], 500, 0)).toBeNull()
  })
  it('moves when the order changes', () => {
    const a = card('a', 120)
    const b = card('b', 30)
    const c = card('c', 30)
    expect(run([a, b, c], 0, 120)).toBe('a')
    expect(run([b, c, a], 0, 120)).toBe('a')
    expect(run([b, a, c], 0, 120)).toBe('a')
    expect(run([b, c, a], 0, 60)).toBe('c')
  })
})
