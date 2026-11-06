import { describe, expect, it } from 'vitest'
import { arrowHead, fitSize, isMark, normaliseRect, strokeWidth, toBitmapPoint, FLATTEN_MAX_WIDTH } from '~/lib/feedback/flattenCanvas'

describe('flattenCanvas pure parts', () => {
  it('scales a retina capture down to 1600 px wide and never scales up', () => {
    expect(fitSize(2400, 1600)).toEqual({ width: 1600, height: 1067, scale: 1600 / 2400 })
    expect(fitSize(1200, 800)).toEqual({ width: 1200, height: 800, scale: 1 })
    expect(fitSize(FLATTEN_MAX_WIDTH, 100).scale).toBe(1)
    expect(fitSize(2400, 1600, 800).width).toBe(800)
    expect(fitSize(0, 10)).toEqual({ width: 0, height: 0, scale: 1 })
  })

  it('normalises a drag in any direction to a positive rectangle', () => {
    expect(normaliseRect(10, 20, 50, 80)).toEqual({ x: 10, y: 20, width: 40, height: 60 })
    expect(normaliseRect(50, 80, 10, 20)).toEqual({ x: 10, y: 20, width: 40, height: 60 })
    expect(normaliseRect(50, 20, 10, 80)).toEqual({ x: 10, y: 20, width: 40, height: 60 })
  })

  it('maps CSS pixels of a scaled canvas to bitmap pixels and clamps to the canvas', () => {
    const box = { left: 100, top: 50, width: 600, height: 400 }
    const bitmap = { width: 2400, height: 1600 }
    expect(toBitmapPoint(400, 250, box, bitmap)).toEqual({ x: 1200, y: 800 })
    expect(toBitmapPoint(100, 50, box, bitmap)).toEqual({ x: 0, y: 0 })
    expect(toBitmapPoint(9999, -50, box, bitmap)).toEqual({ x: 2400, y: 0 })
    expect(toBitmapPoint(5, 5, { left: 0, top: 0, width: 0, height: 0 }, bitmap)).toEqual({ x: 0, y: 0 })
  })

  it('treats a tiny drag as a tap, not a mark', () => {
    expect(isMark({ tool: 'rect', x1: 0, y1: 0, x2: 1, y2: 1 })).toBe(false)
    expect(isMark({ tool: 'redact', x1: 0, y1: 0, x2: 30, y2: 0 })).toBe(true)
  })

  it('draws the arrow head at the end point, opening backwards', () => {
    const [left, right] = arrowHead({ tool: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 }, 10)
    expect(left![0]).toBeLessThan(100)
    expect(right![0]).toBeLessThan(100)
    expect(left![1]).toBeCloseTo(-right![1], 5)
  })

  it('keeps marks visible at every size', () => {
    expect(strokeWidth(200)).toBe(3)
    expect(strokeWidth(2400)).toBe(8)
  })
})
