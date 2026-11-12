/**
 * In-memory stand-in for the Rust data file (`DataBackend`, #222). It keeps the same contract the real
 * one has: `set` only records, `init` creates the file once, `setLocation` follows the three modes, and
 * `emit` plays a `data-status` event. Tests read `sets`, `initStores` and `calls`.
 */
import type {
  BackupEntry,
  ConflictChoice,
  ConflictCopy,
  DataBackend,
  DataLoadResult,
  DataErrorKind,
  DataStatus,
  DataStatusPayload,
  DataStores,
  FolderInfo,
  LocationMode,
} from '~/types/dataFile'
import { DataError } from '~/lib/dataBackendTauri'
import { emptyDataStatus } from '~/lib/dataStatus'
import { CURRENT_SCHEMA_VERSION } from '~/utils/dataFile/envelope'

export interface FakeFolder {
  /** Raw envelope in the folder; undefined means no file. */
  envelope?: unknown
  writable?: boolean
  existing?: FolderInfo['existing']
}

export interface FakeOptions {
  status?: DataStatus
  folder?: string
  envelope?: unknown
  needsInit?: boolean
  folders?: Record<string, FakeFolder>
  failInit?: boolean
  /** Backups listed by `listBackups`. */
  backups?: BackupEntry[]
  /** Every `backup` call rejects with `backup_failed` (a mandatory backup that cannot be taken). */
  failBackup?: boolean
  failRestore?: DataErrorKind
}

export interface FakeDataBackend extends DataBackend {
  calls: string[]
  sets: Record<string, unknown>
  initStores: DataStores | null
  picked: string | null
  /** Answers of the native dialogs; null cancels. */
  savePath: string | null
  openPath: string | null
  /** What `importRead` returns for `openPath`. */
  importText: string
  exported: { path: string; contents: string } | null
  imported: string | null
  backups: BackupEntry[]
  emit: (payload: Partial<DataStatusPayload>) => void
  current: DataStatusPayload
}

export function createFakeDataBackend(options: FakeOptions = {}): FakeDataBackend {
  const listeners = new Set<(payload: DataStatusPayload) => void>()
  const folders = options.folders ?? {}
  let current: DataStatusPayload = emptyDataStatus({
    status: options.status ?? 'ok',
    folder: options.folder ?? '/data/default',
    filePath: `${options.folder ?? '/data/default'}/kan-do-data.json`,
    writtenAt: '2026-01-01T10:00:00.000Z',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deviceId: 'device-1',
    appVersion: '0.1.0',
  })

  const fake: FakeDataBackend = {
    calls: [],
    sets: {},
    initStores: null,
    picked: null,
    savePath: null,
    openPath: null,
    importText: '',
    exported: null,
    imported: null,
    backups: options.backups ?? [],
    get current() {
      return current
    },
    emit(payload) {
      current = { ...current, ...payload }
      for (const listener of listeners) listener(current)
    },
    async load() {
      fake.calls.push('load')
      return { ...current, envelope: options.envelope ?? null, needsInit: options.needsInit ?? false, generation: 1 } as DataLoadResult
    },
    async set(key, value) {
      fake.calls.push(`set:${key}`)
      fake.sets[key] = value
    },
    async flush() {
      fake.calls.push('flush')
    },
    async status() {
      return current
    },
    async init(stores) {
      fake.calls.push('init')
      if (options.failInit) throw new DataError('io', { message: 'disk full' })
      fake.initStores = stores
      current = { ...current, status: 'ok' }
      return current
    },
    async inspectFolder(folder) {
      const entry = folders[folder] ?? {}
      return {
        writable: entry.writable ?? true,
        existing: entry.existing ?? (entry.envelope ? 'valid' : 'none'),
        writtenAt: entry.envelope ? '2026-01-02T10:00:00.000Z' : null,
        isCurrent: folder === current.folder,
      }
    },
    async setLocation(folder: string, mode: LocationMode) {
      fake.calls.push(`setLocation:${folder}:${mode}`)
      const entry = folders[folder] ?? {}
      if (entry.writable === false) throw new DataError('not_writable')
      if (mode === 'use' && !entry.envelope) throw new DataError('target_empty')
      if (mode === 'move' && entry.envelope) throw new DataError('target_has_data')
      current = { ...current, folder, filePath: `${folder}/kan-do-data.json`, status: 'ok' }
      return { ...current, envelope: mode === 'use' ? entry.envelope : null, needsInit: false, generation: 1 } as DataLoadResult
    },
    async reveal() {
      fake.calls.push('reveal')
    },
    async backup(kind) {
      fake.calls.push(`backup:${kind}`)
      if (options.failBackup) throw new DataError('backup_failed', { message: 'disk full' })
      return `20260101T100000Z-${kind}-aaaaaa.json`
    },
    async listBackups() {
      fake.calls.push('listBackups')
      return fake.backups
    },
    async restore(name) {
      fake.calls.push(`restore:${name}`)
      if (options.failRestore) throw new DataError(options.failRestore)
      current = { ...current, status: 'ok', conflict: null }
      return current
    },
    async resolveConflict(choice: ConflictChoice) {
      fake.calls.push(`resolve:${choice}`)
      if (options.failBackup) throw new DataError('backup_failed', { message: 'disk full' })
      current = { ...current, status: choice === 'mine' ? 'ok' : 'conflict', conflict: choice === 'mine' ? null : current.conflict }
      return current
    },
    async fileToBackups(name) {
      fake.calls.push(`fileToBackups:${name}`)
      current = { ...current, conflictCopies: current.conflictCopies.filter((copy: ConflictCopy) => copy.name !== name) }
      return current
    },
    async retry() {
      fake.calls.push('retry')
      return current
    },
    async exportData(path, contents) {
      fake.calls.push('exportData')
      fake.exported = { path, contents }
    },
    async importRead(path) {
      fake.calls.push(`importRead:${path}`)
      return fake.importText
    },
    async importApply(contents) {
      fake.calls.push('importApply')
      // The replace takes a mandatory `pre-restore` backup first (Rust): without it nothing is replaced
      if (options.failBackup) throw new DataError('backup_failed', { message: 'disk full' })
      fake.imported = contents
      current = { ...current, status: 'ok' }
      return current
    },
    async pickSavePath() {
      fake.calls.push('pickSavePath')
      return fake.savePath
    },
    async pickOpenFile() {
      fake.calls.push('pickOpenFile')
      return fake.openPath
    },
    async pickFolder() {
      fake.calls.push('pickFolder')
      return fake.picked
    },
    async onStatus(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return fake
}
