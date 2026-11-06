#!/usr/bin/env node
/**
 * UI term registry: checks and approval (#472, epic #464).
 *
 * `docs/copy/terms.json` is the registry of UI terms (preferred form and forms to avoid, German and English).
 * An entry is `proposed` (anyone may add or change it) or `decided` (the user approved it). A decided entry is
 * pinned by the SHA-256 of its canonical JSON in `docs/copy/terms.lock.json`; only `approve` writes that lock.
 *
 * `checkTerms` is pure: given the registry, the lock and the flattened locale messages it returns `{ errors, warnings }`.
 *   - schema: array of `{ id, concept, de, en, avoidDe, avoidEn, status, note?, allow?, caseSensitive? }`, unique ids, non-empty de/en
 *   - decided entry: no avoid form in any locale value (case-insensitive unless the entry sets `caseSensitive: true`,
 *     matched as word prefix so inflections hit, keys in `allow` exempt), and its hash equals the lock entry; the lock has no entry without a decided term
 *   - proposed entry: never an error; an avoid form in a locale value is only listed as a warning
 *   - registry self-consistency: a term's own preferred `de`/`en` must not hit another term's avoid form (or its own);
 *     an error when both terms are decided, a warning otherwise (no copy could satisfy both)
 *   - the lock must be an object of id -> hash
 *
 * CLI (the user runs it in their own terminal; `.claude/hooks/guard-commands.sh` blocks agents):
 *   `npm run terms:approve`                -> writes the lock from the current decided entries
 *   `npm run terms:approve -- <id> ...`    -> sets those entries to `decided` first, then writes the lock
 *   Both print the ids newly locked, changed and dropped, and how many avoid hits in today's locales turn into errors.
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const TERMS_PATH = join(ROOT, 'docs/copy/terms.json')
export const LOCK_PATH = join(ROOT, 'docs/copy/terms.lock.json')
const LOCALES_DIR = join(ROOT, 'i18n/locales')

export const STATUSES = ['proposed', 'decided']
const REQUIRED_KEYS = ['id', 'concept', 'de', 'en', 'avoidDe', 'avoidEn', 'status']
const OPTIONAL_KEYS = ['note', 'allow', 'caseSensitive']
const APPROVE_HINT = 'needs the user (`npm run terms:approve`)'

/** JSON with object keys sorted at every level, so the hash does not depend on key order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** SHA-256 (hex) of an entry's canonical JSON. */
export function hashEntry(entry) {
  return createHash('sha256').update(canonicalJson(entry)).digest('hex')
}

const isNonEmptyString = value => typeof value === 'string' && value.trim().length > 0
const isStringList = value => Array.isArray(value) && value.every(isNonEmptyString)

