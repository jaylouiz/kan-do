import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPTURE_MASK_CLASS, CaptureError, useScreenshotCapture } from '~/composables/useScreenshotCapture'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

const bitmap = { width: 4, height: 3, close: vi.fn() }

const setDesktop = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

describe('useScreenshotCapture', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    setDesktop(true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
  })
  afterEach(() => {
    setDesktop(false)
    vi.unstubAllGlobals()
    document.documentElement.classList.remove(CAPTURE_MASK_CLASS)
  })

  it('masks private text only while the native capture runs, then removes the class', async () => {
    const during: boolean[] = []
    invokeMock.mockImplementation(async (cmd: string) => {
      during.push(document.documentElement.classList.contains(CAPTURE_MASK_CLASS))
      return cmd === 'feedback_capture' ? new Uint8Array([137, 80, 78, 71]).buffer : null
    })
    const result = await useScreenshotCapture().capture({ mask: true })
    expect(invokeMock).toHaveBeenCalledWith('feedback_capture')
    expect(during).toEqual([true])
    expect(document.documentElement.classList.contains(CAPTURE_MASK_CLASS)).toBe(false)
    expect(result).toBe(bitmap)
  })

  it('does not touch the page when the toggle is off', async () => {
    const during: boolean[] = []
    invokeMock.mockImplementation(async () => {
      during.push(document.documentElement.classList.contains(CAPTURE_MASK_CLASS))
      return new ArrayBuffer(4)
    })
    await useScreenshotCapture().capture({ mask: false })
    expect(during).toEqual([false])
  })

  it('removes the mask when the capture fails, with a typed error', async () => {
    invokeMock.mockRejectedValue({ kind: 'timeout' })
    const error = await useScreenshotCapture().capture({ mask: true }).catch(e => e)
    expect(error).toBeInstanceOf(CaptureError)
    expect((error as CaptureError).kind).toBe('timeout')
    expect(document.documentElement.classList.contains(CAPTURE_MASK_CLASS)).toBe(false)
  })

  it('maps unknown rejections to failed and a broken PNG to failed', async () => {
    invokeMock.mockRejectedValue(new Error('boom'))
    expect(((await useScreenshotCapture().capture({ mask: true }).catch(e => e)) as CaptureError).kind).toBe('failed')
    invokeMock.mockResolvedValue(new ArrayBuffer(4))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('bad png') }))
    expect(((await useScreenshotCapture().capture({ mask: true }).catch(e => e)) as CaptureError).kind).toBe('failed')
  })

  it('is unsupported on the web and never calls IPC there', async () => {
    setDesktop(false)
    const capture = useScreenshotCapture()
    expect(capture.available).toBe(false)
    expect(((await capture.capture({ mask: true }).catch(e => e)) as CaptureError).kind).toBe('unsupported')
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('writes nothing to any storage', async () => {
    invokeMock.mockResolvedValue(new ArrayBuffer(4))
    const set = vi.spyOn(Storage.prototype, 'setItem')
    await useScreenshotCapture().capture({ mask: true })
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
  })

  it('fails with a typed timeout when the window never paints (rAF stalls) and removes the mask', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('requestAnimationFrame', () => 0)
      const pending = useScreenshotCapture().capture({ mask: true }).catch(e => e)
      await vi.advanceTimersByTimeAsync(5000)
      const error = await pending
      expect(error).toBeInstanceOf(CaptureError)
      expect((error as CaptureError).kind).toBe('timeout')
      expect(invokeMock).not.toHaveBeenCalled()
      expect(document.documentElement.classList.contains(CAPTURE_MASK_CLASS)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
