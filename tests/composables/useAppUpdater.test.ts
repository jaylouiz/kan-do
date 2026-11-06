import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toastAddMock } from '../mocks/nuxt-imports'
import { resetAppUpdaterState, toInstallFailure, useAppUpdater, PROGRESS_EVENT } from '~/composables/useAppUpdater'
import type { UpdateCheckResult } from '~/types/updater'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

const unlistenMock = vi.fn()
let progressHandler: ((event: { payload: unknown }) => void) | null = null
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    expect(name).toBe(PROGRESS_EVENT)
    progressHandler = handler
    return unlistenMock
  }),
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '0.1.0') }))

const flushNowMock = vi.fn()
vi.mock('~/composables/useDataFolder', () => ({ useDataFolder: () => ({ flushNow: flushNowMock }) }))
const navigateToMock = vi.fn()
vi.mock('nuxt/app', () => ({ navigateTo: (...args: unknown[]) => navigateToMock(...args) }))

const available: UpdateCheckResult = { status: 'available', currentVersion: '0.1.0', version: '0.2.0', notes: 'N', publishedAt: '2026-10-27T09:00:00Z' }
const plain = (status: UpdateCheckResult['status']): UpdateCheckResult => ({ status, currentVersion: '0.1.0' })

function answer(map: Record<string, unknown>) {
  invokeMock.mockImplementation(async (command: string) => {
    const value = map[command]
    if (value instanceof Error) throw value
    if (typeof value === 'function') return (value as () => unknown)()
    return value
  })
}