/** Schema errors of a registry (check a). */
export function validateRegistry(terms) {
  if (!Array.isArray(terms)) return ['terms.json must be an array of entries']
  const errors = []
  const seen = new Set()
  terms.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`entry #${index} is not an object`)
      return
    }
    const name = isNonEmptyString(entry.id) ? entry.id : `#${index}`
    for (const key of REQUIRED_KEYS) if (!(key in entry)) errors.push(`term ${name}: missing "${key}"`)
    for (const key of Object.keys(entry)) {
      if (!REQUIRED_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key)) errors.push(`term ${name}: unknown key "${key}"`)
    }
    if ('id' in entry) {
      if (!isNonEmptyString(entry.id)) errors.push(`term ${name}: id must be a non-empty string`)
      else if (seen.has(entry.id)) errors.push(`term ${name}: duplicate id`)
      else seen.add(entry.id)
    }
    for (const key of ['concept', 'de', 'en']) {
      if (key in entry && !isNonEmptyString(entry[key])) errors.push(`term ${name}: "${key}" must be a non-empty string`)
    }
    for (const key of ['avoidDe', 'avoidEn']) {
      if (key in entry && !isStringList(entry[key])) errors.push(`term ${name}: "${key}" must be a list of non-empty strings`)
    }
    if ('status' in entry && !STATUSES.includes(entry.status)) errors.push(`term ${name}: status must be ${STATUSES.join(' or ')}`)
    if ('note' in entry && !isNonEmptyString(entry.note)) errors.push(`term ${name}: "note" must be a non-empty string`)
    if ('allow' in entry && !isStringList(entry.allow)) errors.push(`term ${name}: "allow" must be a list of locale keys`)
    if ('caseSensitive' in entry && typeof entry.caseSensitive !== 'boolean') errors.push(`term ${name}: "caseSensitive" must be true or false`)
  })
  return errors
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** German umlauts folded to their base vowel, one character each, so offsets and word starts stay put (#492). */
const foldUmlauts = text => text.replace(/[äöüÄÖÜ]/g, char => 'aouAOU'['äöüÄÖÜ'.indexOf(char)])

/**
 * Match of `form` at the start of a word (Unicode-aware, so an inflection or a compound start hits).
 * Case-insensitive unless `caseSensitive` (so "Sie" can hit a capitalised address and not the pronoun "sie").
 * Umlauts match their base vowel on both sides, so the plural "Zugänge" hits the avoid form "Zugang" (#492).
 */
export function matchesAvoidForm(value, form, caseSensitive = false) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(foldUmlauts(form))}`, caseSensitive ? 'u' : 'iu').test(foldUmlauts(value))
}

/** Avoid forms of an entry found in the locale values: `[{ locale, key, form }]`. Keys in `allow` are exempt. */
export function findAvoidHits(entry, locales) {
  const allow = new Set(entry.allow ?? [])
  const hits = []
  for (const [locale, forms] of [['de', entry.avoidDe], ['en', entry.avoidEn]]) {
    for (const [key, value] of Object.entries(locales[locale] ?? {})) {
      if (allow.has(key)) continue
      const form = (forms ?? []).find(candidate => matchesAvoidForm(value, candidate, entry.caseSensitive === true))
      if (form !== undefined) hits.push({ locale, key, form })
    }
  }
  return hits
}

/**
 * Registry self-consistency: preferred forms (`de`, `en`) of a term that hit an avoid form of a term (any, itself included).
 * Returns `[{ id, locale, value, form, otherId, decided }]`; `decided` is true when both terms are decided.
 */
export function findTermConflicts(terms) {
  const conflicts = []
  for (const entry of terms) {
    for (const [locale, value] of [['de', entry.de], ['en', entry.en]]) {
      for (const other of terms) {
        const form = (locale === 'de' ? other.avoidDe : other.avoidEn).find(candidate => matchesAvoidForm(value, candidate, other.caseSensitive === true))
        if (form !== undefined) {
          conflicts.push({ id: entry.id, locale, value, form, otherId: other.id, decided: entry.status === 'decided' && other.status === 'decided' })
        }
      }
    }
  }
  return conflicts
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

/**
 * Checks a registry against its lock and the locale messages.
 * @param {{ terms: unknown, lock: Record<string, string>, locales: { de: Record<string, string>, en: Record<string, string> } }} input
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkTerms({ terms, lock, locales }) {
  const errors = validateRegistry(terms)
  const warnings = []
  if (!isPlainObject(lock)) errors.push('terms.lock.json must be an object of term id -> hash (restore it from git, or the user runs `npm run terms:approve`)')
  if (errors.length > 0) return { errors, warnings }
  for (const conflict of findTermConflicts(terms)) {
    const message = `term ${conflict.id} ${conflict.locale} "${conflict.value}" hits avoid form "${conflict.form}" of term ${conflict.otherId}`
    if (conflict.decided) errors.push(message)
    else warnings.push(message)
  }
  const decided = new Map()
  for (const entry of terms) {
    const hits = findAvoidHits(entry, locales)
    const describe = hit => `${hit.locale} ${hit.key}: avoid form "${hit.form}" of term ${entry.id}`
    if (entry.status === 'decided') {
      decided.set(entry.id, entry)
      for (const hit of hits) errors.push(describe(hit))
    } else {
      for (const hit of hits) warnings.push(describe(hit))
    }
  }
  for (const [id, entry] of decided) {
    if (!hasOwn(lock, id)) errors.push(`decided term ${id} has no approval in terms.lock.json: ${APPROVE_HINT}`)
    else if (lock[id] !== hashEntry(entry)) errors.push(`decided term ${id} changed or removed: ${APPROVE_HINT}`)
  }
  for (const id of Object.keys(lock)) {
    if (!decided.has(id)) errors.push(`decided term ${id} changed or removed: ${APPROVE_HINT}`)
  }
  return { errors, warnings }
}

/**
 * The approval: promotes `ids` to `decided`, then locks every decided entry.
 * With the previous `lock` and the `locales` it also reports what the approval changes (all optional):
 * `report = { newlyLocked, changed, dropped, avoidHits }`, the ids locked for the first time, locked before with a
 * different hash, removed from the lock, and the number of avoid hits in the locales per newly locked, changed or promoted id
 * (those become build errors once the term is decided).
 * @returns {{ terms: object[], lock: Record<string, string>, report: object }}
 */
export function approveTerms({ terms, ids = [], lock: previous = {}, locales = { de: {}, en: {} } }) {
  const schemaErrors = validateRegistry(terms)
  if (schemaErrors.length > 0) throw new Error(`terms.json is invalid:\n${schemaErrors.join('\n')}`)
  const unknown = ids.filter(id => !terms.some(entry => entry.id === id))
  if (unknown.length > 0) throw new Error(`unknown term id: ${unknown.join(', ')}`)
  const old = isPlainObject(previous) ? previous : {}
  const next = terms.map(entry => (ids.includes(entry.id) ? { ...entry, status: 'decided' } : entry))
  const lock = {}
  const report = { newlyLocked: [], changed: [], dropped: [], avoidHits: {} }
  for (const entry of next.filter(candidate => candidate.status === 'decided').sort((a, b) => a.id.localeCompare(b.id))) {
    lock[entry.id] = hashEntry(entry)
    if (!hasOwn(old, entry.id)) report.newlyLocked.push(entry.id)
    else if (old[entry.id] !== lock[entry.id]) report.changed.push(entry.id)
    else if (!ids.includes(entry.id)) continue
    report.avoidHits[entry.id] = findAvoidHits(entry, locales).length
  }
  report.dropped = Object.keys(old).filter(id => !hasOwn(lock, id)).sort()
  return { terms: next, lock, report }
}

/** Flattens a nested locale file to `{ 'a.b.c': 'text' }`. */
export function flattenMessages(tree, prefix = '') {
  const out = {}
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out[path] = value
    else if (isPlainObject(value)) Object.assign(out, flattenMessages(value, path))
  }
  return out
}

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const list = ids => (ids.length ? ids.join(', ') : 'none')

function readLockForReport() {
  try {
    return readJson(LOCK_PATH)
  } catch {
    return {}
  }
}

function main(args) {
  const [command, ...ids] = args
  if (command !== 'approve') {
    console.error('usage: node scripts/copy-terms.mjs approve [<id> ...]')
    process.exit(1)
  }
  const locales = {
    de: flattenMessages(readJson(join(LOCALES_DIR, 'de.json'))),
    en: flattenMessages(readJson(join(LOCALES_DIR, 'en.json'))),
  }
  const { terms, lock, report } = approveTerms({ terms: readJson(TERMS_PATH), ids, lock: readLockForReport(), locales })
  writeJson(TERMS_PATH, terms)
  writeJson(LOCK_PATH, lock)
  console.log(`terms.lock.json: ${Object.keys(lock).length} decided term(s) locked${ids.length ? `, promoted: ${ids.join(', ')}` : ''}`)
  console.log(`  newly locked: ${list(report.newlyLocked)}`)
  console.log(`  changed: ${list(report.changed)}`)
  console.log(`  dropped: ${list(report.dropped)}`)
  for (const [id, count] of Object.entries(report.avoidHits)) {
    if (count > 0) console.log(`  ${id}: ${count} avoid hit(s) in the current locales are now build errors (fix the copy or allow the keys)`)
  }
  const { errors } = checkTerms({ terms, lock, locales })
  if (errors.length > 0) console.log(`  npm run i18n:check would now report ${errors.length} error(s)`)
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
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
