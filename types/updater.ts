/** Shapes of the Rust update commands (`src-tauri/src/updater.rs`, #225). */

export type UpdateStatus =
  | 'up-to-date'
  | 'available'
  | 'rejected'
  | 'offline'
  | 'no-release-or-access'
  | 'rate-limited'
  | 'not-configured'
  | 'error'

/** Why a check ended in `error`. */
export type UpdateErrorReason =
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'no-platform'
  | 'keychain'
  | 'api'
  | 'unknown'

export interface UpdateCheckResult {
  status: UpdateStatus
  currentVersion: string
  version?: string | null
  notes?: string | null
  /** RFC 3339 `pub_date` of the manifest. */
  publishedAt?: string | null
  reason?: UpdateErrorReason | null
}

/** The part of a result that exists when `status` is `available`. */
export interface AvailableUpdate {
  version: string
  currentVersion: string
  notes: string | null
  publishedAt: string | null
}

export interface UpdateStateSnapshot {
  last: UpdateCheckResult | null
  /** RFC 3339 time of the last check in this session. */
  lastCheckedAt: string | null
  installing: boolean
}

export interface UpdateProgress {
  downloaded: number
  total: number | null
}

/** Why Rust refused to touch the app (`BlockReason`). `conflict` arrives with #224. */
export type DataBlockReason = 'folder-unavailable' | 'unreadable' | 'conflict'

export type UpdateInstallFailure =
  | { kind: 'data_blocked'; reason: DataBlockReason }
  | { kind: 'no_update' | 'busy' | 'flush_failed' | 'backup_failed' | 'install_failed' }
