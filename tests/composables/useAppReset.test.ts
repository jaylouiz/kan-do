import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appStorage, initDataStorage, PERSISTED_KEYS, resetDataStorage } from '~/lib/dataStorage'
import { resetAppResetState, useAppReset } from '~/composables/useAppReset'
import { SECRET_ENTRIES } from '~/lib/secrets'
import { createFakeDataBackend } from '../helpers/fakeDataBackend'

const events: string[] = []
const removeSecret = vi.fn(async (entry: string) => { events.push(`remove:${entry}`) })

vi.mock('~/composables/useSecrets', () => ({ useSecrets: () => ({ remove: removeSecret }) }))
vi.mock('~/utils/reloadApp', () => ({ reloadApp: (path?: string) => { events.push(`reload:${path ?? ''}`) } }))

const setDesktop = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

function seedWeb() {
  for (const key of PERSISTED_KEYS) localStorage.setItem(key, `{"${key}":1}`)
  localStorage.setItem('notionConfig', '{"config":{"token":"secret_abc"}}')
  localStorage.setItem('statistics-backfill-state', '{}')
  localStorage.setItem('kando-locale', 'en')
}

beforeEach(() => {
  events.length = 0
  removeSecret.mockClear()
  removeSecret.mockImplementation(async (entry: string) => { events.push(`remove:${entry}`) })
  localStorage.clear()
  resetDataStorage()
  resetAppResetState()
})
afterEach(() => {
  setDesktop(false)
  resetDataStorage()
  vi.restoreAllMocks()
})

describe('app reset on web', () => {
  it('erases every persisted key and the backfill marker, keeps the language, reloads onto /welcome and drops later writes', async () => {
    seedWeb()
    const reset = useAppReset()
    await reset.confirm()

    for (const key of PERSISTED_KEYS) expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem('statistics-backfill-state')).toBeNull()
    expect(localStorage.getItem('kando-locale')).toBe('en')
    expect(events).toEqual(['reload:/welcome'])
    expect(removeSecret).not.toHaveBeenCalled() // no Keychain on web: the tokens lived in the blobs

    // A deferred store write after the commit must not bring the old state back
    appStorage.setItem('tasks-store', '{"tasks":[1]}')
    expect(localStorage.getItem('tasks-store')).toBeNull()
  })

  it('a failed commit keeps the old data, shows the failure, lifts the freeze and does not reload', async () => {
    seedWeb()
    const original = Storage.prototype.removeItem
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      if (key === 'trash-store') throw new Error('boom')
      original.call(this, key)
    })
    const reset = useAppReset()
    await reset.confirm()

    expect(reset.failure.value).toEqual({ kind: 'write' })
    expect(reset.busy.value).toBe(false)
    expect(events).toEqual([])
    for (const key of PERSISTED_KEYS) expect(localStorage.getItem(key)).not.toBeNull()
    appStorage.setItem('tasks-store', '{"tasks":[2]}') // writes work again
    expect(localStorage.getItem('tasks-store')).toBe('{"tasks":[2]}')
  })

  it('a second confirm while working does nothing', async () => {
    seedWeb()
    const reset = useAppReset()
    const first = reset.confirm()
    await reset.confirm()
    await first
    expect(events).toEqual(['reload:/welcome'])
  })
})

