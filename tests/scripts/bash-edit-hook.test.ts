// @vitest-environment node
/**
 * Per-edit hooks for files changed through Bash (#650): `eslint-file.sh` and `impeccable-worktree.sh` are registered for
 * `Bash` too and ask `edit-root.sh` (`kando_edited_files`) which files the command changed, from
 * `tool_response.bashEditDiff` or, without it, from dirty files with a fresh mtime. Real scripts, a temp git repository
 * and fake `eslint` / `impeccable` binaries that log their arguments.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each case spawns bash, git, jq and node scripts; under the parallel unit-test run the 5 s default is too tight.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const HOOKS = resolve(__dirname, '../../.claude/hooks')
const dirs: string[] = []
let repo: string
let tmp: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' })

function fakeBin(root: string, name: string, body: string) {
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true })
  const bin = join(root, 'node_modules/.bin', name)
  writeFileSync(bin, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(bin, 0o755)
}

/** eslint logs its argument list to $TMP/eslint.log and fails on a file containing BAD. */
function installFakes(root: string) {
  fakeBin(root, 'eslint', `echo "$*" >>"${tmp}/eslint.log"\nfor f in "$@"; do case "$f" in -*) ;; *) grep -q BAD "$f" && echo "$f: error no-bad" && exit 1;; esac; done; exit 0`)
  fakeBin(root, 'impeccable', `cat >/dev/null; echo '{"hookSpecificOutput":{"additionalContext":"finding from impeccable"}}'; echo x >>"${tmp}/impeccable.log"`)
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bash-edit-repo-'))
  dirs.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
  mkdirSync(join(dir, 'lib'))
  writeFileSync(join(dir, 'lib/a.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'lib/old.ts'), 'export const old = 1\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  installFakes(dir)
  return dir
}

function run(script: string, payload: unknown, projectDir = repo) {
  const r = spawnSync('bash', [join(HOOKS, script)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, TMPDIR: tmp },
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

const bash = (extra: Record<string, unknown> = {}, command = "sed -i '' s/a/b/ lib/a.ts") => ({
  hook_event_name: 'PostToolUse',
  session_id: 's1',
  tool_name: 'Bash',
  tool_input: { command },
  cwd: repo,
  duration_ms: 50,
  ...extra,
})
const eslintCalls = () => (existsSync(join(tmp, 'eslint.log')) ? readFileSync(join(tmp, 'eslint.log'), 'utf8').trim().split('\n') : [])
const ageFile = (file: string) => utimesSync(file, new Date(2020, 1, 1), new Date(2020, 1, 1))

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bash-edit-tmp-'))
  dirs.push(tmp)
  repo = makeRepo()
})
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('eslint-file.sh on a Bash call', () => {
  it('lints a file the command just rewrote and feeds the error back (exit 2)', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    const r = run('eslint-file.sh', bash())
    expect(r.code).toBe(2)
    expect(r.err).toContain('lib/a.ts: error no-bad')
  })

  it('stays silent for a clean rewrite', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'export const a = 2\n')
    expect(run('eslint-file.sh', bash()).code).toBe(0)
    expect(eslintCalls()).toHaveLength(1)
  })

  it('ignores a dirty file whose mtime is older than the command run (not changed by it)', () => {
    writeFileSync(join(repo, 'lib/old.ts'), 'BAD\n')
    ageFile(join(repo, 'lib/old.ts'))
    expect(run('eslint-file.sh', bash()).code).toBe(0)
    expect(eslintCalls()).toEqual([])
  })

  it('finds a changed file elsewhere in the checkout when the command ran in a subdirectory', () => {
    mkdirSync(join(repo, 'lib/sub'))
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    const r = run('eslint-file.sh', bash({ cwd: join(repo, 'lib/sub') }))
    expect(r.code).toBe(2)
    expect(r.err).toContain('lib/a.ts: error no-bad')
    expect(r.err).not.toContain('..')
  })

  it('uses bashEditDiff.changedFiles when present, whatever the mtime says', () => {
    writeFileSync(join(repo, 'lib/old.ts'), 'BAD\n')
    ageFile(join(repo, 'lib/old.ts'))
    const diff = { changedFiles: [join(repo, 'lib/old.ts')], files: [], moreFiles: 0 }
    const r = run('eslint-file.sh', bash({ tool_response: { bashEditDiff: diff } }))
    expect(r.code).toBe(2)
    expect(r.err).toContain('lib/old.ts')
  })

  it('falls back to the mtime scan when bashEditDiff is unavailable', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    expect(run('eslint-file.sh', bash({ tool_response: { bashEditDiff: { unavailable: true } } })).code).toBe(2)
  })

  it('lints all changed files of a checkout in one ESLint process', () => {
    for (const n of ['b', 'c', 'd']) writeFileSync(join(repo, `lib/${n}.ts`), 'export const x = 1\n')
    expect(run('eslint-file.sh', bash()).code).toBe(0)
    const calls = eslintCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/lib\/b\.ts.*lib\/c\.ts.*lib\/d\.ts/)
  })

  it.each([
    'git checkout other -- lib/a.ts',
    'git -C . stash pop',
    'cd x && git pull --rebase',
    'git restore lib/a.ts',
    'git worktree add ../w',
  ])('checks nothing after a tree-moving command: %s', (command) => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    expect(run('eslint-file.sh', bash({}, command)).code).toBe(0)
    expect(eslintCalls()).toEqual([])
  })

  it('still checks `git apply` and `git commit` (authored edits)', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    expect(run('eslint-file.sh', bash({}, 'git apply fix.patch')).code).toBe(2)
  })

  it('checks nothing when bashEditDiff says the command was skipped', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    expect(run('eslint-file.sh', bash({ tool_response: { bashEditDiff: { skipped: true } } })).code).toBe(0)
    expect(eslintCalls()).toEqual([])
  })

  it('checks nothing when bashEditDiff reports no changed file', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    expect(run('eslint-file.sh', bash({ tool_response: { bashEditDiff: { changedFiles: [] } } })).code).toBe(0)
    expect(eslintCalls()).toEqual([])
  })

  it('skips non-source files and vendored directories', () => {
    writeFileSync(join(repo, 'README.md'), 'BAD\n')
    mkdirSync(join(repo, 'dist'))
    writeFileSync(join(repo, 'dist/x.js'), 'BAD\n')
    expect(run('eslint-file.sh', bash()).code).toBe(0)
    expect(eslintCalls()).toEqual([])
  })

  it('skips a bulk change of more than 40 files', () => {
    for (let i = 0; i < 41; i++) writeFileSync(join(repo, `lib/n${i}.ts`), 'BAD\n')
    expect(run('eslint-file.sh', bash()).code).toBe(0)
    expect(eslintCalls()).toEqual([])
    rmSync(join(repo, 'lib/n0.ts'))
    expect(run('eslint-file.sh', bash()).code).toBe(2) // exactly 40 are checked
  })

  it('exits at once without starting ESLint when the command changed nothing', () => {
    expect(run('eslint-file.sh', bash({}, 'ls -la')).code).toBe(0)
    expect(eslintCalls()).toEqual([])
  })

  it('never blocks on infra failure', () => {
    expect(run('eslint-file.sh', 'not json').code).toBe(0)
    expect(run('eslint-file.sh', bash({ cwd: '/nonexistent/dir' })).code).toBe(0)
    expect(run('eslint-file.sh', bash({ cwd: undefined })).code).toBe(0)
    expect(run('eslint-file.sh', bash({ tool_response: 'plain string' })).code).toBe(0)
    rmSync(join(repo, 'node_modules'), { recursive: true })
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    expect(run('eslint-file.sh', bash()).code).toBe(0) // no node_modules: a hint, no block
  })

  it('skips proto/* branches', () => {
    git(repo, 'checkout', '-q', '-b', 'proto/1-x')
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    expect(run('eslint-file.sh', bash()).code).toBe(0)
  })

  it('records the worktree a Bash edit landed in, so the Stop hook verifies it', () => {
    const wt = join(tmp, 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'wt-branch', wt)
    installFakes(wt)
    writeFileSync(join(wt, 'lib/a.ts'), 'BAD\n')
    const r = run('eslint-file.sh', bash({ cwd: wt, session_id: 'sess-wt' }))
    expect(r.code).toBe(2)
    expect(readFileSync(join(tmp, 'kando-roots-sess-wt'), 'utf8').trim()).toBe(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: wt, encoding: 'utf8' }).trim())
  })
})

