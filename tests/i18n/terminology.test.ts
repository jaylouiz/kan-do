import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'
import { approveTerms, checkTerms, findTermConflicts, flattenMessages, hashEntry, matchesAvoidForm } from '../../scripts/copy-terms.mjs'

// UI term registry guard (#472): the real registry against the real locales, then the check on fixtures.
// A proposed term never fails; a decided one is pinned by the lock, which only `npm run terms:approve` writes.

type Locales = { de: Record<string, string>, en: Record<string, string> }
type Entry = {
  id: string
  concept: string
  de: string
  en: string
  avoidDe: string[]
  avoidEn: string[]
  status: 'proposed' | 'decided'
  note?: string
  allow?: string[]
  caseSensitive?: boolean
}
type Result = { errors: string[], warnings: string[] }
type Lock = Record<string, string>

const check = checkTerms as (input: { terms: unknown, lock: Lock, locales: Locales }) => Result
type Report = { newlyLocked: string[], changed: string[], dropped: string[], avoidHits: Record<string, number> }
const approve = approveTerms as (input: { terms: Entry[], ids?: string[], lock?: unknown, locales?: Locales }) => { terms: Entry[], lock: Lock, report: Report }
const conflictsOf = findTermConflicts as (terms: Entry[]) => { id: string, locale: string, value: string, form: string, otherId: string, decided: boolean }[]
const flatten_ = flattenMessages as (tree: Record<string, unknown>) => Record<string, string>
const hash = hashEntry as (entry: Entry) => string
const matches = matchesAvoidForm as (value: string, form: string, caseSensitive?: boolean) => boolean

const root = resolve(__dirname, '../..')
const readJson = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))

type MessageTree = { [key: string]: string | MessageTree }

// Same flattening as locale-parity.test.ts; not imported from there, since importing a test file re-registers its tests.
function flatten(tree: MessageTree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }
  return out
}

const realLocales: Locales = { de: flatten(de as MessageTree), en: flatten(en as MessageTree) }

describe('terminology: the real registry', () => {
  const terms = readJson('docs/copy/terms.json') as Entry[]
  const lock = readJson('docs/copy/terms.lock.json') as Lock
  const result = check({ terms, lock, locales: realLocales })

  it('is valid, and every decided term is approved and absent from the locales', () => {
    expect(result.errors).toEqual([])
  })

  it('has seeded entries and lists proposed avoid forms as warnings only', () => {
    expect(terms.length).toBeGreaterThan(0)
    if (result.warnings.length > 0) console.warn(`terminology: ${result.warnings.length} avoid form(s) of proposed terms:\n${result.warnings.join('\n')}`)
  })

  it('has no term whose preferred form is another term\'s avoid form', () => {
    expect(conflictsOf(terms)).toEqual([])
    expect(result.warnings.filter(warning => warning.includes('hits avoid form'))).toEqual([])
  })

  it('keeps the lock free of undecided terms', () => {
    const decided = new Set(terms.filter(entry => entry.status === 'decided').map(entry => entry.id))
    expect(Object.keys(lock).filter(id => !decided.has(id))).toEqual([])
  })
})

describe('terminology: the calibration approval (#474)', () => {
  const ids = ['address-du', 'timebox', 'task-source', 'delete', 'remove', 'disconnect', 'note']
  const terms = readJson('docs/copy/terms.json') as Entry[]

  it('approving the calibrated terms leaves no error and no avoid hit, and stays valid after approval', () => {
    const { terms: approved, lock, report } = approve({ terms, ids, lock: {}, locales: realLocales })
    // The report covers every decided term, not only `ids` (later approvals add more): each must have no hit
    expect(report.avoidHits).toMatchObject(Object.fromEntries(ids.map(id => [id, 0])))
    expect(Object.values(report.avoidHits).filter(n => n !== 0)).toEqual([])
    expect(check({ terms: approved, lock, locales: realLocales }).errors).toEqual([])
    const again = approve({ terms: approved, ids, lock, locales: realLocales })
    expect(again.report.changed).toEqual([])
    expect(check({ terms: again.terms, lock: again.lock, locales: realLocales }).errors).toEqual([])
  })
})

