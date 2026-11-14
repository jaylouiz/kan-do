import { defineStore, acceptHMRUpdate } from 'pinia'
import { ref } from 'vue'
import { sanitizeWorkingMinutes } from '~/lib/dayCapacity'

/**
 * App-wide preferences (#394). A store of its own, not a slice of `board-store`: settings are not board
 * configuration, and it travels with export/import and the desktop data file through `PERSISTED_KEYS`.
 *
 * `focusEnabled`: while a task sits in Jetzt, the overlay lets the rest of the board step back (default on).
 * Nothing stored (every existing install) means `true`; hydration writes nothing on its own (#273).
 *
 * `workingHoursMinutes` (#306): the working day the user sets for the capacity divider, whole half hours from 1 to
 * 12 h as minutes; `null` = automatic (learned from tracked work). Additive: older data hydrates to `null`, a
 * malformed stored value is dropped in memory by `afterHydrate` (no write; the next mutation persists it).
 */
export const useSettingsStore = defineStore('settings', () => {
  const focusEnabled = ref(true)

  function setFocusEnabled(value: boolean) {
    focusEnabled.value = value
  }

  const workingHoursMinutes = ref<number | null>(null)

  function setWorkingHoursMinutes(value: number | null) {
    workingHoursMinutes.value = sanitizeWorkingMinutes(value)
  }

  return {
    focusEnabled,
    setFocusEnabled,
    workingHoursMinutes,
    setWorkingHoursMinutes,
  }
}, {
  persist: {
    key: 'settings-store',
    pick: ['focusEnabled', 'workingHoursMinutes'],
    afterHydrate: (ctx: { store: { workingHoursMinutes: unknown } }) => {
      ctx.store.workingHoursMinutes = sanitizeWorkingMinutes(ctx.store.workingHoursMinutes)
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSettingsStore, import.meta.hot))
}
