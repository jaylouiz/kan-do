import { describe, expect, it } from 'vitest'
import { diffFingerprint, serializeFingerprint } from '../../e2e/helpers/fingerprint'

const base = {
  'UButton:matrix:primary/solid/md': { 'background-color': 'rgb(1, 2, 3)', 'color': 'rgb(255, 255, 255)' },
  'UButton:state:disabled': { 'background-color': 'rgb(1, 2, 3)', 'color': 'rgb(255, 255, 255)' },
}

describe('style fingerprint helpers (#66)', () => {
  it('finds no difference in an identical fingerprint', () => {
    expect(diffFingerprint(base, structuredClone(base))).toEqual([])
  })

  it('names the sample and property of a changed value (a theme token that moved)', () => {
    const changed = structuredClone(base)
    changed['UButton:matrix:primary/solid/md']['background-color'] = 'rgb(9, 9, 9)'
    expect(diffFingerprint(base, changed)).toEqual(['UButton:matrix:primary/solid/md background-color: rgb(1, 2, 3) -> rgb(9, 9, 9)'])
  })

  it('reports a sample that appeared or vanished', () => {
    const grown = { ...base, 'UButton:state:loading': { color: 'x' } }
    expect(diffFingerprint(base, grown)).toEqual(['UButton:state:loading: new sample'])
    expect(diffFingerprint(grown, base)).toEqual(['UButton:state:loading: sample is gone'])
  })

  it('serialises one sample per line, keys sorted, so the same data always gives the same file', () => {
    const text = serializeFingerprint({ b: { x: '1' }, a: { x: '2' } })
    expect(text).toBe('{\n  "a": {"x":"2"},\n  "b": {"x":"1"}\n}\n')
    expect(JSON.parse(text)).toEqual({ a: { x: '2' }, b: { x: '1' } })
  })
})
