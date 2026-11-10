import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// kd#128: the card's hover transition may only fade shadow colours. WebKit (the desktop app) draws an interpolated
// shadow geometry in whole-pixel steps, so a transition between two different geometries jumps back and forth.
// The resting and the hovered token therefore hold the same layers, each with the other's layers transparent.
const css = readFileSync(resolve(__dirname, '../../assets/css/main.css'), 'utf8')

interface Layer { geometry: string; alpha: number }

const layersOf = (token: string): Layer[] => {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1]
  if (!value) throw new Error(`${token} not found in main.css`)
  // split on the commas between layers, not the ones inside rgba()
  return value.split(/,(?![^(]*\))/).map((layer) => {
    const match = /^\s*(.+?)\s+rgba\(([^)]+)\)\s*$/.exec(layer)
    if (!match?.[1] || !match[2]) throw new Error(`unexpected shadow layer "${layer.trim()}" in ${token}`)
    return { geometry: match[1].replace(/\s+/g, ' '), alpha: Number(match[2].split(',')[3]) }
  })
}

describe('card shadow tokens (kd#128)', () => {
  const rest = layersOf('--shadow-task')
  const hover = layersOf('--shadow-task-hover')

  it('resting and hovered shadow have the same layers with the same geometry, so a transition fades colours only', () => {
    expect(hover.map(l => l.geometry)).toEqual(rest.map(l => l.geometry))
  })

  it('every layer is visible in exactly one of the two looks', () => {
    expect(rest.length).toBeGreaterThan(1)
    rest.forEach((layer, i) => {
      const other = hover[i]!
      expect([layer.alpha > 0, other.alpha > 0].filter(Boolean)).toHaveLength(1)
    })
    expect(rest.some(l => l.alpha > 0)).toBe(true)
    expect(hover.some(l => l.alpha > 0)).toBe(true)
  })
})
