/**
 * @module tauriStub
 * @description Browser-side stand-in for the Tauri IPC of the desktop app (#223). Installs
 * `window.__TAURI_INTERNALS__.invoke` before any page script runs (`context.addInitScript`), so the
 * app sees "desktop" (`isTauri()`), reads and writes an in-memory Keychain and talks to a fake
 * `github_request`. It mirrors the contract of `src-tauri/src/secrets.rs` and `github.rs`:
 *  - `secret_get` refuses the GitHub entries, `secret_status` reports `{ state, present, last4, rejected, source }`
 *    (`source`: `keychain`, or `gh_cli` for the feedback entry with `feedbackFromGh`, #280)
 *  - `github_request` fails fast with `rejected` once a 401 was seen, until a new token is saved;
 *    `POST .../issues` answers 201 (#4711) without any network, the request stays in `calls`
 *
 * The `data_*` commands mirror `src-tauri/src/data_file.rs` (#222): a fake data file per folder, the
 * `data-status` event (`emitDataStatus`) and the native folder picker (`plugin:dialog|open`, answers
 * `data.pick`). #224 adds the backup store (`data.backups`), conflict copies, the conflict choice
 * (`data.theirs` is the other version), the save and open dialogs and export/import. Without options the app starts as a first run: the stub reports `needsInit` and the
 * app imports `localStorage` into the fake file.
 *
 * `mockIPC` from `@tauri-apps/api/mocks` cannot run inside an init script (it is an ES module the page
 * does not load), so this implements the one thing it provides: the `invoke` handler.
 *
 * The updater commands mirror `src-tauri/src/updater.rs` (#225): `update_check` answers the configured
 * result, `update_install` emits `update://progress` and then succeeds, fails with a typed error or never
 * settles (`installHangs`, the "installing" state); `plugin:app|version`, `log_location` and `log_reveal`
 * back the version line and the log row.
 *
 * `feedback_capture` mirrors `src-tauri/src/capture.rs` (#247): it answers a generated PNG (never a shot of the
 * real app) as an ArrayBuffer and records whether the dialog was gone and the mask class set at that instant
 * (`captures`); `captureError` makes it fail with a typed error. `navigator.clipboard.write` is replaced by a
 * recorder (`clipboard`, `clipboardFails`). `github_request` knows the `feedback-assets` branch routes:
 * the mode `no-contents` answers 403 for every Contents/Git-data write, `issue-fails` answers 502 for issues.
 * `GET /repos/jaylouiz/kan-do` answers `permissions.push: true` (the owner), or `false` in the mode `read-only` (a
 * public user's token: the feedback takes the browser path).
 *
 * `menu_install` mirrors `src-tauri/src/menu.rs` (#614): it answers nothing, the labels stay in `calls`; `emitTauriEvent`
 * plays `menu://action` for a clicked custom menu item.
 *
 * The page-side state lives on `window.__tauriStub`; tests read `calls` and flip `githubMode` /
 * `keychainError` through `page.evaluate`. It is mirrored into sessionStorage so a reload keeps it.
 */
import type { BrowserContext, Page } from '@playwright/test'
import { emptyDataStatus } from '../../../lib/dataStatus'

export type GithubMode = 'ok' | 'unauthorized' | 'forbidden' | 'not-found' | 'offline' | 'slow-forbidden' | 'no-contents' | 'issue-fails' | 'read-only'

export type DataStubStatus =
  | 'ok'
  | 'read-only-newer-schema'
  | 'read-only-corrupt'
  | 'missing-file'
  | 'write-failed'
  | 'conflict'
  | 'folder-unavailable'

export interface BackupStub {
  name: string
  kind: string
  ts: string
  device6?: string
  ownDevice?: boolean
  taskCount?: number | null
  schemaVersion?: number | null
  readable?: boolean
  /** What a restore of this backup brings back. */
  envelope?: unknown
}

export interface ConflictCopyStub {
  name: string
  writtenAt: string
  writtenBy?: string
  taskCount?: number | null
  schemaVersion?: number
  envelope?: unknown
}

/** The `cloudSync` field of the status payload (#271). `visible: false` is a state still inside the grace. */
export interface CloudSyncStub {
  state: 'uploading' | 'pending' | 'error' | 'uploaded'
  message?: string | null
  since?: string | null
  visible: boolean
}

export interface DataStubFolder {
  /** Raw envelope of the file in this folder; absent means an empty folder. */
  envelope?: unknown
  corrupt?: boolean
  writable?: boolean
}

