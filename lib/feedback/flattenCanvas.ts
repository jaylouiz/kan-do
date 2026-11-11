/**
 * @module feedback/flattenCanvas
 * @description Annotation maths and the flatten step of the feedback screenshot (#247). The capture
 * and the marks live in canvas pixels of the native snapshot; "Fertig" draws everything onto one
 * canvas at most `FLATTEN_MAX_WIDTH` wide and re-encodes it as PNG, which burns redactions in and
 * drops all metadata. Pure helpers first (tested without a canvas), canvas helpers last.
 * Images only ever live in `ImageBitmap`, `<canvas>` and `Blob`: no `<img>` with a blob/data source,
 * so the `img-src 'self'` CSP stays as it is (ADR 014).
 */

export type AnnotationTool = 'rect' | 'arrow' | 'redact'

/** Two corner points in bitmap pixels, as dragged. */
export interface Annotation {
  tool: AnnotationTool
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Colours are resolved from CSS variables by the caller; canvas cannot read `var()`. */
export interface AnnotationColors {
  /** Opaque fill of a redaction. */
  redact: string
  /** Stroke of rectangles and arrows. */
  stroke: string
}

export const FLATTEN_MAX_WIDTH = 1600
/** Smallest width a PNG is shrunk to before the upload is refused as too large. */
export const FLATTEN_MIN_WIDTH = 480
/** The base64 request body must stay below the Rust cap (10 MiB) with room for the JSON around it. */
export const MAX_UPLOAD_PNG_BYTES = 7 * 1024 * 1024
/** Drags shorter than this (bitmap pixels) are taps, not marks. */
export const MIN_MARK_SIZE = 4

/** Scales down to `maxWidth` keeping the ratio; never scales up. */
export function fitSize(width: number, height: number, maxWidth = FLATTEN_MAX_WIDTH): { width: number, height: number, scale: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scale: 1 }
  const scale = width > maxWidth ? maxWidth / width : 1
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

/** Corner points in any drag direction to a positive rectangle. */
export function normaliseRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

/** Pointer position (CSS pixels) to bitmap pixels of a CSS-scaled canvas, clamped to the canvas. */
export function toBitmapPoint(
  clientX: number,
  clientY: number,
  box: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  bitmap: { width: number, height: number },
): { x: number, y: number } {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 }
  const x = ((clientX - box.left) / box.width) * bitmap.width
  const y = ((clientY - box.top) / box.height) * bitmap.height
  return { x: Math.min(bitmap.width, Math.max(0, x)), y: Math.min(bitmap.height, Math.max(0, y)) }
}

/** A drag long enough to count as a mark. */
export function isMark(annotation: Annotation): boolean {
  return Math.hypot(annotation.x2 - annotation.x1, annotation.y2 - annotation.y1) >= MIN_MARK_SIZE
}

/** The two short strokes of an arrow head at the end point. */
export function arrowHead(annotation: Annotation, size: number): Array<[number, number]> {
  const angle = Math.atan2(annotation.y2 - annotation.y1, annotation.x2 - annotation.x1)
  const spread = Math.PI / 7
  return [angle + Math.PI - spread, angle + Math.PI + spread]
    .map(a => [annotation.x2 + size * Math.cos(a), annotation.y2 + size * Math.sin(a)] as [number, number])
}

/** Stroke width of marks, relative to the bitmap so they look the same at every size. */
export function strokeWidth(bitmapWidth: number): number {
  return Math.max(3, Math.round(bitmapWidth / 300))
}

/** Draws the marks in bitmap pixel space (call after `ctx.scale` when drawing to a smaller canvas). */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: readonly Annotation[],
  colors: AnnotationColors,
  bitmapWidth: number,
): void {
  const width = strokeWidth(bitmapWidth)
  ctx.save()
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const mark of annotations) {
    if (mark.tool === 'redact') {
      const box = normaliseRect(mark.x1, mark.y1, mark.x2, mark.y2)
      ctx.fillStyle = colors.redact
      ctx.fillRect(box.x, box.y, box.width, box.height)
    } else if (mark.tool === 'rect') {
      const box = normaliseRect(mark.x1, mark.y1, mark.x2, mark.y2)
      ctx.strokeStyle = colors.stroke
      ctx.strokeRect(box.x, box.y, box.width, box.height)
    } else {
      const [left, right] = arrowHead(mark, width * 6)
      ctx.strokeStyle = colors.stroke
      ctx.beginPath()
      ctx.moveTo(mark.x1, mark.y1)
      ctx.lineTo(mark.x2, mark.y2)
      if (left && right) {
        ctx.moveTo(left[0], left[1])
        ctx.lineTo(mark.x2, mark.y2)
        ctx.lineTo(right[0], right[1])
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Reads the colours of the marks from semantic tokens. Falls back to fixed values outside a browser. */
export function readAnnotationColors(): AnnotationColors {
  if (typeof document === 'undefined') return { redact: '#000000', stroke: '#000000' }
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    redact: read('--ui-text-highlighted', '#000000'),
    stroke: read('--ui-error', read('--ui-primary', '#000000')),
  }
}

export interface Flattened {
  /** PNG without metadata, redactions burned in. */
  blob: Blob
  width: number
  height: number
}

function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

/**
 * Draws the capture and its marks on one canvas (≤ `maxWidth` wide) and encodes it as PNG. When the
 * PNG is too large for the upload it is shrunk step by step, down to `FLATTEN_MIN_WIDTH`, then refused.
 * The canvas re-encode is what strips metadata: nothing of the source PNG is copied.
 */
export async function flattenToPng(
  source: ImageBitmap,
  annotations: readonly Annotation[],
  colors: AnnotationColors,
  maxWidth = FLATTEN_MAX_WIDTH,
): Promise<Flattened | null> {
  let limit = maxWidth
  for (;;) {
    const { width, height, scale } = fitSize(source.width, source.height, limit)
    if (!width) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, width, height)
    ctx.save()
    ctx.scale(scale, scale)
    drawAnnotations(ctx, annotations, colors, source.width)
    ctx.restore()
    const blob = await encode(canvas)
    if (!blob) return null
    if (blob.size <= MAX_UPLOAD_PNG_BYTES) return { blob, width, height }
    const next = Math.floor(width * 0.75)
    if (next < FLATTEN_MIN_WIDTH) return null
    limit = next
  }
}
