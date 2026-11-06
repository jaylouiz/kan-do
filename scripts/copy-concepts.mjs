#!/usr/bin/env node
/**
 * Copy concepts: measures the locales for a calibration questionnaire (#482, epic #464).
 *
 * The `copy-writer` skill (`.claude/skills/copy-writer/calibrate.md`) asks the user a short questionnaire instead of
 * a review of every string. This script is the measurement behind it: per detector the count and the keys, the words
 * that recur across keys but are in no registry entry, and the live count per form of registry terms with a `note`.
 * It is read-only (never writes a locale, the registry or the lock) and exits 0 whatever it finds: it measures, it
 * does not gate. Detectors are regex heuristics; false positives are fine because the agent reads the example keys.
 *
 *   `npm run copy:concepts`                      -> markdown report
 *   `npm run copy:concepts -- --json`            -> the same as JSON
 *   `npm run copy:concepts -- --keys <id>`       -> every key of a detector (`--json`: a list)
 *   `npm run copy:concepts -- --keys word:<p>`   -> every key with a word starting with `<p>` (a cluster; both locales)
 *
 * Pure functions (`findDetectorHits`, `termCandidates`, `mixedForms`, `renderReport`) are exported; `main` runs only
 * when the file is the process entry.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenMessages, matchesAvoidForm, TERMS_PATH } from './copy-terms.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES_DIR = join(ROOT, 'i18n/locales')

export const EXAMPLES_PER_DETECTOR = 8
export const CANDIDATE_LIMIT = 40
export const CANDIDATE_MIN_KEYS = 3
export const CANDIDATE_MIN_LETTERS = 5
const REGISTERED_MIN_LETTERS = 4

/** A last key segment that is, or ends in, description/hint/help (`description`, `pageDescription`, `emptyHint`). */
const DESCRIPTION_KEY = /(?:^|\.)[\w-]*(?:[Dd]escription|[Hh]int|[Hh]elp)$/
const hasPlaceholder = value => /\{[^}]*\}/.test(value)

/** Contractions are matched on both apostrophe forms. */
const EN_CONTRACTION = /\b(?:\w+n['’]t|(?:it|that|there|here|what|who|let|he|she|we|you|they|i)['’](?:s|re|ve|ll|d|m))\b/i
const EN_SPELLED_OUT = /\b(?:do not|does not|did not|is not|are not|was not|were not|will not|would not|cannot|could not|should not|has not|have not|it is|that is|there is|you are|we are|they are|you will|you have)\b/i
const ALL_CAPS_IGNORED = new Set(['OK', 'API', 'URL', 'CSV', 'JSON', 'PDF', 'HTML', 'PIN', 'MCP', 'UTC', 'ISO', 'HTTP', 'HTTPS', 'OAUTH', 'WIP', 'ID', 'UI', 'FAQ', 'SSO', 'ICS', 'DNS'])

/** Words in capitals (two letters or more, no placeholders), minus a few real acronyms. */
function allCapsWords(value) {
  const text = value.replace(/\{[^}]*\}/g, ' ')
  return (text.match(/(?<![\p{L}\p{N}])\p{Lu}{2,}(?![\p{L}\p{N}])/gu) ?? []).filter(word => !ALL_CAPS_IGNORED.has(word))
}

/**
 * The detector table. A test is a RegExp (on the value) or `(value, key) => boolean`; `de` / `en` set per locale.
 * `why` is the one-line reason a hit matters for the questionnaire.
 */
