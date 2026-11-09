import { describe, expect, it } from 'vitest'
import { blockingIssues, matchesForm, termIssues, type TermEntry } from '~/lib/copy-editor/terms'
import { matchesAvoidForm } from '../../../scripts/copy-terms.mjs'
import terms from '~/docs/copy/terms.json'

const cases: [string, string, boolean][] = [
  ['Zugänge verwalten', 'Zugang', false],
  ['Bei Quelle klicken', 'quelle', false],
  ['Bei Quelle klicken', 'quelle', true],
  ['Die Datenquelle', 'Quelle', false],
  ['Task öffnen', 'Task', false],
  ['Sie können', 'Sie', true],
  ['sie können', 'Sie', true],
]

describe('copy editor term check', () => {
  it('matches avoid forms exactly like scripts/copy-terms.mjs', () => {
    for (const [value, form, caseSensitive] of cases) {
      expect(matchesForm(value, form, caseSensitive), `${value} / ${form}`).toBe(matchesAvoidForm(value, form, caseSensitive))
    }
  })

  const entries: TermEntry[] = [
    { id: 'src', de: 'Verbindung', en: 'connection', avoidDe: ['Quelle'], avoidEn: ['provider'], status: 'decided', allow: ['keep.key'] },
    { id: 'task', de: 'Aufgabe', en: 'task', avoidDe: ['Ticket'], status: 'proposed' },
  ]

  it('reports avoid forms per language, blocks decided terms and only warns for proposed ones', () => {
    const issues = termIssues('Eine Quelle und ein Ticket', 'de', 'a.b', entries)
    expect(issues.map(i => [i.termId, i.form, i.status])).toEqual([['src', 'Quelle', 'decided'], ['task', 'Ticket', 'proposed']])
    expect(blockingIssues(issues).map(i => i.termId)).toEqual(['src'])
    expect(termIssues('a provider', 'en', 'a.b', entries).map(i => i.termId)).toEqual(['src'])
    expect(termIssues('a provider', 'de', 'a.b', entries)).toEqual([])
  })

  it('honours allow lists and returns the preferred form for the message', () => {
    expect(termIssues('Quelle', 'de', 'keep.key', entries)).toEqual([])
    expect(termIssues('Quelle', 'de', 'a.b', entries)[0]?.preferred).toBe('Verbindung')
  })

  it('accepts the real registry shape', () => {
    expect(Array.isArray(terms)).toBe(true)
    expect(termIssues('Wir haben ein Ticket', 'de', 'x', terms as TermEntry[]).length).toBeGreaterThan(0)
  })
})
