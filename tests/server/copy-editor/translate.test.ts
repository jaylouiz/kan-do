// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { TermEntry } from '~/lib/copy-editor/terms'
import type { Runner } from '~/server/copy-editor/exec'
import { buildPrompt, checkDraft, extractVoiceRules, parseAgentOutput, translate, validateItems, VOICE_RULES_FILE } from '~/server/copy-editor/translate'
import type { BaseTrees } from '~/server/copy-editor/validate'

const base: BaseTrees = { de: { a: { title: 'Aufgabe {name}' }, b: 'Zurück' }, en: { a: { title: 'Task {name}' }, b: 'Back' } }
const terms: TermEntry[] = [{ id: 'src', de: 'Verbindung', en: 'connection', avoidDe: ['Quelle'], avoidEn: ['provider'], status: 'decided' }]
const items = [{ key: 'a.title', from: 'de' as const, value: 'Neue Aufgabe {name}' }, { key: 'b', from: 'en' as const, value: 'Go back' }]
const envelope = (translations: unknown) => JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ translations }) })
const runner = (stdout: string, code: number | null = 0, extra: Partial<Awaited<ReturnType<Runner>>> = {}): Runner =>
  vi.fn(async () => ({ code, stdout, stderr: '', timedOut: false, ...extra }))
const deps = (run: Runner) => ({ base, terms, rules: 'Short and concrete.', run, agentCmd: 'claude' })

describe('copy editor translate', () => {
  it('extracts the rule list of docs/copy/voice.md', () => {
    expect(extractVoiceRules('# Voice\nintro\n## Rules\nrule 1\nrule 2\n## Guards\ny')).toBe('rule 1\nrule 2')
    expect(extractVoiceRules('# Voice\nintro\n## Rules\nrule 1')).toBe('rule 1')
    expect(extractVoiceRules('## A\nx')).toBe('')
  })

  it('finds the rules in the real file, without the guards table', () => {
    const rules = extractVoiceRules(readFileSync(join(process.cwd(), VOICE_RULES_FILE), 'utf8'))
    expect(rules).toContain('**Address.**')
    // Usage rules no check can tell: the agent has to read them (the registry only knows forms to avoid).
    for (const name of ['One term per concept', 'Löschen, Entfernen, Trennen', 'Task state', 'Settings, token, time', 'Plurals']) expect(rules).toContain(`**${name}.**`)
    expect(rules).toContain('**Statistik verdicts.**')
    expect(rules).not.toContain('| Guaranteed |')
  })

  it('validates items', () => {
    expect(validateItems({ items }, base)).toEqual({ ok: true, items })
    expect(validateItems({ items: [{ key: 'nope', from: 'de', value: 'x' }] }, base).ok).toBe(false)
    expect(validateItems({ items: [{ key: 'b', from: 'fr', value: 'x' }] }, base).ok).toBe(false)
    expect(validateItems({}, base).ok).toBe(false)
  })

  it('puts rules, terms, the format contract and the entries into the prompt', () => {
    const prompt = buildPrompt(items, { base, terms, rules: 'Short and concrete.' })
    expect(prompt).toContain('Short and concrete.')
    expect(prompt).toContain('docs/copy/voice.md')
    expect(prompt).toContain('"avoidDe":["Quelle"]')
    expect(prompt).toContain('"currentTarget":"Task {name}"')
    expect(prompt).toContain('{"translations":')
  })

  it('parses the CLI envelope, a bare object and a fenced answer; rejects errors and prose', () => {
    expect(parseAgentOutput(envelope({ b: 'Zurück' }))).toEqual({ b: 'Zurück' })
    expect(parseAgentOutput(JSON.stringify({ result: '```json\n{"translations":{"b":"x"}}\n```' }))).toEqual({ b: 'x' })
    expect(parseAgentOutput('{"translations":{"b":"y"}}')).toEqual({ b: 'y' })
    expect(parseAgentOutput(JSON.stringify({ is_error: true, result: 'boom' }))).toBeNull()
    expect(parseAgentOutput('Sure, here you go')).toBeNull()
  })

  it('accepts valid drafts and flags placeholder, plural and decided-term problems per key', async () => {
    const run = runner(envelope({ 'a.title': 'New task {name}', b: 'Zurück zur Quelle' }))
    const result = await translate(items, deps(run))
    expect(result).toMatchObject({ ok: true })
    const drafts = (result as { drafts: Record<string, { text: string | null, problems: string[] }> }).drafts
    expect(drafts['a.title']).toEqual({ text: 'New task {name}', problems: [], warnings: [] })
    expect(drafts.b?.text).toBeNull()
    expect(drafts.b?.problems[0]).toContain('decided term')
    expect(checkDraft(items[0]!, 'New task', terms).problems[0]).toContain('placeholders differ')
  })

  it('runs the agent without tools, in a scratch directory, with the prompt on stdin', async () => {
    const run = runner(envelope({ 'a.title': 'x {name}', b: 'y' }))
    await translate(items, deps(run))
    const [cmd, args, options] = (run as unknown as { mock: { calls: [string, string[], { cwd: string, input: string }][] } }).mock.calls[0]!
    expect(cmd).toBe('claude')
    expect(args).toEqual(expect.arrayContaining(['-p', '--tools', '', '--no-session-persistence']))
    expect(options.cwd).not.toContain('kan-do')
    expect(options.input).toContain('Go back')
  })

  it('reports a missing key, a failed command, a timeout and an unreadable answer as errors', async () => {
    const missing = await translate(items, deps(runner(envelope({ b: 'Zurück' }))))
    expect((missing as { drafts: Record<string, { problems: string[] }> }).drafts['a.title']?.problems[0]).toContain('no translation')
    expect(await translate(items, deps(runner('', 1, { stderr: 'not logged in' })))).toMatchObject({ ok: false, errors: [expect.stringContaining('not logged in')] })
    expect(await translate(items, deps(runner('', null, { timedOut: true })))).toMatchObject({ ok: false, errors: [expect.stringContaining('did not answer')] })
    expect(await translate(items, deps(runner('prose')))).toMatchObject({ ok: false, errors: [expect.stringContaining('unexpected format')] })
  })
})
