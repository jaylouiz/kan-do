import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { useDayRecapStore } from '~/store/dayRecap'

function freshPinia() {
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: localStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

describe('day recap store', () => {
  beforeEach(() => {
    localStorage.clear()
    freshPinia()
  })

  it('starts with no marker and the switch on, and writes nothing at hydration', async () => {
    const store = useDayRecapStore()
    await nextTick()
    expect(store.lastShownDay).toBeNull()
    expect(store.archiveDone).toBe(true)
    expect(localStorage.getItem('day-recap-store')).toBeNull()
  })

  it('markShown only moves forward', () => {
    const store = useDayRecapStore()
    store.markShown('2026-10-22')
    expect(store.lastShownDay).toBe('2026-10-22')
    store.markShown('2026-10-20')
    store.markShown('2026-10-22')
    expect(store.lastShownDay).toBe('2026-10-22')
    store.markShown('2026-10-23')
    expect(store.lastShownDay).toBe('2026-10-23')
  })

  it('ignores a malformed key', () => {
    const store = useDayRecapStore()
    store.markShown('yesterday')
    expect(store.lastShownDay).toBeNull()
  })

  it('reads a malformed stored marker as null and replaces it on the next markShown', () => {
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: 'garbage', archiveDone: false }))
    freshPinia()
    const store = useDayRecapStore()
    expect(store.archiveDone).toBe(false)
    expect(store.validLastShownDay).toBeNull()
    store.markShown('2026-10-22')
    expect(store.lastShownDay).toBe('2026-10-22')
  })

  it('persists the marker and the switch under day-recap-store', async () => {
    const store = useDayRecapStore()
    store.markShown('2026-10-22')
    store.setArchiveDone(false)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('day-recap-store') as string)).toEqual({ lastShownDay: '2026-10-22', archiveDone: false })
  })

  it('restores both after a reload', () => {
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', archiveDone: false }))
    freshPinia()
    const store = useDayRecapStore()
    expect(store.lastShownDay).toBe('2026-10-21')
    expect(store.archiveDone).toBe(false)
  })
})
