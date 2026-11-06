import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { mapHelpers } from '~/utils/mapHelpers'
import {
  advanceCarryOverEntry,
  carryOverDisplayDay,
  createCarryOverEntry,
  isCarryOverVisible,
  isCarryOverNudgeDue,
  localDateKey,
  CARRY_OVER_NUDGE_DAYS,
} from '~/utils/carryOver'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

function makeTask(id: string, status: TaskStatus = TaskStatus.Open, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status, activity: null, topic: null, topicColorCode: null,
    priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

describe('carryOver utils', () => {
  it('formats the local date as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })

  it('advances once per later day and never on the same or an earlier day', () => {
    const entry = createCarryOverEntry('2026-10-20')
    expect(advanceCarryOverEntry(entry, '2026-10-20').days).toBe(0)
    expect(advanceCarryOverEntry(entry, '2026-10-19').days).toBe(0)
    expect(advanceCarryOverEntry(entry, '2026-10-21')).toMatchObject({ days: 1, lastOn: '2026-10-21' })
  })

  it('nudges at the threshold and re-arms after Keep plus the threshold', () => {
    const base = createCarryOverEntry('2026-10-01')
    expect(isCarryOverNudgeDue({ ...base, days: CARRY_OVER_NUDGE_DAYS - 1 })).toBe(false)
    expect(isCarryOverNudgeDue({ ...base, days: CARRY_OVER_NUDGE_DAYS })).toBe(true)
    expect(isCarryOverNudgeDue({ ...base, days: 7, keptAtDays: 4 })).toBe(false)
    expect(isCarryOverNudgeDue({ ...base, days: 8, keptAtDays: 4 })).toBe(true)
    expect(isCarryOverNudgeDue(null)).toBe(false)
  })
})

describe('tasks store carry-over counter', () => {
  let store: ReturnType<typeof useTasksStore>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTasksStore()
  })

  const daysOf = (id: string) => mapHelpers.get(store.carryOverByTaskId, id)?.days

  it('starts existing tasks at 0 on first run, whatever createdAt/updatedAt say', () => {
    const old = new Date('2026-01-01')
    store.setTasks([makeTask('a', TaskStatus.Open, { createdAt: old, updatedAt: old })])
    store.recordCarryOver('2026-10-20')
    expect(daysOf('a')).toBe(0)
  })

  it('counts board days opened, not calendar days (a weekend off adds nothing)', () => {
    store.setTasks([makeTask('a')])
    store.recordCarryOver('2026-10-16') // Friday: first seen
    store.recordCarryOver('2026-10-16') // reopened the same day
    store.recordCarryOver('2026-10-19') // Monday: board opened again
    expect(daysOf('a')).toBe(1)
    store.recordCarryOver('2026-10-20')
    expect(daysOf('a')).toBe(2)
  })

  it('keeps the counter across Offen/Jetzt/Wartet, drops it on Done and restarts at 0 after reopening', () => {
    store.setTasks([makeTask('a')])
    store.recordCarryOver('2026-10-19')
    store.recordCarryOver('2026-10-20')
    store.updateTask('a', { status: TaskStatus.Waiting })
    store.recordCarryOver('2026-10-20')
    expect(daysOf('a')).toBe(1)

    store.updateTask('a', { status: TaskStatus.Done })
    store.recordCarryOver('2026-10-20')
    expect(mapHelpers.get(store.carryOverByTaskId, 'a')).toBeUndefined()

    store.updateTask('a', { status: TaskStatus.Open })
    store.recordCarryOver('2026-10-20')
    expect(daysOf('a')).toBe(0)
  })

  it('Keep silences the nudge without changing the count, and it returns after 4 further days', () => {
    store.setTasks([makeTask('a')])
    ;['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].forEach(d => store.recordCarryOver(d))
    expect(isCarryOverNudgeDue(mapHelpers.get(store.carryOverByTaskId, 'a'))).toBe(true)

    store.keepCarryOver('a')
    expect(daysOf('a')).toBe(4)
    expect(isCarryOverNudgeDue(mapHelpers.get(store.carryOverByTaskId, 'a'))).toBe(false)

    ;['2026-10-06', '2026-10-07', '2026-10-08'].forEach(d => store.recordCarryOver(d))
    expect(isCarryOverNudgeDue(mapHelpers.get(store.carryOverByTaskId, 'a'))).toBe(false)
    store.recordCarryOver('2026-10-09')
    expect(daysOf('a')).toBe(8)
    expect(isCarryOverNudgeDue(mapHelpers.get(store.carryOverByTaskId, 'a'))).toBe(true)
  })

  it('survives mergeTasks and prunes tasks that were not fetched', () => {
    store.setTasks([makeTask('a'), makeTask('b')])
    store.recordCarryOver('2026-10-19')
    store.recordCarryOver('2026-10-20')

    store.mergeTasks('local', [makeTask('a', TaskStatus.Open, { title: 'renamed upstream' })])

    expect(daysOf('a')).toBe(1)
    expect(mapHelpers.get(store.carryOverByTaskId, 'b')).toBeUndefined()
  })

  it('is persisted with the tasks store', async () => {
    store.setTasks([makeTask('a')])
    store.recordCarryOver('2026-10-20')
    // pinia-plugin-persistedstate is not installed in unit tests; the state is a plain Record
    expect(mapHelpers.get(JSON.parse(JSON.stringify(store.$state)).carryOverByTaskId, 'a')).toMatchObject({ days: 0, firstOn: '2026-10-20' })
  })
})

describe('useTaskCarryOver', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('shows the nudge for Offen and Jetzt but not for Wartet; display day is days + 1', async () => {
    const { useTaskCarryOver } = await import('~/composables/useCarryOver')
    const store = useTasksStore()
    store.setTasks([makeTask('a'), makeTask('w', TaskStatus.Waiting)])
    for (let day = 1; day <= 8; day++) store.recordCarryOver(`2026-10-0${day}`)

    const open = useTaskCarryOver(() => store.task('a'))
    const waiting = useTaskCarryOver(() => store.task('w'))
    expect(open.displayDay.value).toBe(8)
    expect(open.isNudgeDue.value).toBe(true)
    expect(waiting.displayDay.value).toBe(8)
    expect(waiting.isVisible.value).toBe(true)
    expect(waiting.isNudgeDue.value).toBe(false)

    open.keep()
    expect(open.isNudgeDue.value).toBe(false)
    expect(open.displayDay.value).toBe(8)
  })
})

