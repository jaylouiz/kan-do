import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The issue-workflow profile keeps every heading and points at partials for its long sections (#901,
// agent-workflow `reference/project-profile.md`). A pointer to a missing partial, or a partial nobody points
// at, is a rule no stage reads any more: these checks keep the two in step.

const root = join(__dirname, '../..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const PARTIALS = '.claude/issue-workflow'
const POINTER = /Full text: (\.claude\/issue-workflow\/[a-z-]+\.md) \(read when: [^)]+\)/g

describe('issue-workflow profile partials (#901)', () => {
  const profile = read('.claude/issue-workflow.md')
  const pointed = [...profile.matchAll(POINTER)].map(m => m[1]!)

  it('names an existing partial and a "read when" in every pointer', () => {
    expect(pointed.length).toBeGreaterThan(0)
    // Every "Full text:" in the profile parses as a complete pointer (path and "read when").
    expect((profile.match(/Full text:/g) ?? []).length).toBe(pointed.length)
    for (const path of pointed) expect(existsSync(join(root, path)), `${path} is missing`).toBe(true)
  })

  it('points at every partial in the directory', () => {
    const files = readdirSync(join(root, PARTIALS)).filter(f => f.endsWith('.md')).map(f => `${PARTIALS}/${f}`)
    expect(files.sort()).toEqual([...new Set(pointed)].sort())
  })

  it('carries the template version line and stays inside the 20 KB limit', () => {
    expect(profile).toMatch(/<!-- profile-template: \d+ -->/)
    expect(Buffer.byteLength(profile)).toBeLessThanOrEqual(20480)
  })
})
