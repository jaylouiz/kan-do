import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// Guards for the deploy and CI triggers: Vercel deploys only `main` and `proto/*` (#355); GitHub Actions runs
// `quality` on pull requests and pushes to main with a read-only token and no secrets, and pins third-party
// actions by commit SHA. All of it only shows its faults on a real push, so the shape is pinned here.

const root = resolve(__dirname, '../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')

describe('vercel.json', () => {
  it('limits Git deployments to main and proto/** and holds nothing else', () => {
    expect(JSON.parse(read('vercel.json'))).toEqual({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      git: { deploymentEnabled: { '**': false, 'main': true, 'proto/**': true } },
    })
  })
})

describe('ci.yml triggers', () => {
  interface Job { needs?: string, if?: string }
  const text = read('.github/workflows/ci.yml')
  const doc = parse(text) as {
    on: Record<string, unknown>
    permissions: unknown
    jobs: Record<string, Job>
  }

  // Manual only (Actions budget, 2026-11-07): pushes and PRs start no run; the local gate checks every merge.
  it('runs only on dispatch, read-only and without secrets', () => {
    expect(Object.keys(doc.on)).toEqual(['workflow_dispatch'])
    expect(doc.permissions).toEqual({ contents: 'read' })
    expect(text).not.toContain('${{ secrets.')
    expect(text).not.toContain('pull_request_target')
  })

  it('runs quality, then e2e behind it, on every manual run', () => {
    expect(doc.jobs.quality!.if).toBeUndefined()
    expect(doc.jobs.e2e!.needs).toBe('quality')
    expect(doc.jobs.e2e!.if).toBeUndefined()
  })
})

describe('third-party actions', () => {
  it.each(['.github/workflows/ci.yml', '.github/workflows/release.yml'])('%s pins every action by commit SHA with the version as a comment', (file) => {
    const uses = read(file).split('\n').filter(line => /^\s*-?\s*uses:/.test(line))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
  })
})
