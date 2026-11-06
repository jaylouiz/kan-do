import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #615, DESIGN.md "The Glass Chrome Rule": every glass surface carries its own opaque fallback. Playwright's WebKit
// never paints backdrop-filter, so the fallback CSS has no browser test of its own; pin that it exists and what it does.
const css = readFileSync(resolve(__dirname, '../../assets/css/app-nav.css'), 'utf8')

/** The body of the first block that opens with `header` (balanced braces). */
function block(header: string): string {
  const start = css.indexOf(header)
  expect(start, `${header} is missing`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  throw new Error(`${header} is not closed`)
}

describe('app bar glass fallbacks (#615)', () => {
  it('declares the 94% fallback tint once, and both fallbacks read it', () => {
    expect(css.match(/--nav-glass-tint-solid:[^;]*var\(--ui-bg-muted\) 94%/g)?.length).toBe(1)
    expect(css.match(/var\(--ui-bg-muted\) 94%/g)?.length).toBe(1)
    expect(block('@supports not (')).toMatch(/--nav-glass-tint:\s*var\(--nav-glass-tint-solid\)/)
  })

  it('uses the same tint and drops the filter under reduced transparency', () => {
    const body = block('@media (prefers-reduced-transparency: reduce)')
    expect(body).toMatch(/--nav-glass-tint:\s*var\(--nav-glass-tint-solid\)/)
    expect(body).toMatch(/--nav-glass-filter:\s*none/)
  })

  it('declares the veil gradient once; the phone only flips its direction', () => {
    expect(css.match(/linear-gradient\(var\(--nav-veil-dir\)/g)?.length).toBe(1)
    expect(css.match(/--ui-page-bg\) 62%/g)?.length).toBe(1)
    expect(css).toMatch(/--nav-veil-dir:\s*to bottom/)
    expect(css).toMatch(/--nav-veil-dir:\s*to top/)
  })

  it('fades the phone bar on the pills and the veil, never on .app-nav (a Backdrop Root would pop the blur in at the end)', () => {
    expect(css).not.toMatch(/\.app-nav\.is-dragging\s*\{[^}]*opacity/)
    expect(css).toMatch(/\.app-nav\.is-dragging \.app-nav-pill,[^{]*\{\s*opacity:\s*0/)
  })

  it('applies the filter through the recipe property to the pills only, with both prefixes', () => {
    expect(css.match(/backdrop-filter: var\(--nav-glass-filter\)/g)?.length).toBe(2) // prefixed + unprefixed
    expect(css.match(/blur\(20px\)/g)?.length).toBe(1) // the recipe value is declared once, in --nav-glass-filter
  })

  it('shares the veil hang: the veil and the sticky offset read one variable', () => {
    expect(css.match(/--app-bar-veil-hang:\s*1\.75rem/g)?.length).toBe(1)
    expect(block('.app-nav::before {')).toMatch(/inset:[^;]*var\(--app-bar-veil-hang\)/)
    expect(block('.sticky-below-page-header {')).toMatch(/var\(--app-bar-offset-top\) \+ var\(--app-bar-veil-hang\)/)
  })
})
