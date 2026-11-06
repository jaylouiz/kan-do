import { describe, it, expect } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { TrashEntry } from '~/types/trash'
import { TRASH_MAX_ENTRIES, TRASH_RETENTION_DAYS, groupTrashByDay, pruneTrash, trashAgo, trashDayGroup } from '~/lib/trash'

const DAY = 86_400_000
const NOW = new Date(2026, 9, 31, 15, 0, 0).getTime()

const entry = (id: string, deletedAt: number): TrashEntry => ({
  taskId: id,
  deletedAt,
  fromStatus: TaskStatus.Open,
  carryOver: null,
  task: { id, source: 'local', externalId: null, title: id, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null } as Task,
})

describe('pruneTrash (#422, D3)', () => {
  it('keeps the input array when nothing is purged and the order is newest first', () => {
    const entries = [entry('a', NOW - 1000), entry('b', NOW - 2000)]
    expect(pruneTrash(entries, NOW)).toBe(entries)
  })

  it('drops entries older than 30 days and keeps one just inside', () => {
    const inside = entry('in', NOW - (TRASH_RETENTION_DAYS * DAY - 1000))
    const outside = entry('out', NOW - (TRASH_RETENTION_DAYS * DAY + 1000))
    expect(pruneTrash([inside, outside], NOW).map(e => e.taskId)).toEqual(['in'])
  })

  it('caps at 100 entries, keeping the newest, and sorts a hand-edited order', () => {
    const entries = Array.from({ length: TRASH_MAX_ENTRIES + 5 }, (_, i) => entry(`t${i}`, NOW - i * 1000)).reverse()
    const pruned = pruneTrash(entries, NOW)
    expect(pruned).toHaveLength(TRASH_MAX_ENTRIES)
    expect(pruned[0]?.taskId).toBe('t0')
    expect(pruned.at(-1)?.taskId).toBe(`t${TRASH_MAX_ENTRIES - 1}`)
  })

  it('drops an entry without a usable deletedAt', () => {
    expect(pruneTrash([entry('x', Number.NaN)], NOW)).toEqual([])
  })
})

describe('grouping and age', () => {
  it('buckets by local calendar day: Heute, Gestern, Früher', () => {
    const startOfToday = new Date(NOW).setHours(0, 0, 0, 0)
    expect(trashDayGroup(startOfToday, NOW)).toBe('today')
    expect(trashDayGroup(startOfToday - 1, NOW)).toBe('yesterday')
    expect(trashDayGroup(startOfToday - DAY, NOW)).toBe('yesterday')
    expect(trashDayGroup(startOfToday - DAY - 1, NOW)).toBe('earlier')
  })

  it('returns only non-empty groups in display order', () => {
    const groups = groupTrashByDay([entry('a', NOW - 1000), entry('c', NOW - 5 * DAY)], NOW)
    expect(groups.map(g => [g.group, g.entries.map(e => e.taskId)])).toEqual([['today', ['a']], ['earlier', ['c']]])
  })

  it('rounds the age down to minutes, hours or days', () => {
    expect(trashAgo(NOW - 30_000, NOW)).toEqual({ unit: 'now' })
    expect(trashAgo(NOW - 12 * 60_000, NOW)).toEqual({ unit: 'minutes', n: 12 })
    expect(trashAgo(NOW - 3 * 3_600_000 - 5000, NOW)).toEqual({ unit: 'hours', n: 3 })
    expect(trashAgo(NOW - 2 * DAY - 5000, NOW)).toEqual({ unit: 'days', n: 2 })
  })
})
