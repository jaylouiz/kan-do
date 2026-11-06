#!/usr/bin/env node
/**
 * Rendered design scan at the end of a turn (the Stop hook `.claude/hooks/verify.sh`): runs
 * `tests/e2e/design-detect.spec.ts` (Impeccable's element rules, contrast and tiny text among them, on the seeded
 * surfaces at 1280 and 390) when the checkout changes a file on a `design` path of `.claude/hooks/e2e-gate.json`.
 *
 * Why here: `.vue` files get the detector's regex rules only, so per edit nothing sees contrast or text size; the
 * pre-merge gate would, but only at merge. This moves the finding to the turn that caused it.
 *
 * Cheap when idle: no design-path change against the merge base = no run; the same content as the last passing run
 * (a hash of every changed design file) = no run. It serves its own production build on a free port
 * (scripts/e2e-server.mjs via Playwright's webServer), so a dev server on :3000 is never touched.
 *
 * Exit 0 = skipped or passed, 1 = findings (Playwright's report on stdout), 2 = could not run.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, matchesGlob, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findFreePort } from './release/e2e.mjs'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' })
const lines = (out) => out.split('\n').map(s => s.trim()).filter(Boolean)

const config = JSON.parse(readFileSync(join(root, '.claude/hooks/e2e-gate.json'), 'utf8'))
const designPaths = config.design?.paths ?? []
const base = git('merge-base', 'origin/main', 'HEAD').stdout.trim()
if (!base) {
  console.log('design-scan: no merge base with origin/main, skipped')
  process.exit(0)
}
const changed = new Set([
  ...lines(git('diff', '--name-only', base).stdout),
  ...lines(git('ls-files', '--others', '--exclude-standard').stdout),
])
const design = [...changed].filter(file => designPaths.some(glob => matchesGlob(file, glob))).sort()
if (design.length === 0) {
  console.log('design-scan: no design-path change, skipped')
  process.exit(0)
}

// The scan's own inputs count too: a changed spec, detector config or DESIGN.md can change the verdict.
const INPUTS = ['tests/e2e/design-detect.spec.ts', '.impeccable/config.json', 'DESIGN.md', 'package-lock.json']
const hash = createHash('sha256')
for (const file of [...design, ...INPUTS]) {
  hash.update(file)
  hash.update(existsSync(join(root, file)) ? readFileSync(join(root, file)) : 'deleted')
}
const stamp = hash.digest('hex')
const stampFile = join(tmpdir(), `kando-design-scan-${createHash('sha256').update(root).digest('hex').slice(0, 16)}`)
if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) {
  console.log('design-scan: unchanged since the last passing scan, skipped')
  process.exit(0)
}

const port = await findFreePort()
const run = spawnSync('npx', ['playwright', 'test', '-c', 'tests/e2e/playwright.config.ts', 'tests/e2e/design-detect.spec.ts', '--reporter=line'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, PORT: String(port), BASE_URL: '' },
  timeout: 280_000,
})
const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
if (run.error || run.status === null) {
  console.log(`design-scan: could not run (${run.error?.message ?? `signal ${run.signal}`})\n${out.slice(-2000)}`)
  process.exit(2)
}
if (run.status !== 0) {
  // Playwright exits 1 for findings and for infrastructure failures alike. Findings are failed tests in the report;
  // a missing browser, a failed build or a webServer timeout never reach a test.
  const ranTests = /\b\d+ (failed|passed)\b/.test(out)
  const infra = /Executable doesn't exist|config\.webServer|browserType\.launch/.test(out)
  if (!ranTests || infra) {
    console.log(`design-scan: could not run (Playwright exit ${run.status})\n${out.slice(-2000)}`)
    process.exit(2)
  }
  console.log(out.slice(-6000))
  process.exit(1)
}
writeFileSync(stampFile, stamp)
console.log(`design-scan: ${design.length} design file(s) changed, rendered scan passed`)
