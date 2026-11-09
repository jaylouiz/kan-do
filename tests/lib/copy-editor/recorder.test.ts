import { beforeEach, describe, expect, it } from 'vitest'
import { keysForText, normalizeText, recordTranslation, resetRecorder } from '~/lib/copy-editor/recorder'

describe('copy editor recorder', () => {
  beforeEach(resetRecorder)

  it('maps a rendered string, interpolation included, to the keys that produced it', () => {
    expect(recordTranslation('3 Aufgaben heute', 'board.count')).toBe('3 Aufgaben heute')
    recordTranslation('Heute', 'board.pageHeading')
    recordTranslation('Heute', 'common.today')
    expect(keysForText('3 Aufgaben  heute')).toEqual(['board.count'])
    expect(keysForText('Heute')).toEqual(['board.pageHeading', 'common.today'])
    expect(keysForText('unknown')).toEqual([])
  })

  it('ignores missing translations (the key echoed back) and empty output', () => {
    recordTranslation('a.b', 'a.b')
    recordTranslation('  ', 'x.y')
    expect(keysForText('a.b')).toEqual([])
    expect(keysForText('')).toEqual([])
  })

  it('normalises whitespace like the browser', () => {
    expect(normalizeText('  a \n b\t')).toBe('a b')
  })
})
