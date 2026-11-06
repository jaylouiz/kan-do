/**
 * #600: stored `taskStatistics` from before work sessions existed still loads, a malformed stored list never reaches
 * the page, and hydrating writes nothing (#273).
 */
import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { useTaskStatisticsStore } from '~/store/taskStatistics'

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

describe('taskStatistics.workSessions hydration (#600)', () => {
  it('loads state saved before work sessions existed as [] and writes nothing', () => {
    const { store, writes } = hydrate({ completionRecords: [], dayEndInFlight: { '2026-11-03': 2 } })
    expect(store.workSessions).toEqual([])
    expect(writes).toEqual([])
  })

  it('keeps stored sessions', () => {
    const { store } = hydrate({ completionRecords: [], workSessions: [{ start: 1, end: 2 }] })
    expect(store.workSessions).toEqual([{ start: 1, end: 2 }])
  })

  it.each([['null', null], ['a string', 'x'], ['a number', 7], ['an object', { start: 1, end: 2 }]])('coerces %s to []', (_name, wrong) => {
    const { store, writes } = hydrate({ completionRecords: [], workSessions: wrong })
    expect(store.workSessions).toEqual([])
    expect(writes).toEqual([])
    expect(() => store.openWorkSession(1000)).not.toThrow()
  })

  it('drops malformed entries and keeps the valid ones', () => {
    const { store } = hydrate({ completionRecords: [], workSessions: [null, { start: 9, end: 1 }, { start: 1, end: 2 }, 'x'] })
    expect(store.workSessions).toEqual([{ start: 1, end: 2 }])
  })

  it('opens, extends and clears sessions', () => {
    const { store } = hydrate({ completionRecords: [] })
    const start = store.openWorkSession(1_000)
    store.extendWorkSession(start, 61_000)
    expect(store.workSessions).toEqual([{ start: 1_000, end: 61_000 }])
    expect(store.openWorkSession(100_000)).toBe(1_000)
    store.clearAllRecords()
    expect(store.workSessions).toEqual([])
  })
})
