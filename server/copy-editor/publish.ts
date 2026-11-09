/**
 * @module copy-editor/publish
 * @description Publish of the copy editor (#59, decision D6): turns the collected edits into a pull request without
 * touching the designer's checkout. A temporary detached worktree on `origin/main` gets the two locale files, runs
 * `i18n:check` there, commits on a `copy/...` branch, pushes only that branch (`HEAD:refs/heads/copy/...`, never
 * `main`) and opens the PR through `gh`. The worktree and the local branch are removed afterwards, success or not.
 * @responsibility The git/gh sequence and its error steps. Git, gh and the check run through the injected `Runner`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getLeaf, type MessageTree } from '../../lib/copy-editor/messages'
import type { TermEntry } from '../../lib/copy-editor/terms'
import type { Runner } from './exec'
import { applyEdits, LOCALE_FILES } from './locales'
import { validateEdits, type Edit } from './validate'

export const BASE_BRANCH = 'main'
export const BRANCH_PREFIX = 'copy/'
const GIT_TIMEOUT_MS = 120_000
const CHECK_TIMEOUT_MS = 240_000

export type PublishStep = 'busy' | 'validate' | 'fetch' | 'worktree' | 'check' | 'commit' | 'push'
export type PublishResult =
  | { ok: true, branch: string, prUrl: string | null, note: string | null, edits: number, files: number, warnings: string[] }
  | { ok: false, step: PublishStep, errors: string[] }

export interface PublishDeps {
  /** The dev server's checkout (any git work tree of the repository). */
  root: string
  run: Runner
  terms: readonly TermEntry[]
  now?: () => Date
  /** Runs `i18n:check` in the throwaway worktree; replaced in tests. */
  check?: (worktree: string) => Promise<{ ok: boolean, output: string }>
}

let running = false

const tail = (text: string, lines = 30) => text.trim().split('\n').slice(-lines).join('\n')
const pad = (n: number) => String(n).padStart(2, '0')

export function branchName(edits: readonly Edit[], now: Date): string {
  const slug = (edits[0]?.key ?? 'copy').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'copy'
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${BRANCH_PREFIX}${stamp}-${slug}`
}

export function prTitle(edits: readonly Edit[]): string {
  return `chore(copy): update UI copy (${edits.length} ${edits.length === 1 ? 'key' : 'keys'})`
}

export function prBody(edits: readonly Edit[], before: { de: MessageTree, en: MessageTree }): string {
  const rows = edits.map(edit => [
    `- \`${edit.key}\``,
    `  - de: ${getLeaf(before.de, edit.key) === edit.de ? 'unchanged' : `${JSON.stringify(getLeaf(before.de, edit.key))} → ${JSON.stringify(edit.de)}`}`,
    `  - en: ${getLeaf(before.en, edit.key) === edit.en ? 'unchanged' : `${JSON.stringify(getLeaf(before.en, edit.key))} → ${JSON.stringify(edit.en)}`}`,
  ].join('\n'))
  return [
    `Copy changes from the live copy editor (dev tool): ${edits.length} ${edits.length === 1 ? 'key' : 'keys'} in \`i18n/locales/de.json\` and \`en.json\`.`,
    '',
    ...rows,
    '',
    'A language the designer did not write may be an agent translation that was reviewed before publishing. `i18n:check` passed on this branch before the push.',
  ].join('\n')
}

async function defaultCheck(run: Runner, worktree: string) {
  const result = await run('npx', ['vitest', 'run', 'tests/i18n'], { cwd: worktree, timeoutMs: CHECK_TIMEOUT_MS })
  return { ok: result.code === 0 && !result.timedOut, output: tail(`${result.stdout}\n${result.stderr}`, 40) }
}