describe('terminology: the questionnaire approval (#485)', () => {
  // The ids the PR asks the user to approve with `npm run terms:approve`; keep in step with the PR body.
  const ids = ['time-spent', 'token', 'settings', 'set-up', 'product-name', 'column-done']
  const terms = readJson('docs/copy/terms.json') as Entry[]
  const realLock = readJson('docs/copy/terms.lock.json') as Lock

  // Runs approve() and check() over the whole registry once per id: ~1.2 s alone, past the 5 s default under parallel-worker load (#520).
  it('approving exactly the PR id list leaves no error and no avoid hit, as one batch and one id at a time', () => {
    const { terms: approved, lock, report } = approve({ terms, ids, lock: realLock, locales: realLocales })
    expect(Object.fromEntries(ids.map(id => [id, report.avoidHits[id]]))).toEqual(Object.fromEntries(ids.map(id => [id, 0])))
    expect(check({ terms: approved, lock, locales: realLocales }).errors).toEqual([])
    for (const id of ids) {
      const single = approve({ terms, ids: [id], lock: realLock, locales: realLocales })
      expect(check({ terms: single.terms, lock: single.lock, locales: realLocales }).errors).toEqual([])
    }
  }, 30_000)

  it('keeps every allow key of the registry a real locale key, so an exemption cannot outlive its string', () => {
    for (const entry of terms) {
      for (const key of entry.allow ?? []) {
        expect([entry.id, key, key in realLocales.de || key in realLocales.en]).toEqual([entry.id, key, true])
      }
    }
  })
})

describe('terminology: avoid-form matching', () => {
  it('matches case-insensitively at the start of a word, so inflections hit', () => {
    expect(matches('Alle zeitboxen anzeigen', 'Zeitbox')).toBe(true)
    expect(matches('Zeitboxen', 'Zeitbox')).toBe(true)
    expect(matches('Ohne Zeitbox', 'zeitbox')).toBe(true)
    expect(matches('Neue Überschrift', 'Überschrift')).toBe(true)
  })

  it('matches an umlaut plural of a form without the umlaut, in both directions (#492)', () => {
    expect(matches('GitHub-Zugänge', 'Zugang')).toBe(true)
    expect(matches('Zugänge öffnen', 'Zugang')).toBe(true)
    expect(matches('Zugang', 'Zugäng')).toBe(true)
    expect(matches('Neue Überschrift', 'Uberschrift')).toBe(true)
    expect(matches('Zugriff auf GitHub', 'Zugang')).toBe(false)
  })

  it('flags "GitHub-Zugänge" as an avoid form of a decided token term (#492)', () => {
    const token: Entry = { id: 'token', concept: 'The secret', de: 'Token', en: 'token', avoidDe: ['Zugang', 'Zugangsdaten'], avoidEn: [], status: 'decided' }
    const locales: Locales = { de: { 'settings.github.pageTitle': 'GitHub-Zugänge', 'settings.github.ok': 'GitHub-Zugriff' }, en: {} }
    const lock = { token: hash(token) }
    expect(check({ terms: [token], lock, locales }).errors).toEqual([
      'de settings.github.pageTitle: avoid form "Zugang" of term token',
    ])
  })

  it('does not match inside a word and handles regex characters in a form', () => {
    expect(matches('Mehrzeitbox', 'Zeitbox')).toBe(false)
    expect(matches('Übertrag', 'Trag')).toBe(false)
    expect(matches('Wählen...', 'Wählen...')).toBe(true)
    expect(matches('Wählen xyz', 'Wählen...')).toBe(false)
  })
})

