import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// #586 (Pattern check) and #587 (design rules from feedback): the always-on rule, the PR-body gate in
// .claude/issue-workflow.sh (wf_pr_body_check) and the pointers that make the mechanism reachable.
const root = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('Pattern check rule (#586)', () => {
  const rule = read('.claude/rules/ui-patterns.md')

  it('is path-scoped to the UI source', () => {
    const front = rule.split('---')[1] ?? ''
    for (const glob of ['components/**/*.vue', 'pages/**/*.vue', 'layouts/**', 'app.vue']) {
      expect(front, glob).toContain(`"${glob}"`)
    }
  })

  it('states the outcomes, the record grammar and that the agent never asks', () => {
    for (const word of ['reuse', 'align', 'diverge', 'new', '→ reused', '→ aligned with', '→ diverged from', 'Pattern: none (', 'never ask']) {
      expect(rule, word).toContain(word)
    }
    expect(rule.split('\n').length).toBeLessThan(45)
  })

  it('searches the manifest with ui:find first, then /ui, then the old searches (#79)', () => {
    const step = rule.split('\n').find(l => l.startsWith('2. '))
    expect(step).toBeDefined()
    const [find = -1, ui = -1, old = -1] = ['npm run ui:find', '/ui', 'rg -i'].map(w => step!.indexOf(w))
    expect(find).toBeGreaterThan(-1)
    expect(find).toBeLessThan(ui)
    expect(ui).toBeLessThan(old)
    expect(step).toContain('docs/design/ui-manifest.json')
    expect(JSON.parse(read('package.json')).scripts['ui:find']).toBe('node scripts/ui-find.mjs')
    expect(read('.claude/issue-workflow.md')).toContain('npm run ui:find')
    expect(read('CLAUDE.md')).toContain('npm run ui:find')
  })

  it('is listed in CLAUDE.md, which stays under the 200-line budget', () => {
    const claude = read('CLAUDE.md')
    expect(claude).toContain('`ui-patterns.md`')
    expect(claude).toContain('design-rule')
    expect(claude.split('\n').length).toBeLessThan(200)
  })

  it('has a Pattern check section in the profile', () => {
    const profile = read('.claude/issue-workflow.md')
    expect(profile).toContain('## Pattern check')
    expect(profile).toContain('wf_pr_body_check')
  })
})

describe('wf_pr_body_check Pattern gate (#586)', () => {
  let dir: string
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pattern-check-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    git('config', 'commit.gpgsign', 'false')
    git('config', 'core.hooksPath', '/dev/null')
    writeFileSync(join(dir, 'README.md'), 'base\n')
    git('add', '.')
    git('commit', '-q', '-m', 'base')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(dir + '-body.md', { force: true })
  })

  /** Branch off origin/main, commit `files`, run wf_pr_body_check on `body` in the repo; `null` = the check passed. */
  function check(files: string[], body: string, opts: { noOrigin?: boolean } = {}): string | null {
    git('checkout', '-q', '-B', 'work', 'refs/remotes/origin/main')
    for (const f of files) {
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      writeFileSync(join(dir, f), `${f}\n`)
    }
    if (files.length) {
      git('add', '.')
      git('commit', '-q', '-m', 'change')
    }
    const bodyFile = join(dir + '-body.md')
    writeFileSync(bodyFile, body)
    try {
      if (opts.noOrigin) git('update-ref', '-d', 'refs/remotes/origin/main')
      execFileSync('bash', ['-c', `source "${join(root, '.claude/issue-workflow.sh')}"; wf_pr_body_check "${bodyFile}"`], { cwd: dir, stdio: 'pipe' })
      return null
    } catch (err) {
      return String((err as { stdout: Buffer }).stdout)
    } finally {
      if (opts.noOrigin) git('update-ref', 'refs/remotes/origin/main', 'main')
    }
  }

  const ui = ['components/ui/Thing.vue']
  const e2e = 'E2E-specs: smoke\n'

  it('still requires the E2E-specs line, with or without a UI diff', () => {
    expect(check([], 'Closes #1\n')).toContain('E2E-specs')
    expect(check(ui, 'Pattern: none (copy fix)\n')).toContain('E2E-specs')
  })

  it('asks nothing extra of a diff without UI source files', () => {
    expect(check(['lib/x.ts', 'tests/e2e/a.spec.ts'], e2e)).toBeNull()
  })

  it.each(['components/ui/Thing.vue', 'pages/tasks.vue', 'layouts/default.vue', 'app.vue'])('requires a Pattern line when %s changes', (file) => {
    expect(check([file], e2e)).toContain("no 'Pattern:' line")
  })

  it('accepts each valid record form', () => {
    for (const line of [
      'Pattern: confirmation dialog → reused ConfirmDialog',
      'Pattern: task state -> aligned with Task card (own icon size)',
      'Pattern: undo → diverged from Undo toast: it must stay in the card slot',
      'Pattern: dialog → diverged from DESIGN.md Components: Dialogs: this one is a flow',
      'Pattern: filter → new (no existing pattern; searched: filter, chip)',
      '- Pattern: none (copy fix)',
    ]) {
      const body = `${e2e}${line}\n${line.includes('diverged') ? 'Rule candidate: #590\n' : ''}`
      expect(check(ui, body), line).toBeNull()
    }
  })

  it('rejects a malformed line, also next to a valid one', () => {
    expect(check(ui, `${e2e}Pattern: dialog reused ConfirmDialog\n`)).toContain('invalid Pattern line')
    expect(check(ui, `${e2e}Pattern: a → reused X\nPattern: b → diverged from Y\n`)).toContain('invalid Pattern line')
    expect(check(ui, `${e2e}Pattern: none ()\n`)).toContain('invalid Pattern line')
  })

  it('ties a diverged line to a Rule candidate line', () => {
    const diverged = `${e2e}Pattern: undo → diverged from Undo toast: stays in the slot\n`
    expect(check(ui, diverged)).toContain('Rule candidate')
    expect(check(ui, `${diverged}Rule candidate: #590\n`)).toBeNull()
    expect(check(ui, `${diverged}Rule candidate: none (one-off)\n`)).toBeNull()
    expect(check(ui, `${diverged}Rule candidate: maybe\n`)).toContain('Rule candidate')
  })

  it('skips the extra checks when git cannot say what the diff touches', () => {
    expect(check(ui, e2e, { noOrigin: true })).toBeNull()
  })

  it('keeps the file free of a syntax error', () => {
    expect(existsSync(join(root, '.claude/issue-workflow.sh'))).toBe(true)
    execFileSync('bash', ['-n', join(root, '.claude/issue-workflow.sh')])
  })
})

describe('ui:find (#79)', () => {
  it('finds a component by job words in its doc-block text, not by name', async () => {
    const { findEntries, queryWords } = await import('../../scripts/ui-find.mjs')
    const manifest = JSON.parse(read('docs/design/ui-manifest.json'))
    const names = (q: string) => findEntries(manifest, queryWords(q)).map(r => String(r.entry.name))
    expect(names('confirm destructive')).toContain('DataRestoreModal')
    expect(names('confirmation integration off the board')[0]).toBe('DisconnectSourceDialog')
    expect(names('persistent notice desktop data file')).toContain('DataStorageNotice')
    expect(names('zzzxqq')).toEqual([])
  })
})