export interface DataStubOptions {
  status?: DataStubStatus
  folder?: string
  /** The file of the configured folder. Omit for a first run (nothing configured yet). */
  envelope?: unknown
  /** What the native picker answers; null cancels. */
  pick?: string | null
  /** Other folders the picker can return. */
  folders?: Record<string, DataStubFolder>
  backups?: BackupStub[]
  conflictCopies?: ConflictCopyStub[]
  backupError?: string | null
  /** iCloud upload state of the data file; null (default) is a folder that is not in iCloud. */
  cloudSync?: CloudSyncStub | null
  /** The other version while the status is `conflict`. */
  theirs?: unknown
  /** The conflict has unsaved edits of mine (default true). */
  localChanges?: boolean
  /** Answer of the save dialog; null cancels. */
  saveTarget?: string | null
  /** Answer of the file open dialog; null cancels. */
  openTarget?: string | null
  /** Contents by path for `data_import_read`. */
  importFiles?: Record<string, string>
  /** Every `data_backup` and the backup inside a conflict choice fails (disk full). */
  failBackup?: boolean
  /** `data_restore` fails with this error kind. */
  failRestore?: string | null
  /** `data_retry` brings a `folder-unavailable` state back to `ok`. */
  retryRecovers?: boolean
}

export interface DataStubState {
  configured: boolean
  status: DataStubStatus
  folder: string
  envelope: unknown
  writtenAt: string | null
  error: string | null
  pick: string | null
  folders: Record<string, DataStubFolder>
  /** Mirrors Rust: bumped by `data_load` and a `use` switch; `data_set` must carry the current one. */
  generation: number
  /** Highest `seq` applied per key in this generation. */
  appliedSeq: Record<string, number>
  backups: BackupStub[]
  conflictCopies: ConflictCopyStub[]
  backupError: string | null
  cloudSync: CloudSyncStub | null
  theirs: unknown
  localChanges: boolean
  saveTarget: string | null
  openTarget: string | null
  importFiles: Record<string, string>
  failBackup: boolean
  failRestore: string | null
  retryRecovers: boolean
  exported: { path: string; contents: string } | null
}

export interface UpdateStubResult {
  status: 'up-to-date' | 'available' | 'rejected' | 'offline' | 'no-release-or-access'
    | 'rate-limited' | 'not-configured' | 'error'
  currentVersion?: string
  version?: string
  notes?: string
  reason?: string
}

export interface UpdateStubOptions {
  appVersion?: string
  /** What `update_check` answers. Default: up to date. */
  check?: UpdateStubResult
  /** `update_install` rejects with this (`{ kind, reason? }`). */
  installFailure?: { kind: string; reason?: string }
  /** `update_install` emits progress and then never settles. */
  installHangs?: boolean
}

export interface TauriStubOptions {
  data?: DataStubOptions
  update?: UpdateStubOptions
  /** Keychain content at start, by account name. */
  entries?: Record<string, string>
  githubMode?: GithubMode
  /** The feedback token comes from the developer's GitHub CLI login: status `source: 'gh_cli'`, the Keychain stays untouched (#280). */
  feedbackFromGh?: boolean
  /** Every Keychain command fails with `{ kind: 'keychain' }`. */
  keychainError?: boolean
  /** `feedback_capture` rejects with `{ kind }` (#247). */
  captureError?: string
  /** The feedback-assets branch exists at start (default true); false makes the first send bootstrap it. */
  assetsBranch?: boolean
}

export interface TauriStubState {
  update: Required<Pick<UpdateStubOptions, 'appVersion'>> & UpdateStubOptions & { lastChecked: string | null }
  entries: Record<string, string>
  rejected: Record<string, boolean>
  /** What the fake `log_tail` answers. */
  logTail: string
  githubMode: GithubMode
  feedbackFromGh: boolean
  keychainError: boolean
  captureError: string | null
  assetsBranch: boolean
  /** One entry per `feedback_capture`: was the dialog gone, was `html.kando-capture-mask` set. */
  captures: Array<{ dialogPresent: boolean, mask: boolean }>
  clipboard: Array<{ type: string, size: number }>
  clipboardFails: boolean
  calls: Array<{ cmd: string; args: Record<string, unknown> }>
  openedUrls: string[]
  data: DataStubState
}

