import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BREAKPOINT_QUERIES } from '../../lib/breakpoints'
import { DESKTOP_QUERY } from '../../composables/useIsDesktop'
import postcssBreakpoints, { expandBreakpoints } from '../../scripts/postcss-breakpoints.mjs'
import postcss from 'postcss'

// One definition of the viewport breakpoints (#70): lib/breakpoints.ts. CSS writes `@media (--phone)`, the PostCSS
// plugin expands it, JS reads the query strings.

const root = resolve(__dirname, '../..')

describe('breakpoints', () => {
  it('phone and desktop are the two sides of one 768px step', () => {
    expect(BREAKPOINT_QUERIES.phone).toBe('(max-width: 767px)')
    expect(BREAKPOINT_QUERIES.desktop).toBe('(min-width: 768px)')
    expect(DESKTOP_QUERY).toBe(BREAKPOINT_QUERIES.desktop)
  })

  it('equals Tailwind\'s md and sm steps, which the md: and sm: classes use', () => {
    const theme = readFileSync(resolve(root, 'node_modules/tailwindcss/theme.css'), 'utf8')
    expect(theme).toMatch(/--breakpoint-md:\s*48rem/)
    expect(theme).toMatch(/--breakpoint-sm:\s*40rem/)
    expect(BREAKPOINT_QUERIES.sm).toBe('(min-width: 40rem)')
  })

  it('expands a named breakpoint inside a media query list and leaves other features alone', () => {
    expect(expandBreakpoints('(--phone)')).toBe('(max-width: 767px)')
    expect(expandBreakpoints('(pointer: coarse), (--phone)')).toBe('(pointer: coarse), (max-width: 767px)')
    expect(expandBreakpoints('(--phone), (hover: none) and (pointer: coarse)')).toBe('(max-width: 767px), (hover: none) and (pointer: coarse)')
  })

  it('fails on an unknown breakpoint instead of shipping a query that never matches', () => {
    expect(() => expandBreakpoints('(--tablet)')).toThrow(/Unknown breakpoint \(--tablet\)/)
  })

  it('rewrites a stylesheet through PostCSS', async () => {
    const out = await postcss([postcssBreakpoints()]).process('@media (--desktop) { .a { color: red } }', { from: undefined })
    expect(out.css).toBe('@media (min-width: 768px) { .a { color: red } }')
  })
})