export const DETECTORS = [
  {
    id: 'address-formal',
    why: 'German formal address (Sie/Ihr/Ihnen): a leftover next to the du voice',
    de: /(?<![\p{L}\p{N}])(?:Sie|Ihr\p{L}*|Ihnen)(?![\p{L}\p{N}])/u,
  },
  {
    id: 'address-informal',
    why: 'German informal address (du/dein/dir/dich): the counterweight for address-formal',
    de: /(?<![\p{L}\p{N}])(?:du|dein\p{L}*|dir|dich)(?![\p{L}\p{N}])/iu,
  },
  {
    id: 'exclamation',
    why: 'Exclamation marks: tone (calm vs enthusiastic), praise in tips and statistics',
    de: /!/,
    en: /!/,
  },
  {
    id: 'three-dots',
    why: 'Three dots "..." where the design rule asks for the single character "…"',
    de: /\.{3}/,
    en: /\.{3}/,
  },
  {
    id: 'ellipsis-char',
    why: 'The single ellipsis character "…": the counterweight for three-dots',
    de: /…/,
    en: /…/,
  },
  {
    id: 'please',
    why: 'Bitte / please: politeness register, mostly in errors and hints',
    de: /(?<![\p{L}\p{N}])bitte(?![\p{L}\p{N}])/iu,
    en: /\bplease\b/i,
  },
  {
    id: 'error-phrasing',
    why: 'Error structure: "X ist fehlgeschlagen" vs "konnte nicht" / "kann nicht" (en: failed, could not, cannot)',
    de: /fehlgeschlagen|konnte nicht|kann nicht/i,
    en: /\bfailed\b|\bcould not\b|\bcannot\b/i,
  },
  {
    id: 'button-ok-yes-no',
    why: 'Button-like values that are only OK / Ja / Nein / Yes / No: the rule says buttons are verbs',
    de: value => ['OK', 'Ja', 'Nein'].includes(value.trim()),
    en: value => ['OK', 'Yes', 'No'].includes(value.trim()),
  },
  {
    id: 'contractions',
    why: 'English contractions (don\'t, it\'s): register of the English copy',
    en: EN_CONTRACTION,
  },
  {
    id: 'spelled-out',
    why: 'English spelled-out forms (do not, it is): the counterweight for contractions',
    en: EN_SPELLED_OUT,
  },
  {
    id: 'all-caps',
    why: 'Words in ALL CAPS: the case rule says sentence case, no ALL CAPS',
    de: value => allCapsWords(value).length > 0,
    en: value => allCapsWords(value).length > 0,
  },
  {
    id: 'empty-phrasing',
    why: 'Empty-state phrasing: "Keine …" / "Noch kein…" (en: "No …", "Nothing …") and how it ends',
    de: /^(?:Keine?[nmrs]?|Noch kein\p{L}*|Nichts)(?![\p{L}\p{N}])/u,
    en: /^(?:No\s+\p{L}|Nothing(?![\p{L}\p{N}]))/u,
  },
  {
    id: 'period-style',
    why: 'Sentence without placeholders in a description/hint/help key that ends without a full stop: period style',
    de: (value, key) => DESCRIPTION_KEY.test(key) && !hasPlaceholder(value) && /\p{L}\s*$/u.test(value) && /\s/.test(value.trim()),
    en: (value, key) => DESCRIPTION_KEY.test(key) && !hasPlaceholder(value) && /\p{L}\s*$/u.test(value) && /\s/.test(value.trim()),
  },
]

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const LOCALE_ORDER = ['de', 'en']

function runTest(test, value, key) {
  if (test instanceof RegExp) return test.test(value)
  return test(value, key)
}

/**
 * Runs the detectors over the flattened locales.
 * @returns {{ id: string, why: string, locale: string, count: number, hits: { key: string, text: string }[] }[]}
 *   one row per detector and locale it covers, in table order; `hits` is every hit sorted by key.
 */
export function findDetectorHits(locales, detectors = DETECTORS) {
  const rows = []
  for (const detector of detectors) {
    for (const locale of LOCALE_ORDER) {
      const test = detector[locale]
      if (test === undefined) continue
      const hits = Object.entries(locales[locale] ?? {})
        .filter(([key, text]) => runTest(test, text, key))
        .map(([key, text]) => ({ key, text }))
        .sort((a, b) => byText(a.key, b.key))
      rows.push({ id: detector.id, why: detector.why, locale, count: hits.length, hits })
    }
  }
  return rows
}

