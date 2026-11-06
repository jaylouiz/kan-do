import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #257: the safe-area insets only resolve to non-zero values when the viewport meta opts into
// viewport-fit=cover, and every inset rule falls back to 0 without it. Pin the opt-in.
describe('nuxt.config.ts viewport meta', () => {
  it('declares viewport-fit=cover', () => {
    const source = readFileSync(resolve(__dirname, '../../nuxt.config.ts'), 'utf8')
    const match = /name: 'viewport', content: '([^']+)'/.exec(source)
    expect(match?.[1]).toContain('viewport-fit=cover')
  })
})