describe('terminology: case-sensitive matching (#474)', () => {
  const address: Entry = { id: 'address-du', concept: 'Form of address', de: 'du', en: 'you', avoidDe: ['Sie'], avoidEn: [], status: 'proposed' }
  const locales: Locales = { de: { 'a.formal': 'Bitte richten Sie Notion ein.', 'a.pronoun': 'Das Token läuft ab, wie sie sagt.', 'a.initial': 'Sie bleibt erhalten.' }, en: {} }
  const hitsOf = (entry: Entry) => check({ terms: [entry], lock: {}, locales }).warnings

  it('stays case-insensitive by default', () => {
    expect(matches('wie sie sagt', 'Sie')).toBe(true)
    expect(hitsOf(address)).toHaveLength(3)
  })

  it('with caseSensitive only the capitalised word hits: "Sie" in "richten Sie", not "sie" in "wie sie sagt"', () => {
    expect(matches('Bitte richten Sie', 'Sie', true)).toBe(true)
    expect(matches('wie sie sagt', 'Sie', true)).toBe(false)
    expect(hitsOf({ ...address, caseSensitive: true }).map(warning => warning.split(':')[0])).toEqual(['de a.formal', 'de a.initial'])
  })

  it('exempts a sentence-initial pronoun through allow', () => {
    expect(hitsOf({ ...address, caseSensitive: true, allow: ['a.initial'] }).map(warning => warning.split(':')[0])).toEqual(['de a.formal'])
  })

  it('applies the flag of the avoiding term in the registry self-consistency check', () => {
    const other: Entry = { id: 'x', concept: 'c', de: 'wie sie', en: 'x', avoidDe: [], avoidEn: [], status: 'proposed' }
    expect(conflictsOf([address, other])).toHaveLength(1)
    expect(conflictsOf([{ ...address, caseSensitive: true }, other])).toEqual([])
  })

  it('rejects a non-boolean caseSensitive and accepts a boolean', () => {
    expect(check({ terms: [{ ...address, caseSensitive: 'yes' }], lock: {}, locales: { de: {}, en: {} } }).errors).toContain('term address-du: "caseSensitive" must be true or false')
    expect(check({ terms: [{ ...address, caseSensitive: false }], lock: {}, locales: { de: {}, en: {} } }).errors).toEqual([])
  })
})

describe('terminology: schema', () => {
  const entry = (patch: Partial<Entry> = {}): Entry => ({
    id: 'task', concept: 'A unit of work', de: 'Aufgabe', en: 'task', avoidDe: ['Ticket'], avoidEn: ['ticket'], status: 'proposed', ...patch,
  })
  const locales: Locales = { de: {}, en: {} }
  const errorsOf = (terms: unknown) => check({ terms, lock: {}, locales }).errors

  it('accepts a complete entry with note and allow', () => {
    expect(errorsOf([entry({ note: 'n', allow: ['a.b'] })])).toEqual([])
  })

  it('rejects a registry that is not an array and entries that are not objects', () => {
    expect(errorsOf({})).toEqual(['terms.json must be an array of entries'])
    expect(errorsOf(['x'])).toEqual(['entry #0 is not an object'])
  })

  it('rejects duplicate ids', () => {
    expect(errorsOf([entry(), entry()])).toContain('term task: duplicate id')
  })

  it('rejects empty de/en, a bad status, unknown keys and malformed lists', () => {
    expect(errorsOf([entry({ de: ' ' })])).toContain('term task: "de" must be a non-empty string')
    expect(errorsOf([entry({ en: '' })])).toContain('term task: "en" must be a non-empty string')
    expect(errorsOf([entry({ status: 'draft' as Entry['status'] })])).toContain('term task: status must be proposed or decided')
    expect(errorsOf([{ ...entry(), extra: 1 }])).toContain('term task: unknown key "extra"')
    expect(errorsOf([entry({ avoidDe: [''] })])).toContain('term task: "avoidDe" must be a list of non-empty strings')
    expect(errorsOf([entry({ allow: 'a.b' as unknown as string[] })])).toContain('term task: "allow" must be a list of locale keys')
  })

  it('rejects a missing required key', () => {
    const { avoidEn: _omit, ...incomplete } = entry()
    expect(errorsOf([incomplete])).toContain('term task: missing "avoidEn"')
  })
})

