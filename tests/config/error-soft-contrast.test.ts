import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #594: Nuxt UI's `error`/`soft` text is the base raspberry-500, ~4.0:1 on its own 10% tint (below WCAG AA for small
// text). One compound variant in `app.config.ts` sets the 700 step app-wide, like `primary`/`soft`; call sites carry
// no local override. The ratios are computed from the raspberry scale in `assets/css/main.css`.

const root = resolve(__dirname, '../..')
const css = readFileSync(resolve(root, 'assets/css/main.css'), 'utf8')
const config = readFileSync(resolve(root, 'app.config.ts'), 'utf8')

const SHEET = '#FFFFFF'

function step(n: number): string {
  const hex = css.match(new RegExp(`--color-custom-raspberry-${n}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]
  if (!hex) throw new Error(`raspberry-${n} missing in main.css`)
  return hex
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

function luminance(channels: number[]): number {
  const [lr = 0, lg = 0, lb = 0] = channels.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

function contrast(a: number[], b: number[]): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `error` at 10% over the sheet: what `bg-error/10` paints behind the soft button. */
function tint(): number[] {
  const base = rgb(step(500))
  const sheet = rgb(SHEET)
  return sheet.map((s, i) => Math.round(s * 0.9 + base[i]! * 0.1))
}

describe('error soft button contrast (#594)', () => {
  it('the base error text fails AA on its tint, the 700 step passes', () => {
    expect(contrast(rgb(step(500)), tint())).toBeLessThan(4.5)
    expect(contrast(rgb(step(700)), tint())).toBeGreaterThanOrEqual(4.5)
  })

  it('app.config.ts sets text-error-700 for button error/soft', () => {
    expect(config).toMatch(/color:\s*'error',\s*variant:\s*'soft',\s*class:\s*'text-error-700'/)
  })

  it('the undo pill carries no local text override', () => {
    const gap = readFileSync(resolve(root, 'components/task/TaskDeletedGap.vue'), 'utf8')
    const pill = gap.match(/<UButton[^>]*data-testid="gap-undo"[^>]*>|<UButton[\s\S]*?data-testid="gap-undo"/)?.[0] ?? ''
    expect(pill).toContain('variant="soft"')
    expect(pill).not.toMatch(/text-error/)
  })
})
