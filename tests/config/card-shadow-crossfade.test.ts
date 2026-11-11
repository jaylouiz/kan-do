import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// kd#128: the card's hover transition may only fade shadow colours. WebKit (the desktop app) draws an interpolated
// shadow geometry in whole-pixel steps, so a transition between two different geometries jumps back and forth.
// The resting and the raised token therefore hold the same four layers in the one shadow colour; only alphas differ.
const css = readFileSync(resolve(__dirname, '../../assets/css/main.css'), 'utf8')

interface Layer { geometry: string; alpha: number }

const layersOf = (token: string): Layer[] => {
  const value = new RegExp(`${token}:\\s*([^;]+);`).exec(css)?.[1]
  if (!value) throw new Error(`${token} not found in main.css`)
  // every layer is `<geometry> rgb(var(--shadow-color) / <alpha>)`: one colour, so nothing but the alpha can differ
  return value.split(/,(?![^(]*\))/).map((layer) => {
    const match = /^\s*(.+?)\s+rgb\(var\(--shadow-color\) \/ ([\d.]+)\)\s*$/.exec(layer)
    if (!match?.[1] || !match[2]) throw new Error(`unexpected shadow layer "${layer.trim()}" in ${token}`)
    return { geometry: match[1].replace(/\s+/g, ' '), alpha: Number(match[2]) }
  })
}

describe('card shadow tokens (kd#128)', () => {
  const rest = layersOf('--shadow-task')
  const hover = layersOf('--shadow-task-hover')

  it('resting and hovered shadow have the same layers with the same geometry, so a transition fades colours only', () => {
    expect(hover.map(l => l.geometry)).toEqual(rest.map(l => l.geometry))
  })

  it('has four layers, each visible in at least one look, and the two looks differ', () => {
    expect(rest).toHaveLength(4)
    rest.forEach((layer, i) => {
      expect(Math.max(layer.alpha, hover[i]!.alpha)).toBeGreaterThan(0)
    })
    expect(hover.map(l => l.alpha)).not.toEqual(rest.map(l => l.alpha))
  })
})
