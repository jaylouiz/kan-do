/**
 * Shapes shared by the desktop data-file layer (#222, ADR 008). They mirror the serde types in
 * `src-tauri/src/data_file.rs` (camelCase fields, kebab-case status).
 */

/**
 * Health of the data file. Anything but `ok` and `write-failed` blocks every write in Rust.
 * Priority when several apply: `read-only-*` > `conflict` > `folder-unavailable` > `write-failed` > `missing-file`.
 */
export type DataStatus =
  | 'ok'
  | 'read-only-newer-schema'
  | 'read-only-corrupt'
  | 'missing-file'
  | 'write-failed'
  /** The file on disk is not the one this app last read or wrote: the user picks a version (#224). */
  | 'conflict'
  /** The folder is missing, offline or too slow: edits stay in memory, nothing is written (#224). */
  | 'folder-unavailable'

/** What the file on disk says about itself when it is the other side of a conflict. */
export interface TheirVersion {
  /** False for a half-synced file that does not parse. */
  readable: boolean
  writtenAt: string | null
  writtenBy: string | null
  taskCount: number | null
  schemaVersion: number | null
}

export interface ConflictInfo {
  theirs: TheirVersion
  /** This app holds edits that are not in the file. */
  localChanges: boolean
  mineTaskCount: number | null
  /** The file came back after a launch without data and nothing was edited: reload without asking. */
  autoReload: boolean
}

export type BackupKind =
  | 'daily'
  | 'manual'
  | 'pre-migration'
  | 'pre-restore'
  | 'pre-replace'
  | 'pre-update'
  | 'conflict'
  | 'unsaved'

/** Backups the webview may ask for; Rust takes the others itself. */
export type RequestableBackupKind = Extract<BackupKind, 'manual' | 'pre-migration' | 'pre-update'>

export interface BackupEntry {
  /** File name inside `<folder>/backups/`. */
  name: string
  kind: BackupKind
  /** ISO-8601 UTC time from the file name. */
  ts: string
  device6: string
  /** The file's `writtenBy` is this device. */
  ownDevice: boolean
  taskCount: number | null
  schemaVersion: number | null
  /** False for a file that does not parse: listed, but not restorable. */
  readable: boolean
}

/** A cloud-sync conflict copy next to the data file. */
export interface ConflictCopy {
  name: string
  writtenAt: string
  writtenBy: string
  taskCount: number | null
  schemaVersion: number
}

export type ConflictChoice = 'mine' | 'theirs'

/** Upload state of the data file in an iCloud folder (#271, ADR 011). */
export type CloudSyncState = 'uploading' | 'pending' | 'error' | 'uploaded'

export interface CloudSync {
  state: CloudSyncState
  /** iCloud's own reason; set for `error` only. */
  message: string | null
  /** ISO time of the first look that found the file not uploaded; null once uploaded. */
  since: string | null
  /** The notice may show it: `error`, `uploading` and `pending` after the grace, `uploaded` never. */
  visible: boolean
}

export interface DataStatusPayload {
  status: DataStatus
  folder: string
  filePath: string
  writtenAt: string | null
  schemaVersion: number | null
  /** This device's id; lives only in the local `data-location.json`. */
  deviceId: string
  /** Version of this build; written into exports. */
  appVersion: string
  /** Last I/O error text while `write-failed` or `folder-unavailable`. */
  error: string | null
  /** Set while the status is `conflict`. */
  conflict: ConflictInfo | null
  /** Cloud-sync conflict copies next to the data file (non-blocking). */
  conflictCopies: ConflictCopy[]
  /** The last `daily` or `manual` backup failed (non-blocking). */
  backupError: string | null
  /** Whether the latest save reached the cloud; null for any other folder, any status but ok/write-failed, and on web (non-blocking). */
  cloudSync: CloudSync | null
}

export interface DataLoadResult extends DataStatusPayload {
  /** The raw, un-migrated envelope as read from disk; null when there is none to read. */
  envelope: unknown
  /** First run of this device: no location configured and no file yet. */
  needsInit: boolean
  /** Rust bumps it on every `load` and on a `use` switch; `data_set` carries the one `load` returned. */
  generation: number
}

export type FolderContent = 'none' | 'valid' | 'newer-schema' | 'corrupt'

export interface FolderInfo {
  writable: boolean
  existing: FolderContent
  writtenAt: string | null
  /** The folder is the one already in use. */
  isCurrent: boolean
}

/** `move`: copy my data into an empty folder. `use`: switch to the data there. `replace`: overwrite it with mine. */
export type LocationMode = 'move' | 'use' | 'replace'

export type DataErrorKind =
  | 'blocked'
  | 'not_writable'
  | 'target_has_data'
  | 'target_empty'
  | 'target_corrupt'
  | 'same_folder'
  | 'exists'
  | 'invalid'
  | 'io'
  | 'unavailable'
  | 'backup_failed'
  | 'newer_schema'
  | 'unreadable'
  | 'changed'

/** What the file holds, by store key. Values are the parsed JSON of each persisted store. */
export type DataStores = Record<string, unknown>

/**
 * The seam between the synchronous storage adapter and the Rust data file. The Tauri implementation
 * lives in `lib/dataBackendTauri.ts`; tests use an in-memory fake (`tests/helpers/fakeDataBackend.ts`).
 */
export interface DataBackend {
  load: () => Promise<DataLoadResult>
  /** Hands one store to Rust; Rust debounces and writes. */
  set: (key: string, value: unknown) => Promise<void>
  /** Writes pending changes now (also the pre-update hook for #225). */
  flush: () => Promise<void>
  status: () => Promise<DataStatusPayload>
  /** Creates the file from `stores`: first-run import and "start here" after `missing-file`. */
  init: (stores: DataStores) => Promise<DataStatusPayload>
  inspectFolder: (folder: string) => Promise<FolderInfo>
  setLocation: (folder: string, mode: LocationMode) => Promise<DataLoadResult>
  reveal: () => Promise<void>
  /** Copies the data file into `backups/` (pending edits are written first); resolves to the backup's name. */
  backup: (kind: RequestableBackupKind) => Promise<string>
  listBackups: () => Promise<BackupEntry[]>
  /** Backs up the current state (`pre-restore`), replaces the data file with a backup or conflict copy. */
  restore: (name: string) => Promise<DataStatusPayload>
  resolveConflict: (choice: ConflictChoice) => Promise<DataStatusPayload>
  /** "Ablegen": moves a cloud conflict copy into `backups/` as `conflict`. */
  fileToBackups: (name: string) => Promise<DataStatusPayload>
  /** "Erneut versuchen": one look at the folder now. */
  retry: () => Promise<DataStatusPayload>
  /** Writes the export JSON (already stripped of secrets) to a path the user picked. */
  exportData: (path: string, contents: string) => Promise<void>
  importRead: (path: string) => Promise<string>
  /** Replaces the data with the (stripped) import after a `pre-restore` backup. */
  importApply: (contents: string) => Promise<DataStatusPayload>
  /** Native folder picker; null when cancelled. */
  pickFolder: (defaultPath?: string) => Promise<string | null>
  /** Native save dialog; null when cancelled. */
  pickSavePath: (defaultName: string) => Promise<string | null>
  /** Native open dialog for a JSON file; null when cancelled. */
  pickOpenFile: () => Promise<string | null>
  /** Subscribes to `data-status` events; resolves to the unsubscribe function. */
  onStatus: (listener: (payload: DataStatusPayload) => void) => Promise<() => void>
}
