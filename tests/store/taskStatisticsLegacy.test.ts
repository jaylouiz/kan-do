/**
 * #537: stored `taskStatistics` from before the day-end counts and discarded time existed still loads, a malformed
 * stored field never reaches the page, and hydrating writes nothing (#273).
 */
import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { deriveReview, deriveUnfinishedTime } from '~/lib/statisticsReview'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

function hydrate(stored: unknown) {
  const writes: string[] = []
  const storage = {
    getItem: (key: string) => (key === 'taskStatistics' ? JSON.stringify(stored) : null),
    setItem: (key: string) => { writes.push(key) },
    removeItem: () => {},
  }
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { store: useTaskStatisticsStore(), writes }
}

describe('taskStatistics hydration (#537)', () => {
  it('loads stored state without the new fields as {} and []', () => {
    const { store, writes } = hydrate({ completionRecords: [] })
    expect(store.dayEndInFlight).toEqual({})
    expect(store.discardedTime).toEqual([])
    expect(writes).toEqual([])
  })

  it('keeps stored values of the new fields', () => {
    const { store } = hydrate({
      completionRecords: [],
      dayEndInFlight: { '2026-11-03': 4 },
      discardedTime: [{ taskId: 'a', deletedAt: 5, seconds: 60 }],
    })
    expect(store.dayEndInFlight).toEqual({ '2026-11-03': 4 })
    expect(store.discardedTime).toHaveLength(1)
  })
  // A present but wrongly shaped field (hand-edited or imported data file) must not throw in a reader or action.
  const WRONG_SHAPES: Array<[string, unknown, unknown]> = [
    ['null', null, null],
    ['a string', 'x', 'x'],
    ['a number', 7, 7],
    ['an array for the object / an object for the array', [1, 2], { a: 1 }],
  ]
  it.each(WRONG_SHAPES)('coerces %s in both fields to the defaults and keeps the app working', (_name, forMap, forList) => {
    const { store, writes } = hydrate({ completionRecords: [], dayEndInFlight: forMap, discardedTime: forList })
    expect(store.dayEndInFlight).toEqual({})
    expect(store.discardedTime).toEqual([])
    expect(writes).toEqual([])
    const task = { id: 't1', status: TaskStatus.Open, timeSpentSeconds: 60 } as Task
    expect(() => store.recordDiscardedTime(task)).not.toThrow()
    expect(() => store.recordDayEnd('2026-11-03', 3)).not.toThrow()
    expect(() => store.removeDiscardedTime('t1')).not.toThrow()
    expect(() => deriveReview([], new Date(2026, 10, 3), store.dayEndInFlight)).not.toThrow()
    expect(() => deriveUnfinishedTime([], [], store.discardedTime, new Date(2026, 10, 3))).not.toThrow()
  })

  it('drops non-object entries of a stored discardedTime list and keeps the valid ones', () => {
    const { store } = hydrate({
      completionRecords: [],
      discardedTime: [null, 'x', 4, { taskId: 'a', deletedAt: 5, seconds: 60 }],
    })
    expect(store.discardedTime).toEqual([{ taskId: 'a', deletedAt: 5, seconds: 60 }])
    expect(() => store.recordDiscardedTime({ id: 'b', status: TaskStatus.Open, timeSpentSeconds: 30 } as Task)).not.toThrow()
  })
})
