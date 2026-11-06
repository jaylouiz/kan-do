/**
 * @module dataStorage
 * @description The storage behind every persisted Pinia store (#222, ADR 008).
 *
 * - Web (and Vitest/jsdom): `appStorage` delegates to `localStorage`, exactly as before.
 * - Desktop: `initDataStorage()` loads `kan-do-data.json` through Rust into a synchronous string mirror
 *   before Pinia is created. `getItem` reads the mirror; `setItem` updates it and hands the parsed
 *   store to Rust, which debounces and writes atomically.
 *
 * Both methods resolve the backend at call time. Never capture `localStorage` or the mirror in a
 * constant at import time: stores are defined before the plugin has run.
 *
 * Secrets: `setItem` strips `SECRET_STATE_PATHS` (lib/secrets.ts) before the mirror and the file see
 * the value, so no bootstrap ordering can put a token into the data file. `withoutPersistence` keeps the
 * start-up token apply from counting as a user edit (#255 N1, ADR 008).
 */
import { nextTick, reactive } from 'vue'
import { emptyDataStatus } from '~/lib/dataStatus'
import type { DataBackend, DataStatusPayload, DataStores, FolderInfo, LocationMode } from '~/types/dataFile'
import { importLocalStorage } from '~/utils/dataFile/importLocalStorage'
import { isDataEnvelope, storesToMirror } from '~/utils/dataFile/envelope'
import { runMigrations, type MigrationOptions } from '~/utils/dataFile/migrations'
import { SECRET_STATE_LOCATIONS } from '~/lib/secrets'
import { stripSecretPaths } from '~/utils/dataFile/stripSecrets'
import { isTauri } from '~/utils/isTauri'
import { createTauriBackend, toDataError, type DataError } from '~/lib/dataBackendTauri'

/**
 * Persist keys that live in the data file. `kando-locale` (per-device preference needed before Pinia)
 * and `statistics-backfill-state` (transient job bookkeeping) stay in localStorage. A Vitest guard fails
 * when a persisted store is missing here.
 */
export const PERSISTED_KEYS = [
  'tasks-store',
  'board-store',
  'integration-health-store',
  'taskStatistics',
  'notionConfig',
  'propertyOptions',
  'settings-store',
  'day-recap-store',
  'trash-store',
  'topic-styles',
] as const

const PERSISTED_KEY_SET: ReadonlySet<string> = new Set(PERSISTED_KEYS)

/** Stores that carry a secret path: the only keys `withoutPersistence` mutes. */
const SECRET_STORAGE_KEYS: ReadonlySet<string> = new Set(SECRET_STATE_LOCATIONS.map(l => l.storageKey))

/** Open `withoutPersistence` windows (nesting-safe). */
let persistenceMuted = 0

/**
 * Runs `fn` with `appStorage.setItem` dropping writes for the stores that hold a secret path, and keeps
 * that window open until the stores' pending `$subscribe` flush has happened (`await nextTick()` after
 * `fn`): `$patch` notifies synchronously, a plain state assignment through Pinia's async watcher.
 *
 * For the secrets bootstrap, which puts the Keychain token into the store at start-up. That mutation is
 * not an edit: persisting it would make Rust count an offline launch (unreadable data file) as edited and
 * force a later recovery through the conflict choice. Only for start-up before mount, where no user edit
 * can fall inside the window; it removes a write path, never adds one.
 */
export async function withoutPersistence<T>(fn: () => T | Promise<T>): Promise<T> {
  persistenceMuted++
  try {
    return await fn()
  } finally {
    await nextTick()
    persistenceMuted--
  }
}

interface Runtime {
  backend: DataBackend
  mirror: Map<string, string>
  /** Nothing is handed to Rust (a failed migration must not overwrite the file). */
  readOnly: boolean
}

let runtime: Runtime | null = null
let unsubscribe: (() => void) | null = null

/** Reactive view of the data file for the UI (`useDataFolder`, `DataStorageNotice`). */
export const dataState = reactive<DataStatusPayload & { available: boolean }>({
  available: false,
  ...emptyDataStatus(),
})

export function applyDataStatus(payload: DataStatusPayload): void {
  dataState.status = payload.status
  dataState.folder = payload.folder
  dataState.filePath = payload.filePath
  dataState.writtenAt = payload.writtenAt
  dataState.schemaVersion = payload.schemaVersion
  dataState.deviceId = payload.deviceId
  dataState.appVersion = payload.appVersion ?? ''
  dataState.error = payload.error
  dataState.conflict = payload.conflict ?? null
  dataState.conflictCopies = payload.conflictCopies ?? []
  dataState.backupError = payload.backupError ?? null
  dataState.cloudSync = payload.cloudSync ?? null
}

function webStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

