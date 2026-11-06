import { describe, it, expect } from 'vitest'
import {
  WORK_SESSION_MERGE_GAP_MS,
  WORK_SESSION_MIN_MS,
  cleanWorkSessions,
  extendSession,
  isWorkSession,
  openSession,
} from '~/lib/workSessions'

const MIN = 60_000
const RETENTION = 120 * 86_400_000

describe('workSessions (#600)', () => {
  it('isWorkSession accepts only finite spans with end >= start', () => {
    expect(isWorkSession({ start: 1, end: 1 })).toBe(true)
    expect(isWorkSession({ start: 2, end: 1 })).toBe(false)
    expect(isWorkSession({ start: Number.NaN, end: 1 })).toBe(false)
    expect(isWorkSession({ start: '1', end: 2 })).toBe(false)
    expect(isWorkSession(null)).toBe(false)
    expect(isWorkSession([1, 2])).toBe(false)
  })

  it('cleanWorkSessions keeps the usable entries and reads anything else as empty', () => {
    expect(cleanWorkSessions([null, { start: 1, end: 2 }, 'x', { start: 5, end: 1 }])).toEqual([{ start: 1, end: 2 }])
    for (const wrong of [null, undefined, 'x', 7, { start: 1, end: 2 }]) expect(cleanWorkSessions(wrong)).toEqual([])
  })

  it('openSession starts a session when there is none', () => {
    expect(openSession([], 1000, RETENTION)).toEqual({ sessions: [{ start: 1000, end: 1000 }], start: 1000 })
  })

  it('continues the previous session when it ended less than the merge gap ago', () => {
    const last = { start: 0, end: 10 * MIN }
    const result = openSession([last], 10 * MIN + WORK_SESSION_MERGE_GAP_MS, RETENTION)
    expect(result.start).toBe(0)
    expect(result.sessions).toEqual([{ start: 0, end: 10 * MIN + WORK_SESSION_MERGE_GAP_MS }])
  })

  it('starts a new session after a longer gap, and drops a too-short last one that was never continued', () => {
    const slip = { start: 0, end: WORK_SESSION_MIN_MS - 1 }
    const result = openSession([slip], WORK_SESSION_MERGE_GAP_MS + WORK_SESSION_MIN_MS, RETENTION)
    expect(result.sessions).toEqual([{ start: result.start, end: result.start }])

    const real = { start: 0, end: 10 * MIN }
    const next = openSession([real], 20 * MIN, RETENTION)
    expect(next.sessions).toEqual([real, { start: 20 * MIN, end: 20 * MIN }])
  })

  it('prunes entries older than the retention when a new session starts', () => {
    const old = { start: 0, end: 10 * MIN }
    const at = RETENTION + 20 * MIN
    expect(openSession([old], at, RETENTION).sessions).toEqual([{ start: at, end: at }])
  })

  it('extendSession moves the end of the named session forward, never back, and ignores an unknown start', () => {
    const list = [{ start: 0, end: 5 }, { start: 100, end: 100 }]
    expect(extendSession(list, 100, 160)).toEqual([{ start: 0, end: 5 }, { start: 100, end: 160 }])
    expect(extendSession(list, 100, 50)).toBe(list)
    expect(extendSession(list, 7, 500)).toBe(list)
  })
})