describe('carry-over display day (#121)', () => {
  it.each([
    [0, 1, false],
    [1, 2, true],
    [3, 4, true],
    [4, 5, true],
    [6, 7, true],
  ])('stored days %i shows day %i (visible: %s)', (days, day, visible) => {
    expect(carryOverDisplayDay(days)).toBe(day)
    expect(isCarryOverVisible(carryOverDisplayDay(days))).toBe(visible)
  })

  it.each([
    [0, false],
    [1, false],
    [3, false],
    [4, true],
    [6, true],
  ])('nudge at stored days %i is due: %s (threshold unchanged, title reads day 5)', (days, due) => {
    const entry = { ...createCarryOverEntry('2026-10-01'), days }
    expect(isCarryOverNudgeDue(entry)).toBe(due)
  })
})

describe('tasks store setCarryOver (#536)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('adds counters without touching those of other tasks, and replaces a counter of the same id', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a'), makeTask('b'), makeTask('c')])
    store.carryOverByTaskId = { a: createCarryOverEntry('2026-10-01'), b: createCarryOverEntry('2026-10-02') }

    const fresh = { ...createCarryOverEntry('2026-10-05'), days: 4 }
    store.setCarryOver({ b: fresh, c: fresh })

    expect(mapHelpers.get(store.carryOverByTaskId, 'a')?.firstOn).toBe('2026-10-01')
    expect(mapHelpers.get(store.carryOverByTaskId, 'b')).toEqual(fresh)
    expect(mapHelpers.get(store.carryOverByTaskId, 'c')).toEqual(fresh)
  })
})