describe('terminology: approval sequences (fixtures)', () => {
  const base: Entry = {
    id: 'timebox', concept: 'Planned time', de: 'Timebox', en: 'timebox', avoidDe: ['Zeitbox'], avoidEn: ['time limit'], status: 'proposed',
  }
  const clean: Locales = { de: { 'task.timebox': 'Timebox' }, en: { 'task.timebox': 'timebox' } }

  it('add proposed (passes) -> promote with approve (passes) -> edit de unapproved (fails) -> approve (passes) -> remove (fails)', () => {
    // add a proposed term: nothing is locked, nothing fails
    let terms: Entry[] = [base]
    let lock: Lock = {}
    expect(check({ terms, lock, locales: clean })).toEqual({ errors: [], warnings: [] })

    // promote it: approve sets it to decided and locks its hash
    const approved = approve({ terms, ids: ['timebox'] })
    terms = approved.terms
    lock = approved.lock
    expect(terms[0]?.status).toBe('decided')
    expect(lock).toEqual({ timebox: hash(terms[0] as Entry) })
    expect(check({ terms, lock, locales: clean }).errors).toEqual([])

    // edit the German form without approving: the hash no longer matches
    terms = [{ ...(terms[0] as Entry), de: 'Zeitvorgabe' }]
    expect(check({ terms, lock, locales: clean }).errors).toEqual([
      'decided term timebox changed or removed: needs the user (`npm run terms:approve`)',
    ])

    // approve again: passes with the new hash
    const reapproved = approve({ terms })
    lock = reapproved.lock
    expect(check({ terms: reapproved.terms, lock, locales: clean }).errors).toEqual([])

    // remove the term: the lock has an entry without a decided term
    expect(check({ terms: [], lock, locales: clean }).errors).toEqual([
      'decided term timebox changed or removed: needs the user (`npm run terms:approve`)',
    ])
  })

  it('does not depend on the key order of an entry', () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as Entry
    expect(hash(reordered)).toBe(hash(base))
  })

  it('flipping status from decided back to proposed without approving fails', () => {
    const { terms, lock } = approve({ terms: [base], ids: ['timebox'] })
    const reverted = [{ ...(terms[0] as Entry), status: 'proposed' as const }]
    expect(check({ terms: reverted, lock, locales: clean }).errors).toHaveLength(1)
  })

  it('a decided entry without a lock entry fails', () => {
    const errors = check({ terms: [{ ...base, status: 'decided' }], lock: {}, locales: clean }).errors
    expect(errors).toEqual(['decided term timebox has no approval in terms.lock.json: needs the user (`npm run terms:approve`)'])
  })

  it('approve without ids relocks the decided entries and drops lock entries of removed ones', () => {
    const first = approve({ terms: [base, { ...base, id: 'topic', de: 'Thema', en: 'topic', avoidDe: [], avoidEn: [] }], ids: ['timebox', 'topic'] })
    expect(Object.keys(first.lock)).toEqual(['timebox', 'topic'])
    const second = approve({ terms: first.terms.filter(entry => entry.id !== 'topic') })
    expect(Object.keys(second.lock)).toEqual(['timebox'])
  })

  it('approve rejects an unknown id and an invalid registry', () => {
    expect(() => approve({ terms: [base], ids: ['nope'] })).toThrow('unknown term id: nope')
    expect(() => approve({ terms: [{ ...base, de: '' }] })).toThrow('terms.json is invalid')
  })
})

describe('terminology: avoid forms in locale values (fixtures)', () => {
  const entry: Entry = {
    id: 'timebox', concept: 'Planned time', de: 'Timebox', en: 'timebox', avoidDe: ['Zeitbox'], avoidEn: ['time limit'], status: 'proposed',
  }
  const withAvoid: Locales = { de: { 'a.one': 'Keine Zeitbox', 'a.two': 'Timebox' }, en: { 'a.one': 'Set a time limit' } }
  const decided = (patch: Partial<Entry> = {}) => {
    const terms: Entry[] = [{ ...entry, ...patch, status: 'decided' }]
    return { terms, lock: approve({ terms }).lock }
  }

  it('fails for a decided term, in de and in en', () => {
    const { terms, lock } = decided()
    const { errors, warnings } = check({ terms, lock, locales: withAvoid })
    expect(errors).toEqual([
      'de a.one: avoid form "Zeitbox" of term timebox',
      'en a.one: avoid form "time limit" of term timebox',
    ])
    expect(warnings).toEqual([])
  })

  it('only warns for a proposed term', () => {
    const { errors, warnings } = check({ terms: [entry], lock: {}, locales: withAvoid })
    expect(errors).toEqual([])
    expect(warnings).toEqual([
      'de a.one: avoid form "Zeitbox" of term timebox',
      'en a.one: avoid form "time limit" of term timebox',
    ])
  })

  it('passes for a key in allow', () => {
    const { terms, lock } = decided({ allow: ['a.one'] })
    expect(check({ terms, lock, locales: withAvoid })).toEqual({ errors: [], warnings: [] })
  })

  it('checks each locale against its own avoid list', () => {
    const { terms, lock } = decided()
    const swapped: Locales = { de: { 'a.one': 'Set a time limit' }, en: { 'a.one': 'Keine Zeitbox' } }
    expect(check({ terms, lock, locales: swapped })).toEqual({ errors: [], warnings: [] })
  })
})

