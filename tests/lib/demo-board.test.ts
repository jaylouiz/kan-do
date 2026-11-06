import { describe, it, expect, afterAll } from 'vitest'
import { buildDemoBoard, DEMO_TOPIC_STYLES } from '~/lib/demo-board'
import { isDemoTaskId } from '~/lib/demoIds'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { GroupKey } from '~/types/boardGrouping'
import { groupTasksByKey, EMPTY_GROUP_KEY, deriveGroupKeyForTask } from '~/utils/taskGrouping'
import { isHue, symbolOf } from '~/lib/topicStyles'
import { localDateKey } from '~/utils/carryOver'

const NOON = new Date(2026, 10, 4, 12, 0, 0)
const startOfDay = (d: Date) => new Date(d).setHours(0, 0, 0, 0)

describe('demo board (#527)', () => {
  const board = buildDemoBoard(NOON)
  const inColumn = (status: TaskStatus) => board.tasks.filter(t => t.status === status)

  it('fills every column', () => {
    for (const status of [TaskStatus.Open, TaskStatus.Progress, TaskStatus.Waiting, TaskStatus.Done]) {
      expect(inColumn(status).length, `status ${status}`).toBeGreaterThan(0)
    }
    expect(inColumn(TaskStatus.Open).length).toBeGreaterThanOrEqual(6)
    expect(inColumn(TaskStatus.Open).length).toBeLessThanOrEqual(9)
    expect(inColumn(TaskStatus.Progress)).toHaveLength(1)
  })

  it('marks every id as a demo id and hands out one statistics record per done task (seed only)', () => {
    expect(board.tasks.every(t => isDemoTaskId(t.id))).toBe(true)
    expect(isDemoTaskId('seed-open-1')).toBe(false)
    const doneIds = inColumn(TaskStatus.Done).map(t => t.id)
    expect(board.completionRecords.map(r => r.taskId)).toEqual(doneIds)
  })

  it('has unique ids and is a Local board', () => {
    expect(new Set(board.tasks.map(t => t.id)).size).toBe(board.tasks.length)
    expect(board.tasks.every(t => t.source === 'local' && t.externalId === null)).toBe(true)
  })

  it.each<GroupKey>(['topic', 'activity', 'priority'])('Offen forms a stack (group of 2+) when grouped by %s', (key) => {
    const groups = groupTasksByKey(inColumn(TaskStatus.Open), key)
    expect([...groups.values()].some(members => members.length >= 2)).toBe(true)
  })

  it('Offen has a spread of priorities, several topics and activities, and a card without topic and activity', () => {
    const open = inColumn(TaskStatus.Open)
    expect(new Set(open.map(t => t.priority)).size).toBeGreaterThanOrEqual(3)
    expect(groupTasksByKey(open, 'topic').size).toBeGreaterThanOrEqual(3)
    expect(groupTasksByKey(open, 'activity').size).toBeGreaterThanOrEqual(2)
    const bare = open.filter(t => deriveGroupKeyForTask(t, 'topic') === EMPTY_GROUP_KEY && deriveGroupKeyForTask(t, 'activity') === EMPTY_GROUP_KEY)
    expect(bare.length).toBeGreaterThanOrEqual(1)
  })

  it('Jetzt holds one task with a timebox and some time already spent', () => {
    const [now] = inColumn(TaskStatus.Progress)
    expect(now!.timeBoxSeconds).toBeGreaterThan(0)
    expect(now!.timeSpentSeconds).toBeGreaterThan(0)
    expect(now!.timeSpentSeconds).toBeLessThan(now!.timeBoxSeconds!)
  })

  it('Wartet says what each task waits for and carries one over for days', () => {
    const waiting = inColumn(TaskStatus.Waiting)
    expect(waiting.every(t => (t.notes ?? '').length > 0)).toBe(true)
    expect(waiting.some(t => (board.carryOverByTaskId[t.id]?.days ?? 0) >= 3)).toBe(true)
  })

  it('Erledigt has tasks done today with tracked time and one done yesterday', () => {
    const done = inColumn(TaskStatus.Done)
    const today = startOfDay(NOON)
    const doneToday = done.filter(t => t.completedAt && t.completedAt.getTime() >= today)
    expect(doneToday.length).toBeGreaterThanOrEqual(3)
    expect(doneToday.every(t => t.timeSpentSeconds > 0)).toBe(true)
    expect(done.filter(t => t.completedAt && t.completedAt.getTime() < today)).toHaveLength(1)
    expect(done.every(t => t.completedAt && t.completedAt.getTime() <= NOON.getTime())).toBe(true)
  })

  it('keeps "done today" today when opened right after midnight', () => {
    const justAfterMidnight = new Date(2026, 10, 4, 0, 1, 0)
    const early = buildDemoBoard(justAfterMidnight)
    const today = startOfDay(justAfterMidnight)
    const done = early.tasks.filter(t => t.status === TaskStatus.Done)
    expect(done.filter(t => t.completedAt!.getTime() >= today).length).toBeGreaterThanOrEqual(3)
    expect(done.filter(t => t.completedAt!.getTime() < today)).toHaveLength(1)
  })

  it('mixes notes, timeboxes, priorities and creation dates, and one unplanned task', () => {
    expect(board.tasks.some(t => t.notes)).toBe(true)
    expect(board.tasks.some(t => t.timeBoxSeconds === null)).toBe(true)
    expect(board.tasks.some(t => t.timeBoxSeconds !== null)).toBe(true)
    expect(new Set(board.tasks.map(t => t.priority)).size).toBe(3)
    expect(new Set(board.tasks.map(t => t.createdAt!.getTime())).size).toBeGreaterThan(3)
    expect(board.tasks.some(t => t.isUnplanned)).toBe(true)
  })

  it('carry-over counters are counted through today, only for tasks that are not done', () => {
    const ids = new Map(board.tasks.map(t => [t.id, t]))
    for (const [id, entry] of Object.entries(board.carryOverByTaskId)) {
      expect(ids.get(id)?.status, id).not.toBe(TaskStatus.Done)
      expect(entry.lastOn).toBe(localDateKey(NOON))
    }
    expect(Object.values(board.carryOverByTaskId).some(e => e.days >= 4)).toBe(true)
  })

  it('every topic has a valid style, and every style belongs to a topic', () => {
    const topics = new Set(board.tasks.map(t => t.topic).filter((t): t is string => t !== null))
    expect([...topics].sort()).toEqual(Object.keys(DEMO_TOPIC_STYLES).sort())
    for (const style of Object.values(DEMO_TOPIC_STYLES)) {
      expect(isHue(style.hue)).toBe(true)
      expect(symbolOf(style.symbol)).toBeDefined()
    }
  })
})

