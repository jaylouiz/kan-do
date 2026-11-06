import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildReport,
  DETECTORS,
  findDetectorHits,
  keysFor,
  main,
  mixedForms,
  renderReport,
  termCandidates,
} from '../../scripts/copy-concepts.mjs'

// Copy-concepts measurement (#482): detectors on fixtures, registry words are not candidates, the report is
// deterministic, and the CLI never writes. The real locales are measured by `npm run copy:concepts`, not here.

type Locales = { de: Record<string, string>, en: Record<string, string> }
type Hit = { key: string, text: string }
type Row = { id: string, why: string, locale: string, count: number, hits: Hit[] }
type Entry = { id: string, concept: string, de: string, en: string, avoidDe: string[], avoidEn: string[], status: 'proposed' | 'decided', note?: string }
type Candidate = { word: string, count: number, keys: string[] }
type Report = { keys: { de: number, en: number }, detectors: Row[], candidates: { de: Candidate[], en: Candidate[] }, mixedForms: { id: string, locale: string, forms: { form: string, preferred: boolean, count: number }[] }[] }

const hitsOf = findDetectorHits as (locales: Locales) => Row[]
const candidatesOf = termCandidates as (locales: Locales, terms: Entry[], options?: { limit?: number }) => { de: Candidate[], en: Candidate[] }
const mixedOf = mixedForms as (locales: Locales, terms: Entry[]) => Report['mixedForms']
const reportOf = buildReport as (locales: Locales, terms: Entry[]) => Report
const render = renderReport as (report: Report) => string
const keysOf = keysFor as (selector: string, locales: Locales) => { locale: string, key: string, text: string }[]
const run = main as (args: string[], paths: { de: string, en: string, terms: string }) => string
const detectorIds = (DETECTORS as { id: string }[]).map(detector => detector.id)

function find(rows: Row[], id: string, locale: string): string[] {
  const row = rows.find(candidate => candidate.id === id && candidate.locale === locale)
  expect(row, `${id}/${locale} exists`).toBeDefined()
  return row!.hits.map(hit => hit.key)
}

const dirty: Locales = {
  de: {
    'a.formal': 'Bitte geben Sie Ihr Passwort ein.',
    'a.informal': 'Gib dein Passwort ein.',
    'b.bang': 'Gespeichert!',
    'c.dots': 'Lade Daten...',
    'c.char': 'Lade Daten…',
    'd.please': 'Bitte versuche es erneut.',
    'e.failed': 'Der Export ist fehlgeschlagen.',
    'e.could': 'Das Update konnte nicht geladen werden.',
    'e.cannot': 'Das kann nicht gelöscht werden.',
    'f.ok': 'OK',
    'f.ja': 'Ja',
    'f.nein': 'Nein',
    'g.caps': 'LÖSCHEN bestätigen',
    'g.acronym': 'Der API Zugriff',
    'h.empty': 'Keine Aufgaben vorhanden.',
    'h.noch': 'Noch keine Themen.',
    'p.description': 'Befehle suchen und ausführen',
    'p.hint': 'Das steht in der Zeile.',
    'p.help': 'Für {n} Aufgaben gilt das',
    'p.pageDescription': 'Seite zum Suchen von Befehlen',
    'p.descriptionList': 'Seite zum Suchen von Befehlen',
  },
  en: {
    'a.bang': 'Done!',
    'c.dots': 'Loading...',
    'd.please': 'Please try again.',
    'e.failed': 'Export failed.',
    'e.could': 'The update could not be loaded.',
    'e.cannot': 'This cannot be deleted.',
    'f.yes': 'Yes',
    'f.no': 'No',
    'f.ok': 'OK',
    'g.contraction': "Can't move this task",
    'g.curly': 'What’s new',
    'g.spelled': 'That is enough for today.',
    'g.caps': 'DELETE now',
    'h.empty': 'No tasks yet.',
    'h.nothing': 'Nothing left open.',
    'p.description': 'Search and run commands',
    'p.other': 'Search and run commands',
    'p.emptyHint': 'Shown when the list is empty',
    'p.descriptionList': 'Search and run commands',
  },
}

