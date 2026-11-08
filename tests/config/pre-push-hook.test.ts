import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const hook = join(root, '.githooks/pre-push')

describe('.githooks/pre-push', () => {
  const text = readFileSync(hook, 'utf8')

  // Git sets GIT_DIR for hooks; without the unset, vitest's git-in-a-temp-dir tests write into this repo.
  it('drops the repository env vars git sets for hooks before anything runs', () => {
    const unset = text.indexOf('unset $(git rev-parse --local-env-vars)')
    expect(unset).toBeGreaterThan(-1)
    expect(unset).toBeLessThan(text.indexOf('npm run lint:ci'))
  })

  it('runs full verify unless the testing mode is fast, and only changed unit tests in fast', () => {
    expect(text).toContain('exec npm run verify')
    expect(text).toContain('npx vitest run --changed origin/main --passWithNoTests')
  })

  it('checks nothing when the push only deletes branches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pre-push-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir } })
      const out = execFileSync('bash', [hook], {
        cwd: dir,
        env: { PATH: process.env.PATH, HOME: dir },
        input: `refs/heads/x ${'0'.repeat(40)} refs/heads/x ${'1'.repeat(40)}\n`,
        encoding: 'utf8',
      })
      expect(out).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