export async function publish(input: unknown, deps: PublishDeps): Promise<PublishResult> {
  if (running) return { ok: false, step: 'busy', errors: ['another publish is still running'] }
  running = true
  const { root, run, terms } = deps
  const git = (args: string[], cwd = root, timeoutMs = GIT_TIMEOUT_MS) => run('git', args, { cwd, timeoutMs })
  let scratch: string | null = null
  let worktree: string | null = null
  let branch: string | null = null
  try {
    const fetched = await git(['fetch', 'origin', BASE_BRANCH])
    if (fetched.code !== 0) return { ok: false, step: 'fetch', errors: [`git fetch origin ${BASE_BRANCH} failed: ${tail(fetched.stderr, 5)}`] }

    const base: { de: MessageTree, en: MessageTree } = { de: {}, en: {} }
    for (const lang of ['de', 'en'] as const) {
      const shown = await git(['show', `origin/${BASE_BRANCH}:${LOCALE_FILES[lang]}`])
      if (shown.code !== 0) return { ok: false, step: 'fetch', errors: [`cannot read ${LOCALE_FILES[lang]} on origin/${BASE_BRANCH}`] }
      base[lang] = JSON.parse(shown.stdout) as MessageTree
    }

    const validated = validateEdits(input, base, terms)
    if (!validated.ok) return { ok: false, step: 'validate', errors: validated.errors }
    const edits = validated.value

    scratch = mkdtempSync(join(tmpdir(), 'kando-copy-publish-'))
    worktree = join(scratch, 'wt')
    const added = await git(['worktree', 'add', '--detach', worktree, `origin/${BASE_BRANCH}`])
    if (added.code !== 0) return { ok: false, step: 'worktree', errors: [`git worktree add failed: ${tail(added.stderr, 5)}`] }
    if (existsSync(join(root, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(worktree, 'node_modules'))

    const files = applyEdits(base, edits)
    mkdirSync(join(worktree, 'i18n/locales'), { recursive: true })
    writeFileSync(join(worktree, LOCALE_FILES.de), files.de)
    writeFileSync(join(worktree, LOCALE_FILES.en), files.en)

    const checked = await (deps.check ?? (wt => defaultCheck(run, wt)))(worktree)
    if (!checked.ok) return { ok: false, step: 'check', errors: ['npm run i18n:check failed', checked.output] }

    branch = branchName(edits, (deps.now ?? (() => new Date()))())
    const wt = worktree
    const steps: [string, string[]][] = [
      ['checkout', ['checkout', '-b', branch]],
      ['add', ['add', '--', LOCALE_FILES.de, LOCALE_FILES.en]],
    ]
    for (const [name, args] of steps) {
      const result = await git(args, wt)
      if (result.code !== 0) return { ok: false, step: 'commit', errors: [`git ${name} failed: ${tail(result.stderr, 5)}`] }
    }
    const allowed: string[] = [LOCALE_FILES.de, LOCALE_FILES.en]
    const staged = (await git(['diff', '--cached', '--name-only'], wt)).stdout.split('\n').filter(Boolean)
    if (staged.length === 0 || staged.some(file => !allowed.includes(file))) {
      return { ok: false, step: 'commit', errors: [`unexpected staged files: ${staged.join(', ') || 'none'}`] }
    }
    const committed = await git(['commit', '-m', prTitle(edits), '-m', 'Created with the live copy editor (dev tool).'], wt)
    if (committed.code !== 0) return { ok: false, step: 'commit', errors: [`git commit failed: ${tail(committed.stderr || committed.stdout, 5)}`] }

    // Only the new copy branch is pushed, by explicit refspec; the personal pre-push hook would run the whole suite in a
    // throwaway tree for two JSON files (decision D6): `i18n:check` just passed and CI runs everything on the PR.
    const pushed = await git(['push', '--no-verify', 'origin', `HEAD:refs/heads/${branch}`], wt)
    if (pushed.code !== 0) return { ok: false, step: 'push', errors: [`git push failed: ${tail(pushed.stderr, 8)}`] }

    const pr = await run('gh', ['pr', 'create', '--base', BASE_BRANCH, '--head', branch, '--title', prTitle(edits), '--body', prBody(edits, base)], { cwd: wt, timeoutMs: GIT_TIMEOUT_MS })
    const url = /https?:\/\/\S+/.exec(pr.stdout)?.[0] ?? null
    const note = pr.code === 0 && url ? null : `Branch ${branch} is pushed, but the pull request was not created (${tail(pr.stderr || pr.stdout, 3) || 'gh unavailable'}). Open it from GitHub.`
    return { ok: true, branch, prUrl: url, note, edits: edits.length, files: 2, warnings: validated.warnings }
  } catch (error) {
    return { ok: false, step: 'worktree', errors: [error instanceof Error ? error.message : String(error)] }
  } finally {
    if (worktree) await git(['worktree', 'remove', '--force', worktree])
    if (branch) await git(['branch', '-D', branch])
    if (scratch) rmSync(scratch, { recursive: true, force: true })
    running = false
  }
}