const clean: Locales = {
  de: {
    'x.title': 'Tag abschließen',
    'x.body': 'Du kannst die Aufgabe später wiederherstellen.',
    'x.loading': 'Lädt…',
    'x.description': 'Fokus und Verbindungen.',
    'x.now': 'Jetzt',
    'x.nobody': 'Notizen werden gespeichert',
  },
  en: {
    'x.title': 'Close the day',
    'x.body': 'You can restore the task later.',
    'x.loading': 'Loading…',
    'x.description': 'Focus and connections.',
    'x.now': 'Now',
    'x.nobody': 'Nobody is here',
  },
}

describe('detectors', () => {
  const rows = hitsOf(dirty)

  it('formal and informal address are told apart', () => {
    expect(find(rows, 'address-formal', 'de')).toEqual(['a.formal'])
    expect(find(rows, 'address-informal', 'de')).toEqual(['a.informal'])
  })

  it('finds exclamation marks per locale', () => {
    expect(find(rows, 'exclamation', 'de')).toEqual(['b.bang'])
    expect(find(rows, 'exclamation', 'en')).toEqual(['a.bang'])
  })

  it('three dots and the ellipsis character are counted apart', () => {
    expect(find(rows, 'three-dots', 'de')).toEqual(['c.dots'])
    expect(find(rows, 'three-dots', 'en')).toEqual(['c.dots'])
    expect(find(rows, 'ellipsis-char', 'de')).toEqual(['c.char'])
  })

  it('finds Bitte and please', () => {
    expect(find(rows, 'please', 'de')).toEqual(['a.formal', 'd.please'])
    expect(find(rows, 'please', 'en')).toEqual(['d.please'])
  })

  it('finds error phrasing in both languages', () => {
    expect(find(rows, 'error-phrasing', 'de')).toEqual(['e.cannot', 'e.could', 'e.failed'])
    expect(find(rows, 'error-phrasing', 'en')).toEqual(['e.cannot', 'e.could', 'e.failed'])
  })

  it('finds button-like values only when the whole value is OK/Ja/Nein/Yes/No', () => {
    expect(find(rows, 'button-ok-yes-no', 'de')).toEqual(['f.ja', 'f.nein', 'f.ok'])
    expect(find(rows, 'button-ok-yes-no', 'en')).toEqual(['f.no', 'f.ok', 'f.yes'])
  })

  it('finds contractions (both apostrophes) and spelled-out forms', () => {
    expect(find(rows, 'contractions', 'en')).toEqual(['g.contraction', 'g.curly'])
    expect(find(rows, 'spelled-out', 'en')).toEqual(['e.cannot', 'e.could', 'g.spelled'])
  })

  it('finds ALL CAPS words but not a listed acronym', () => {
    expect(find(rows, 'all-caps', 'de')).toEqual(['g.caps'])
    expect(find(rows, 'all-caps', 'en')).toEqual(['g.caps'])
  })

  it('finds empty-state phrasing at the start of a value', () => {
    expect(find(rows, 'empty-phrasing', 'de')).toEqual(['h.empty', 'h.noch'])
    expect(find(rows, 'empty-phrasing', 'en')).toEqual(['h.empty', 'h.nothing'])
  })

  it('period style: only description/hint/help keys (also camelCase), no placeholder, no closing punctuation', () => {
    expect(find(rows, 'period-style', 'de')).toEqual(['p.description', 'p.pageDescription'])
    expect(find(rows, 'period-style', 'en')).toEqual(['p.description', 'p.emptyHint'])
  })

  it('finds none of the problem detectors in clean text (the counterweights count the preferred forms)', () => {
    const counterweights = ['address-informal', 'ellipsis-char']
    const cleanRows = hitsOf(clean).filter(row => !counterweights.includes(row.id))
    expect(cleanRows.length).toBeGreaterThan(10)
    expect(cleanRows.filter(row => row.count > 0).map(row => `${row.id}/${row.locale}`)).toEqual([])
    expect(hitsOf(clean).filter(row => counterweights.includes(row.id) && row.count > 0)).toHaveLength(3)
  })

  it('every detector has a one-line why and covers at least one locale', () => {
    for (const detector of DETECTORS as { id: string, why: string, de?: unknown, en?: unknown }[]) {
      expect(detector.why.length).toBeGreaterThan(10)
      expect(detector.why).not.toContain('\n')
      expect(detector.de !== undefined || detector.en !== undefined).toBe(true)
    }
    expect(new Set(detectorIds).size).toBe(detectorIds.length)
  })
})