/** Frequent words that are not terms; kept short, the cluster list is read by an agent anyway. */
const STOPWORDS = {
  de: new Set([
    'aber', 'alle', 'allen', 'aller', 'alles', 'auch', 'dabei', 'dann', 'darf', 'dass', 'dein', 'deine', 'deinen', 'deiner', 'deinem', 'denn', 'dich', 'diese', 'diesem', 'diesen', 'dieser', 'dieses',
    'doch', 'eine', 'einem', 'einen', 'einer', 'eines', 'einfach', 'erst', 'etwas', 'oder', 'ohne', 'noch', 'nicht', 'nach', 'neue', 'neuen', 'neuer', 'neues', 'schon', 'sich', 'sind', 'sonst',
    'über', 'unter', 'viele', 'vielen', 'wenn', 'werden', 'wieder', 'wird', 'wurde', 'wurden', 'würde', 'zeigt', 'zwischen', 'dafür', 'damit', 'dazu', 'danach', 'davon', 'diesmal', 'immer',
    'jetzt', 'kannst', 'kein', 'keine', 'keinen', 'machen', 'mehr', 'mein', 'meine', 'mich', 'musst', 'müssen', 'sein', 'seine', 'seiner', 'seinen', 'soll', 'sollen', 'sollte', 'wählen', 'weil',
    'weiter', 'weitere', 'weiteren', 'willst', 'wollen', 'zuerst', 'zurück', 'zum', 'später', 'gerade', 'heute', 'gestern', 'morgen', 'bereits', 'bisher', 'hier', 'dort', 'jede', 'jeden', 'jeder', 'jedes',
  ]),
  en: new Set([
    'about', 'above', 'after', 'again', 'all', 'also', 'always', 'another', 'because', 'before', 'being', 'below', 'between', 'both', 'cannot', 'could', 'does', 'doing', 'during', 'each', 'either',
    'every', 'from', 'have', 'here', 'into', 'just', 'later', 'make', 'many', 'more', 'most', 'much', 'need', 'never', 'next', 'other', 'otherwise', 'over', 'same', 'select', 'should', 'since',
    'some', 'still', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'until', 'using', 'want', 'were', 'what', 'when', 'where',
    'whether', 'which', 'while', 'will', 'with', 'within', 'without', 'would', 'your', 'yours', 'currently', 'already', 'nothing', 'first', 'today', 'stays', 'current', 'please', 'instead', 'might', 'only', 'once', 'open',
  ]),
}

/** Lowercased words (letters only) of a message, placeholders and linked-message references removed. */
export function wordsOf(value) {
  const text = value.replace(/\{[^}]*\}/g, ' ').replace(/@[.:][\w.]+(?:\([^)]*\))?/g, ' ')
  return (text.toLowerCase().match(/\p{L}+/gu) ?? [])
}

/** Every word of the registry's `de`, `en`, `avoidDe`, `avoidEn` fields (lowercased), per locale. */
function registryWords(terms) {
  const words = { de: new Set(), en: new Set() }
  for (const term of terms) {
    for (const form of [term.de, ...(term.avoidDe ?? [])]) for (const word of wordsOf(form)) words.de.add(word)
    for (const form of [term.en, ...(term.avoidEn ?? [])]) for (const word of wordsOf(form)) words.en.add(word)
  }
  return words
}

/** A word counts as registered when it equals a registry word or one is the start of the other (inflections, compounds). */
function isRegistered(word, registered) {
  if (registered.has(word)) return true
  for (const known of registered) {
    if (known.length >= REGISTERED_MIN_LETTERS && (word.startsWith(known) || (word.length >= CANDIDATE_MIN_LETTERS && known.startsWith(word)))) return true
  }
  return false
}

/**
 * Term-cluster candidates: words (≥ 5 letters) that occur in ≥ 3 keys of a locale and are in no registry field.
 * @returns {{ de: Candidate[], en: Candidate[] }} sorted by count (desc), then word; `Candidate = { word, count, keys }`
 *   with up to 3 example keys.
 */
