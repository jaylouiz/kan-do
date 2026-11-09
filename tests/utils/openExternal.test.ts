import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openExternal } from '~/utils/openExternal'

const openUrlMock = vi.fn()
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args: unknown[]) => openUrlMock(...args) }))
const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: handleErrorMock }) }))

function setDesktop(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

describe('openExternal (#71)', () => {
  const windowOpen = vi.fn()
  beforeEach(() => {
    openUrlMock.mockReset()
    handleErrorMock.mockReset()
    windowOpen.mockReset()
    vi.stubGlobal('open', windowOpen)
  })
  afterEach(() => {
    setDesktop(false)
    vi.unstubAllGlobals()
  })

  it('opens a new tab on web, without an opener reference', async () => {
    setDesktop(false)
    await openExternal('https://example.com/a')
    expect(windowOpen).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
    expect(openUrlMock).not.toHaveBeenCalled()
  })

  it('hands the URL to the system browser on desktop, never to window.open', async () => {
    setDesktop(true)
    openUrlMock.mockResolvedValue(undefined)
    await openExternal('https://example.com/a')
    expect(openUrlMock).toHaveBeenCalledWith('https://example.com/a')
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it('reports a rejecting opener through useErrorHandler and does not throw', async () => {
    setDesktop(true)
    const failure = new Error('not allowed')
    openUrlMock.mockRejectedValue(failure)
    await expect(openExternal('https://example.com/a')).resolves.toBeUndefined()
    expect(handleErrorMock).toHaveBeenCalledWith(failure, 'external_link')
  })
})