/** Plugin storage: the file mirror for persisted keys when a desktop backend is up, else `localStorage`. */
export const appStorage = {
  getItem(key: string): string | null {
    if (runtime && PERSISTED_KEY_SET.has(key)) return runtime.mirror.get(key) ?? null
    return webStorage()?.getItem(key) ?? null
  },
  setItem(key: string, value: string): void {
    if (persistenceMuted > 0 && SECRET_STORAGE_KEYS.has(key)) return
    const active = runtime
    if (!active || !PERSISTED_KEY_SET.has(key)) {
      webStorage()?.setItem(key, value)
      return
    }
    let state: unknown
    try {
      state = JSON.parse(value)
    } catch {
      return
    }
    // Keep the mirror and the file free of secrets even when the store still carries one in memory.
    const clean = stripSecretPaths(key, state) ? JSON.stringify(state) : value
    active.mirror.set(key, clean)
    if (active.readOnly) return
    active.backend.set(key, state).catch((error: unknown) => {
      // Disk failures arrive as a `data-status` event; this is the IPC itself failing.
      if (import.meta.dev) console.warn('[dataStorage] data_set failed', toDataError(error).kind)
    })
  },
}

export interface InitDeps {
  /** Defaults to the Tauri backend. */
  backend?: DataBackend
  /** Source of the first-run import. Defaults to `localStorage`. */
  source?: Pick<Storage, 'getItem'> | null
  /** Migration steps, for tests; defaults to the real chain. */
  migrations?: MigrationOptions
}

/**
 * Desktop start-up: loads the file into the mirror before any store hydrates. No-op on web.
 * A backend that cannot be reached (the `data_load` IPC itself failing) is not a reason to fall back to
 * `localStorage`: that copy is frozen at the first-run import, and edits made there would be ignored by
 * the next healthy launch. The stores hydrate empty and nothing is written, with the notice shown.
 */
export async function initDataStorage(deps: InitDeps = {}): Promise<DataStatusPayload | null> {
  if (!deps.backend && !isTauri()) return null
  const backend = deps.backend ?? createTauriBackend()
  const source = deps.source === undefined ? webStorage() : deps.source

  let loaded
  try {
    loaded = await backend.load()
  } catch (error) {
    const detail = toDataError(error)
    if (import.meta.dev) console.warn('[dataStorage] data_load failed, running read-only', detail.kind)
    const status = unreachableStatus(detail)
    runtime = { backend, mirror: new Map(), readOnly: true }
    dataState.available = true
    applyDataStatus(status)
    return status
  }

  let status: DataStatusPayload = loaded
  let mirror = new Map<string, string>()
  let readOnly = false
  const migratedStores: DataStores = {}

  if (loaded.needsInit) {
    const stores = source ? importLocalStorage(source, PERSISTED_KEYS) : {}
    mirror = storesToMirror(stores)
    status = await backend.init(stores).catch((error: unknown) => failedInit(loaded, error))
  } else if (isDataEnvelope(loaded.envelope)) {
    try {
      // The backup comes first and is mandatory: when it fails the migration does not run.
      const outcome = await runMigrations(loaded.envelope, {
        beforeMigrate: async () => { await backend.backup('pre-migration') },
        ...deps.migrations,
      })
      mirror = storesToMirror(outcome.envelope.stores)
      if (outcome.kind === 'migrated') Object.assign(migratedStores, outcome.envelope.stores)
    } catch (error) {
      // The file stays as it is: nothing is handed to Rust and the stores hydrate empty.
      readOnly = true
      status = { ...loaded, status: 'read-only-corrupt', error: error instanceof Error ? error.message : null }
    }
  }

  runtime = { backend, mirror, readOnly }
  dataState.available = true
  applyDataStatus(status)

  // A rejected IPC call must not fail the plugin setup (the app would not boot): the mirror already
  // holds the migrated stores and the next start migrates the untouched file again.
  for (const [key, value] of Object.entries(migratedStores)) await backend.set(key, value).catch(() => undefined)
  if (Object.keys(migratedStores).length) await backend.flush().catch(() => undefined)

  unsubscribe?.()
  unsubscribe = null
  void backend
    .onStatus(applyDataStatus)
    .then((off) => { unsubscribe = off })
    .catch(() => undefined)

  return status
}

/** The state shown when Rust cannot be asked at all: unreadable, so nothing is written. */
function unreachableStatus(error: DataError): DataStatusPayload {
  return emptyDataStatus({ status: 'read-only-corrupt', error: error.message })
}

function failedInit(loaded: DataStatusPayload, error: unknown): DataStatusPayload {
  return { ...loaded, status: 'write-failed', error: toDataError(error).message }
}

/** The active desktop backend, or null on web / before `initDataStorage`. */
export function getDataBackend(): DataBackend | null {
  return runtime?.backend ?? null
}

/** Current content of the mirror as parsed stores: the source for "start here" after `missing-file`. */
export function snapshotMirror(): DataStores {
  const stores: DataStores = {}
  for (const [key, value] of runtime?.mirror ?? []) stores[key] = JSON.parse(value) as unknown
  return stores
}

export function inspectFolder(folder: string): Promise<FolderInfo> {
  return requireBackend().inspectFolder(folder)
}

export async function changeLocation(folder: string, mode: LocationMode): Promise<DataStatusPayload> {
  const result = await requireBackend().setLocation(folder, mode)
  applyDataStatus(result)
  return result
}

function requireBackend(): DataBackend {
  if (!runtime) throw new Error('Data storage is not initialised')
  return runtime.backend
}

/** Test helper: back to the web behaviour. */
export function resetDataStorage(): void {
  unsubscribe?.()
  unsubscribe = null
  runtime = null
  dataState.available = false
  applyDataStatus(emptyDataStatus())
}
