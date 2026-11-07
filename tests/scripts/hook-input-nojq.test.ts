// @vitest-environment node
/**
 * #9: the per-edit and Stop hooks (`eslint-file.sh`, `impeccable-worktree.sh`, `verify.sh`) read their input through
 * `hook-input.sh`, so a contributor without `jq` keeps the feedback. Same payloads run with and without jq on PATH.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// A PATH with the tools the hooks need, resolved from the real PATH, but no jq.
function noJqBin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kando-nojq-'))
  dirs.push(dir)
  for (const tool of ['bash', 'sh', 'cat', 'sed', 'tr', 'grep', 'head', 'dirname', 'mktemp', 'rm', 'awk', 'env', 'git', 'date', 'paste', 'perl', 'sort', 'wc', 'cksum', 'cut', 'stat', 'mkdir', 'touch', 'uname', 'basename', 'tail', 'printf']) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    if (found) symlinkSync(found, join(dir, tool))
  }
  return dir
}

function run(script: string, payload: unknown, path?: string) {
  const r = spawnSync('/bin/bash', [join(HOOKS, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...(path ? { PATH: path } : {}), CLAUDE_PROJECT_DIR: repo, TMPDIR: tmp },
  })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

const edit = (file: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: 'PostToolUse',
  session_id: 's1',
  tool_name: 'Edit',
  tool_input: { file_path: file },
  cwd: repo,
  ...extra,
})

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nojq-tmp-'))
  repo = mkdtempSync(join(tmpdir(), 'nojq-repo-'))
  dirs.push(tmp, repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n')
  mkdirSync(join(repo, 'lib'))
  writeFileSync(join(repo, 'lib/a.ts'), 'export const a = 1\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  fakeBin(repo, 'eslint', 'for f in "$@"; do case "$f" in -*) ;; *) grep -q BAD "$f" && echo "$f: error no-bad" && exit 1;; esac; done; exit 0')
  fakeBin(repo, 'impeccable', `cat >/dev/null; echo '{"hookSpecificOutput":{"additionalContext":"finding from impeccable"}}'`)
})
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('per-edit hooks without jq (#9)', () => {
  it('the test PATH really has no jq', () => {
    expect(spawnSync('sh', ['-c', 'command -v jq'], { env: { PATH: noJqBin() } }).status).not.toBe(0)
  })

  it('eslint-file.sh still lints an edited file and feeds the error back', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    const withJq = run('eslint-file.sh', edit(join(repo, 'lib/a.ts')))
    const without = run('eslint-file.sh', edit(join(repo, 'lib/a.ts')), noJqBin())
    expect(without.code).toBe(2)
    expect(without.err).toContain('lib/a.ts: error no-bad')
    expect(without.code).toBe(withJq.code)
  })

  it('eslint-file.sh finds the files of a Bash call from bashEditDiff', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'BAD\n')
    const payload = edit('', {
      tool_name: 'Bash',
      tool_input: { command: 'sed -i s/a/b/ lib/a.ts' },
      duration_ms: 50,
      tool_response: { bashEditDiff: { changedFiles: [join(repo, 'lib/a.ts')], files: [{ filePath: join(repo, 'lib/a.ts') }] } },
    })
    const without = run('eslint-file.sh', payload, noJqBin())
    expect(without.code).toBe(2)
    expect(without.err).toContain('lib/a.ts: error no-bad')
  })

  it('eslint-file.sh stays silent for a Bash call that changed nothing', () => {
    const payload = edit('', { tool_name: 'Bash', tool_input: { command: 'ls' }, duration_ms: 50, tool_response: { bashEditDiff: { skipped: true } } })
    expect(run('eslint-file.sh', payload, noJqBin()).code).toBe(0)
  })

  it('impeccable-worktree.sh judges a Bash-changed file in the session checkout and reports the same context', () => {
    writeFileSync(join(repo, 'lib/a.ts'), 'export const a = 2\n')
    const payload = edit('', {
      tool_name: 'Bash',
      tool_input: { command: 'sed -i s/1/2/ lib/a.ts' },
      duration_ms: 50,
      tool_response: { bashEditDiff: { changedFiles: [join(repo, 'lib/a.ts')], files: [] } },
    })
    const withJq = run('impeccable-worktree.sh', payload)
    const without = run('impeccable-worktree.sh', payload, noJqBin())
    expect(without.code).toBe(0)
    expect(JSON.parse(without.out)).toEqual(JSON.parse(withJq.out))
    expect(JSON.parse(without.out).hookSpecificOutput.additionalContext).toContain('finding from impeccable')
  })

  it('the helpers give the same answers with and without jq, including odd values', () => {
    const payload = JSON.stringify({ session_id: 'ü-1', n: 5, o: { a: [1] }, tool_input: { command: 'echo "hi"\nx' } })
    const script = [`. "${HOOKS}/hook-input.sh"`, ...['session_id', 'tool_input.command', 'o', 'n', 'missing.x'].map((p) => `printf '[%s]' "$(hook_get "$PAYLOAD" ${p})"`)].join('\n')
    const call = (path?: string) => spawnSync('/bin/bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PAYLOAD: payload, ...(path ? { PATH: path } : {}) },
    }).stdout
    expect(call()).toBe('[ü-1][echo "hi"\nx][{"a":[1]}][5][]')
    expect(call(noJqBin())).toBe(call())
  })
})
