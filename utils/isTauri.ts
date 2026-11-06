/**
 * Detects the Tauri desktop shell. Tauri 2.x injects `__TAURI_INTERNALS__` (and `__TAURI__` when
 * `withGlobalTauri` is on) before any page script runs, so the answer is stable for the whole session.
 */
export const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window
}
