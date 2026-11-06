import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// #587: design reasons become rules only through a challenged proposal the user adopts. The mechanism is a
// project skill plus pointers; this guards that it exists, is tracked by git and says it never writes first.
const root = resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

describe('design-rule skill (#587)', () => {
  const skill = read('.claude/skills/design-rule/SKILL.md')

  it('has a frontmatter that names the trigger and the exclusion', () => {
    const front = skill.split('---')[1] ?? ''
    expect(front).toMatch(/^name: design-rule$/m)
    expect(front).toContain('because')
    expect(front).toContain('diverged from')
    expect(front).toContain('bare preference')
  })

  it('reports exactly the three verdicts and proposes with a destination', () => {
    for (const word of ['matches convention', 'conflicts', 'personal preference only', 'Where it goes:', 'Deliberate exception']) {
      expect(skill, word).toContain(word)
    }
  })

  it('never writes before the explicit yes of the user', () => {
    expect(skill).toContain('before the user\'s explicit yes')
    expect(skill).toMatch(/Adopt: the only write/)
    expect(skill.split('\n').length).toBeLessThan(90)
  })

  it('is tracked by git (the .claude/skills allow-list names it)', () => {
    // exit 1 = not ignored (0 = ignored)
    const result = spawnSync('git', ['check-ignore', '-q', '.claude/skills/design-rule/SKILL.md'], { cwd: root })
    expect(result.status).toBe(1)
  })
})

describe('design-rule pointers (#587)', () => {
  it('CLAUDE.md, the profile and the canvas profile point at the skill', () => {
    expect(read('CLAUDE.md')).toContain('`design-rule`')
    const profile = read('.claude/issue-workflow.md')
    expect(profile).toContain('## Design feedback')
    expect(profile).toContain('`rule-candidate`')
    expect(read('.claude/ui-canvas.md')).toContain('design-rule')
  })
})