export function termCandidates(locales, terms, { limit = CANDIDATE_LIMIT, minKeys = CANDIDATE_MIN_KEYS, minLetters = CANDIDATE_MIN_LETTERS } = {}) {
  const registered = registryWords(terms)
  const result = {}
  for (const locale of LOCALE_ORDER) {
    const keysByWord = new Map()
    for (const [key, value] of Object.entries(locales[locale] ?? {})) {
      for (const word of new Set(wordsOf(value))) {
        if (word.length < minLetters || STOPWORDS[locale].has(word)) continue
        if (!keysByWord.has(word)) keysByWord.set(word, [])
        keysByWord.get(word).push(key)
      }
    }
    result[locale] = [...keysByWord.entries()]
      .filter(([word, keys]) => keys.length >= minKeys && !isRegistered(word, registered[locale]))
      .map(([word, keys]) => ({ word, count: keys.length, keys: keys.sort(byText).slice(0, 3) }))
      .sort((a, b) => b.count - a.count || byText(a.word, b.word))
      .slice(0, limit)
  }
  return result
}

/**
 * Registry terms with a `note` and the live count of keys per form (preferred and avoid), when an avoid form still
 * occurs: the mixed forms of a concept (e.g. Timebox 9 vs Zeitbox 12). Matching is the registry's (word prefix).
 * @returns {{ id: string, status: string, locale: string, forms: { form: string, preferred: boolean, count: number }[] }[]}
 */
export function mixedForms(locales, terms) {
  const rows = []
  for (const term of terms) {
    if (typeof term.note !== 'string' || term.note.trim() === '') continue
    for (const [locale, preferred, avoid] of [['de', term.de, term.avoidDe], ['en', term.en, term.avoidEn]]) {
      const forms = [{ form: preferred, preferred: true }, ...(avoid ?? []).map(form => ({ form, preferred: false }))]
        .map(entry => ({
          ...entry,
          count: Object.entries(locales[locale] ?? {}).filter(([key, value]) => !(term.allow ?? []).includes(key) && matchesAvoidForm(value, entry.form, term.caseSensitive === true)).length,
        }))
      if (forms.some(entry => !entry.preferred && entry.count > 0)) rows.push({ id: term.id, status: term.status, locale, forms })
    }
  }
  return rows
}

/** The complete measurement as one object. */
export function buildReport(locales, terms) {
  return {
    keys: { de: Object.keys(locales.de ?? {}).length, en: Object.keys(locales.en ?? {}).length },
    detectors: findDetectorHits(locales),
    candidates: termCandidates(locales, terms),
    mixedForms: mixedForms(locales, terms),
  }
}

/** Keys behind a selector: a detector id (`exclamation`) or a cluster (`word:zeit`, words starting with it). */
export function keysFor(selector, locales, detectors = DETECTORS) {
  if (selector.startsWith('word:')) {
    const prefix = selector.slice('word:'.length).toLowerCase()
    if (prefix === '') throw new Error('word: needs a prefix, e.g. word:konfig')
    return LOCALE_ORDER.flatMap(locale => Object.entries(locales[locale] ?? {})
      .filter(([, value]) => wordsOf(value).some(word => word.startsWith(prefix)))
      .map(([key, text]) => ({ locale, key, text }))).sort((a, b) => byText(a.locale, b.locale) || byText(a.key, b.key))
  }
  if (!detectors.some(detector => detector.id === selector)) {
    throw new Error(`unknown detector "${selector}" (known: ${detectors.map(detector => detector.id).join(', ')}; or word:<prefix>)`)
  }
  return findDetectorHits(locales, detectors).filter(row => row.id === selector)
    .flatMap(row => row.hits.map(hit => ({ locale: row.locale, ...hit })))
    .sort((a, b) => byText(a.locale, b.locale) || byText(a.key, b.key))
}

const oneLine = text => text.replace(/\s+/g, ' ').trim()
const cell = text => oneLine(text).replace(/\|/g, '\\|')

