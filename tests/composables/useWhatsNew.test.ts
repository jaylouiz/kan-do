import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppUpdaterState } from '~/composables/useAppUpdater'
import { GATE_POLL_MS, LAST_SEEN_KEY, TOAST_ID, resetWhatsNewState, useWhatsNew } from '~/composables/useWhatsNew'
import { toastAddMock } from '../mocks/nuxt-imports'

const bundleMock = vi.fn()
vi.mock('~/lib/releaseNotes', async (importActual) => ({
  ...(await importActual<typeof import('~/lib/releaseNotes')>()),
  loadBundledNotes: () => bundleMock(),
}))

let version = '0.3.0'
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => version) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('~/composables/useDataFolder', () => ({ useDataFolder: () => ({ flushNow: vi.fn() }) }))
vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))

const hl = (n: string) => ({ de: [{ title: `D${n}.`, text: 'de' }], en: [{ title: `E${n}.`, text: 'en' }] })

describe('useWhatsNew', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetAppUpdaterState()
    resetWhatsNewState()
    toastAddMock.mockClear()
    localStorage.clear()
    document.body.innerHTML = ''
    version = '0.3.0'
    bundleMock.mockResolvedValue([
      { version: '0.3.0', highlights: hl('3') },
      { version: '0.2.0', highlights: null },
      { version: '0.1.0', highlights: hl('1') },
    ])
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  })
  afterEach(() => {
    vi.useRealTimers()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('does nothing on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    await w.openReopen()
    expect(w.state.open).toBe(false)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBeNull()
  })

  it('first run: stores the current version and shows nothing', async () => {
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    expect(w.state.open).toBe(false)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.3.0')
  })

  it('downgrade: overwrites silently', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.9.0')
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    expect(w.state.open).toBe(false)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.3.0')
  })

  it('same version: nothing happens', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.3.0')
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    expect(w.state.open).toBe(false)
    expect(bundleMock).not.toHaveBeenCalled()
  })

  it('toasts once with a button, stores last-seen immediately and opens no dialog by itself', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1')
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    expect(w.state.open).toBe(false)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.3.0')
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    const toast = toastAddMock.mock.calls[0]![0]
    expect(toast.id).toBe(TOAST_ID)
    expect(toast.title).toBe('Aktualisiert auf Version 0.3.0')
    expect(toast.duration).toBe(10000)
    expect(toast.actions).toHaveLength(1)
    expect(toast.actions[0].label).toBe('Was ist neu')
  })

  it('the button opens the dialog with every version in between, newest first, and closing keeps last-seen', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1')
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    toastAddMock.mock.calls[0]![0].actions[0].onClick()
    expect(w.state.open).toBe(true)
    expect(w.state.entries.map(e => e.version)).toEqual(['0.3.0', '0.1.0'])
    w.close()
    expect(w.state.open).toBe(false)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.3.0')
  })

  it('only None. versions in between: toast without a button, last-seen advances', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.1.0')
    bundleMock.mockResolvedValue([{ version: '0.2.0', highlights: null }, { version: '0.3.0', highlights: null }])
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    expect(w.state.open).toBe(false)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.3.0')
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    expect(toastAddMock.mock.calls[0]![0].actions).toEqual([])
  })

  it('waits only for onboarding, not for an open dialog, and toasts once', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1')
    let onboarding = true
    const w = useWhatsNew()
    const done = w.checkAfterUpdate(() => onboarding)
    await vi.advanceTimersByTimeAsync(GATE_POLL_MS * 3)
    expect(toastAddMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.0.1')
    onboarding = false
    await vi.advanceTimersByTimeAsync(GATE_POLL_MS * 2)
    await done
    expect(toastAddMock).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.3.0')
  })

  it('toasts despite another open dialog (a toast is not modal)', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    expect(toastAddMock).toHaveBeenCalledTimes(1)
  })

  it('runs at most once per start', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1')
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1')
    await w.checkAfterUpdate()
    expect(toastAddMock).toHaveBeenCalledTimes(1)
  })

  it('unavailable storage: no toast', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const w = useWhatsNew()
    await w.checkAfterUpdate()
    spy.mockRestore()
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('re-open shows the newest versions and never changes last-seen', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.2.0')
    const w = useWhatsNew()
    await w.openReopen()
    expect(w.state.open).toBe(true)
    expect(w.state.entries.map(e => e.version)).toEqual(['0.3.0', '0.1.0'])
    w.close()
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.2.0')
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('re-open with no highlights has no entries', async () => {
    bundleMock.mockResolvedValue([{ version: '0.1.0', highlights: null }])
    const w = useWhatsNew()
    await w.openReopen()
    expect(w.state.open).toBe(true)
    expect(w.state.entries).toEqual([])
  })

  it('bundle load failure: no toast, no dialog, no throw, last-seen untouched, re-open retries', async () => {
    localStorage.setItem(LAST_SEEN_KEY, '0.0.1')
    bundleMock.mockRejectedValueOnce(new Error('chunk failed'))
    const w = useWhatsNew()
    await expect(w.checkAfterUpdate()).resolves.toBeUndefined()
    expect(w.state.open).toBe(false)
    expect(localStorage.getItem(LAST_SEEN_KEY)).toBe('0.0.1')
    expect(toastAddMock).not.toHaveBeenCalled()

    bundleMock.mockRejectedValueOnce(new Error('chunk failed'))
    await expect(w.openReopen()).resolves.toBeUndefined()
    expect(w.state.open).toBe(false)

    await w.openReopen()
    expect(w.state.open).toBe(true)
  })
})
