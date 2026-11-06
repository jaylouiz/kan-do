import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_RELOAD_GAP_MS, conflictOpen, resetConflictFlow, useConflictAutoOpen } from '~/composables/useDataConflictFlow'
import { resetCloudNoticeDismissal, useDataFolder } from '~/composables/useDataFolder'
import { initDataStorage, resetDataStorage, appStorage, dataState } from '~/lib/dataStorage'
import type { BackupEntry, CloudSync, ConflictCopy, ConflictInfo } from '~/types/dataFile'
import { createFakeDataBackend, type FakeDataBackend } from '../helpers/fakeDataBackend'

const envelope = (stores: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  writtenAt: '2026-01-01T00:00:00.000Z',
  writtenBy: 'device-1',
  appVersion: '0.1.0',
  stores,
})

const conflictInfo = (patch: Partial<ConflictInfo> = {}): ConflictInfo => ({
  theirs: { readable: true, writtenAt: '2026-10-24T09:12:00.000Z', writtenBy: 'other', taskCount: 31, schemaVersion: 1 },
  localChanges: true,
  mineTaskCount: 29,
  autoReload: false,
  ...patch,
})

const entry = (patch: Partial<BackupEntry> = {}): BackupEntry => ({
  name: '20261024T091200Z-daily-aaaaaa.json',
  kind: 'daily',
  ts: '2026-10-24T09:12:00.000Z',
  device6: 'aaaaaa',
  ownDevice: true,
  taskCount: 23,
  schemaVersion: 1,
  readable: true,
  ...patch,
})

let backend: FakeDataBackend
let reload: ReturnType<typeof vi.fn>

async function start(options: Parameters<typeof createFakeDataBackend>[0] = {}) {
  backend = createFakeDataBackend({ envelope: envelope(), ...options })
  await initDataStorage({ backend })
  await Promise.resolve()
  return useDataFolder()
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetDataStorage()
  resetCloudNoticeDismissal()
  resetConflictFlow()
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetDataStorage()
})

const cloud = (patch: Partial<CloudSync> = {}): CloudSync => ({ state: 'pending', message: null, since: '2026-10-27T10:00:00.000Z', visible: true, ...patch })

