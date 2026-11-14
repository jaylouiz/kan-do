/**
 * #306: the working-hours setting is an additive field of `settings-store`. Stored state from before it hydrates to
 * automatic (null), a malformed value reads as automatic, hydrating writes nothing (#273), the setter persists.
 */
import { describe, it, expect, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { useSettingsStore } from '~/store/settings'

function hydrate(stored: unknown, backing: Record<string, string> = {}) {
  const writes: string[] = []
  if (stored !== undefined) backing['settings-store'] = JSON.stringify(stored)
  const storage = {
    getItem: (key: string) => backing[key] ?? null,
    setItem: (key: string, value: string) => { writes.push(key); backing[key] = value },
    removeItem: (key: string) => { Reflect.deleteProperty(backing, key) },
  }
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { store: useSettingsStore(), writes, backing }
}

describe('settings-store working hours (#306)', () => {
  it('is automatic when nothing is stored, and hydration writes nothing', async () => {
    const { store, writes } = hydrate(undefined)
    await nextTick()
    expect(store.workingHoursMinutes).toBeNull()
    expect(writes).toEqual([])
  })

  it('is automatic for stored state from before the field (only focusEnabled)', async () => {
    const { store, writes } = hydrate({ focusEnabled: false })
    await nextTick()
    expect(store.workingHoursMinutes).toBeNull()
    expect(store.focusEnabled).toBe(false)
    expect(writes).toEqual([])
  })

  it.each([60, 240, 450, 720])('keeps the valid stored value %i', (minutes) => {
    expect(hydrate({ workingHoursMinutes: minutes }).store.workingHoursMinutes).toBe(minutes)
  })

  it.each([['a string', '240'], ['zero', 0], ['negative', -5], ['too long', 750], ['off the half hour', 100], ['fractional', 3.3], ['null', null], ['an object', {}], ['an array', [240]], ['a boolean', true]])(
    'reads %s as automatic without writing on hydrate',
    async (_name, bad) => {
      const { store, writes } = hydrate({ focusEnabled: true, workingHoursMinutes: bad })
      await nextTick()
      expect(store.workingHoursMinutes).toBeNull()
      expect(writes).toEqual([])
    },
  )

  it('persists the setter and survives a reload (A -> B -> A)', async () => {
    const { store, backing } = hydrate(undefined)
    store.setWorkingHoursMinutes(240)
    await vi.waitFor(() => expect(JSON.parse(backing['settings-store'] ?? '{}').workingHoursMinutes).toBe(240))

    const reloaded = hydrate(undefined, backing).store
    expect(reloaded.workingHoursMinutes).toBe(240)

    reloaded.setWorkingHoursMinutes(null)
    await vi.waitFor(() => expect(JSON.parse(backing['settings-store'] ?? '{}').workingHoursMinutes).toBeNull())
    expect(hydrate(undefined, backing).store.workingHoursMinutes).toBeNull()
  })

  it('refuses an invalid value in the setter (reads as automatic)', () => {
    const { store } = hydrate(undefined)
    store.setWorkingHoursMinutes(100)
    expect(store.workingHoursMinutes).toBeNull()
  })
})
