/**
 * @composable useDataConflictFlow
 * @description Shared state of the conflict modal and its automatic opening (#224, ADR 011).
 * @responsibility
 * - `conflictOpen` is the one flag behind `DataConflictModal`; the notice's "Lösen" sets it
 * - `useConflictAutoOpen` (called by `DataStorageNotice`, which exists once per page) opens the modal once
 *   when a conflict appears and re-arms when the conflict is gone; "Später" keeps status and notice
 * - A conflict that reports `autoReload` (the folder came back after a launch without data and nothing
 *   was edited) reloads the window by itself, at most once per `AUTO_RELOAD_GAP_MS`; after that the
 *   modal is the fallback, so a file that keeps changing can never cause a reload loop
 */
import { ref, watch } from 'vue'
import { useDataFolder } from '~/composables/useDataFolder'

export const AUTO_RELOAD_GAP_MS = 30_000
const AUTO_RELOAD_KEY = 'kando-data-auto-reload'

export const conflictOpen = ref(false)

/** True once the modal was opened by itself for the conflict that is currently pending. */
let autoOpened = false
let reloading = false

function recentlyAutoReloaded(now: number): boolean {
  try {
    const last = Number(sessionStorage.getItem(AUTO_RELOAD_KEY))
    return Number.isFinite(last) && last > 0 && now - last < AUTO_RELOAD_GAP_MS
  } catch {
    return false
  }
}

function markAutoReload(now: number): void {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(now))
  } catch {
    // Private mode: the guard degrades to the in-memory flag.
  }
}

export function openConflict(): void {
  conflictOpen.value = true
}

/** Test helper: back to a fresh page load. */
export function resetConflictFlow(): void {
  conflictOpen.value = false
  autoOpened = false
  reloading = false
}

export function useConflictAutoOpen(now: () => number = Date.now): void {
  const folder = useDataFolder()
  watch(
    () => [folder.status.value, folder.conflict.value] as const,
    ([status, conflict]) => {
      if (status !== 'conflict' || !conflict) {
        autoOpened = false
        conflictOpen.value = false
        return
      }
      // The window is about to reload on their file: the status still says `conflict` until then.
      if (reloading) return
      if (conflict.autoReload && !recentlyAutoReloaded(now())) {
        reloading = true
        markAutoReload(now())
        void folder.resolveConflict('theirs').catch(() => {
          reloading = false
          conflictOpen.value = true
        })
        return
      }
      if (!autoOpened) {
        autoOpened = true
        conflictOpen.value = true
      }
    },
    { immediate: true },
  )
}
