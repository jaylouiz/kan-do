/**
 * The topic focus of the board (#161): persisted in `board-store` as `{ topic, day }`, ends with its local day,
 * hydrates tolerantly from older data and never writes on hydration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { sanitizeFocus, useBoardStore } from '~/store/board'
import { dayKey } from '~/utils/recapDay'

const today = () => dayKey(new Date())
const yesterday = () => dayKey(new Date(Date.now() - 86_400_000 - 3_600_000))

function hydrate(stored: unknown) {
  if (stored !== undefined) localStorage.setItem('board-store', JSON.stringify(stored))
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: localStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useBoardStore()
}

describe('board focus (#161)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('setFocus focuses on a topic for today, clearFocus ends it', () => {
    const store = hydrate(undefined)
    expect(store.activeFocusTopic).toBeNull()
    store.setFocus('Baustelle Müller')
    expect(store.activeFocusTopic).toBe('Baustelle Müller')
    expect(store.focus).toEqual({ topic: 'Baustelle Müller', day: today() })
    store.clearFocus()
    expect(store.activeFocusTopic).toBeNull()
  })

  it('a focus of an earlier day is no focus', () => {
    const store = hydrate({ focus: { topic: 'Alt', day: yesterday() } })
    expect(store.activeFocusTopic).toBeNull()
  })

  it('a focus of today survives a reload', () => {
    const store = hydrate({ focus: { topic: 'Heute', day: today() } })
    expect(store.activeFocusTopic).toBe('Heute')
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['a string', 'Design'],
    ['without a day', { topic: 'Design' }],
    ['a malformed day', { topic: 'Design', day: 'gestern' }],
    ['an empty topic', { topic: ' ', day: '2026-01-01' }],
    ['a wrong topic type', { topic: 3, day: '2026-01-01' }],
  ])('%s hydrates to no focus without throwing', (_label, focus) => {
    const store = hydrate(focus === undefined ? { boardConfig: { sources: { connected: [], default: 'local' } } } : { focus })
    expect(store.focus).toBeNull()
    expect(store.activeFocusTopic).toBeNull()
  })

  it('hydration alone writes nothing back', () => {
    localStorage.setItem('board-store', JSON.stringify({ focus: { topic: 'Alt', day: yesterday() }, boardConfig: { sources: { connected: [], default: 'local' } } }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    hydrate(undefined)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('a rename or merge carries the focus, an unrelated one leaves it', () => {
    const store = hydrate(undefined)
    store.setFocus('Design')
    store.renameFocusTopic('Other', 'Else')
    expect(store.activeFocusTopic).toBe('Design')
    store.renameFocusTopic('Design', 'Entwurf')
    expect(store.activeFocusTopic).toBe('Entwurf')
  })

  it('sanitizeFocus keeps a well-formed focus', () => {
    expect(sanitizeFocus({ topic: 'A', day: '2026-11-12' })).toEqual({ topic: 'A', day: '2026-11-12' })
  })
})
