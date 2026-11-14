import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { create, type Font } from 'fontkitten'

// The bundled faces stay small (#287): WOFF2 only, Fraunces pinned to the one heading weight, and the German
// characters the UI copy and task titles need still render in Fraunces (a glyph outside the file falls back to the
// serif stack without a warning, so only this check notices a subset that went too far).

const fontsDir = resolve(__dirname, '../../public/fonts')
const files = readdirSync(fontsDir).filter(name => !name.startsWith('.') && !name.endsWith('.txt'))
const read = (name: string) => readFileSync(join(fontsDir, name))
const parse = (name: string) => create(read(name)) as Font

// Every non-ASCII character of de.json and en.json that Fraunces ever had, plus the letters German titles use.
const GERMAN_SET = 'ÄÖÜäöüßØ„“”’–…› é'

describe('public/fonts', () => {
  it('ships every face as WOFF2 (no TTF)', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      expect(name).toMatch(/\.woff2$/)
      expect(read(name).subarray(0, 4).toString('latin1')).toBe('wOF2')
    }
  })

  it('keeps each face under its size budget', () => {
    expect(read('Fraunces-Variable.woff2').length).toBeLessThan(80_000)
    expect(read('Figtree-VariableFont_wght.woff2').length).toBeLessThan(40_000)
    expect(read('Figtree-Italic-VariableFont_wght.woff2').length).toBeLessThan(40_000)
  })

  it('pins Fraunces to weight 500 and keeps its optical-size axis and the German characters', () => {
    const font = parse('Fraunces-Variable.woff2')
    expect(Object.keys(font.variationAxes ?? {})).toEqual(['opsz'])
    for (const char of GERMAN_SET) expect(font.hasGlyphForCodePoint(char.codePointAt(0)!), `U+${char.codePointAt(0)!.toString(16)}`).toBe(true)
  })

  it('keeps the weight axis of both Figtree faces', () => {
    for (const name of ['Figtree-VariableFont_wght.woff2', 'Figtree-Italic-VariableFont_wght.woff2']) {
      expect(Object.keys(parse(name).variationAxes ?? {})).toEqual(['wght'])
    }
  })
})
