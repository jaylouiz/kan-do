import { describe, it, expect } from 'vitest'
import { collectNames, isMerge, renameField, renameInList, renameVerdict, trimName } from '~/lib/topicNames'

describe('topicNames (#430)', () => {
  it('trims and tolerates non-strings', () => {
    expect(trimName('  Work ')).toBe('Work')
    expect(trimName(null)).toBe('')
    expect(trimName(undefined)).toBe('')
  })

  it('renameField rewrites a trimmed match and returns the same object otherwise', () => {
    const item = { topic: ' Work ', activity: 'Work' }
    expect(renameField(item, 'topic', 'Work', 'Job')).toEqual({ topic: 'Job', activity: 'Work' })
    expect(renameField(item, 'activity', 'Work', 'Job')).toEqual({ topic: ' Work ', activity: 'Job' })
    const other = { topic: 'work', activity: null }
    expect(renameField(other, 'topic', 'Work', 'Job')).toBe(other)
    expect(renameField(other, 'activity', 'Work', 'Job')).toBe(other)
    const none = { topic: null }
    expect(renameField(none, 'topic', 'Work', 'Job')).toBe(none)
  })

  it('renameInList dedupes into an existing target, sorts and keeps the list when nothing matches', () => {
    expect(renameInList(['Alpha', 'Wrk', 'Zed'], 'Wrk', 'Work')).toEqual(['Alpha', 'Work', 'Zed'])
    expect(renameInList(['Alpha', 'Wrk', 'Work'], 'Wrk', 'Work')).toEqual(['Alpha', 'Work'])
    const list = ['A', 'B']
    expect(renameInList(list, 'C', 'D')).toBe(list)
  })

  it('isMerge needs an existing, different target (trimmed, case-sensitive)', () => {
    expect(isMerge(['A', 'B'], 'A', 'B')).toBe(true)
    expect(isMerge(['A', 'B'], 'A', ' B ')).toBe(true)
    expect(isMerge(['A', 'B'], 'A', 'b')).toBe(false)
    expect(isMerge(['A', 'B'], 'A', 'A')).toBe(false)
    expect(isMerge(['A'], 'A', 'C')).toBe(false)
  })

  it('renameVerdict separates empty, unchanged and ok', () => {
    expect(renameVerdict('A', '   ')).toBe('empty')
    expect(renameVerdict('A', ' A ')).toBe('unchanged')
    expect(renameVerdict('A', 'B')).toBe('ok')
  })

  it('collectNames unions, trims, drops empties and sorts', () => {
    expect(collectNames(['b', ' a ', ''], [null, 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})
