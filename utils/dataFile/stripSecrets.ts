/**
 * @module dataFile/stripSecrets
 * @description Removes `SECRET_STATE_PATHS` (lib/secrets.ts, ADR 007) from a persisted store state.
 * The data-file writer applies it itself, so a token that reaches persisted state because a Keychain
 * bootstrap failed or has not run yet can never land in the (possibly cloud-synced) data file.
 */
import { SECRET_STATE_LOCATIONS } from '~/lib/secrets'

/** Deletes the secret leaves of the store persisted under `storageKey`, in place. True if any was removed. */
export function stripSecretPaths(storageKey: string, state: unknown): boolean {
  let removed = false
  for (const location of SECRET_STATE_LOCATIONS) {
    if (location.storageKey !== storageKey) continue
    const keys = location.statePath.split('.')
    const leaf = keys.pop() as string
    let node: unknown = state
    for (const key of keys) {
      node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined
    }
    if (typeof node === 'object' && node !== null && leaf in node) {
      removed = Reflect.deleteProperty(node, leaf) || removed
    }
  }
  return removed
}
