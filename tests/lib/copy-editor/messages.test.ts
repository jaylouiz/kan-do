import { describe, expect, it } from 'vitest'
import { flattenMessages, getLeaf, nestedMessage, parityProblems, placeholdersOf, setLeaf } from '~/lib/copy-editor/messages'

const tree = { a: { b: 'Hallo {name}', c: 'x | y' }, top: 'Oben' }

describe('copy editor messages', () => {
  it('flattens and reads leaves by dotted key', () => {
    expect(flattenMessages(tree)).toEqual({ 'a.b': 'Hallo {name}', 'a.c': 'x | y', top: 'Oben' })
    expect(getLeaf(tree, 'a.b')).toBe('Hallo {name}')
    expect(getLeaf(tree, 'a')).toBeUndefined()
    expect(getLeaf(tree, 'a.zzz')).toBeUndefined()
    expect(getLeaf(tree, '__proto__.x')).toBeUndefined()
  })

  it('sets an existing leaf on a copy and refuses unknown keys or branches', () => {
    const next = setLeaf(tree, 'a.b', 'Servus {name}')
    expect(getLeaf(next, 'a.b')).toBe('Servus {name}')
    expect(getLeaf(tree, 'a.b')).toBe('Hallo {name}')
    expect(() => setLeaf(tree, 'a.new', 'x')).toThrow('unknown key')
    expect(() => setLeaf(tree, 'a', 'x')).toThrow('unknown key')
  })

  it('builds the nested shape for mergeLocaleMessage', () => {
    expect(nestedMessage('a.b.c', 'v')).toEqual({ a: { b: { c: 'v' } } })
  })

  it('compares placeholders, list slots, linked messages and plural branches', () => {
    expect(placeholdersOf("{count} von {total} {'{'} @:common.x {0}")).toEqual(['@:common.x', '{0}', '{count}', '{total}'])
    expect(parityProblems('{n} Aufgabe | {n} Aufgaben', '{n} task | {n} tasks')).toEqual([])
    expect(parityProblems('{n} Aufgaben', '{count} tasks')).toHaveLength(1)
    expect(parityProblems('eins | zwei', 'one')).toEqual(['plural branches differ: 2 vs 1'])
  })
})
