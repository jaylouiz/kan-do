import { describe, it, expect, beforeEach } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { useTopicStylesStore } from '~/store/topicStyles'

function freshPinia() {
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: localStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

describe('topicStyles store (#431)', () => {
  beforeEach(() => {
    localStorage.clear()
    freshPinia()
  })

  it('sets, patches and clears a style; an entry with neither field is removed', () => {
    const store = useTopicStylesStore()
    store.setStyle('Work', { hue: 'blue' })
    expect(store.styleOf('Work')).toEqual({ hue: 'blue', symbol: null })
    store.setStyle('Work', { symbol: 'briefcase' })
    expect(store.styleOf(' Work ')).toEqual({ hue: 'blue', symbol: 'briefcase' })
    store.setStyle('Work', { hue: null })
    expect(store.styleOf('Work')).toEqual({ hue: null, symbol: 'briefcase' })
    store.setStyle('Work', { symbol: null })
    expect(store.styles).toEqual({})
  })

  it('moves the style on a rename and keeps the target on a merge', () => {
    const store = useTopicStylesStore()
    store.setStyle('Wrk', { hue: 'red', symbol: 'flag' })
    store.renameStyle('Wrk', 'Work', false)
    expect(store.styles).toEqual({ Work: { hue: 'red', symbol: 'flag' } })

    store.setStyle('Other', { hue: 'green' })
    store.renameStyle('Other', 'Work', true)
    expect(store.styleOf('Work')).toEqual({ hue: 'red', symbol: 'flag' })
    expect(store.styles).toEqual({ Work: { hue: 'red', symbol: 'flag' } })
  })

  it('a merge onto a target without a style leaves the target unstyled and drops the source entry', () => {
    const store = useTopicStylesStore()
    store.setStyle('A', { hue: 'red', symbol: 'rocket' })
    store.renameStyle('A', 'B', true)
    expect(store.styleOf('B')).toEqual({ hue: null, symbol: null })
    expect(store.styles).toEqual({})
  })

  it('a plain rename overwrites a stale entry the new name still has', () => {
    const store = useTopicStylesStore()
    store.setStyle('Home', { hue: 'green', symbol: 'house' })
    store.setStyle('Work', { hue: 'red', symbol: 'briefcase' })
    store.renameStyle('Work', 'Home', false)
    expect(store.styles).toEqual({ Home: { hue: 'red', symbol: 'briefcase' } })
  })

  it('topic names that are Object.prototype members are plain names, not entries', () => {
    const store = useTopicStylesStore()
    for (const name of ['constructor', 'toString', 'hasOwnProperty']) {
      expect(store.styleOf(name)).toEqual({ hue: null, symbol: null })
      store.renameStyle(name, 'X', false)
      expect(store.styles).toEqual({})
    }
    store.setStyle('Work', { hue: 'red' })
    store.renameStyle('Work', 'constructor', false)
    expect(store.styleOf('constructor')).toEqual({ hue: 'red', symbol: null })
    expect(store.styleOf('Work')).toEqual({ hue: null, symbol: null })
  })

  it('a topic named __proto__ is stored as an own entry and a reload does not pollute the prototype', async () => {
    const store = useTopicStylesStore()
    store.setStyle('__proto__', { hue: 'blue', symbol: 'flag' })
    expect(Object.keys(store.styles)).toEqual(['__proto__'])
    expect(store.styleOf('__proto__')).toEqual({ hue: 'blue', symbol: 'flag' })
    expect(store.styleOf('hue')).toEqual({ hue: null, symbol: null })
    await nextTick()
    freshPinia()
    expect(useTopicStylesStore().styleOf('Work')).toEqual({ hue: null, symbol: null })
    expect(({} as Record<string, unknown>).hue).toBeUndefined()
    store.setStyle('__proto__', { hue: null, symbol: null })
    expect(Object.keys(store.styles)).toEqual([])
  })

  it('rename A -> B -> A returns the style to A', () => {
    const store = useTopicStylesStore()
    store.setStyle('A', { hue: 'pink' })
    store.renameStyle('A', 'B', false)
    store.renameStyle('B', 'A', false)
    expect(store.styles).toEqual({ A: { hue: 'pink', symbol: null } })
  })

  it('persists under topic-styles and survives a new pinia (a reload)', async () => {
    const store = useTopicStylesStore()
    store.setStyle('Work', { hue: 'blue', symbol: 'code' })
    await nextTick()
    expect(JSON.parse(localStorage.getItem('topic-styles') ?? 'null')).toEqual({ styles: { Work: { hue: 'blue', symbol: 'code' } } })

    freshPinia()
    expect(useTopicStylesStore().styleOf('Work')).toEqual({ hue: 'blue', symbol: 'code' })
  })

  it('hydrates empty without a stored key and writes nothing', async () => {
    const store = useTopicStylesStore()
    await nextTick()
    expect(store.styles).toEqual({})
    expect(localStorage.getItem('topic-styles')).toBeNull()
  })

  it('reads an unknown hue or symbol as none and leaves the stored value untouched', async () => {
    const raw = JSON.stringify({ styles: { Work: { hue: 'teal', symbol: 'unicorn' }, Home: { hue: 'red', symbol: 'unicorn' } } })
    localStorage.setItem('topic-styles', raw)
    freshPinia()
    const store = useTopicStylesStore()
    await nextTick()
    expect(store.styleOf('Work')).toEqual({ hue: null, symbol: null })
    expect(store.styleOf('Home')).toEqual({ hue: 'red', symbol: null })
    expect(localStorage.getItem('topic-styles')).toBe(raw)
  })

  it('survives garbage state: a non-record styles value reads as empty and is replaced on the first edit', () => {
    for (const garbage of [null, [], 'x', 4]) {
      localStorage.setItem('topic-styles', JSON.stringify({ styles: garbage }))
      freshPinia()
      const store = useTopicStylesStore()
      expect(store.styleOf('Work')).toEqual({ hue: null, symbol: null })
      store.setStyle('Work', { hue: 'gray' })
      expect(store.styleOf('Work')).toEqual({ hue: 'gray', symbol: null })
    }
  })
})
