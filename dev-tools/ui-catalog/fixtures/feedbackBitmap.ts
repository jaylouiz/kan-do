import type { CatalogFixture } from '../useCatalog'

/**
 * A screenshot stand-in: a canvas drawn like a small board, which `drawImage` takes like an `ImageBitmap` (width,
 * height), with a rectangle and a redaction on top.
 */
const fixture: CatalogFixture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 360
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#f4f4f2'
    ctx.fillRect(0, 0, 640, 360)
    for (let column = 0; column < 3; column++) {
      ctx.fillStyle = '#e4e4e0'
      ctx.fillRect(24 + column * 200, 24, 184, 312)
      for (let card = 0; card < 3; card++) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(36 + column * 200, 48 + card * 88, 160, 72)
      }
    }
  }
  return {
    bitmap: canvas,
    annotations: [
      { tool: 'rect', x1: 230, y1: 44, x2: 400, y2: 126 },
      { tool: 'redact', x1: 436, y1: 136, x2: 590, y2: 190 },
    ],
  }
}
export default fixture
