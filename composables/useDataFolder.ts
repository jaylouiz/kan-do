/**
 * @composable useDataFolder
 * @description State and actions for the desktop data folder (#222, ADR 008) and its safety net
 * (#224, ADR 011).
 * @responsibility
 * - Exposes the reactive status of `kan-do-data.json` (`dataState`) for the settings page and the notice
 * - `chooseFolder` opens the native picker and inspects the pick; `applyFolder` switches the folder
 * - `startFresh` ("Hier neu beginnen") recreates a missing file from the in-memory data
 * - `flushNow` is the explicit flush the updater (#225) calls before it replaces the app;
 *   `backupNow('pre-update')` is the backup it takes right after
 * - Backups: `refreshBackups`, `backupNow`, `restore` (flush, then Rust backs up and replaces, then reload)
 * - Conflicts and an unavailable folder: `conflict`, `conflictCopies`, `resolveConflict`, `retry`,
 *   `fileToBackups`; `pickImport`/`applyImport`/`exportData` for the portable JSON
 * - `cloudNotice` (#271): the iCloud upload state worth a notice (uploading/pending/error after the grace Rust
 *   applies), only while the file is healthy and no conflict copies own the notice; `dismissCloudNotice` (#289)
 *   hides it for the rest of the app session (memory only)
 * - On web every call is a no-op or rejects with `unavailable`; `available` is false
 */
import { computed, reactive, ref } from 'vue'
import { applyDataStatus, changeLocation, dataState, getDataBackend, inspectFolder, snapshotMirror } from '~/lib/dataStorage'
import { DataError, toDataError } from '~/lib/dataBackendTauri'
import { buildExport, parseImport, type ImportFailure } from '~/utils/dataFile/exportImport'
import { restoreBlockedBy } from '~/utils/dataFile/restoreAvailability'
import { reloadApp } from '~/utils/reloadApp'
import type { BackupEntry, CloudSync, ConflictChoice, DataStatus, FolderInfo, LocationMode, RequestableBackupKind } from '~/types/dataFile'

/** States in which nothing is written to disk. */
const BLOCKING: readonly DataStatus[] = [
  'read-only-newer-schema',
  'read-only-corrupt',
  'missing-file',
  'conflict',
  'folder-unavailable',
]

export type BackupsLoad = 'idle' | 'loading' | 'ready' | 'error'

/** Module-level so the page and its modals share one list. */
const backupsState = reactive<{ load: BackupsLoad; items: BackupEntry[] }>({ load: 'idle', items: [] })

export interface ImportPreview {
  /** Stripped envelope text that `applyImport` hands to Rust. */
  text: string
  fileName: string
  taskCount: number | null
  schemaVersion: number
  writtenAt: string | null
}

export type ImportPick =
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: ImportFailure | 'unreadable' }
  | { kind: 'ready'; preview: ImportPreview }

export interface FolderChoice {
  folder: string
  info: FolderInfo
}

function backend() {
  const active = getDataBackend()
  if (!active) throw new DataError('unavailable')
  return active
}

/** The short reason to show next to "... failed": the OS or Rust message, else the error kind. */
export function describeError(error: unknown): string {
  const detail = toDataError(error)
  return detail.detail ?? detail.kind
}

/**
 * #289: the user hid the cloud notice. One flag for the whole app session, memory only, never persisted: `uploaded`,
 * an escalation to `error` and a folder change do not clear it; only a reload or restart does.
 */
const cloudNoticeDismissed = ref(false)

/** Test seam: a fresh app session. */
export function resetCloudNoticeDismissal() {
  cloudNoticeDismissed.value = false
}

