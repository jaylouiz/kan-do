/**
 * Guard for #222: every persisted store must be listed in PERSISTED_KEYS, otherwise it would silently
 * stay in localStorage on desktop and be lost to the data folder (and to the user's sync).
 */
import { describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia, type Store } from 'pinia'
import { PERSISTED_KEYS } from '~/lib/dataStorage'

const modules = import.meta.glob('../../store/*.ts', { eager: true }) as Record<string, Record<string, unknown>>

describe('persisted store keys', () => {
  it('lists every key a store persists under, and nothing else', () => {
    const keys = new Set<string>()
    const pinia = createPinia()
    pinia.use(({ options, store }) => {
      const persist = (options as { persist?: unknown }).persist as boolean | { key?: unknown } | Array<{ key?: unknown }> | undefined
      if (!persist) return
      for (const entry of Array.isArray(persist) ? persist : [persist]) {
        const key = typeof entry === 'object' && typeof entry.key === 'string' ? entry.key : store.$id
        keys.add(key)
      }
    })
    // Plugins only run once pinia is installed into an app.
    createApp({}).use(pinia)
    setActivePinia(pinia)

    let stores = 0
    for (const exports of Object.values(modules)) {
      for (const [name, value] of Object.entries(exports)) {
        if (/^use\w+Store$/.test(name) && typeof value === 'function') {
          ;(value as () => Store)()
          stores += 1
        }
      }
    }

    expect(stores).toBeGreaterThanOrEqual(6)
    expect([...keys].sort()).toEqual([...PERSISTED_KEYS].sort())
  })
})