export async function installTauriStub(context: BrowserContext, options: TauriStubOptions = {}): Promise<void> {
  // The empty status comes from the app's factory; the init script cannot import it, so it is passed in.
  await context.addInitScript(({ opts, emptyStatus }) => {
    const STORAGE_KEY = '__tauriStub'
    const saved = sessionStorage.getItem(STORAGE_KEY)
    const state: TauriStubState = saved
      ? JSON.parse(saved)
      : {
          update: {
            appVersion: opts.update?.appVersion ?? '0.1.0',
            check: opts.update?.check ?? { status: 'up-to-date' },
            installFailure: opts.update?.installFailure,
            installHangs: opts.update?.installHangs ?? false,
            lastChecked: null,
          },
          entries: { ...(opts.entries ?? {}) },
          rejected: {},
          logTail: '12:00:00 INFO update check: up-to-date',
          githubMode: opts.githubMode ?? 'ok',
          feedbackFromGh: opts.feedbackFromGh ?? false,
          keychainError: opts.keychainError ?? false,
          captureError: opts.captureError ?? null,
          assetsBranch: opts.assetsBranch ?? true,
          captures: [],
          clipboard: [],
          clipboardFails: false,
          calls: [],
          openedUrls: [],
          data: {
            configured: opts.data?.envelope !== undefined,
            status: opts.data?.status ?? 'ok',
            folder: opts.data?.folder ?? '/Users/test/Library/Application Support/io.github.jaylouiz.kan-do',
            envelope: opts.data?.envelope ?? null,
            writtenAt: opts.data?.envelope !== undefined ? '2026-01-01T10:00:00.000Z' : null,
            error: null,
            pick: opts.data?.pick ?? null,
            folders: opts.data?.folders ?? {},
            generation: 0,
            appliedSeq: {},
            backups: opts.data?.backups ?? [],
            conflictCopies: opts.data?.conflictCopies ?? [],
            backupError: opts.data?.backupError ?? null,
            cloudSync: opts.data?.cloudSync ?? null,
            theirs: opts.data?.theirs ?? null,
            localChanges: opts.data?.localChanges ?? true,
            saveTarget: opts.data?.saveTarget ?? null,
            openTarget: opts.data?.openTarget ?? null,
            importFiles: opts.data?.importFiles ?? {},
            failBackup: opts.data?.failBackup ?? false,
            failRestore: opts.data?.failRestore ?? null,
            retryRecovers: opts.data?.retryRecovers ?? false,
            exported: null,
          },
        }
    const persist = () => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    const ACCOUNTS = ['notion-token', 'todoist-token', 'github-updates', 'github-feedback']
    const READABLE = ['notion-token', 'todoist-token']

    const callbacks: Record<number, (event: unknown) => void> = {}
    const listeners: Array<{ event: string; handler: number; id: number }> = []
    let nextCallback = 0
    const emitEvent = (event: string, payload: unknown) => {
      for (const l of listeners) if (l.event === event) callbacks[l.handler]?.({ event, id: l.id, payload })
    }

    const FILE = 'kan-do-data.json'
    const data = state.data
    const dataPayload = () => ({
      ...emptyStatus,
      status: data.status,
      folder: data.folder,
      filePath: `${data.folder}/${FILE}`,
      writtenAt: data.writtenAt,
      schemaVersion: 2,
      deviceId: 'device-e2e',
      appVersion: '0.1.0',
      error: data.error,
      conflict: data.status === 'conflict'
        ? {
            theirs: {
              readable: true,
              writtenAt: (data.theirs as { writtenAt?: string } | null)?.writtenAt ?? '2026-10-24T09:12:00.000Z',
              writtenBy: (data.theirs as { writtenBy?: string } | null)?.writtenBy ?? 'other-device',
              taskCount: tasksOf(data.theirs),
              schemaVersion: (data.theirs as { schemaVersion?: number } | null)?.schemaVersion ?? 2,
            },
            localChanges: data.localChanges,
            mineTaskCount: tasksOf(data.envelope),
            autoReload: false,
          }
        : null,
      conflictCopies: data.conflictCopies.map(copy => ({
        name: copy.name,
        writtenAt: copy.writtenAt,
        writtenBy: copy.writtenBy ?? 'other-device',
        taskCount: copy.taskCount ?? tasksOf(copy.envelope),
        schemaVersion: copy.schemaVersion ?? 2,
      })),
      backupError: data.backupError,
      // Like Rust, only a state that may write reports the cloud.
      cloudSync: (data.status === 'ok' || data.status === 'write-failed') && data.cloudSync
        ? { message: null, since: null, ...data.cloudSync }
        : null,
    })
    const tasksOf = (envelope: unknown): number | null => {
      const tasks = (envelope as { stores?: { 'tasks-store'?: { tasks?: unknown } } } | null)?.stores?.['tasks-store']?.tasks
      return Array.isArray(tasks) ? tasks.length : null
    }
    const emitData = () => emitEvent('data-status', dataPayload())
    let backupCounter = 0
    const pushBackup = (kind: string, envelope: unknown, tsOffsetSeconds = 0) => {
      backupCounter += 1
      const ts = new Date(Date.now() + tsOffsetSeconds * 1000 + backupCounter).toISOString()
      const name = `${ts.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${kind}-e2e000.json`
      data.backups.push({
        name,
        kind,
        ts,
        device6: 'e2e000',
        ownDevice: true,
        taskCount: tasksOf(envelope),
        schemaVersion: 2,
        readable: true,
        envelope,
      })
      return name
    }
    const storesOf = (): Record<string, unknown> =>
      ((data.envelope as { stores?: Record<string, unknown> } | null)?.stores) ?? {}
    const makeEnvelope = (stores: Record<string, unknown>) => ({
      schemaVersion: 2,
      writtenAt: new Date().toISOString(),
      writtenBy: 'device-e2e',
      appVersion: '0.1.0',
      stores,
    })

    const fail = (kind: string, extra: Record<string, unknown> = {}) => Promise.reject({ kind, ...extra })
    const parse = (name: unknown) => (ACCOUNTS.includes(name as string) ? (name as string) : null)
    const statusOf = (entry: string) => {
      if (entry === 'github-feedback' && state.feedbackFromGh) {
        return { state: 'ok', present: true, last4: 'gh01', rejected: !!state.rejected[entry], source: 'gh_cli' }
      }
      const value = state.entries[entry]
      return {
        state: 'ok',
        present: value !== undefined,
        last4: value === undefined ? null : value.slice(-4),
        rejected: !!state.rejected[entry],
        source: 'keychain',
      }
    }

    const invoke = async (cmd: string, args: Record<string, unknown> = {}) => {
      state.calls.push({
        cmd,
        args: {
          ...args,
          value: args.value === undefined ? undefined : '<redacted>',
          token: args.token === undefined ? undefined : '<redacted>',
          // A base64 PNG would bloat the persisted call log: keep its head (the PNG signature) and its length.
          body: typeof (args.body as { content?: unknown } | undefined)?.content === 'string' && (args.body as { content: string }).content.length > 200
            ? { ...(args.body as object), content: `${(args.body as { content: string }).content.slice(0, 24)}…#${(args.body as { content: string }).content.length}` }
            : args.body,
        },
      })
      persist()
      if (cmd === 'plugin:event|listen') {
        const id = listeners.length + 1
        listeners.push({ event: String(args.event), handler: Number(args.handler), id })
        return id
      }
      if (cmd === 'plugin:event|unlisten') return null
      if (cmd === 'plugin:app|version') return state.update.appVersion
      if (cmd === 'log_location') return '/Users/test/Library/Logs/io.github.jaylouiz.kan-do'
      if (cmd === 'log_tail') return state.logTail
      if (cmd === 'feedback_capture') {
        state.captures.push({
          dialogPresent: !!document.querySelector('[data-testid="feedback-dialog"]'),
          mask: document.documentElement.classList.contains('kando-capture-mask'),
        })
        persist()
        if (state.captureError) throw { kind: state.captureError }
        // A generated fixture: noisy gradients, so a uniform redaction is distinguishable from the background.
        const canvas = document.createElement('canvas')
        canvas.width = 1200
        canvas.height = 800
        const ctx = canvas.getContext('2d')!
        for (let y = 0; y < 800; y += 8) {
          for (let x = 0; x < 1200; x += 8) {
            ctx.fillStyle = `rgb(${(x * 7 + y * 3) % 256}, ${(x * 5 + y * 11) % 256}, ${(x + y * 13) % 256})`
            ctx.fillRect(x, y, 8, 8)
          }
        }
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        return blob!.arrayBuffer()
      }
      if (cmd === 'log_reveal') return null
      // Native menu bar (#614): the labels the app sent stay in `calls`.
      if (cmd === 'menu_install') return null
      if (cmd === 'update_check') {
        const check = state.update.check ?? { status: 'up-to-date' }
        state.update.lastChecked = new Date().toISOString()
        persist()
        return { currentVersion: state.update.appVersion, ...check }
      }
      if (cmd === 'update_state') {
        return {
          last: state.update.lastChecked ? { currentVersion: state.update.appVersion, ...state.update.check } : null,
          lastCheckedAt: state.update.lastChecked,
          installing: false,
        }
      }
      if (cmd === 'update_install') {
        for (const downloaded of [25, 60, 100]) emitEvent('update://progress', { downloaded, total: 100 })
        if (state.update.installHangs) return new Promise(() => undefined)
        if (state.update.installFailure) return Promise.reject(state.update.installFailure)
        return null
      }
      if (cmd === 'plugin:dialog|open') {
        const options = (args.options ?? {}) as { directory?: boolean }
        return options.directory ? data.pick : data.openTarget
      }
      if (cmd === 'plugin:dialog|save') return data.saveTarget
      if (cmd === 'data_load') {
        data.generation += 1
        data.appliedSeq = {}
        persist()
        return {
          ...dataPayload(),
          generation: data.generation,
          envelope: data.configured && !['missing-file', 'read-only-corrupt', 'folder-unavailable'].includes(data.status) ? data.envelope : null,
          needsInit: !data.configured,
        }
      }
      if (cmd === 'data_status') return dataPayload()
      if (cmd === 'data_set') {
        // Same guards as Rust: a stale generation or a reordered (not newer) seq is dropped.
        const key = String(args.key)
        const seq = Number(args.seq)
        if (args.generation !== data.generation || seq <= (data.appliedSeq[key] ?? 0)) return null
        data.appliedSeq[key] = seq
        const stores = { ...storesOf(), [String(args.key)]: args.value }
        if (data.status === 'ok' || data.status === 'write-failed') {
          data.envelope = makeEnvelope(stores)
          if (data.status === 'ok') data.writtenAt = new Date().toISOString()
        } else {
          // Blocked states keep the memory copy only; the file is never touched.
          data.envelope = data.envelope ?? makeEnvelope(stores)
        }
        persist()
        return null
      }
      if (cmd === 'data_flush') return null
      if (cmd === 'data_backup') {
        if (data.failBackup) return fail('backup_failed', { message: 'disk full' })
        if (data.status !== 'ok' && data.status !== 'write-failed' && data.status !== 'read-only-newer-schema') {
          return fail('blocked', { status: data.status })
        }
        const name = pushBackup(String(args.kind), data.envelope)
        persist()
        return name
      }
      if (cmd === 'data_backup_list') {
        return [...data.backups]
          .sort((a, b) => (a.ts < b.ts ? 1 : -1))
          .map(({ envelope: _envelope, ...entry }) => ({
            device6: 'e2e000',
            ownDevice: true,
            taskCount: null,
            schemaVersion: 2,
            readable: true,
            ...entry,
          }))
      }
      if (cmd === 'data_restore') {
        if (data.failRestore) return fail(data.failRestore)
        // Same gate as Rust (`Inner::restorable`): a conflict, a newer schema and a gone folder refuse.
        if (['conflict', 'read-only-newer-schema', 'folder-unavailable'].includes(data.status)) return fail('blocked', { status: data.status })
        const name = String(args.name)
        const source = data.backups.find(b => b.name === name) ?? data.conflictCopies.find(c => c.name === name)
        if (!source || !('envelope' in source) || source.envelope === undefined) return fail('invalid')
        if (data.failBackup) return fail('backup_failed', { message: 'disk full' })
        pushBackup('pre-restore', data.envelope)
        data.envelope = source.envelope
        data.writtenAt = new Date().toISOString()
        data.status = 'ok'
        data.generation += 1
        data.appliedSeq = {}
        persist()
        emitData()
        return dataPayload()
      }
      if (cmd === 'data_resolve_conflict') {
        if (data.status !== 'conflict') return fail('blocked', { status: data.status })
        if (data.failBackup) return fail('backup_failed', { message: 'disk full' })
        if (args.choice === 'mine') {
          pushBackup('conflict', data.theirs)
          data.envelope = makeEnvelope(storesOf())
        } else {
          if (data.localChanges) pushBackup('unsaved', data.envelope)
          data.envelope = data.theirs
          data.generation += 1
          data.appliedSeq = {}
        }
        data.status = 'ok'
        data.theirs = null
        data.writtenAt = new Date().toISOString()
        persist()
        emitData()
        return dataPayload()
      }
      if (cmd === 'data_file_to_backups') {
        const name = String(args.name)
        const copy = data.conflictCopies.find(c => c.name === name)
        if (!copy) return fail('invalid')
        pushBackup('conflict', copy.envelope)
        data.conflictCopies = data.conflictCopies.filter(c => c.name !== name)
        persist()
        emitData()
        return dataPayload()
      }
      // Rust re-checks the folder, then returns the status payload's conflict copies.
      if (cmd === 'data_scan_conflict_copies') return dataPayload().conflictCopies
      if (cmd === 'data_retry') {
        if (data.status === 'folder-unavailable' && data.retryRecovers) {
          data.status = 'ok'
          data.error = null
          persist()
          emitData()
        }
        return dataPayload()
      }
      if (cmd === 'data_export') {
        data.exported = { path: String(args.path), contents: String(args.contents) }
        persist()
        return null
      }
      if (cmd === 'data_import_read') {
        const text = data.importFiles[String(args.path)]
        return text === undefined ? fail('io', { message: 'no such file' }) : text
      }
      if (cmd === 'data_import_apply') {
        if (data.failBackup) return fail('backup_failed', { message: 'disk full' })
        pushBackup('pre-restore', data.envelope)
        data.envelope = JSON.parse(String(args.contents))
        data.writtenAt = new Date().toISOString()
        data.status = 'ok'
        data.generation += 1
        data.appliedSeq = {}
        persist()
        emitData()
        return dataPayload()
      }
      if (cmd === 'data_init') {
        const stores = ((args.envelope as { stores?: Record<string, unknown> } | undefined)?.stores) ?? {}
        data.envelope = makeEnvelope(stores)
        data.configured = true
        data.status = 'ok'
        data.writtenAt = new Date().toISOString()
        persist()
        emitData()
        return dataPayload()
      }
      if (cmd === 'data_reveal') return null
      if (cmd === 'data_inspect_folder') {
        const folder = data.folders[String(args.folder)] ?? {}
        const existing = folder.corrupt ? 'corrupt' : folder.envelope === undefined ? 'none'
          : (folder.envelope as { schemaVersion?: number }).schemaVersion! > 2 ? 'newer-schema' : 'valid'
        return {
          writable: folder.writable ?? true,
          existing,
          writtenAt: folder.envelope === undefined ? null : '2026-01-02T10:00:00.000Z',
          isCurrent: String(args.folder) === data.folder,
        }
      }
      if (cmd === 'data_set_location') {
        const target = String(args.folder)
        const folder = data.folders[target] ?? {}
        const mode = String(args.mode)
        if (target === data.folder) return fail('same_folder')
        if (folder.writable === false) return fail('not_writable')
        if (mode === 'use') {
          if (folder.corrupt) return fail('target_corrupt')
          if (folder.envelope === undefined) return fail('target_empty')
          data.envelope = folder.envelope
          data.generation += 1
          data.appliedSeq = {}
          data.status = (folder.envelope as { schemaVersion?: number }).schemaVersion! > 2 ? 'read-only-newer-schema' : 'ok'
        } else {
          if (data.status === 'read-only-newer-schema') return fail('blocked', { status: data.status })
          if (mode === 'move' && (folder.envelope !== undefined || folder.corrupt)) return fail('target_has_data')
          const envelope = makeEnvelope(storesOf())
          data.folders[target] = { ...folder, envelope }
          data.envelope = envelope
          data.status = 'ok'
        }
        data.folder = target
        data.configured = true
        data.writtenAt = new Date().toISOString()
        persist()
        emitData()
        return { ...dataPayload(), generation: data.generation, envelope: mode === 'use' ? data.envelope : null, needsInit: false }
      }
      if (cmd === 'plugin:opener|open_url') {
        state.openedUrls.push(String(args.url))
        persist()
        return null
      }
      if (cmd === 'secret_get') {
        const entry = parse(args.entry)
        if (!entry) return fail('invalid_entry')
        if (!READABLE.includes(entry)) return fail('read_forbidden')
        if (state.keychainError) return fail('keychain')
        return state.entries[entry] ?? null
      }
      if (cmd === 'secret_set') {
        const entry = parse(args.entry)
        if (!entry) return fail('invalid_entry')
        if (state.keychainError) return fail('keychain')
        state.entries[entry] = String(args.value)
        Reflect.deleteProperty(state.rejected, entry)
        persist()
        return null
      }
      if (cmd === 'secret_delete') {
        const entry = parse(args.entry)
        if (!entry) return fail('invalid_entry')
        if (state.keychainError) return fail('keychain')
        Reflect.deleteProperty(state.entries, entry)
        Reflect.deleteProperty(state.rejected, entry)
        persist()
        return null
      }
      if (cmd === 'secret_status') {
        const names = (args.entries as string[] | undefined) ?? ACCOUNTS
        const out: Record<string, unknown> = {}
        for (const name of names) {
          out[name] = state.keychainError ? { state: 'error', kind: 'keychain' } : statusOf(name)
        }
        return out
      }
      if (cmd === 'github_request') {
        const entry = parse(args.entry)
        if (!entry || READABLE.includes(entry)) return fail('invalid_entry')
        // A candidate token (save checks before storing) neither needs a stored token nor sets the flag.
        const candidate = typeof args.token === 'string'
        if (!candidate && state.rejected[entry]) return fail('rejected')
        if (!candidate && state.entries[entry] === undefined && !(entry === 'github-feedback' && state.feedbackFromGh)) return fail('not_configured')
        if (state.githubMode === 'offline') return fail('network')
        if (state.githubMode === 'unauthorized') {
          if (!candidate) {
            state.rejected[entry] = true
            persist()
          }
          return fail('rejected')
        }
        if (state.githubMode === 'forbidden') return { status: 403, body: { message: 'Forbidden' } }
        if (state.githubMode === 'not-found') return { status: 404, body: { message: 'Not Found' } }
        // Token without Contents: write (#247): every Contents/Git-data write is refused, reads of the ref say "no such ref".
        const route = String(args.path).replace('/repos/jaylouiz/kan-do', '')
        const touchesContents = route.startsWith('/git/') || route.startsWith('/contents/')
        if (state.githubMode === 'no-contents' && touchesContents) {
          return { status: args.method === 'GET' ? 404 : 403, body: { message: 'Resource not accessible by personal access token' } }
        }
        // A send that is still running when the test tries to close the dialog (#254).
        if (state.githubMode === 'slow-forbidden') {
          await new Promise(resolve => setTimeout(resolve, 1500))
          return { status: 403, body: { message: 'Forbidden' } }
        }
        // The feedback's write-access check: the repository with the token user's permissions.
        if (args.method === 'GET' && route === '') {
          return { status: 200, body: { full_name: 'jaylouiz/kan-do', permissions: { admin: false, push: state.githubMode !== 'read-only', pull: true } } }
        }
        // The feedback-assets branch (#247): read, bootstrap and upload answer like GitHub, nothing leaves the stub.
        if (args.method === 'GET' && route === '/git/ref/heads/feedback-assets') {
          return state.assetsBranch ? { status: 200, body: { ref: 'refs/heads/feedback-assets' } } : { status: 404, body: { message: 'Not Found' } }
        }
        if (args.method === 'POST' && ['/git/blobs', '/git/trees', '/git/commits'].includes(route)) {
          return { status: 201, body: { sha: 'stub-sha' } }
        }
        if (args.method === 'POST' && route === '/git/refs') {
          state.assetsBranch = true
          persist()
          return { status: 201, body: { ref: 'refs/heads/feedback-assets' } }
        }
        if (args.method === 'PUT' && route.startsWith('/contents/')) {
          return { status: 201, body: { content: { path: route.slice('/contents/'.length) } } }
        }
        if (state.githubMode === 'issue-fails' && args.method === 'POST' && route === '/issues') {
          return { status: 502, body: { message: 'Bad Gateway' } }
        }
        // Issue creation (#227): never reaches GitHub; the body is in `calls` for assertions.
        if (args.method === 'POST' && String(args.path).endsWith('/issues')) {
          return { status: 201, body: { number: 4711, html_url: 'https://github.com/jaylouiz/kan-do/issues/4711' } }
        }
        return { status: 200, body: [] }
      }
      return null
    }

    // The system clipboard is not reachable in the test browser: record what would be written (#247).
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          if (state.clipboardFails) throw new Error('clipboard denied')
          for (const item of items) {
            for (const type of item.types) {
              state.clipboard.push({ type, size: (await item.getType(type)).size })
            }
          }
          persist()
        },
      },
    })

    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke,
      transformCallback: (callback: (event: unknown) => void) => {
        nextCallback += 1
        callbacks[nextCallback] = callback
        return nextCallback
      },
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    }
    ;(window as unknown as Record<string, unknown>).__emitEvent = emitEvent
    ;(window as unknown as Record<string, unknown>).__emitDataStatus = (patch: Partial<DataStubState>) => {
      Object.assign(data, patch)
      persist()
      emitData()
    }
    ;(window as unknown as Record<string, unknown>).__tauriStub = new Proxy(state, {
      set(target, key, value) {
        ;(target as unknown as Record<string | symbol, unknown>)[key] = value
        persist()
        return true
      },
    })
  }, { opts: options, emptyStatus: emptyDataStatus() })
}

