/**
 * @module copy-editor/validate
 * @description Input validation for the copy editor routes (#59). Untrusted JSON in, typed edits out; every rule that
 * keeps the tool from writing anything but existing copy lives here.
 * @responsibility Validate edits against the base locale trees and the term registry. No I/O.
 */
import { getLeaf, parityProblems, type MessageTree } from '../../lib/copy-editor/messages'
import { blockingIssues, termIssues, type TermEntry } from '../../lib/copy-editor/terms'

export const MAX_EDITS = 200
export const MAX_VALUE_LENGTH = 2000

export type Lang = 'de' | 'en'
export interface Edit { key: string, de: string, en: string }
export interface BaseTrees { de: MessageTree, en: MessageTree }
export interface Validated<T> { ok: true, value: T, warnings: string[] }
export interface Invalid { ok: false, errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A string value that is safe to store: non-empty, bounded, no control characters other than newline. */
export function checkValue(label: string, value: unknown): string | null {
  if (typeof value !== 'string') return `${label}: not a string`
  if (value.trim() === '') return `${label}: empty`
  if (value.length > MAX_VALUE_LENGTH) return `${label}: longer than ${MAX_VALUE_LENGTH} characters`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(value)) return `${label}: control characters`
  return null
}

export function checkKey(key: unknown, base: BaseTrees): string | null {
  // The real key set is the whitelist (keys may hold hyphens, e.g. `topic.symbol.graduation-cap`); no pattern guesses.
  if (typeof key !== 'string' || key.length > 200) return 'invalid key'
  if (getLeaf(base.de, key) === undefined || getLeaf(base.en, key) === undefined) return `unknown key ${JSON.stringify(key)}`
  return null
}

function parseChanged(value: unknown): Lang[] | null {
  if (value === undefined) return ['de', 'en']
  if (!Array.isArray(value) || value.length === 0 || !value.every(lang => lang === 'de' || lang === 'en')) return null
  return [...new Set(value as Lang[])]
}

/** Edits for Publish: both languages present, at least one changed, parity and term rules hold. */
export function validateEdits(input: unknown, base: BaseTrees, terms: readonly TermEntry[]): Validated<Edit[]> | Invalid {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(input) || !Array.isArray(input.edits)) return { ok: false, errors: ['body must be { edits: [...] }'] }
  if (input.edits.length === 0) return { ok: false, errors: ['no edits'] }
  if (input.edits.length > MAX_EDITS) return { ok: false, errors: [`more than ${MAX_EDITS} edits`] }
  const seen = new Set<string>()
  const edits: Edit[] = []
  for (const raw of input.edits) {
    if (!isRecord(raw)) { errors.push('edit is not an object'); continue }
    const keyError = checkKey(raw.key, base)
    if (keyError) { errors.push(keyError); continue }
    const key = raw.key as string
    if (seen.has(key)) { errors.push(`${key}: duplicate`); continue }
    seen.add(key)
    const changed = parseChanged(raw.changed)
    if (!changed) { errors.push(`${key}: changed must list de and/or en`); continue }
    const valueErrors = changed.map(lang => checkValue(`${key} ${lang}`, raw[lang])).filter((e): e is string => e !== null)
    if (valueErrors.length) { errors.push(...valueErrors); continue }
    // A language the designer did not change keeps the base text: a stale local checkout must not revert newer copy.
    const edit: Edit = {
      key,
      de: changed.includes('de') ? raw.de as string : getLeaf(base.de, key)!,
      en: changed.includes('en') ? raw.en as string : getLeaf(base.en, key)!,
    }
    if (edit.de === getLeaf(base.de, key) && edit.en === getLeaf(base.en, key)) { errors.push(`${key}: unchanged`); continue }
    for (const problem of parityProblems(edit.de, edit.en)) errors.push(`${key}: ${problem}`)
    for (const lang of ['de', 'en'] as const) {
      const issues = termIssues(edit[lang], lang, key, terms)
      for (const issue of blockingIssues(issues)) errors.push(`${key} ${lang}: "${issue.form}" is an avoid form of the decided term "${issue.preferred}"`)
      for (const issue of issues.filter(i => i.status === 'proposed')) warnings.push(`${key} ${lang}: "${issue.form}" is an avoid form of the proposed term "${issue.preferred}"`)
    }
    edits.push(edit)
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: edits, warnings }
}
