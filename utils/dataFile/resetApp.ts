/**
 * @module dataFile/resetApp
 * @description The pure half of "App zurücksetzen" (kd#227, ADR 011): what an app reset erases and the empty data it
 * leaves behind. The erased set is derived from `PERSISTED_KEYS` and `SECRET_ENTRIES`, so a new store or a new
 * Keychain entry is covered without touching the reset. Unlike an import (`planReplace`) a reset keeps no token of this
 * browser: on web the tokens live inside the persisted blobs and go with them.
 * Kept on purpose: `kando-locale` (language) and `kando-last-seen-version` (install fact), neither is user data.
 */
import { PERSISTED_KEYS } from '~/lib/dataStorage'
import { SECRET_ENTRIES, type SecretEntryName } from '~/lib/secrets'
import { CURRENT_SCHEMA_VERSION, type DataEnvelope } from './envelope'
import { commitReplace, type BlobStorage, type StoredBlobs } from './webReplace'

/** `localStorage` keys outside `PERSISTED_KEYS` that describe the old data and must not outlive it. */
export const RESET_LOCAL_KEYS = ['statistics-backfill-state'] as const

/** Every Keychain entry, in the order they are deleted. */
export const RESET_SECRET_ENTRIES: readonly SecretEntryName[] = SECRET_ENTRIES

/** The web plan: every persisted key removed (the tokens inside the blobs with them). */
export function planReset(): StoredBlobs {
  const plan: StoredBlobs = {}
  for (const key of PERSISTED_KEYS) plan[key] = null
  return plan
}

/** Writes the plan with the rollback of `commitReplace`, then drops the keys of `RESET_LOCAL_KEYS`. Throws `WebTransferError`. */
export function commitReset(storage: BlobStorage): void {
  commitReplace(storage, planReset())
  for (const key of RESET_LOCAL_KEYS) {
    try {
      storage.removeItem(key)
    } catch {
      // Bookkeeping only: a stale backfill marker cannot bring data back.
    }
  }
}

/** Removes the webview's own copy of the persisted keys on desktop (the frozen first-run import); best effort. */
export function clearWebviewCopy(storage: BlobStorage): void {
  for (const key of [...PERSISTED_KEYS, ...RESET_LOCAL_KEYS]) {
    try {
      storage.removeItem(key)
    } catch {
      // Not the source of truth on desktop: the data file is.
    }
  }
}

/** The empty data file content handed to Rust: a valid envelope without any store. */
export function emptyEnvelopeText(deviceId: string, appVersion: string, now: Date = new Date()): string {
  const envelope: DataEnvelope = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    writtenAt: now.toISOString(),
    writtenBy: deviceId,
    appVersion,
    stores: {},
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

/** Display names of the Keychain entries that failed, once each ("Notion", "Todoist", "GitHub"). */
export function secretLabels(entries: readonly SecretEntryName[]): string[] {
  const label = (entry: SecretEntryName) => (entry === 'notion-token' ? 'Notion' : entry === 'todoist-token' ? 'Todoist' : 'GitHub')
  return [...new Set(entries.map(label))]
}