export function useDataFolder() {
  const available = computed(() => dataState.available)
  const status = computed(() => dataState.status)
  /** The cloud state the notice shows; every status other than `ok` and conflict copies come first, `uploaded` never shows, a dismissed notice (#289) stays hidden for the session. */
  const cloudNotice = computed<CloudSync | null>(() => {
    const sync = dataState.cloudSync
    if (!dataState.available || dataState.status !== 'ok' || dataState.conflictCopies.length > 0) return null
    if (!sync?.visible || sync.state === 'uploaded') return null
    return cloudNoticeDismissed.value ? null : sync
  })
  /** "Ausblenden" (#289): hides the cloud notice until the next reload or restart. */
  function dismissCloudNotice() {
    cloudNoticeDismissed.value = true
  }
  /** Anything that needs the user's attention: the notice shows for every non-`ok` status. */
  const needsAttention = computed(
    () => dataState.available && (dataState.status !== 'ok' || dataState.conflictCopies.length > 0 || cloudNotice.value !== null),
  )
  const isReadOnly = computed(() => BLOCKING.includes(dataState.status))
  /** Why restore and import are off in this state (null: allowed), shared by every button that replaces the data. */
  const restoreBlock = computed(() => restoreBlockedBy(dataState.status))

  /** Opens the picker; null when cancelled. Otherwise the folder plus what it holds. */
  async function chooseFolder(): Promise<FolderChoice | null> {
    const active = backend()
    const folder = await active.pickFolder(dataState.folder || undefined)
    if (!folder) return null
    return { folder, info: await inspectFolder(folder) }
  }

  /** Switches the folder. `use` swaps the data underneath the stores, so the window reloads. */
  async function applyFolder(folder: string, mode: LocationMode): Promise<void> {
    await changeLocation(folder, mode)
    if (mode === 'use') reloadApp()
  }

  /** Recreates a missing file from what the app holds in memory. */
  async function startFresh(): Promise<void> {
    applyDataStatus(await backend().init(snapshotMirror()))
  }

  async function revealInFinder(): Promise<void> {
    await backend().reveal()
  }

  async function flushNow(): Promise<void> {
    await getDataBackend()?.flush()
  }

  async function refresh(): Promise<void> {
    const active = getDataBackend()
    if (active) applyDataStatus(await active.status())
  }

  /** Pending edits first, so a restore or import backs up the latest state. Rust re-checks, so a failure is not fatal here. */
  async function flushQuietly(): Promise<void> {
    await getDataBackend()?.flush().catch(() => undefined)
  }

  async function refreshBackups(): Promise<void> {
    const active = getDataBackend()
    if (!active) return
    backupsState.load = backupsState.items.length ? backupsState.load : 'loading'
    try {
      backupsState.items = await active.listBackups()
      backupsState.load = 'ready'
    } catch {
      backupsState.load = 'error'
    }
  }

  /** A backup on demand ("Jetzt sichern", `pre-update`). Rejects with a `DataError` when it fails. */
  async function backupNow(kind: RequestableBackupKind): Promise<string> {
    const name = await backend().backup(kind)
    await refreshBackups()
    return name
  }

  /** Flush, then Rust takes the `pre-restore` backup and replaces the file, then the window reloads. */
  async function restore(name: string): Promise<void> {
    await flushQuietly()
    applyDataStatus(await backend().restore(name))
    reloadApp()
  }

  /**
   * "Diese Version behalten" writes mine over theirs (both stay in `backups/`); "Andere Version laden" / "Neu laden" keeps
   * my state as `unsaved` first and only then reloads on their file. A failed backup rejects, no reload.
   */
  async function resolveConflict(choice: ConflictChoice): Promise<void> {
    applyDataStatus(await backend().resolveConflict(choice))
    if (choice === 'theirs') reloadApp()
    else await refreshBackups()
  }

  /** "Erneut versuchen": one look at the folder now. */
  async function retry(): Promise<void> {
    applyDataStatus(await backend().retry())
  }

  /** "Ablegen": moves a cloud conflict copy into `backups/`. */
  async function fileToBackups(name: string): Promise<void> {
    applyDataStatus(await backend().fileToBackups(name))
    await refreshBackups()
  }

  /** Save dialog, then the current state without secrets as plain JSON. */
  async function exportData(): Promise<'saved' | 'cancelled'> {
    const active = backend()
    const built = buildExport({ stores: snapshotMirror(), deviceId: dataState.deviceId, appVersion: dataState.appVersion })
    const path = await active.pickSavePath(built.fileName)
    if (!path) return 'cancelled'
    await active.exportData(path, built.text)
    return 'saved'
  }

  /** Open dialog, then validation; nothing changes until `applyImport`. */
  async function pickImport(): Promise<ImportPick> {
    const active = backend()
    const path = await active.pickOpenFile()
    if (!path) return { kind: 'cancelled' }
    let text: string
    try {
      text = await active.importRead(path)
    } catch {
      return { kind: 'failed', reason: 'unreadable' }
    }
    const parsed = parseImport(text)
    if (!parsed.ok) return { kind: 'failed', reason: parsed.reason }
    const fileName = path.split(/[\\/]/).pop() ?? path
    const { taskCount, schemaVersion, writtenAt } = parsed
    return { kind: 'ready', preview: { text: parsed.text, fileName, taskCount, schemaVersion, writtenAt } }
  }

  /** Flush, then Rust takes the `pre-restore` backup and replaces the data, then the window reloads. */
  async function applyImport(preview: ImportPreview): Promise<void> {
    await flushQuietly()
    applyDataStatus(await backend().importApply(preview.text))
    reloadApp()
  }

  return {
    state: dataState,
    available,
    status,
    needsAttention,
    cloudNotice,
    dismissCloudNotice,
    isReadOnly,
    restoreBlock,
    chooseFolder,
    applyFolder,
    startFresh,
    revealInFinder,
    flushNow,
    refresh,
    backups: computed(() => backupsState.items),
    backupsLoad: computed(() => backupsState.load),
    conflict: computed(() => dataState.conflict),
    conflictCopies: computed(() => dataState.conflictCopies),
    backupError: computed(() => dataState.backupError),
    refreshBackups,
    backupNow,
    restore,
    resolveConflict,
    retry,
    fileToBackups,
    exportData,
    pickImport,
    applyImport,
    toDataError,
    describeError,
  }
}
