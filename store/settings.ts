import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'

/**
 * App-wide preferences (#394). A store of its own, not a slice of `board-store`: settings are not board
 * configuration, and it travels with export/import and the desktop data file through `PERSISTED_KEYS`.
 *
 * `focusEnabled`: while a task sits in Jetzt, the overlay lets the rest of the board step back (default on).
 * Nothing stored (every existing install) means `true`; hydration writes nothing on its own (#273).
 */
export const useSettingsStore = defineStore('settings', () => {
  const focusEnabled = ref(true)

  function setFocusEnabled(value: boolean) {
    focusEnabled.value = value
  }

  return {
    focusEnabled,
    setFocusEnabled,
  }
}, {
  persist: {
    key: 'settings-store',
    pick: ['focusEnabled'],
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
}