describe('term candidates', () => {
  const locales: Locales = {
    de: {
      'a.1': 'Konfiguration prüfen',
      'a.2': 'Konfiguration speichern',
      'a.3': 'Die Konfiguration fehlt',
      'b.1': 'Aufgabenliste leeren',
      'b.2': 'Aufgabenliste zeigen',
      'b.3': 'Aufgabenliste teilen',
      'c.1': 'Zugang erneuern',
      'c.2': 'Zugang prüfen',
    },
    en: {
      'a.1': 'Configuration check',
      'a.2': 'Configuration saved',
      'a.3': 'Configuration missing',
      'b.1': 'Timebox ready',
      'b.2': 'Timebox set',
      'b.3': 'Timebox cleared',
    },
  }
  const terms: Entry[] = [
    { id: 'task', concept: 'task', de: 'Aufgabe', en: 'task', avoidDe: [], avoidEn: [], status: 'proposed' },
    { id: 'timebox', concept: 'timebox', de: 'Timebox', en: 'timebox', avoidDe: ['Zeitbox'], avoidEn: [], status: 'proposed' },
  ]

  it('lists a recurring word that no registry field has, with count and example keys', () => {
    expect(candidatesOf(locales, terms).de).toEqual([{ word: 'konfiguration', count: 3, keys: ['a.1', 'a.2', 'a.3'] }])
    expect(candidatesOf(locales, terms).en).toEqual([{ word: 'configuration', count: 3, keys: ['a.1', 'a.2', 'a.3'] }])
  })

  it('a word in a registry field (or an inflection of it) is not a candidate', () => {
    const words = candidatesOf(locales, terms)
    expect(words.de.map(candidate => candidate.word)).not.toContain('aufgabenliste')
    expect(words.en.map(candidate => candidate.word)).not.toContain('timebox')
  })

  it('a word in an avoid field is not a candidate either', () => {
    const withAvoid: Entry[] = [...terms, { id: 'config', concept: 'config', de: 'Einstellungen', en: 'settings', avoidDe: ['Konfiguration'], avoidEn: ['configuration'], status: 'proposed' }]
    expect(candidatesOf(locales, withAvoid).de).toEqual([])
    expect(candidatesOf(locales, withAvoid).en).toEqual([])
  })

  it('needs 3 keys, and honours the limit', () => {
    expect(candidatesOf(locales, terms).de.map(candidate => candidate.word)).not.toContain('zugang')
    expect(candidatesOf(locales, [], { limit: 1 }).de).toHaveLength(1)
  })
})