describe('terminology: registry self-consistency (fixtures)', () => {
  const del: Entry = { id: 'delete', concept: 'Delete a task', de: 'Löschen', en: 'Delete', avoidDe: ['Verwerfen'], avoidEn: ['discard'], status: 'proposed' }
  const remove: Entry = { id: 'remove', concept: 'Take a value away', de: 'Entfernen', en: 'Remove', avoidDe: ['Löschen'], avoidEn: ['delete'], status: 'proposed' }
  const locales: Locales = { de: {}, en: {} }
  const decideAll = (terms: Entry[]) => {
    const decided = terms.map(entry => ({ ...entry, status: 'decided' as const }))
    return { terms: decided, lock: approve({ terms: decided }).lock }
  }

  it('finds a preferred form that hits another term\'s avoid form, in de and in en', () => {
    expect(conflictsOf([del, remove]).map(c => `${c.id} ${c.locale} "${c.value}" -> ${c.otherId} "${c.form}"`)).toEqual([
      'delete de "Löschen" -> remove "Löschen"',
      'delete en "Delete" -> remove "delete"',
    ])
  })

  it('also finds a term that avoids its own preferred form', () => {
    expect(conflictsOf([{ ...del, avoidDe: ['Lösch'] }]).map(c => `${c.id} -> ${c.otherId}`)).toEqual(['delete -> delete'])
  })

  it('is an error when both terms are decided', () => {
    const { terms, lock } = decideAll([del, remove])
    expect(check({ terms, lock, locales })).toEqual({
      errors: [
        'term delete de "Löschen" hits avoid form "Löschen" of term remove',
        'term delete en "Delete" hits avoid form "delete" of term remove',
      ],
      warnings: [],
    })
  })

  it('is only a warning when one or both terms are proposed', () => {
    const warned = [
      'term delete de "Löschen" hits avoid form "Löschen" of term remove',
      'term delete en "Delete" hits avoid form "delete" of term remove',
    ]
    expect(check({ terms: [del, remove], lock: {}, locales })).toEqual({ errors: [], warnings: warned })
    const { terms, lock } = decideAll([del])
    expect(check({ terms: [terms[0] as Entry, remove], lock, locales })).toEqual({ errors: [], warnings: warned })
  })

  it('passes once the contradiction is gone', () => {
    const fixed = { ...remove, avoidDe: ['Streichen'], avoidEn: ['erase'] }
    const { terms, lock } = decideAll([del, fixed])
    expect(check({ terms, lock, locales })).toEqual({ errors: [], warnings: [] })
  })

  it('does not treat a word inside a longer word as a hit', () => {
    const topic: Entry = { ...del, id: 'topic', de: 'Thema', en: 'topic', avoidDe: ['Tags'], avoidEn: ['tag'] }
    const dayClose: Entry = { ...del, id: 'day-close', de: 'Tag abschließen', en: 'Close the day', avoidDe: ['Tagesabschluss'], avoidEn: ['day close'] }
    expect(conflictsOf([topic, dayClose])).toEqual([])
  })
})

describe('terminology: lock robustness (fixtures)', () => {
  const base: Entry = { id: 'timebox', concept: 'Planned time', de: 'Timebox', en: 'timebox', avoidDe: ['Zeitbox'], avoidEn: ['time limit'], status: 'proposed' }
  const locales: Locales = { de: {}, en: {} }

  it.each([[null], [[]], ['x'], [1]])('reports a lock that is not an object (%j) instead of throwing', (lock) => {
    const { errors } = check({ terms: [base], lock: lock as unknown as Lock, locales })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('terms.lock.json must be an object')
  })

  it('does not take an inherited key for an approval', () => {
    const terms: Entry[] = [{ ...base, id: 'constructor', status: 'decided' }]
    expect(check({ terms, lock: {}, locales }).errors).toEqual([
      'decided term constructor has no approval in terms.lock.json: needs the user (`npm run terms:approve`)',
    ])
  })
})