export async function stubState(page: Page): Promise<TauriStubState> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { __tauriStub: unknown }).__tauriStub)) as TauriStubState)
}

/** Flips how the fake GitHub answers from now on. */
export async function setGithubMode(page: Page, mode: GithubMode): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __tauriStub: { githubMode: string } }).__tauriStub.githubMode = value
  }, mode)
}

/** Plays a `data-status` event: patches the fake file state (`status`, `error`, ...) and notifies the app. */
export async function emitDataStatus(
  page: Page,
  patch: Partial<Pick<DataStubState, 'status' | 'error' | 'writtenAt' | 'conflictCopies' | 'backupError' | 'cloudSync' | 'theirs' | 'localChanges' | 'backups' | 'retryRecovers'>>,
): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __emitDataStatus: (p: unknown) => void }).__emitDataStatus(value)
  }, patch)
}

/** Plays a Tauri event to the app's listeners, e.g. `menu://action` when a native menu item is clicked (#614). */
export async function emitTauriEvent(page: Page, event: string, payload: unknown): Promise<void> {
  await page.evaluate(({ name, value }) => {
    ;(window as unknown as { __emitEvent: (e: string, p: unknown) => void }).__emitEvent(name, value)
  }, { name: event, value: payload })
}

/** Changes what the fake `update_check` answers from now on. */
export async function setUpdateResult(page: Page, check: UpdateStubResult): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __tauriStub: { update: { check: unknown } } }).__tauriStub.update.check = value
  }, check)
}

