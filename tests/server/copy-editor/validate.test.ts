// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { TermEntry } from '~/lib/copy-editor/terms'
import { validateEdits, type BaseTrees } from '~/server/copy-editor/validate'

const base: BaseTrees = {
  de: { a: { title: 'Aufgabe {name}', count: '{n} Aufgabe | {n} Aufgaben' }, b: 'Zurück' },
  en: { a: { title: 'Task {name}', count: '{n} task | {n} tasks' }, b: 'Back' },
}
const terms: TermEntry[] = [
  { id: 'src', de: 'Verbindung', en: 'connection', avoidDe: ['Quelle'], avoidEn: ['provider'], status: 'decided' },
  { id: 'task', de: 'Aufgabe', en: 'task', avoidDe: ['Ticket'], status: 'proposed' },
]
const run = (edits: unknown) => validateEdits({ edits }, base, terms)

describe('copy editor edit validation', () => {
  it('accepts every key of the real locale files, hyphenated ones included, and rejects others by name', async () => {
    const { readLocaleTrees } = await import('~/server/copy-editor/locales')
    const { flattenMessages } = await import('~/lib/copy-editor/messages')
    const real = readLocaleTrees(process.cwd())
    const keys = Object.keys(flattenMessages(real.de)).filter(key => key in flattenMessages(real.en))
    expect(keys.filter(key => key.includes('-')).length).toBeGreaterThan(0)
    const { checkKey } = await import('~/server/copy-editor/validate')
    expect(keys.filter(key => checkKey(key, real) !== null)).toEqual([])
    expect(checkKey('no.such-key', real)).toBe('unknown key "no.such-key"')
    expect(checkKey('__proto__', real)).not.toBeNull()
  })

  it('takes a language the client did not change from the base, whatever the client sent', () => {
    const result = run([{ key: 'b', de: 'Zurück zur Liste', en: 'STALE LOCAL', changed: ['de'] }])
    expect(result).toMatchObject({ ok: true, value: [{ key: 'b', de: 'Zurück zur Liste', en: 'Back' }] })
    expect(run([{ key: 'b', de: 'Zurück', en: 'Back', changed: ['de'] }])).toMatchObject({ ok: false, errors: ['b: unchanged'] })
    expect(run([{ key: 'b', de: 'x', en: 'y', changed: ['fr'] }])).toMatchObject({ ok: false })
  })

  it('accepts a changed pair and returns proposed-term warnings', () => {
    const result = run([{ key: 'a.title', de: 'Ticket {name}', en: 'Task {name}' }])
    expect(result).toEqual({ ok: true, value: [{ key: 'a.title', de: 'Ticket {name}', en: 'Task {name}' }], warnings: ['a.title de: "Ticket" is an avoid form of the proposed term "Aufgabe"'] })
  })

  it.each([
    ['not an object body', 'x', 'body must be'],
    ['no edits', [], 'no edits'],
    ['an unknown key', [{ key: 'a.nope', de: 'x', en: 'y' }], 'unknown key'],
    ['a branch key', [{ key: 'a', de: 'x', en: 'y' }], 'unknown key'],
    ['path tricks', [{ key: '../a', de: 'x', en: 'y' }], 'unknown key'],
    ['a prototype key', [{ key: '__proto__.x', de: 'x', en: 'y' }], 'unknown key'],
    ['a duplicate key', [{ key: 'b', de: 'x', en: 'y' }, { key: 'b', de: 'x', en: 'y' }], 'duplicate'],
    ['a non-string value', [{ key: 'b', de: 5, en: 'y' }], 'not a string'],
    ['an empty value', [{ key: 'b', de: ' ', en: 'y' }], 'empty'],
    ['a control character', [{ key: 'b', de: 'a\u0000b', en: 'y' }], 'control'],
    ['a too long value', [{ key: 'b', de: 'x'.repeat(2001), en: 'y' }], 'longer than'],
    ['an unchanged edit', [{ key: 'b', de: 'Zurück', en: 'Back' }], 'unchanged'],
    ['a placeholder mismatch', [{ key: 'a.title', de: 'Aufgabe {x}', en: 'Task {name}' }], 'placeholders differ'],
    ['a plural mismatch', [{ key: 'a.count', de: '{n} Aufgabe', en: '{n} task | {n} tasks' }], 'plural branches differ'],
    ['a decided avoid form', [{ key: 'b', de: 'Quelle', en: 'Back' }], 'decided term'],
  ])('rejects %s', (_label, edits, message) => {
    const result = validateEdits(_label === 'not an object body' ? edits : { edits }, base, terms)
    expect(result.ok).toBe(false)
    expect(JSON.stringify((result as { errors: string[] }).errors)).toContain(message)
  })

  it('caps the batch at 200 edits', () => {
    const edits = Array.from({ length: 201 }, () => ({ key: 'b', de: 'x', en: 'y' }))
    expect(run(edits)).toEqual({ ok: false, errors: ['more than 200 edits'] })
  })
})
