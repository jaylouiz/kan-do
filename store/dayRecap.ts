import { defineStore, acceptHMRUpdate } from 'pinia'
import { computed, ref } from 'vue'
import { isValidDayKey } from '~/utils/recapDay'

/**
 * Day marker and toggle of the new-day recap (#385). Persisted under `day-recap-store` through
 * `appStorage`, so both travel with the data file (export/import, cloud-synced folder) like every other store.
 *
 * Nothing here writes at hydration (#273): the baseline write ("first run, show nothing") is the caller's
 * decision (`useNewDayRecap`), because it must be skipped while the data status blocks writes (ADR 011).
 */
export const useDayRecapStore = defineStore('dayRecap', () => {
  /** Local day (`YYYY-MM-DD`) the recap was last left on; null until the baseline is written. */
  const lastShownDay = ref<string | null>(null)
  /** "Erledigte archivieren" on the recap page: on by default, remembers the last choice. */
  const archiveDone = ref(true)

  /** `lastShownDay` as a trusted value: a malformed stored string (hand-edited file, import) reads as null. */
  const validLastShownDay = computed(() => (isValidDayKey(lastShownDay.value) ? lastShownDay.value : null))

  /** Monotonic: a key that is not after the stored one is ignored, so a clock set back never moves it back. */
  function markShown(todayKey: string): void {
    if (!isValidDayKey(todayKey)) return
    const current = validLastShownDay.value
    if (current !== null && todayKey <= current) return
    lastShownDay.value = todayKey
  }

  function setArchiveDone(value: boolean): void {
    archiveDone.value = value
  }

  return { lastShownDay, archiveDone, validLastShownDay, markShown, setArchiveDone }
}, {
  persist: { key: 'day-recap-store', pick: ['lastShownDay', 'archiveDone'] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useDayRecapStore, import.meta.hot))
}
