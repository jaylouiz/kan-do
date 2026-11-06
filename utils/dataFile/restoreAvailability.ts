import type { DataStatus } from '~/types/dataFile'

/** Why restoring a backup or importing a file is not offered right now. */
export type RestoreBlock = 'conflict' | 'newer-schema' | 'unavailable'

/**
 * Whether a restore or import may replace the data file in `status` (#224, ADR 011), or what stands in
 * the way. Mirrors `Inner::restorable` in `src-tauri/src/data_file.rs`: out of `ok`, `write-failed`,
 * `missing-file` and `read-only-corrupt` (the recovery case, the unreadable file is kept verbatim as
 * `pre-restore` first). A conflict wants its own two-version choice, a newer-schema file wants the app
 * updated, an unavailable folder cannot be written at all. (An unreadable location pointer is also
 * `read-only-corrupt`; Rust refuses there and the inline error says so.)
 */
export function restoreBlockedBy(status: DataStatus): RestoreBlock | null {
  switch (status) {
    case 'conflict':
      return 'conflict'
    case 'read-only-newer-schema':
      return 'newer-schema'
    case 'folder-unavailable':
      return 'unavailable'
    case 'ok':
    case 'write-failed':
    case 'missing-file':
    case 'read-only-corrupt':
      return null
  }
}