/** Makes the next `update_install` fail with a typed error (or succeed again with `undefined`). */
export async function setInstallFailure(page: Page, failure: { kind: string; reason?: string } | undefined): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __tauriStub: { update: { installFailure: unknown } } }).__tauriStub.update.installFailure = value
  }, failure)
}

export interface GithubCall {
  entry: string
  method: string
  path: string
  body?: { title: string, body: string, labels: string[] } & Record<string, unknown>
}

/** Narrows `githubCalls`: `method` is exact (case-insensitive), `path` a string suffix or a RegExp. */
export interface GithubCallFilter {
  method?: string
  path?: string | RegExp
  /** Include the feedback's read-only write-access check (`GET /repos/jaylouiz/kan-do`); left out by default. */
  accessCheck?: boolean
}

const isAccessCheck = (call: GithubCall) => call.method.toUpperCase() === 'GET' && call.path === '/repos/jaylouiz/kan-do'

/**
 * The recorded `github_request` calls (token arguments are redacted by the stub), in call order.
 * Read them filtered (`githubCalls(page, { method: 'POST', path: '/issues' })`) rather than by
 * position: an extra call such as an open-time check shifts every index. The feedback dialog's access check is
 * left out unless `accessCheck: true`.
 */
export async function githubCalls(page: Page, filter: GithubCallFilter = {}): Promise<GithubCall[]> {
  const state = await stubState(page)
  const calls = state.calls.filter(call => call.cmd === 'github_request').map(call => call.args) as unknown as GithubCall[]
  const { method, path, accessCheck = false } = filter
  return calls.filter(call =>
    (accessCheck || !isAccessCheck(call))
    && (method === undefined || call.method.toUpperCase() === method.toUpperCase())
    && (path === undefined || (typeof path === 'string' ? call.path.endsWith(path) : path.test(call.path))))
}

/** Marks an entry as rejected, as after a 401 earlier in the session. */
export async function markRejected(page: Page, entry: string): Promise<void> {
  await page.evaluate((name) => {
    const stub = (window as unknown as { __tauriStub: { rejected: Record<string, boolean> } }).__tauriStub
    stub.rejected = { ...stub.rejected, [name]: true }
  }, entry)
}

/** Makes the fake clipboard fail (the browser denied the write). */
export async function setClipboardFails(page: Page, fails: boolean): Promise<void> {
  await page.evaluate((value) => {
    ;(window as unknown as { __tauriStub: { clipboardFails: boolean } }).__tauriStub.clipboardFails = value
  }, fails)
}