describe('eslint-file.sh on Edit and Write (unchanged behaviour)', () => {
  it('lints the file_path of an Edit', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    const r = run('eslint-file.sh', { tool_name: 'Edit', session_id: 's', tool_input: { file_path: join(repo, 'lib/a.ts') } })
    expect(r.code).toBe(2)
    expect(r.err).toContain('lib/a.ts: error no-bad')
  })

  it('accepts a payload without tool_name', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'ok\n')
    expect(run('eslint-file.sh', { tool_input: { file_path: join(repo, 'lib/a.ts') } }).code).toBe(0)
    expect(eslintCalls()).toHaveLength(1)
  })

  it('ignores files outside the repository and non-source files', () => {
    writeFileSync(join(tmp, 'x.ts'), 'BAD\n')
    expect(run('eslint-file.sh', { tool_input: { file_path: join(tmp, 'x.ts') } }).code).toBe(0)
    expect(run('eslint-file.sh', { tool_input: { file_path: join(repo, '.gitignore') } }).code).toBe(0)
    expect(eslintCalls()).toEqual([])
  })
})

describe('impeccable-worktree.sh', () => {
  const impeccableRuns = () => (existsSync(join(tmp, 'impeccable.log')) ? readFileSync(join(tmp, 'impeccable.log'), 'utf8').trim().split('\n').length : 0)

  it('judges a file a Bash command changed in the own checkout (the plugin hook never sees Bash)', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'export const a = 3\n')
    const r = run('impeccable-worktree.sh', bash())
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out).hookSpecificOutput.additionalContext).toContain('finding from impeccable')
    expect(impeccableRuns()).toBe(1)
  })

  it('still leaves the own checkout to the plugin hook on Edit and Write', () => {
    const r = run('impeccable-worktree.sh', { hook_event_name: 'PostToolUse', tool_name: 'Write', session_id: 's', tool_input: { file_path: join(repo, 'lib/a.ts') } })
    expect(r.out).toBe('')
    expect(impeccableRuns()).toBe(0)
  })

  it('judges a Bash edit in another checkout and records it', () => {
    const wt = join(tmp, 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'wt-branch', wt)
    installFakes(wt)
    writeFileSync(join(wt, 'lib/a.ts'), 'export const a = 4\n')
    const r = run('impeccable-worktree.sh', bash({ cwd: wt, session_id: 'sess-i' }))
    expect(r.out).toContain('finding from impeccable')
    expect(existsSync(join(tmp, 'kando-roots-sess-i'))).toBe(true)
  })

  it('is silent when the Bash command changed nothing', () => {
    expect(run('impeccable-worktree.sh', bash({}, 'ls')).out).toBe('')
  })
})