describe('useAppUpdater', () => {
  beforeEach(() => {
    resetAppUpdaterState()
    vi.clearAllMocks()
    progressHandler = null
    flushNowMock.mockResolvedValue(undefined)
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  })
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('does nothing on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    const updater = useAppUpdater()
    expect(updater.available).toBe(false)
    expect(await updater.check()).toBeNull()
    await updater.install()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('records a check and exposes the pending update', async () => {
    answer({ update_check: available })
    const updater = useAppUpdater()
    expect(updater.update.value).toBeNull()
    const result = await updater.check()
    expect(result?.status).toBe('available')
    expect(updater.update.value).toEqual({ version: '0.2.0', currentVersion: '0.1.0', notes: 'N', publishedAt: '2026-10-27T09:00:00Z' })
    expect(updater.state.lastCheckedAt).not.toBeNull()
    expect(updater.state.checking).toBe(false)
  })

  it.each(['up-to-date', 'rejected', 'offline', 'no-release-or-access', 'rate-limited', 'not-configured', 'error'] as const)(
    'keeps %s as the status and exposes no update', async (status) => {
      answer({ update_check: plain(status) })
      const updater = useAppUpdater()
      await updater.check()
      expect(updater.state.result?.status).toBe(status)
      expect(updater.update.value).toBeNull()
    })

  it('turns a rejected invoke into a quiet error status', async () => {
    answer({ update_check: new Error('boom') })
    const updater = useAppUpdater()
    const result = await updater.check()
    expect(result).toMatchObject({ status: 'error', reason: 'unknown' })
  })

  it('keeps a found update when Rust answers busy to a check', async () => {
    answer({ update_check: available })
    const updater = useAppUpdater()
    await updater.check()
    answer({ update_check: () => { throw { kind: 'busy' } } })
    expect(await updater.check()).toBeNull()
    expect(updater.state.result).toEqual(available)
    expect(updater.update.value?.version).toBe('0.2.0')
    expect(updater.state.checking).toBe(false)
  })

  it('does not start a second check while one runs', async () => {
    let release: (value: UpdateCheckResult) => void = () => undefined
    invokeMock.mockImplementation(() => new Promise<UpdateCheckResult>((resolve) => { release = resolve }))
    const updater = useAppUpdater()
    const first = updater.check()
    expect(updater.state.checking).toBe(true)
    expect(await updater.check()).toBeNull()
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1))
    release(plain('up-to-date'))
    await first
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('reads the app version and hydrates the last result from Rust', async () => {
    answer({ update_state: { last: available, lastCheckedAt: '2026-10-27T09:10:00Z', installing: false } })
    const updater = useAppUpdater()
    await updater.loadVersion()
    await updater.hydrate()
    expect(updater.state.appVersion).toBe('0.1.0')
    expect(updater.update.value?.version).toBe('0.2.0')
    expect(updater.state.lastCheckedAt).toBe('2026-10-27T09:10:00Z')
  })

  it('hydrates installing only when Rust reports an install, not a running check', async () => {
    answer({ update_state: { last: null, lastCheckedAt: null, installing: false } })
    const updater = useAppUpdater()
    await updater.hydrate()
    expect(updater.state.installing).toBe(false)
    answer({ update_state: { last: null, lastCheckedAt: null, installing: true } })
    await updater.hydrate()
    expect(updater.state.installing).toBe(true)
  })

  describe('install', () => {
    async function withUpdate() {
      answer({ update_check: available })
      const updater = useAppUpdater()
      await updater.check()
      invokeMock.mockClear()
      return updater
    }

    it('flushes the data first, then installs, and tracks progress', async () => {
      const updater = await withUpdate()
      const order: string[] = []
      flushNowMock.mockImplementation(async () => { order.push('flush') })
      invokeMock.mockImplementation(async (command: string) => {
        order.push(command)
        progressHandler?.({ payload: { downloaded: 25, total: 100 } })
        expect(updater.percent.value).toBe(25)
        expect(updater.state.installing).toBe(true)
      })
      await updater.install()
      expect(order).toEqual(['flush', 'update_install'])
      expect(unlistenMock).toHaveBeenCalled()
      expect(updater.state.installError).toBeNull()
    })

    it('stops with flush_failed and never calls Rust when the flush fails', async () => {
      const updater = await withUpdate()
      flushNowMock.mockRejectedValue(new Error('io'))
      await updater.install()
      expect(updater.state.installError).toEqual({ kind: 'flush_failed' })
      expect(invokeMock).not.toHaveBeenCalled()
      expect(updater.state.installing).toBe(false)
    })

    it('shows the typed failure of Rust and can retry', async () => {
      const updater = await withUpdate()
      answer({ update_install: () => { throw { kind: 'data_blocked', reason: 'folder-unavailable' } } })
      await updater.install()
      expect(updater.state.installError).toEqual({ kind: 'data_blocked', reason: 'folder-unavailable' })
      answer({ update_install: undefined })
      await updater.install()
      expect(updater.state.installError).toBeNull()
    })

    it('forgets a failed attempt when the dialog closes or a new check runs', async () => {
      const updater = await withUpdate()
      answer({ update_install: () => { throw { kind: 'install_failed' } }, update_check: available })
      updater.openDialog()
      await updater.install()
      expect(updater.state.installError).not.toBeNull()
      updater.closeDialog()
      expect(updater.state.installError).toBeNull()
      await updater.install()
      expect(updater.state.installError).not.toBeNull()
      await updater.check()
      expect(updater.state.installError).toBeNull()
    })

    it('ignores a second install while one runs and without a found update', async () => {
      const idle = useAppUpdater()
      await idle.install()
      expect(invokeMock).not.toHaveBeenCalled()

      const updater = await withUpdate()
      let finish: () => void = () => undefined
      invokeMock.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
      const first = updater.install()
      await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_install'))
      await updater.install()
      expect(flushNowMock).toHaveBeenCalledTimes(1)
      finish()
      await first
    })

    it('cannot close the dialog while installing', async () => {
      const updater = await withUpdate()
      updater.openDialog()
      expect(updater.state.dialogOpen).toBe(true)
      let finish: () => void = () => undefined
      invokeMock.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
      const running = updater.install()
      await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('update_install'))
      updater.closeDialog()
      expect(updater.state.dialogOpen).toBe(true)
      finish()
      await running
      updater.closeDialog()
      expect(updater.state.dialogOpen).toBe(false)
    })
  })

  describe('notices', () => {
    it('shows the start-up toast once per session, only for an update, with a Details action', async () => {
      answer({ update_check: available })
      const updater = useAppUpdater()
      updater.announceAvailable()
      expect(toastAddMock).not.toHaveBeenCalled()
      await updater.check()
      updater.announceAvailable()
      updater.announceAvailable()
      expect(toastAddMock).toHaveBeenCalledTimes(1)
      const toast = toastAddMock.mock.calls[0]![0] as { title: string, actions: Array<{ onClick: () => void }> }
      expect(toast.title).toContain('0.2.0')
      toast.actions[0]!.onClick()
      expect(updater.state.dialogOpen).toBe(true)
    })

    it('manual check: dialog for an update, toast when current, the page otherwise', async () => {
      const updater = useAppUpdater()
      answer({ update_check: available })
      await updater.checkManually()
      expect(updater.state.dialogOpen).toBe(true)

      resetAppUpdaterState()
      answer({ update_check: plain('up-to-date') })
      await updater.checkManually()
      expect(toastAddMock).toHaveBeenCalledTimes(1)
      expect(navigateToMock).not.toHaveBeenCalled()

      for (const status of ['rate-limited', 'offline', 'rejected'] as const) {
        navigateToMock.mockClear()
        answer({ update_check: plain(status) })
        await updater.checkManually()
        expect(navigateToMock).toHaveBeenCalledWith('/settings/updates')
      }
    })

    it('manual check is a no-op when no check ran (one is already running)', async () => {
      const updater = useAppUpdater()
      let release: (value: UpdateCheckResult) => void = () => undefined
      invokeMock.mockImplementation(() => new Promise<UpdateCheckResult>((resolve) => { release = resolve }))
      const running = updater.check()
      await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1))
      navigateToMock.mockClear()
      toastAddMock.mockClear()
      await updater.checkManually()
      expect(navigateToMock).not.toHaveBeenCalled()
      expect(toastAddMock).not.toHaveBeenCalled()
      release(plain('up-to-date'))
      await running

      // Rust busy after a reload: JS idle, Rust rejects with `busy`.
      answer({ update_check: () => { throw { kind: 'busy' } } })
      await updater.checkManually()
      expect(navigateToMock).not.toHaveBeenCalled()
    })
  })

  it('normalises install failures', () => {
    expect(toInstallFailure({ kind: 'data_blocked', reason: 'unreadable' })).toEqual({ kind: 'data_blocked', reason: 'unreadable' })
    expect(toInstallFailure({ kind: 'data_blocked' })).toEqual({ kind: 'data_blocked', reason: 'folder-unavailable' })
    expect(toInstallFailure({ kind: 'backup_failed' })).toEqual({ kind: 'backup_failed' })
    expect(toInstallFailure(new Error('x'))).toEqual({ kind: 'install_failed' })
    expect(toInstallFailure(null)).toEqual({ kind: 'install_failed' })
  })
})