describe('cloud upload state (#271)', () => {
  it('stays quiet for a plain folder, inside the grace and once uploaded', async () => {
    const folder = await start()
    expect(folder.cloudNotice.value).toBeNull()
    for (const sync of [null, cloud({ visible: false }), cloud({ state: 'uploaded', since: null, visible: false })]) {
      backend.emit({ cloudSync: sync })
      expect(folder.cloudNotice.value).toBeNull()
      expect(folder.needsAttention.value).toBe(false)
    }
  })

  it('asks for attention for a late upload and an upload error, never blocking', async () => {
    const folder = await start()
    backend.emit({ cloudSync: cloud() })
    expect(folder.cloudNotice.value?.state).toBe('pending')
    expect(folder.needsAttention.value).toBe(true)
    backend.emit({ cloudSync: cloud({ state: 'error', message: 'offline' }) })
    expect(folder.cloudNotice.value?.state).toBe('error')
    expect(folder.status.value).toBe('ok')
    expect(folder.isReadOnly.value).toBe(false)
  })

  it('clears by itself when iCloud reports uploaded', async () => {
    const folder = await start()
    backend.emit({ cloudSync: cloud() })
    backend.emit({ cloudSync: cloud({ state: 'uploaded', since: null, visible: false }) })
    expect(folder.cloudNotice.value).toBeNull()
    expect(folder.needsAttention.value).toBe(false)
  })

  it('yields to every other status and to conflict copies', async () => {
    const folder = await start()
    const copy: ConflictCopy = { name: 'kan-do-data 2.json', writtenAt: '2026-10-24T09:12:00.000Z', writtenBy: 'x', taskCount: 21, schemaVersion: 1 }
    backend.emit({ cloudSync: cloud(), conflictCopies: [copy] })
    expect(folder.cloudNotice.value).toBeNull()
    backend.emit({ cloudSync: cloud(), conflictCopies: [], status: 'write-failed' })
    expect(folder.cloudNotice.value).toBeNull()
    expect(folder.needsAttention.value).toBe(true)
  })

  it('a payload without the field (web, older Rust) clears it', async () => {
    const folder = await start()
    backend.emit({ cloudSync: cloud() })
    backend.emit({ cloudSync: undefined })
    expect(dataState.cloudSync).toBeNull()
    expect(folder.cloudNotice.value).toBeNull()
  })

  describe('dismissal (#284)', () => {
    it('hides the notice, also for needsAttention, and a repeated emit of the same state keeps it hidden', async () => {
      const folder = await start()
      backend.emit({ cloudSync: cloud() })
      folder.dismissCloudNotice()
      expect(folder.cloudNotice.value).toBeNull()
      expect(folder.needsAttention.value).toBe(false)
      backend.emit({ cloudSync: cloud() })
      backend.emit({ cloudSync: cloud({ state: 'uploading' }) })
      expect(folder.cloudNotice.value).toBeNull()
    })

    it('is memory only', async () => {
      const folder = await start()
      backend.emit({ cloudSync: cloud() })
      folder.dismissCloudNotice()
      expect(JSON.stringify(Object.entries(localStorage))).not.toContain('dismiss')
    })

    it('stays hidden across uploaded then late again', async () => {
      const folder = await start()
      backend.emit({ cloudSync: cloud() })
      folder.dismissCloudNotice()
      backend.emit({ cloudSync: cloud({ state: 'uploaded', since: null, visible: false }) })
      backend.emit({ cloudSync: cloud() })
      expect(folder.cloudNotice.value).toBeNull()
    })

    it('stays hidden when the data folder changes', async () => {
      const folder = await start()
      backend.emit({ cloudSync: cloud(), folder: '/one' })
      folder.dismissCloudNotice()
      backend.emit({ cloudSync: cloud(), folder: '/two' })
      expect(folder.cloudNotice.value).toBeNull()
    })

    it('stays hidden when pending escalates to error', async () => {
      const folder = await start()
      backend.emit({ cloudSync: cloud() })
      folder.dismissCloudNotice()
      backend.emit({ cloudSync: cloud({ state: 'error', message: 'offline' }) })
      expect(folder.cloudNotice.value).toBeNull()
    })

    it('shows again in a fresh session (reload or restart)', async () => {
      const folder = await start()
      backend.emit({ cloudSync: cloud({ state: 'error', message: 'offline' }) })
      folder.dismissCloudNotice()
      expect(folder.cloudNotice.value).toBeNull()
      resetCloudNoticeDismissal()
      expect(folder.cloudNotice.value?.state).toBe('error')
    })

  })
})

describe('status model', () => {
  it('blocks writes in conflict and folder-unavailable and asks for attention', async () => {
    const folder = await start()
    for (const status of ['conflict', 'folder-unavailable'] as const) {
      backend.emit({ status })
      expect(folder.needsAttention.value).toBe(true)
      expect(folder.isReadOnly.value).toBe(true)
    }
    backend.emit({ status: 'ok' })
    expect(folder.isReadOnly.value).toBe(false)
  })

  it('conflict copies and backup errors are non-blocking fields of the same payload', async () => {
    const folder = await start()
    const copy: ConflictCopy = { name: 'kan-do-data 2.json', writtenAt: '2026-10-24T09:12:00.000Z', writtenBy: 'x', taskCount: 21, schemaVersion: 1 }
    backend.emit({ conflictCopies: [copy], backupError: 'disk full' })
    expect(folder.status.value).toBe('ok')
    expect(folder.isReadOnly.value).toBe(false)
    expect(folder.needsAttention.value).toBe(true)
    expect(folder.conflictCopies.value).toEqual([copy])
    expect(folder.backupError.value).toBe('disk full')
    backend.emit({ conflictCopies: [], backupError: null })
    expect(folder.needsAttention.value).toBe(false)
  })
})

