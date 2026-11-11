#!/usr/bin/env node
/**
 * E2E plan of the CI workflow (kd#187): which specs the `e2e` matrix runs and over how many shards.
 *
 * A pull request runs the selection of the pre-merge gate (`scripts/e2e-gate.mjs`); a push to `main`, a manual run and
 * every other event run the full suite, so a missing `map` rule is caught on `main` after the merge. `planE2e` is pure:
 *   - `skip` and `style` without specs  -> no E2E job (`run=false`)
 *   - `targeted` / `style` with specs   -> the listed specs over `ceil(specs / SPECS_PER_SHARD)` shards, at most `MAX_SHARDS`
 *   - `full`, an unreadable decision, any event other than `pull_request` -> everything over `MAX_SHARDS` shards
 * `forcesFull(files)` marks a PR that changes what decides or runs the tests (workflow, this script, the gate, the E2E
 * server, the Playwright config, `package.json`, the lockfile): such a PR runs the whole suite. `.claude/hooks/e2e-*`
 * cannot be covered: CI's `paths-ignore` keeps `.claude/**` out of the workflow, as before.
 *
 * CLI (the `plan` job of `.github/workflows/ci.yml`): reads `GITHUB_EVENT_NAME`, and for a pull request `PR_BODY`,
 * `PR_BASE_REF`, `PR_HEAD_SHA` (event data, only ever read from the environment, never interpolated into a shell line);
 * writes `run`, `tier`, `specs` (space separated basenames, empty for the full suite), `total` and `shards` (a JSON
 * array) to `GITHUB_OUTPUT`. CI has no `.claude/testing-mode`, so the gate runs in `quality`.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { dirname, join, matchesGlob } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_SHARDS = 8
export const SPECS_PER_SHARD = 12

/** Paths whose change forces the full suite on a pull request (globs, like the gate's `map` rules). */
export const FORCE_FULL_PATHS = [
  '.github/workflows/**',
  'scripts/ci-e2e-plan.mjs',
  'scripts/e2e-gate.mjs',
  'scripts/e2e-server.mjs',
  'tests/e2e/playwright.config.ts',
  'package.json',
  'package-lock.json',
]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string[]} files repo-relative paths of a pull request */
export function forcesFull(files) {
  return files.some(file => FORCE_FULL_PATHS.some(glob => matchesGlob(file, glob)))
}

/** @param {number} count specs to run @returns {number} shards, 1 to `MAX_SHARDS` */
export function shardCount(count) {
  return Math.min(MAX_SHARDS, Math.max(1, Math.ceil(count / SPECS_PER_SHARD)))
}

const range = n => Array.from({ length: n }, (_, i) => i + 1)
const fullPlan = reason => ({ run: true, tier: 'full', reason, specs: [], total: MAX_SHARDS, shards: range(MAX_SHARDS) })

/**
 * @param {{ event: string, decision?: { tier?: unknown, specs?: unknown, reason?: unknown } | null }} input
 * @returns {{ run: boolean, tier: string, reason: string, specs: string[], total: number, shards: number[] }}
 */
export function planE2e({ event, decision }) {
  if (event !== 'pull_request') return fullPlan(`${event || 'unknown event'}: full suite`)
  const tier = decision?.tier
  const specs = decision?.specs
  const named = Array.isArray(specs) && specs.every(spec => typeof spec === 'string') ? specs : null
  if (tier === 'full') return fullPlan(`gate: ${decision?.reason ?? 'full'}`)
  if (tier === 'skip' || ((tier === 'style' || tier === 'targeted') && named?.length === 0)) {
    return { run: false, tier, reason: `gate: ${decision?.reason ?? tier}`, specs: [], total: 0, shards: [] }
  }
  if ((tier === 'targeted' || tier === 'style') && named) {
    const total = shardCount(named.length)
    return { run: true, tier, reason: `gate: ${decision?.reason ?? tier}`, specs: named, total, shards: range(total) }
  }
  return fullPlan('gate decision unreadable')
}

/** The gate's decision for the pull request in the environment; `null` when anything fails (the plan then runs full). */
function gateDecision(env) {
  const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
  const head = env.PR_HEAD_SHA
  const base = env.PR_BASE_REF || 'main'
  if (!head) return null
  const mergeBase = git('merge-base', `origin/${base}`, head)
  const files = git('diff', '--name-only', mergeBase, head).split('\n').filter(Boolean)
  const stdin = JSON.stringify({ files, body: env.PR_BODY ?? '', baseRefName: base, headRefOid: head })
  const gateEnv = { ...env, ...(forcesFull(files) ? { E2E_GATE: 'full' } : {}) }
  delete gateEnv.KANDO_TESTING_MODE
  const out = execFileSync('node', [join(ROOT, 'scripts/e2e-gate.mjs')], { input: stdin, encoding: 'utf8', env: gateEnv, maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(out)
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? ''
  let decision = null
  if (event === 'pull_request') {
    try {
      decision = gateDecision(process.env)
    } catch (error) {
      console.error(`gate decision failed, running the full suite: ${error instanceof Error ? error.message : error}`)
    }
  }
  const plan = planE2e({ event, decision })
  const lines = [
    `run=${plan.run}`,
    `tier=${plan.tier}`,
    `specs=${plan.specs.map(spec => `tests/e2e/${spec}.spec.ts`).join(' ')}`,
    `total=${plan.total}`,
    `shards=${JSON.stringify(plan.shards)}`,
  ]
  console.log(`E2E plan: ${plan.run ? `${plan.tier}, ${plan.specs.length || 'all'} specs, ${plan.total} shards` : `no E2E (${plan.tier})`} (${plan.reason})`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`)
  else console.log(lines.join('\n'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
