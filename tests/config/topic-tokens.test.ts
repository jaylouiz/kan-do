import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HUES } from '~/lib/topicStyles'

/**
 * The nine topic mark tones (#431) are named tokens in assets/css/main.css and each must read on the card sheet:
 * >= 3:1 (WCAG 1.4.11, non-text contrast) against Sheet (#FAFAF9, the card surface) and white (the card edge).
 * Retuning a tone (#423) passes here or it does not ship.
 */
const css = readFileSync(resolve(__dirname, '../../assets/css/main.css'), 'utf8')
const SURFACES = { sheet: '#FAFAF9', white: '#FFFFFF' }

/** OKLCH -> gamma-encoded sRGB (0..1), clipped. */
function oklchToSrgb(l: number, c: number, hue: number): [number, number, number] {
  const a = c * Math.cos((hue * Math.PI) / 180)
  const b = c * Math.sin((hue * Math.PI) / 180)
  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ].map(v => Math.min(1, Math.max(0, v)))
  return linear.map(v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const hexToSrgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]

function tone(hue: string): [number, number, number] {
  const match = new RegExp(`--topic-${hue}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(css)
  if (!match) throw new Error(`--topic-${hue} is not an oklch() token in main.css`)
  return oklchToSrgb(Number(match[1]), Number(match[2]), Number(match[3]))
}

describe('topic mark tokens (#431)', () => {
  it('defines one token per hue', () => {
    for (const hue of HUES) expect(css, hue).toMatch(new RegExp(`--topic-${hue}:`))
  })

  for (const hue of HUES) {
    it(`${hue} has >= 3:1 on the card sheet and on white`, () => {
      for (const [name, surface] of Object.entries(SURFACES)) {
        expect(contrast(tone(hue), hexToSrgb(surface)), `${hue} on ${name}`).toBeGreaterThanOrEqual(3)
      }
    })
  }

  it('prints the measured ratios (value for the PR)', () => {
    const ratios = HUES.map(hue => `${hue} ${contrast(tone(hue), hexToSrgb(SURFACES.sheet)).toFixed(2)}`)
    expect(ratios).toHaveLength(9)
    if (process.env.TOPIC_TOKENS_VERBOSE) console.log(ratios.join(', '))
  })
})
