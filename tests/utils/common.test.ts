import { describe, it, expect } from 'vitest'
import { uuid, parseTimeValue } from '~/utils/common'

describe('uuid', () => {
  it('returns a non-empty string', () => {
    expect(typeof uuid()).toBe('string')
    expect(uuid().length).toBeGreaterThan(0)
  })

  it('returns a different value on each call', () => {
    const a = uuid()
    const b = uuid()
    expect(a).not.toBe(b)
  })
})

describe('parseTimeValue', () => {
  it('returns null for null input', () => {
    expect(parseTimeValue(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(parseTimeValue(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseTimeValue('')).toBeNull()
  })

  it('parses plain number as minutes (returns seconds)', () => {
    expect(parseTimeValue(15)).toBe(900)
  })

  it('parses numeric string as minutes (returns seconds)', () => {
    expect(parseTimeValue('15')).toBe(900)
  })

  it('parses "15 min" as 15 minutes in seconds', () => {
    expect(parseTimeValue('15 min')).toBe(900)
  })

  it('parses "15m" as 15 minutes in seconds', () => {
    expect(parseTimeValue('15m')).toBe(900)
  })

  it('parses "1 hour" as 3600 seconds', () => {
    expect(parseTimeValue('1 hour')).toBe(3600)
  })

  it('parses "2h" as 7200 seconds', () => {
    expect(parseTimeValue('2h')).toBe(7200)
  })

  it('parses "60" as 60 minutes = 3600 seconds', () => {
    expect(parseTimeValue('60')).toBe(3600)
  })

  it('is case-insensitive for units', () => {
    expect(parseTimeValue('2H')).toBe(7200)
    expect(parseTimeValue('30 MIN')).toBe(1800)
  })

  it('returns null for non-numeric string with no match', () => {
    expect(parseTimeValue('abc')).toBeNull()
  })
})
