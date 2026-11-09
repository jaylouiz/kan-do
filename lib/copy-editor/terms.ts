/**
 * @module copy-editor/terms
 * @description Term-registry check for one edited string (#59): which avoid forms of `docs/copy/terms.json` the
 * value uses. A `decided` term blocks the edit, a `proposed` one only warns. Same matching as
 * `matchesAvoidForm` in `scripts/copy-terms.mjs` (word-prefix, umlaut folding, `caseSensitive`, `allow`), which
 * cannot be imported here because it reads files; `tests/lib/copy-editor/terms.test.ts` pins both to the same cases.
 * @responsibility Pure matching. No registry loading, no approval.
 */

export interface TermEntry {
  id: string
  de: string
  en: string
  avoidDe?: string[]
  avoidEn?: string[]
  status: 'proposed' | 'decided'
  allow?: string[]
  caseSensitive?: boolean
}

export interface TermIssue {
  termId: string
  form: string
  preferred: string
  status: TermEntry['status']
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const foldUmlauts = (text: string) => text.replace(/[äöüÄÖÜ]/g, char => 'aouAOU'['äöüÄÖÜ'.indexOf(char)] as string)

export function matchesForm(value: string, form: string, caseSensitive = false): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(foldUmlauts(form))}`, caseSensitive ? 'u' : 'iu').test(foldUmlauts(value))
}

/** Avoid forms of any term found in `value` (a string of `locale`, stored under `key`). */
export function termIssues(value: string, locale: 'de' | 'en', key: string, terms: readonly TermEntry[]): TermIssue[] {
  const issues: TermIssue[] = []
  for (const term of terms) {
    if (term.allow?.includes(key)) continue
    const forms = (locale === 'de' ? term.avoidDe : term.avoidEn) ?? []
    const form = forms.find(candidate => matchesForm(value, candidate, term.caseSensitive === true))
    if (form !== undefined) issues.push({ termId: term.id, form, preferred: term[locale], status: term.status })
  }
  return issues
}

export const blockingIssues = (issues: readonly TermIssue[]) => issues.filter(issue => issue.status === 'decided')