describe('terminology: approve report (fixtures)', () => {
  const entry = (id: string, patch: Partial<Entry> = {}): Entry => ({
    id, concept: id, de: `${id}-de`, en: `${id}-en`, avoidDe: [`${id}-alt`], avoidEn: [], status: 'proposed', ...patch,
  })
  const locales: Locales = { de: { 'a.one': 'Das ist a-alt', 'a.two': 'noch a-alt', 'b.one': 'ok' }, en: {} }

  it('lists the ids newly locked, changed and dropped', () => {
    const first = approve({ terms: [entry('a'), entry('b'), entry('c')], ids: ['a', 'b', 'c'] })
    expect(first.report).toMatchObject({ newlyLocked: ['a', 'b', 'c'], changed: [], dropped: [] })

    // an agent edits b and flips d to decided by hand, c is removed
    const edited = [first.terms[0] as Entry, { ...(first.terms[1] as Entry), de: 'b-neu' }, entry('d', { status: 'decided' })]
    const second = approve({ terms: edited, lock: first.lock })
    expect(second.report).toMatchObject({ newlyLocked: ['d'], changed: ['b'], dropped: ['c'] })
  })

  it('counts the current avoid hits of the promoted term and stays silent about untouched ones', () => {
    const first = approve({ terms: [entry('a'), entry('b')], ids: ['b'], locales })
    expect(first.report.avoidHits).toEqual({ b: 0 })
    const second = approve({ terms: first.terms, ids: ['a'], lock: first.lock, locales })
    expect(second.report.newlyLocked).toEqual(['a'])
    expect(second.report.avoidHits).toEqual({ a: 2 })
  })

  it('tolerates a missing or broken previous lock', () => {
    expect(approve({ terms: [entry('a')], ids: ['a'], lock: null }).report.newlyLocked).toEqual(['a'])
    expect(approve({ terms: [entry('a')], ids: ['a'] }).report.dropped).toEqual([])
  })

  it('flattens nested locale files', () => {
    expect(flatten_({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })).toEqual({ 'a.b': 'x', 'a.c.d': 'y', e: 'z' })
  })
})

describe('terminology: CLI entry', () => {
  it('runs through a symlinked path (prints usage, exits 1) instead of silently doing nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'copy-terms-link-'))
    try {
      const link = join(dir, 'copy-terms.mjs')
      symlinkSync(resolve(root, 'scripts/copy-terms.mjs'), link)
      const result = spawnSync('node', [link], { encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('usage: node scripts/copy-terms.mjs approve')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints usage for the direct path too', () => {
    const result = spawnSync('node', [resolve(root, 'scripts/copy-terms.mjs')], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('usage:')
  })
})

describe('terminology: approve CLI in a scratch copy', () => {
  it('promotes, prints the report and the avoid hits, then relocks (add -> approve -> edit -> approve -> remove)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'copy-terms-cli-'))
    try {
      for (const sub of ['scripts', 'docs/copy', 'i18n/locales']) mkdirSync(join(dir, sub), { recursive: true })
      copyFileSync(resolve(root, 'scripts/copy-terms.mjs'), join(dir, 'scripts/copy-terms.mjs'))
      const write = (path: string, value: unknown) => writeFileSync(join(dir, path), JSON.stringify(value))
      const term = (id: string, de: string): Entry => ({ id, concept: id, de, en: id, avoidDe: ['Zeitbox'], avoidEn: [], status: 'proposed' })
      write('i18n/locales/de.json', { a: { b: 'Keine Zeitbox', c: 'Timebox' } })
      write('i18n/locales/en.json', { a: { b: 'none' } })
      write('docs/copy/terms.json', [term('timebox', 'Timebox'), term('topic', 'Thema')])
      write('docs/copy/terms.lock.json', {})
      const run = (...args: string[]) => spawnSync('node', [join(dir, 'scripts/copy-terms.mjs'), ...args], { encoding: 'utf8' })
      const lock = () => JSON.parse(readFileSync(join(dir, 'docs/copy/terms.lock.json'), 'utf8')) as Lock

      const first = run('approve', 'timebox')
      expect(first.status).toBe(0)
      expect(first.stdout).toContain('1 decided term(s) locked, promoted: timebox')
      expect(first.stdout).toContain('newly locked: timebox')
      expect(first.stdout).toContain('changed: none')
      expect(first.stdout).toContain('timebox: 1 avoid hit(s) in the current locales are now build errors')
      expect(first.stdout).toContain('would now report 1 error(s)')
      expect(Object.keys(lock())).toEqual(['timebox'])

      // edit the decided entry by hand, as an agent could: the bare approve names it as changed
      const terms = JSON.parse(readFileSync(join(dir, 'docs/copy/terms.json'), 'utf8')) as Entry[]
      write('docs/copy/terms.json', [{ ...(terms[0] as Entry), de: 'Zeitrahmen' }, ...terms.slice(1)])
      const second = run('approve')
      expect(second.stdout).toContain('newly locked: none')
      expect(second.stdout).toContain('changed: timebox')

      // remove it: the bare approve names the dropped id
      write('docs/copy/terms.json', terms.slice(1))
      const third = run('approve')
      expect(third.stdout).toContain('dropped: timebox')
      expect(lock()).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
