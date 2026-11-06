/**
 * Shared E2E gate helpers (#355): the pre-merge hook (`scripts/e2e-gate.mjs`) and `npm run release`
 * (`scripts/release.mjs`) run the same Playwright command and keep the same pass stamps, so a full run
 * done for a merge also satisfies the release of that exact commit. Pure apart from `findFreePort`.
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** Directory name below the git common dir that holds the pass stamps (shared by all worktrees). */
export const STAMP_DIR = 'kando-e2e-pass'

/** Stamp key of a full-suite run; it satisfies every tier. */
export const FULL_KEY = 'full'

/**
 * Stamp key of a targeted run: the first 12 hex of the SHA-1 of the sorted spec list, so the key does
 * not depend on the order the specs were collected in and a changed list gets a fresh run.
 * @param {string[]} specs basenames without `.spec.ts`
 */
export function stampKey(specs) {
  const sorted = [...new Set(specs)].sort()
  return createHash('sha1').update(sorted.join('\n')).digest('hex').slice(0, 12)
}

/**
 * @param {string} commonDir absolute `git rev-parse --git-common-dir`
 * @param {string} sha
 * @param {string} key `FULL_KEY` or a `stampKey`
 */
export function stampPath(commonDir, sha, key) {
  return join(commonDir, STAMP_DIR, `${sha}.${key}`)
}

/**
 * Stamp files that satisfy a run: a `<sha>.full` stamp covers any tier, a targeted stamp only the same list.
 * @param {string} commonDir
 * @param {string} sha
 * @param {string} key key of the wanted run
 */
export function satisfyingStamps(commonDir, sha, key) {
  const full = stampPath(commonDir, sha, FULL_KEY)
  return key === FULL_KEY ? [full] : [full, stampPath(commonDir, sha, key)]
}

/**
 * Playwright arguments of a gate or release run. `--retries=1` replaces the manual "rerun failed specs
 * once"; two workers when the 1-minute load average exceeds the CPU count (the load flakes of 2026-10-28).
 * @param {{ files?: string[], load?: number, cpus?: number }} [options] spec files; none = the full suite
 */
export function e2eArgs({ files = [], load = 0, cpus = Infinity } = {}) {
  return ['--reporter=line', '--retries=1', ...(load > cpus ? ['--workers=2'] : []), ...files]
}

/** Strips ANSI colour codes from reporter output. */
export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001B\[[0-9;]*m/g, '')
}

/**
 * Failing and flaky tests of a Playwright `line` reporter log. A flaky test passed only on retry:
 * the gate prints it and does not block.
 * @returns {{ failed: number, flaky: string[] }}
 */
export function parseSummary(log) {
  const lines = stripAnsi(log).split('\n')
  const failedLine = lines.findLast(line => /^\s*\d+ failed\s*$/.test(line))
  const failed = failedLine ? Number(failedLine.trim().split(' ')[0]) : 0
  const flaky = []
  const header = lines.findLastIndex(line => /^\s*\d+ flaky\s*$/.test(line))
  if (header >= 0) {
    for (const line of lines.slice(header + 1)) {
      if (/^\s*\[/.test(line)) flaky.push(line.trim())
      else if (line.trim() && !/^\s/.test(line)) break
    }
  }
  return { failed, flaky }
}

/** A free TCP port, asked from the OS. */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * Porcelain lines of a tree that the E2E run must not leave behind. The version files may legitimately
 * be dirty already (a re-run accepts a bumped tree), everything else means the run or the tree is not
 * what `HEAD` says.
 * @param {string} porcelain output of `git status --porcelain`
 * @param {string[]} allowed repo-relative paths that may be modified
 */
export function dirtyOutside(porcelain, allowed = []) {
  return porcelain.split('\n').filter(line => line.trim() && !allowed.includes(line.slice(3).trim()))
}

/** The refusal printed when the release E2E step fails; nothing was committed, pushed or uploaded yet. */
export function e2eRefusal({ failed, code }) {
  const detail = failed > 0 ? `${failed} failing` : `no failing count in the output, exit ${code}`
  return `Release refused: the full E2E suite failed (${detail}); nothing was committed, pushed or uploaded`
}