describe('app reset on desktop', () => {
  async function desktop(options: Parameters<typeof createFakeDataBackend>[0] = {}) {
    setDesktop(true)
    const backend = createFakeDataBackend(options)
    const flush = backend.flush
    backend.flush = async () => { events.push('flush'); await flush() }
    const apply = backend.importApply
    backend.importApply = async (contents) => { events.push('importApply'); return apply(contents) }
    await initDataStorage({ backend })
    return backend
  }

  it('flushes, replaces the data with an empty envelope, deletes every Keychain entry, then reloads onto /welcome', async () => {
    const backend = await desktop()
    localStorage.setItem('tasks-store', '{"stale":1}')
    localStorage.setItem('kando-locale', 'de')
    await useAppReset().confirm()

    expect(events).toEqual(['flush', 'importApply', ...SECRET_ENTRIES.map(entry => `remove:${entry}`), 'reload:/welcome'])
    expect(JSON.parse(backend.imported as string)).toMatchObject({ stores: {} })
    expect(localStorage.getItem('tasks-store')).toBeNull() // the frozen first-run copy is gone too
    expect(localStorage.getItem('kando-locale')).toBe('de')
    appStorage.setItem('tasks-store', '{"tasks":[1]}') // frozen: not even the mirror takes it
    expect(appStorage.getItem('tasks-store')).toBeNull()
  })

  it('erases nothing when the mandatory backup fails: no Keychain deletion, no reload, writes still work', async () => {
    await desktop({ failBackup: true })
    const reset = useAppReset()
    await reset.confirm()

    expect(reset.failure.value).toEqual({ kind: 'backup' })
    expect(removeSecret).not.toHaveBeenCalled()
    expect(events).not.toContain('reload:/welcome')
    appStorage.setItem('tasks-store', '{"tasks":[3]}')
    expect(appStorage.getItem('tasks-store')).toBe('{"tasks":[3]}')
  })

  it('a refused Keychain deletion keeps the dialog open and names the token; the retry skips the second replace and finishes', async () => {
    const backend = await desktop()
    removeSecret.mockImplementation(async (entry: string) => {
      if (entry === 'notion-token') throw new Error('keychain')
      events.push(`remove:${entry}`)
    })
    const reset = useAppReset()
    await reset.confirm()

    expect(reset.failure.value).toEqual({ kind: 'tokens', entries: ['Notion'] })
    expect(events).not.toContain('reload:/welcome')
    expect(backend.calls.filter(call => call === 'importApply')).toHaveLength(1)

    removeSecret.mockImplementation(async (entry: string) => { events.push(`remove:${entry}`) })
    await reset.confirm()
    expect(reset.failure.value).toBeNull()
    expect(backend.calls.filter(call => call === 'importApply')).toHaveLength(1) // a second pre-restore backup could push the real one out
    expect(events.at(-1)).toBe('reload:/welcome')
  })

  it('cancelling after a refused Keychain deletion reloads the app: the frozen old state never stays on screen', async () => {
    await desktop()
    removeSecret.mockImplementation(async () => { throw new Error('keychain') })
    const reset = useAppReset()
    await reset.confirm()
    expect(reset.failure.value?.kind).toBe('tokens')
    expect(events).not.toContain('reload:')

    // Writes are frozen and the data file is already empty: the only consistent way out is to boot from it
    reset.close()
    expect(events.at(-1)).toBe('reload:') // plain reload of the current page, not /welcome
    expect(reset.isOpen.value).toBe(false)
  })

  it('cancelling before anything was replaced does not reload', async () => {
    await desktop({ failBackup: true })
    const reset = useAppReset()
    await reset.confirm()
    reset.close()
    expect(events).not.toContain('reload:')
    expect(reset.isOpen.value).toBe(false)
  })

  it('after a completed run the dialog stays busy while the page leaves: a second confirm does nothing', async () => {
    await desktop()
    const reset = useAppReset()
    await reset.confirm()
    await reset.confirm()
    expect(events.filter(event => event === 'reload:/welcome')).toHaveLength(1)
    expect(events.filter(event => event === 'importApply')).toHaveLength(1)
  })

  it.each(['conflict', 'read-only-newer-schema', 'folder-unavailable'] as const)('does not run while the data is %s', async (status) => {
    await desktop({ status })
    const reset = useAppReset()
    expect(reset.block.value).not.toBeNull()
    await reset.confirm()
    expect(events).toEqual([])
    expect(removeSecret).not.toHaveBeenCalled()
  })
})
