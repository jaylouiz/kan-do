/**
 * #394: the Fokus option lives in its own persisted store, default on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { appStorage } from '~/lib/dataStorage'
import { useSettingsStore } from '~/store/settings'

function freshPinia() {
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: appStorage }))
  // Plugins only run once pinia is installed into an app.
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return pinia
}

describe('settings store', () => {
  beforeEach(() => localStorage.clear())

  it('has the Fokus option on when nothing is stored, and hydration writes nothing', async () => {
    freshPinia()
    const store = useSettingsStore()
    await nextTick()
    expect(store.focusEnabled).toBe(true)
    expect(localStorage.getItem('settings-store')).toBeNull()
  })

  it('persists the setter and survives a reload (A -> B -> A)', async () => {
    freshPinia()
    useSettingsStore().setFocusEnabled(false)
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('settings-store') ?? '{}')).toEqual({ focusEnabled: false }))

    freshPinia()
    const reloaded = useSettingsStore()
    expect(reloaded.focusEnabled).toBe(false)

    reloaded.setFocusEnabled(true)
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('settings-store') ?? '{}')).toEqual({ focusEnabled: true }))
    freshPinia()
    expect(useSettingsStore().focusEnabled).toBe(true)
  })

  it('keeps the default when the stored blob has no focusEnabled field', () => {
    localStorage.setItem('settings-store', JSON.stringify({}))
    freshPinia()
    expect(useSettingsStore().focusEnabled).toBe(true)
  })
})
