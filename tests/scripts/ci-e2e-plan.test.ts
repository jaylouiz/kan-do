import { describe, expect, it } from 'vitest'
import { forcesFull, MAX_SHARDS, planE2e, shardCount, SPECS_PER_SHARD } from '../../scripts/ci-e2e-plan.mjs'

// The E2E plan of the CI workflow (kd#187): pure tier -> specs and shard matrix.

const names = (count: number) => Array.from({ length: count }, (_, i) => `spec-${i}`)
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('planE2e', () => {
  it.each(['push', 'workflow_dispatch', 'schedule', ''])('runs the full suite over %j events, whatever the decision says', (event) => {
    const plan = planE2e({ event, decision: { tier: 'skip', specs: [] } })
    expect(plan).toMatchObject({ run: true, tier: 'full', specs: [], total: MAX_SHARDS, shards: range(MAX_SHARDS) })
  })

  it('runs no E2E job for a docs-only pull request', () => {
    expect(planE2e({ event: 'pull_request', decision: { tier: 'skip', reason: 'docs-only', specs: [] } })).toMatchObject({ run: false, total: 0, shards: [] })
  })

  it('runs no E2E job for a style-only pull request without specs', () => {
    expect(planE2e({ event: 'pull_request', decision: { tier: 'style', specs: [] } }).run).toBe(false)
  })

  it('runs the changed specs of a style-only pull request (gate tier targeted)', () => {
    const plan = planE2e({ event: 'pull_request', decision: { tier: 'targeted', specs: ['board', 'smoke'] } })
    expect(plan).toMatchObject({ run: true, tier: 'targeted', specs: ['board', 'smoke'], total: 1, shards: [1] })
  })

  it('runs exactly the listed specs of a targeted pull request', () => {
    const plan = planE2e({ event: 'pull_request', decision: { tier: 'targeted', specs: ['copy-editor', 'smoke'] } })
    expect(plan.specs).toEqual(['copy-editor', 'smoke'])
    expect(plan.run).toBe(true)
  })

  it('runs the full suite over 8 shards for a full gate decision', () => {
    const plan = planE2e({ event: 'pull_request', decision: { tier: 'full', specs: names(40) } })
    expect(plan).toMatchObject({ run: true, tier: 'full', specs: [], total: MAX_SHARDS })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an unknown tier', { tier: 'weird', specs: ['a'] }],
    ['a targeted tier without a spec list', { tier: 'targeted' }],
    ['a spec list of non-strings', { tier: 'targeted', specs: [1, 2] }],
  ])('runs the full suite for an unreadable decision (%s)', (_label, decision) => {
    expect(planE2e({ event: 'pull_request', decision })).toMatchObject({ run: true, tier: 'full', total: MAX_SHARDS })
  })
})

describe('shardCount', () => {
  it.each([
    [0, 1],
    [1, 1],
    [SPECS_PER_SHARD, 1],
    [SPECS_PER_SHARD + 1, 2],
    [200, MAX_SHARDS],
  ])('%i specs run over %i shards', (count, shards) => {
    expect(shardCount(count)).toBe(shards)
  })

  it('is what a targeted plan uses, with a shard list 1..n and no empty shard', () => {
    for (const count of [1, 12, 13, 24, 25, 200]) {
      const plan = planE2e({ event: 'pull_request', decision: { tier: 'targeted', specs: names(count) } })
      expect(plan.total).toBe(shardCount(count))
      expect(plan.shards).toEqual(range(plan.total))
      expect(Math.ceil(count / plan.total)).toBeGreaterThan(0)
    }
  })
})

describe('forcesFull', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    'scripts/ci-e2e-plan.mjs',
    'scripts/e2e-gate.mjs',
    'scripts/testing-mode.mjs',
    'scripts/release/e2e.mjs',
    'scripts/e2e-server.mjs',
    'tests/e2e/playwright.config.ts',
    'package.json',
    'package-lock.json',
  ])('%s forces the full suite', (file) => {
    expect(forcesFull(['server/copy-editor/translate.ts', file])).toBe(true)
  })

  it.each([
    ['server/copy-editor/translate.ts'],
    ['components/board/BoardColumn.vue', 'tests/e2e/smoke.spec.ts'],
    ['src-tauri/package.json.bak', 'docs/ci.md'],
    ['scripts/release/version.mjs'],
  ])('%j does not', (...files) => {
    expect(forcesFull(files)).toBe(false)
  })
})
