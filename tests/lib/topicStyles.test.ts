import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { HUES, TOPIC_SYMBOLS, hueOfSourceColor, isHue, symbolOf } from '~/lib/topicStyles'

const ph = JSON.parse(readFileSync(resolve(__dirname, '../../node_modules/@iconify-json/ph/icons.json'), 'utf8')) as { icons: Record<string, unknown> }

describe('topicStyles (#431)', () => {
  it('has nine hues and 24 symbols with unique keys', () => {
    expect(HUES).toHaveLength(9)
    expect(TOPIC_SYMBOLS).toHaveLength(24)
    expect(new Set(TOPIC_SYMBOLS.map(s => s.key)).size).toBe(24)
  })

  it('every symbol class is a literal Phosphor fill icon that resolves in @iconify-json/ph', () => {
    for (const symbol of TOPIC_SYMBOLS) {
      expect(symbol.icon).toBe(`i-ph-${symbol.key}-fill`)
      expect(ph.icons[`${symbol.key}-fill`], symbol.key).toBeDefined()
    }
  })

  it('maps Notion colour names 1:1 and default to gray', () => {
    for (const hue of HUES) expect(hueOfSourceColor(hue)).toBe(hue)
    expect(hueOfSourceColor('default')).toBe('gray')
    expect(hueOfSourceColor(' Blue ')).toBe('blue')
  })

  it('maps hex colours to the nearest hue by angle', () => {
    expect(hueOfSourceColor('#3b82f6')).toBe('blue')
    expect(hueOfSourceColor('#10b981')).toBe('green')
    expect(hueOfSourceColor('#f59e0b')).toBe('orange')
    expect(hueOfSourceColor('#6366f1')).toBe('blue')
    expect(hueOfSourceColor('#ef4444')).toBe('red')
    expect(hueOfSourceColor('#eab308')).toBe('yellow')
    expect(hueOfSourceColor('#a855f7')).toBe('purple')
    expect(hueOfSourceColor('#ec4899')).toBe('pink')
    expect(hueOfSourceColor('#808080')).toBe('gray')
    expect(hueOfSourceColor('#964b00')).toBe('brown')
    expect(hueOfSourceColor('#f00')).toBe('red')
  })

  it('returns null for unknown strings and nothing', () => {
    for (const value of ['chartreuse', '#12', 'rgb(1,2,3)', '', null, undefined]) expect(hueOfSourceColor(value)).toBeNull()
  })

  it('isHue and symbolOf reject unknown keys', () => {
    expect(isHue('blue')).toBe(true)
    expect(isHue('teal')).toBe(false)
    expect(isHue(3)).toBe(false)
    expect(symbolOf('rocket-launch')?.icon).toBe('i-ph-rocket-launch-fill')
    expect(symbolOf('i-ph-rocket-launch-fill')).toBeUndefined()
    expect(symbolOf(null)).toBeUndefined()
  })
})