/** Markdown for a report. Examples show up to 8 `key = text` pairs per detector and locale. */
export function renderReport(report, { examples = EXAMPLES_PER_DETECTOR } = {}) {
  const lines = ['# Copy concepts', '', `Keys: de ${report.keys.de}, en ${report.keys.en}.`, '', '## Detectors', '']
  let current = ''
  for (const row of report.detectors) {
    if (row.id !== current) {
      current = row.id
      lines.push(`### ${row.id}`, '', row.why, '')
    }
    lines.push(`- **${row.locale}: ${row.count}**${row.count > 0 ? ` (all keys: \`--keys ${row.id}\`)` : ''}`)
    for (const hit of row.hits.slice(0, examples)) lines.push(`  - \`${hit.key}\` = ${oneLine(hit.text)}`)
    if (row.count > examples) lines.push(`  - … ${row.count - examples} more`)
    if (row.hits.length === 0 || row.id !== report.detectors[report.detectors.indexOf(row) + 1]?.id) lines.push('')
  }
  lines.push('## Mixed forms of registry terms', '')
  if (report.mixedForms.length === 0) lines.push('None: no registry term with a note still has an avoid form in the locales.', '')
  for (const row of report.mixedForms) {
    lines.push(`- \`${row.id}\` (${row.status}, ${row.locale}): ${row.forms.map(entry => `${entry.form}${entry.preferred ? ' (preferred)' : ''} ${entry.count}`).join(' vs ')}`)
  }
  if (report.mixedForms.length > 0) lines.push('')
  lines.push('## Term-cluster candidates', '', `Words of ≥ ${CANDIDATE_MIN_LETTERS} letters in ≥ ${CANDIDATE_MIN_KEYS} keys that are in no registry field (top ${CANDIDATE_LIMIT} per locale; keys of one cluster: \`--keys word:<prefix>\`).`, '')
  for (const locale of LOCALE_ORDER) {
    lines.push(`### ${locale}`, '', '| word | keys | examples |', '| --- | ---: | --- |')
    for (const candidate of report.candidates[locale]) lines.push(`| ${cell(candidate.word)} | ${candidate.count} | ${candidate.keys.map(key => `\`${cell(key)}\``).join(', ')} |`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

/** Default input paths; the test points them at a fixture directory. */
export const DEFAULT_PATHS = { de: join(LOCALES_DIR, 'de.json'), en: join(LOCALES_DIR, 'en.json'), terms: TERMS_PATH }

function parseArgs(args) {
  const options = { json: false, keys: null }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--json') options.json = true
    else if (arg === '--keys') {
      const selector = args[++index]
      if (selector === undefined || selector.startsWith('--')) throw new Error('--keys needs a detector id or word:<prefix>')
      options.keys = selector
    } else throw new Error(`unknown argument "${arg}" (usage: copy-concepts.mjs [--json] [--keys <id|word:prefix>])`)
  }
  return options
}

/**
 * The CLI without process side effects: reads the three inputs, returns the text to print. Writes nothing.
 * @returns {string}
 */
export function main(args, paths = DEFAULT_PATHS) {
  const options = parseArgs(args)
  const locales = { de: flattenMessages(readJson(paths.de)), en: flattenMessages(readJson(paths.en)) }
  if (options.keys !== null) {
    const rows = keysFor(options.keys, locales)
    if (options.json) return `${JSON.stringify(rows, null, 2)}\n`
    return `${rows.length} key(s) for ${options.keys}\n${rows.map(row => `${row.locale}\t${row.key}\t${oneLine(row.text)}`).join('\n')}\n`
  }
  const report = buildReport(locales, readJson(paths.terms))
  if (options.json) {
    const trimmed = { ...report, detectors: report.detectors.map(({ hits, ...row }) => ({ ...row, examples: hits.slice(0, EXAMPLES_PER_DETECTOR) })) }
    return `${JSON.stringify(trimmed, null, 2)}\n`
  }
  return renderReport(report)
}

/** True when this file is the process entry, also behind a symlinked path. */
function isEntry() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntry()) {
  try {
    process.stdout.write(main(process.argv.slice(2)))
  } catch (error) {
    // Measuring never gates: a usage or read error is reported, the exit code stays 0.
    console.error(error instanceof Error ? error.message : error)
  }
}
