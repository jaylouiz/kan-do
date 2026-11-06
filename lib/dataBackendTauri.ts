/**
 * @module dataBackendTauri
 * @description `DataBackend` over the Rust `data_*` commands (src-tauri/src/data_file.rs, #222).
 * Rust errors arrive as `{ kind, ... }` and are normalised into `DataError`; the plugins are imported
 * lazily so the web build never loads them.
 */
import type {
  BackupEntry,
  DataBackend,
  DataErrorKind,
  DataLoadResult,
  DataStatusPayload,
  DataStores,
  FolderInfo,
  LocationMode,
} from '~/types/dataFile'

export class DataError extends Error {
  readonly kind: DataErrorKind
  /** Present on `kind: 'blocked'`: the status that refused the write. */
  readonly status: string | null
  /** The OS or Rust message behind the kind (for example "disk full"), when there is one. */
  readonly detail: string | null

  constructor(kind: DataErrorKind, detail: { status?: string | null; message?: string } = {}) {
    super(detail.message ? `data file: ${kind}: ${detail.message}` : `data file: ${kind}`)
    this.name = 'DataError'
    this.kind = kind
    this.status = detail.status ?? null
    this.detail = detail.message ?? null
  }
}

/** Maps whatever `invoke` rejected with to a `DataError`. */
export function toDataError(error: unknown): DataError {
  if (error instanceof DataError) return error
  const raw = (error ?? {}) as { kind?: unknown; status?: unknown; message?: unknown }
  const kind = typeof raw.kind === 'string' ? (raw.kind as DataErrorKind) : 'unavailable'
  return new DataError(kind, {
    status: typeof raw.status === 'string' ? raw.status : null,
    message: typeof raw.message === 'string' ? raw.message : undefined,
  })
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw toDataError(error)
  }
}

/**
 * Every `data_set` carries the `generation` of the last `data_load` and a per-page `seq`. `data_set` is
 * an async Tauri command, so concurrent calls can run out of order: Rust drops a `seq` that is not above
 * the last applied one for the key, and a stale `generation` (after a `use` switch, until the reload
 * loads again). `setLocation` deliberately does not adopt the generation it returns.
 */
export function createTauriBackend(): DataBackend {
  let generation = 0
  let seq = 0
  return {
    load: async () => {
      const loaded = await call<DataLoadResult>('data_load')
      generation = loaded.generation
      seq = 0
      return loaded
    },
    set: async (key, value) => {
      // Stamp synchronously: the invoke below starts after an await and may overtake an older call.
      const stamp = { generation, seq: ++seq }
      await call('data_set', { key, value, ...stamp })
    },
    flush: async () => { await call('data_flush') },
    status: () => call<DataStatusPayload>('data_status'),
    init: (stores: DataStores) => call<DataStatusPayload>('data_init', { envelope: { stores } }),
    inspectFolder: (folder: string) => call<FolderInfo>('data_inspect_folder', { folder }),
    setLocation: (folder: string, mode: LocationMode) => call<DataLoadResult>('data_set_location', { folder, mode }),
    reveal: async () => { await call('data_reveal') },
    backup: kind => call<string>('data_backup', { kind }),
    listBackups: () => call<BackupEntry[]>('data_backup_list'),
    restore: name => call<DataStatusPayload>('data_restore', { name }),
    resolveConflict: choice => call<DataStatusPayload>('data_resolve_conflict', { choice }),
    fileToBackups: name => call<DataStatusPayload>('data_file_to_backups', { name }),
    retry: () => call<DataStatusPayload>('data_retry'),
    exportData: async (path, contents) => { await call('data_export', { path, contents }) },
    importRead: path => call<string>('data_import_read', { path }),
    importApply: contents => call<DataStatusPayload>('data_import_apply', { contents }),
    pickFolder: async (defaultPath) => {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) })
      return typeof picked === 'string' ? picked : null
    },
    pickSavePath: async (defaultName) => {
      const { save } = await import('@tauri-apps/plugin-dialog')
      return (await save({ defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] })) ?? null
    },
    pickOpenFile: async () => {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ directory: false, multiple: false, filters: [{ name: 'JSON', extensions: ['json'] }] })
      return typeof picked === 'string' ? picked : null
    },
    onStatus: async (listener) => {
      const { listen } = await import('@tauri-apps/api/event')
      return listen<DataStatusPayload>('data-status', event => listener(event.payload))
    },
  }
}
