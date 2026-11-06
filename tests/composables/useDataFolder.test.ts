import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appStorage, dataState, initDataStorage, resetDataStorage } from '~/lib/dataStorage'
import { useDataFolder } from '~/composables/useDataFolder'
import { middleEllipsis } from '~/utils/middleEllipsis'
import { createFakeDataBackend, type FakeDataBackend } from '../helpers/fakeDataBackend'

const envelope = (stores: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  writtenAt: '2026-01-01T00:00:00.000Z',
  writtenBy: 'device-1',
  appVersion: '0.1.0',
  stores,
})

let backend: FakeDataBackend

async function start(options: Parameters<typeof createFakeDataBackend>[0] = {}) {
  backend = createFakeDataBackend({ envelope: envelope(), ...options })
  await initDataStorage({ backend })
  await Promise.resolve()
  return useDataFolder()
}

beforeEach(() => {
  localStorage.clear()
  resetDataStorage()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetDataStorage()
})

describe('useDataFolder status', () => {
  it('is unavailable on web and never asks for attention', () => {
    const folder = useDataFolder()
    expect(folder.available.value).toBe(false)
    expect(folder.needsAttention.value).toBe(false)
  })

  it('needs no attention while ok', async () => {
    const folder = await start()
    expect(folder.available.value).toBe(true)
    expect(folder.status.value).toBe('ok')
    expect(folder.needsAttention.value).toBe(false)
  })

  it.each(['read-only-newer-schema', 'read-only-corrupt', 'missing-file', 'write-failed'] as const)(
    'asks for attention in %s and clears when the file is healthy again',
    async (status) => {
      const folder = await start({ status })
      expect(folder.needsAttention.value).toBe(true)
      expect(folder.isReadOnly.value).toBe(status !== 'write-failed')
      backend.emit({ status: 'ok' })
      expect(folder.needsAttention.value).toBe(false)
    },
  )

  it('follows write-failed events and recovers on the next successful write', async () => {
    const folder = await start()
    backend.emit({ status: 'write-failed', error: 'disk full' })
    expect(folder.needsAttention.value).toBe(true)
    expect(dataState.error).toBe('disk full')
    backend.emit({ status: 'ok', error: null })
    expect(folder.needsAttention.value).toBe(false)
  })
})

describe('useDataFolder actions', () => {
  it('chooseFolder returns null when the picker is cancelled and changes nothing', async () => {
    const folder = await start()
    backend.picked = null
    expect(await folder.chooseFolder()).toBeNull()
    expect(backend.calls.filter(call => call.startsWith('setLocation'))).toEqual([])
  })

  it('chooseFolder reports what the folder holds', async () => {
    const folder = await start({ folders: { '/cloud': { envelope: envelope() }, '/empty': {} } })
    backend.picked = '/cloud'
    expect((await folder.chooseFolder())?.info.existing).toBe('valid')
    backend.picked = '/empty'
    expect((await folder.chooseFolder())?.info).toMatchObject({ existing: 'none', writable: true })
  })

  it('moving into an empty folder switches without a reload', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const folder = await start({ folders: { '/empty': {} } })
    await folder.applyFolder('/empty', 'move')
    expect(dataState.folder).toBe('/empty')
    expect(reload).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('"use" reloads the window so the stores re-hydrate', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const folder = await start({ folders: { '/cloud': { envelope: envelope({ x: 1 }) } } })
    await folder.applyFolder('/cloud', 'use')
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('a refused move surfaces the error and keeps the current folder', async () => {
    const folder = await start({ folders: { '/cloud': { envelope: envelope() } } })
    await expect(folder.applyFolder('/cloud', 'move')).rejects.toMatchObject({ kind: 'target_has_data' })
    expect(dataState.folder).toBe('/data/default')
  })

  it('startFresh recreates the file from what is in memory', async () => {
    const folder = await start({ status: 'missing-file', envelope: null })
    appStorage.setItem('tasks-store', '{"tasks":[1]}')
    await folder.startFresh()
    expect(backend.initStores).toEqual({ 'tasks-store': { tasks: [1] } })
    expect(folder.status.value).toBe('ok')
  })

  it('flushNow reaches the backend and is harmless on web', async () => {
    await useDataFolder().flushNow()
    const folder = await start()
    await folder.flushNow()
    expect(backend.calls).toContain('flush')
  })

  it('revealInFinder asks the backend', async () => {
    const folder = await start()
    await folder.revealInFinder()
    expect(backend.calls).toContain('reveal')
  })
})

describe('middleEllipsis', () => {
  it('keeps short paths and shortens long ones in the middle', () => {
    expect(middleEllipsis('/Users/a/kan-do', 56)).toBe('/Users/a/kan-do')
    const long = '/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Projects/Example/kan-do'
    const short = middleEllipsis(long, 40)
    expect(short.length).toBe(40)
    expect(short.startsWith('/Users/')).toBe(true)
    expect(short.endsWith('kan-do')).toBe(true)
    expect(short).toContain('…')
  })
})