describe('backups', () => {
  it('lists backups with a loading and an error state', async () => {
    const folder = await start({ backups: [entry(), entry({ name: 'b.json', kind: 'manual' })] })
    expect(folder.backupsLoad.value).toBe('idle')
    const pending = folder.refreshBackups()
    expect(folder.backupsLoad.value).toBe('loading')
    await pending
    expect(folder.backupsLoad.value).toBe('ready')
    expect(folder.backups.value).toHaveLength(2)

    vi.spyOn(backend, 'listBackups').mockRejectedValueOnce(new Error('offline'))
    await folder.refreshBackups()
    expect(folder.backupsLoad.value).toBe('error')
  })

  it('backupNow asks for a backup and refreshes the list', async () => {
    const folder = await start({ backups: [entry()] })
    const name = await folder.backupNow('manual')
    expect(name).toContain('manual')
    expect(backend.calls).toEqual(expect.arrayContaining(['backup:manual', 'listBackups']))
  })

  it('a failing backup rejects with backup_failed and the list is not touched', async () => {
    const folder = await start({ failBackup: true })
    await expect(folder.backupNow('pre-update')).rejects.toMatchObject({ kind: 'backup_failed' })
    expect(backend.calls).not.toContain('listBackups')
  })
})

describe('restore and import order', () => {
  it('restore flushes first, then replaces, then reloads', async () => {
    const folder = await start()
    reload.mockImplementation(() => backend.calls.push('reload'))
    await folder.restore('20261024T091200Z-daily-aaaaaa.json')
    expect(backend.calls.slice(-3)).toEqual(['flush', 'restore:20261024T091200Z-daily-aaaaaa.json', 'reload'])
  })

  it('a refused restore does not reload and keeps the failure', async () => {
    const folder = await start({ failRestore: 'newer_schema' })
    await expect(folder.restore('x.json')).rejects.toMatchObject({ kind: 'newer_schema' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('import validates first, then flushes, replaces and reloads; the stripped text is what Rust gets', async () => {
    const folder = await start()
    reload.mockImplementation(() => backend.calls.push('reload'))
    backend.openPath = '/tmp/in.json'
    backend.importText = JSON.stringify(envelope({ 'tasks-store': { tasks: [1, 2] }, notionConfig: { config: { token: 'SECRET', databaseId: 'db' } } }))
    const picked = await folder.pickImport()
    expect(picked.kind).toBe('ready')
    if (picked.kind !== 'ready') return
    expect(picked.preview).toMatchObject({ fileName: 'in.json', taskCount: 2 })
    expect(backend.calls).not.toContain('importApply')
    await folder.applyImport(picked.preview)
    expect(backend.calls.slice(-3)).toEqual(['flush', 'importApply', 'reload'])
    expect(backend.imported).not.toContain('SECRET')
  })

  it('pickImport reports cancel, junk, foreign files and newer schemas without changing anything', async () => {
    const folder = await start()
    expect(await folder.pickImport()).toEqual({ kind: 'cancelled' })
    backend.openPath = '/tmp/in.json'
    backend.importText = 'nope'
    expect(await folder.pickImport()).toEqual({ kind: 'failed', reason: 'invalid' })
    backend.importText = JSON.stringify({ hello: 1 })
    expect(await folder.pickImport()).toEqual({ kind: 'failed', reason: 'not-kan-do' })
    backend.importText = JSON.stringify(envelope({ 'tasks-store': { tasks: [] } }))
    backend.importText = backend.importText.replace('"schemaVersion":1', '"schemaVersion":99')
    expect(await folder.pickImport()).toEqual({ kind: 'failed', reason: 'newer-schema' })
    expect(backend.calls).not.toContain('importApply')
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('export', () => {
  it('cancelling the dialog writes nothing', async () => {
    const folder = await start()
    expect(await folder.exportData()).toBe('cancelled')
    expect(backend.exported).toBeNull()
  })

  it('writes the in-memory state without secrets to the picked path', async () => {
    const folder = await start()
    appStorage.setItem('tasks-store', JSON.stringify({ tasks: [{ id: 1 }] }))
    appStorage.setItem('notionConfig', JSON.stringify({ config: { token: 'SECRET', databaseId: 'db' } }))
    backend.savePath = '/tmp/out.json'
    expect(await folder.exportData()).toBe('saved')
    expect(backend.exported?.path).toBe('/tmp/out.json')
    expect(backend.exported?.contents).not.toContain('SECRET')
    expect(JSON.parse(backend.exported?.contents ?? '{}').stores['tasks-store']).toEqual({ tasks: [{ id: 1 }] })
  })
})

describe('conflict', () => {
  it('"Andere Version laden" reloads only after Rust kept my state; a failed backup stops the reload', async () => {
    const folder = await start()
    backend.emit({ status: 'conflict', conflict: conflictInfo() })
    reload.mockImplementation(() => backend.calls.push('reload'))
    await folder.resolveConflict('theirs')
    expect(backend.calls.slice(-2)).toEqual(['resolve:theirs', 'reload'])

    reload.mockClear()
    const failing = await start({ failBackup: true })
    backend.emit({ status: 'conflict', conflict: conflictInfo() })
    await expect(failing.resolveConflict('theirs')).rejects.toMatchObject({ kind: 'backup_failed' })
    expect(reload).not.toHaveBeenCalled()
  })

  it('"Diese Version behalten" does not reload and leaves the conflict', async () => {
    const folder = await start()
    backend.emit({ status: 'conflict', conflict: conflictInfo() })
    await folder.resolveConflict('mine')
    expect(reload).not.toHaveBeenCalled()
    expect(folder.status.value).toBe('ok')
    expect(folder.conflict.value).toBeNull()
  })

  it('files a conflict copy away and refreshes', async () => {
    const copy: ConflictCopy = { name: 'kan-do-data 2.json', writtenAt: 'x', writtenBy: 'y', taskCount: 1, schemaVersion: 1 }
    const folder = await start()
    backend.emit({ conflictCopies: [copy] })
    await folder.fileToBackups(copy.name)
    expect(folder.conflictCopies.value).toEqual([])
    expect(backend.calls).toContain('fileToBackups:kan-do-data 2.json')
  })

  it('retry asks Rust to look at the folder again', async () => {
    const folder = await start({ status: 'folder-unavailable' })
    await folder.retry()
    expect(backend.calls).toContain('retry')
  })
})

describe('conflict flow (auto-open, auto-reload)', () => {
  it('opens the modal once per conflict, keeps status on "Später" and re-arms afterwards', async () => {
    const folder = await start()
    useConflictAutoOpen()
    expect(conflictOpen.value).toBe(false)

    backend.emit({ status: 'conflict', conflict: conflictInfo() })
    await Promise.resolve()
    expect(conflictOpen.value).toBe(true)

    conflictOpen.value = false
    backend.emit({ conflict: conflictInfo({ localChanges: false }) })
    await Promise.resolve()
    expect(conflictOpen.value, 'dismissed once, not reopened by every status event').toBe(false)
    expect(folder.status.value).toBe('conflict')

    backend.emit({ status: 'ok', conflict: null })
    await Promise.resolve()
    backend.emit({ status: 'conflict', conflict: conflictInfo() })
    await Promise.resolve()
    expect(conflictOpen.value).toBe(true)
  })

  it('closes the modal when the conflict is resolved elsewhere', async () => {
    await start()
    useConflictAutoOpen()
    backend.emit({ status: 'conflict', conflict: conflictInfo() })
    await Promise.resolve()
    expect(conflictOpen.value).toBe(true)
    backend.emit({ status: 'ok', conflict: null })
    await Promise.resolve()
    expect(conflictOpen.value).toBe(false)
  })

  it('reloads on its own when the folder came back and nothing was edited, but never twice in a row', async () => {
    await start()
    let clock = 1_000_000
    useConflictAutoOpen(() => clock)
    backend.emit({ status: 'conflict', conflict: conflictInfo({ localChanges: false, autoReload: true }) })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(backend.calls).toContain('resolve:theirs')
    expect(conflictOpen.value).toBe(false)

    // The reload brought the page back and the same thing happens within the guard window: ask instead.
    resetConflictFlow()
    resetDataStorage()
    reload.mockClear()
    await start()
    clock += AUTO_RELOAD_GAP_MS - 1
    useConflictAutoOpen(() => clock)
    backend.emit({ status: 'conflict', conflict: conflictInfo({ localChanges: false, autoReload: true }) })
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    expect(conflictOpen.value).toBe(true)
  })

  it('falls back to the modal when the automatic resolve fails', async () => {
    await start({ failBackup: true })
    useConflictAutoOpen()
    backend.emit({ status: 'conflict', conflict: conflictInfo({ localChanges: false, autoReload: true }) })
    await vi.waitFor(() => expect(conflictOpen.value).toBe(true))
    expect(reload).not.toHaveBeenCalled()
  })

  it('sees the data state the notice reads', async () => {
    await start()
    backend.emit({ status: 'folder-unavailable', error: 'offline' })
    expect(dataState.status).toBe('folder-unavailable')
    expect(dataState.error).toBe('offline')
  })
})