describe('mixed forms', () => {
  const locales: Locales = {
    de: { 'a': 'Timebox setzen', 'b': 'Timebox ändern', 'c': 'Zeitbox setzen', 'd': 'Zeitvorgabe' },
    en: { a: 'Set a timebox' },
  }
  const entry = (extra: Partial<Entry>): Entry => ({ id: 'timebox', concept: 'timebox', de: 'Timebox', en: 'timebox', avoidDe: ['Zeitbox', 'Zeitvorgabe'], avoidEn: ['time limit'], status: 'proposed', ...extra })

  it('lists the live count per form for a term with a note', () => {
    const rows = mixedOf(locales, [entry({ note: 'mixed forms' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe('timebox')
    expect(rows[0]!.forms).toEqual([
      { form: 'Timebox', preferred: true, count: 2 },
      { form: 'Zeitbox', preferred: false, count: 1 },
      { form: 'Zeitvorgabe', preferred: false, count: 1 },
    ])
  })

  it('skips a term without a note and a term whose avoid forms are gone', () => {
    expect(mixedOf(locales, [entry({})])).toEqual([])
    expect(mixedOf({ de: { a: 'Timebox' }, en: {} }, [entry({ note: 'x' })])).toEqual([])
  })
})

describe('report', () => {
  const terms: Entry[] = [{ id: 'timebox', concept: 'timebox', de: 'Timebox', en: 'timebox', avoidDe: ['Zeitbox'], avoidEn: [], status: 'proposed', note: 'mixed' }]
  const shuffled = (locales: Locales): Locales => ({
    de: Object.fromEntries(Object.entries(locales.de).reverse()),
    en: Object.fromEntries(Object.entries(locales.en).reverse()),
  })

  it('is deterministic: the same input twice, and key order does not matter', () => {
    const first = render(reportOf(dirty, terms))
    expect(render(reportOf(dirty, terms))).toBe(first)
    expect(render(reportOf(shuffled(dirty), terms))).toBe(first)
  })

  it('shows at most 8 examples per detector and names the rest', () => {
    const many: Locales = { de: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`k${String(index).padStart(2, '0')}`, `Fertig${index}!`])), en: {} }
    const text = render(reportOf(many, terms))
    expect(text).toContain('**de: 12**')
    expect(text).toContain('… 4 more')
    expect(text).toContain('`k07` = Fertig7!')
    expect(text).not.toContain('`k08` = Fertig8!')
    expect(keysOf('exclamation', many)).toHaveLength(12)
  })

  it('keysFor: a detector id gives every key, word: gives a cluster, an unknown id throws', () => {
    expect(keysOf('please', dirty).map(row => `${row.locale}:${row.key}`)).toEqual(['de:a.formal', 'de:d.please', 'en:d.please'])
    expect(keysOf('word:daten', dirty).map(row => row.key)).toEqual(['c.char', 'c.dots'])
    expect(() => keysOf('nope', dirty)).toThrow(/unknown detector/)
  })
})

describe('main', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'copy-concepts-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'locales'))
    const paths = { de: join(dir, 'locales/de.json'), en: join(dir, 'locales/en.json'), terms: join(dir, 'terms.json') }
    writeFileSync(paths.de, JSON.stringify({ a: { bang: 'Fertig!', plain: 'Ruhig.' }, b: 'Zeitbox setzen' }))
    writeFileSync(paths.en, JSON.stringify({ a: { bang: 'Done!', plain: 'Calm.' }, b: 'Set a timebox' }))
    writeFileSync(paths.terms, JSON.stringify([{ id: 'timebox', concept: 'timebox', de: 'Timebox', en: 'timebox', avoidDe: ['Zeitbox'], avoidEn: [], status: 'proposed', note: 'mixed' }]))
    writeFileSync(join(dir, 'terms.lock.json'), '{}')
    return { dir, paths }
  }

  const snapshot = (dir: string): string => {
    const hash = createHash('sha256')
    const walk = (path: string) => {
      for (const name of readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = join(path, name.name)
        if (name.isDirectory()) walk(full)
        else hash.update(full).update(readFileSync(full))
      }
    }
    walk(dir)
    return `${hash.digest('hex')}:${readdirSync(dir, { recursive: true }).length}`
  }

  it('writes nothing: the fixture directory is unchanged after every mode', () => {
    const { dir, paths } = fixture()
    const before = snapshot(dir)
    run([], paths)
    run(['--json'], paths)
    run(['--keys', 'exclamation'], paths)
    run(['--keys', 'word:zeit', '--json'], paths)
    expect(snapshot(dir)).toBe(before)
  })

  it('one more "!" in a fixture string shows up as one more hit, and a rerun on unchanged input is identical', () => {
    const { paths } = fixture()
    const count = () => (JSON.parse(run(['--json'], paths)) as Report).detectors.find(row => row.id === 'exclamation' && row.locale === 'de')!.count
    const first = run([], paths)
    expect(run([], paths)).toBe(first)
    expect(count()).toBe(1)
    writeFileSync(paths.de, JSON.stringify({ a: { bang: 'Fertig!', plain: 'Ruhig!' }, b: 'Zeitbox setzen' }))
    expect(count()).toBe(2)
  })

  it('--json parses and carries examples, not the full key list', () => {
    const { paths } = fixture()
    const report = JSON.parse(run(['--json'], paths)) as { detectors: { examples: Hit[], hits?: unknown }[], mixedForms: { id: string }[] }
    expect(report.detectors.every(row => Array.isArray(row.examples) && row.hits === undefined)).toBe(true)
    expect(report.mixedForms.map(row => row.id)).toEqual(['timebox'])
  })

  it('--keys lists every key as locale, key, text; bad arguments throw', () => {
    const { paths } = fixture()
    expect(run(['--keys', 'exclamation'], paths)).toBe('2 key(s) for exclamation\nde\ta.bang\tFertig!\nen\ta.bang\tDone!\n')
    expect(() => run(['--keys'], paths)).toThrow(/--keys needs/)
    expect(() => run(['--bogus'], paths)).toThrow(/unknown argument/)
  })
})
