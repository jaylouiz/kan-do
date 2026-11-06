import { ref, readonly } from 'vue'
import type { ReadableSecretEntry } from '~/lib/secrets'

/**
 * Entries whose Keychain read failed at start-up with no local copy. The board keeps its cached data
 * and the app does not route to setup while a token is merely unreachable (locked, denied).
 */
const unavailableEntries = ref<ReadableSecretEntry[]>([])

export function useKeychainStatus() {
  function setUnavailable(entries: ReadableSecretEntry[]) {
    unavailableEntries.value = entries
  }
  /** Clears one entry (a successful set or remove proved its Keychain entry reachable), or all. */
  function clearUnavailable(entry?: ReadableSecretEntry) {
    unavailableEntries.value = entry ? unavailableEntries.value.filter(e => e !== entry) : []
  }
  return { unavailable: readonly(unavailableEntries), setUnavailable, clearUnavailable }
}