describe('demo board loaded more than once (#536)', () => {
  it('hands out fresh ids per load, so nothing of the first load collides with the second', () => {
    const first = buildDemoBoard(NOON)
    const second = buildDemoBoard(NOON)
    const firstIds = new Set(first.tasks.map(t => t.id))
    expect(second.tasks.some(t => firstIds.has(t.id))).toBe(false)
    expect(first.tasks.every(t => isDemoTaskId(t.id))).toBe(true)
    expect(second.tasks.every(t => isDemoTaskId(t.id))).toBe(true)
    // carry-over counters and statistics records follow the new ids
    const secondIds = new Set(second.tasks.map(t => t.id))
    expect(Object.keys(second.carryOverByTaskId).every(id => secondIds.has(id))).toBe(true)
    expect(second.completionRecords.every(r => secondIds.has(r.taskId))).toBe(true)
  })

  it('is deterministic for a given load id', () => {
    const a = buildDemoBoard(NOON, 'fixed')
    const b = buildDemoBoard(NOON, 'fixed')
    expect(a.tasks.map(t => t.id)).toEqual(b.tasks.map(t => t.id))
    expect(a.tasks[0]!.id).toBe('demo-fixed-open-1')
  })

  it('an archived task of the first load does not hide its namesake of the second', () => {
    setActivePinia(createPinia())
    const stats = useTaskStatisticsStore()
    const first = buildDemoBoard(NOON)
    const second = buildDemoBoard(NOON)
    const archived = first.tasks.filter(t => t.status === TaskStatus.Done).map(t => t.id)
    // the backfill still ignores demo tasks, whichever load they come from
    stats.syncExistingDoneTasks(second.tasks.filter(t => t.status === TaskStatus.Done), archived)
    expect(stats.completionRecords).toHaveLength(0)
    expect(second.tasks.filter(t => archived.includes(t.id))).toHaveLength(0)
  })
})

describe('demo board dates across a DST switch (#536)', () => {
  const previousTz = process.env.TZ
  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  })

  it('fall-back switch: createdAt keeps the time of day and carry-over firstOn stays on the calendar day', () => {
    process.env.TZ = 'Europe/Berlin' // clocks go back on 2026-10-25, a 25 h day
    expect(new Date(2026, 9, 26).getTime() - new Date(2026, 9, 25).getTime()).toBe(25 * 3_600_000) // the zone really applies
    // 23:30 is where 24 h blocks cross midnight: 6 x 24 h before 2026-10-27 23:30 is 2026-10-22 00:30, one calendar day off
    const lateEvening = new Date(2026, 9, 27, 23, 30)
    const board = buildDemoBoard(lateEvening, 'dst')
    const byId = new Map(board.tasks.map(t => [t.id, t]))

    // open-8 was created 6 days ago, open-7 5 days ago: the same 23:30 on Oct 21 / 22
    expect(byId.get('demo-dst-open-8')!.createdAt).toEqual(new Date(2026, 9, 21, 23, 30))
    expect(byId.get('demo-dst-open-7')!.createdAt).toEqual(new Date(2026, 9, 22, 23, 30))
    // the carry-over count starts on the same calendar day it is counted from (waiting-3: 7 days, open-8: 6 days)
    expect(board.carryOverByTaskId['demo-dst-open-8']).toMatchObject({ firstOn: '2026-10-21', days: 6, lastOn: '2026-10-27' })
    expect(board.carryOverByTaskId['demo-dst-waiting-3']).toMatchObject({ firstOn: '2026-10-20', days: 7, lastOn: '2026-10-27' })
  })

  it('spring-forward switch: firstOn stays on the calendar day just after the 23 h day', () => {
    process.env.TZ = 'Europe/Berlin' // clocks go forward on 2026-03-29, a 23 h day
    expect(new Date(2026, 2, 30).getTime() - new Date(2026, 2, 29).getTime()).toBe(23 * 3_600_000)
    // 7 x 24 h before 2026-03-30 00:30 is 2026-03-22 23:30, one calendar day early
    const board = buildDemoBoard(new Date(2026, 2, 30, 0, 30), 'dst')
    expect(board.carryOverByTaskId['demo-dst-waiting-3']).toMatchObject({ firstOn: '2026-03-23', days: 7, lastOn: '2026-03-30' })
    expect(board.tasks.find(t => t.id === 'demo-dst-open-8')!.createdAt).toEqual(new Date(2026, 2, 24, 0, 30))
  })
})
