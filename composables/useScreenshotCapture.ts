/**
 * @composable useScreenshotCapture
 * @description Takes the native snapshot of the app window for the feedback dialog (#247, ADR 014).
 * The caller has already dismissed the dialog and waited for its leave transition. This waits two
 * animation frames more (nothing of the dialog may be in the image), sets `html.kando-capture-mask`
 * while the toggle "Aufgabentexte schwärzen" is on (it hides `[data-private]` text behind the ink
 * token), calls `feedback_capture` and always removes the class again, also on error and timeout.
 * @responsibility
 * - `invoke('feedback_capture')` returns the PNG as raw bytes; they are decoded with
 *   `createImageBitmap(Blob)` and never turned into an `<img>` source (CSP stays `img-src 'self'`)
 * - Memory only: the result is handed to the caller, nothing is stored or logged
 */
import { isTauri } from '~/utils/isTauri'

/** Set on `<html>` for the instant of the capture only. The rule lives in `assets/css/utilities.css`. */
export const CAPTURE_MASK_CLASS = 'kando-capture-mask'

export type CaptureFailureKind = 'unsupported' | 'timeout' | 'too_large' | 'failed'

export class CaptureError extends Error {
  readonly kind: CaptureFailureKind

  constructor(kind: CaptureFailureKind) {
    super(`screenshot: ${kind}`)
    this.name = 'CaptureError'
    this.kind = kind
  }
}

/** An occluded, minimized or throttled window fires no animation frames: the wait must not hang the dialog. */
export const FRAME_TIMEOUT_MS = 2000

const nextFrame = () => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new CaptureError('timeout')), FRAME_TIMEOUT_MS)
  requestAnimationFrame(() => {
    clearTimeout(timer)
    resolve()
  })
})

/** Two frames: the compositor has dropped the dialog from the last paint. */
export async function waitForPaint(frames = 2): Promise<void> {
  for (let i = 0; i < frames; i += 1) await nextFrame()
}

function toCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error
  const kind = (error as { kind?: unknown } | null)?.kind
  return new CaptureError(kind === 'unsupported' || kind === 'timeout' || kind === 'too_large' ? kind : 'failed')
}

function toBytes(raw: unknown): ArrayBuffer {
  if (raw instanceof ArrayBuffer) return raw
  if (ArrayBuffer.isView(raw)) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
  if (Array.isArray(raw)) return new Uint8Array(raw as number[]).buffer
  throw new CaptureError('failed')
}

export function useScreenshotCapture() {
  /** Whether a native capture can work here: desktop app only. */
  const available = isTauri()

  /**
   * Captures the window. `mask` hides private task text for the instant of the capture.
   * Rejects with a `CaptureError`; the class is removed in every case.
   */
  async function capture(options: { mask: boolean }): Promise<ImageBitmap> {
    if (!isTauri()) throw new CaptureError('unsupported')
    await waitForPaint()
    const root = document.documentElement
    let bytes: ArrayBuffer
    try {
      if (options.mask) {
        root.classList.add(CAPTURE_MASK_CLASS)
        await nextFrame()
      }
      const { invoke } = await import('@tauri-apps/api/core')
      bytes = toBytes(await invoke<unknown>('feedback_capture'))
    } catch (error) {
      throw toCaptureError(error)
    } finally {
      root.classList.remove(CAPTURE_MASK_CLASS)
    }
    try {
      return await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    } catch {
      throw new CaptureError('failed')
    }
  }

  return { available, capture }
}
