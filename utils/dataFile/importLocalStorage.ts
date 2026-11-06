/**
 * @module dataFile/importLocalStorage
 * @description First-run import (#222): on a device without `data-location.json` the persisted stores
 * are copied from `localStorage` into the new data file. `localStorage` itself is left untouched as a
 * safety net. Secrets are stripped with the same list the writer uses.
 */
import type { DataStores } from '~/types/dataFile'
import { stripSecretPaths } from './stripSecrets'

export function importLocalStorage(storage: Pick<Storage, 'getItem'>, keys: readonly string[]): DataStores {
  const stores: DataStores = {}
  for (const key of keys) {
    const raw = storage.getItem(key)
    if (!raw) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      stripSecretPaths(key, parsed)
      stores[key] = parsed
    } catch {
      // An unparsable blob is skipped; the app would not have hydrated it either.
    }
  }
  return stores
}
