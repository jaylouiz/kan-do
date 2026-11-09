/**
 * @module copy-editor/translate
 * @description The one batch translation of Publish (#59, decision D2): the designer wrote one language per edit, the
 * local agent CLI (`claude -p`, headless, tools off, empty scratch directory, so no repository access and no project
 * hooks) writes the other following `DESIGN.md` "Voice and copy" and the term registry. The answer is a draft: every
 * draft is re-checked (placeholders, plural branches, decided terms) and shown for review before anything is pushed.
 * @responsibility Prompt, agent call and draft validation. The runner is injected; nothing is written.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getLeaf, parityProblems } from '../../lib/copy-editor/messages'
import { blockingIssues, termIssues, type TermEntry } from '../../lib/copy-editor/terms'
import type { Runner } from './exec'
import { checkKey, checkValue, MAX_EDITS, type BaseTrees, type Invalid, type Lang } from './validate'

export const AGENT_TIMEOUT_MS = 180_000

export interface TranslateItem { key: string, from: Lang, value: string }
export interface Draft { text: string | null, problems: string[], warnings: string[] }
export interface TranslateDeps { base: BaseTrees, terms: readonly TermEntry[], rules: string, run: Runner, agentCmd: string }

const LANG_NAME: Record<Lang, string> = { de: 'German', en: 'English' }
const other = (lang: Lang): Lang => (lang === 'de' ? 'en' : 'de')

/** The `## Voice and copy` section of DESIGN.md (the copy rules), or '' when it is missing. */
export function extractVoiceRules(designMd: string): string {
  const match = /^## Voice and copy\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(designMd)
  return match?.[1]?.trim() ?? ''
}

export function validateItems(input: unknown, base: BaseTrees): { ok: true, items: TranslateItem[] } | Invalid {
  const list = (input as { items?: unknown } | null)?.items
  if (!Array.isArray(list) || list.length === 0) return { ok: false, errors: ['body must be { items: [...] }'] }
  if (list.length > MAX_EDITS) return { ok: false, errors: [`more than ${MAX_EDITS} items`] }
  const errors: string[] = []
  const items: TranslateItem[] = []
  for (const raw of list as Record<string, unknown>[]) {
    const keyError = checkKey(raw?.key, base)
    if (keyError) { errors.push(keyError); continue }
    if (raw.from !== 'de' && raw.from !== 'en') { errors.push(`${raw.key as string}: from must be de or en`); continue }
    const valueError = checkValue(`${raw.key as string} ${raw.from}`, raw.value)
    if (valueError) { errors.push(valueError); continue }
    items.push({ key: raw.key as string, from: raw.from, value: raw.value as string })
  }
  return errors.length ? { ok: false, errors } : { ok: true, items }
}

export function buildPrompt(items: readonly TranslateItem[], { base, terms, rules }: Pick<TranslateDeps, 'base' | 'terms' | 'rules'>): string {
  const registry = terms.map(t => ({ id: t.id, de: t.de, en: t.en, avoidDe: t.avoidDe ?? [], avoidEn: t.avoidEn ?? [], status: t.status }))
  const entries = items.map((item) => {
    const to = other(item.from)
    return {
      key: item.key,
      from: item.from,
      to,
      text: item.value,
      // What the target language says today, as a style anchor; the designer's new text replaces it.
      currentTarget: getLeaf(base[to], item.key) ?? '',
    }
  })
  return [
    'You translate UI copy of the kan-do app between German and English. The app UI is German first.',
    'Follow these copy rules (DESIGN.md "Voice and copy") exactly:',
    rules || '(rules not found: keep the tone short, concrete and consistent with the current target text)',
    '',
    'Term registry: use the preferred form (`de`/`en`) of a term; never write a form from `avoidDe`/`avoidEn`, also not inflected or as a compound start.',
    JSON.stringify(registry),
    '',
    'Rules for the format: keep every {placeholder} (including {0}) and every @:linked.key exactly as in the text, keep the same number of `|` plural branches, keep punctuation style and line breaks, write no markdown.',
    'Translate each entry\'s `text` from `from` into `to`. `currentTarget` shows how the target language reads today (a style anchor, to be replaced).',
    'Reply with JSON only, no prose and no code fence: {"translations":{"<key>":"<translated text>"}} with exactly the given keys.',
    '',
    JSON.stringify(entries),
  ].join('\n')
}

/** The agent's answer text out of `claude -p --output-format json` stdout; a code fence around the JSON is tolerated. */
export function parseAgentOutput(stdout: string): Record<string, unknown> | null {
  let text = stdout.trim()
  try {
    const envelope = JSON.parse(text) as { result?: unknown, is_error?: unknown, translations?: unknown }
    if (envelope.is_error === true) return null
    if (typeof envelope.result === 'string') text = envelope.result.trim()
    else if (envelope.translations) return envelope.translations as Record<string, unknown>
  } catch { /* not an envelope: treat stdout as the answer */ }
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(text) as { translations?: unknown }
    return parsed && typeof parsed.translations === 'object' && parsed.translations !== null ? parsed.translations as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function checkDraft(item: TranslateItem, raw: unknown, terms: readonly TermEntry[]): Draft {
  const to = other(item.from)
  const problems: string[] = []
  const warnings: string[] = []
  const valueError = checkValue(`${LANG_NAME[to]} draft`, raw)
  if (valueError) return { text: null, problems: [valueError], warnings }
  const text = (raw as string).trim()
  for (const problem of parityProblems(item.value, text)) problems.push(problem)
  const issues = termIssues(text, to, item.key, terms)
  for (const issue of blockingIssues(issues)) problems.push(`"${issue.form}" is an avoid form of the decided term "${issue.preferred}"`)
  for (const issue of issues.filter(i => i.status === 'proposed')) warnings.push(`"${issue.form}" is an avoid form of the proposed term "${issue.preferred}"`)
  return { text: problems.length ? null : text, problems, warnings }
}

export async function translate(items: readonly TranslateItem[], deps: TranslateDeps): Promise<{ ok: true, drafts: Record<string, Draft> } | Invalid> {
  const scratch = mkdtempSync(join(tmpdir(), 'kando-copy-agent-'))
  try {
    const result = await deps.run(deps.agentCmd, [
      '-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--disable-slash-commands',
      '--strict-mcp-config', '--setting-sources', 'project',
    ], { cwd: scratch, input: buildPrompt(items, deps), timeoutMs: AGENT_TIMEOUT_MS })
    if (result.timedOut) return { ok: false, errors: [`the agent did not answer within ${AGENT_TIMEOUT_MS / 1000} s`] }
    if (result.code !== 0) return { ok: false, errors: [`the agent command failed (${result.code ?? 'not started'}): ${(result.stderr || result.stdout).trim().slice(0, 300)}`] }
    const answer = parseAgentOutput(result.stdout)
    if (!answer) return { ok: false, errors: ['the agent answered in an unexpected format'] }
    const drafts: Record<string, Draft> = {}
    for (const item of items) {
      drafts[item.key] = item.key in answer
        ? checkDraft(item, answer[item.key], deps.terms)
        : { text: null, problems: ['the agent returned no translation for this key'], warnings: [] }
    }
    return { ok: true, drafts }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}
