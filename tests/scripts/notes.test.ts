import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadReleaseNotes, notesPath, notesStage } from '../../scripts/release/notes.mjs'

const VALID = `## Highlights
### de
- **Titel.** Satz.
### en
- **Title.** Sentence.

## Fixes
- x
`

describe('loadReleaseNotes', () => {
  it('reads release-notes/<version>.md and returns its text verbatim', () => {
    const seen: string[] = []
    const result = loadReleaseNotes('0.2.0', {
      root: '/repo',
      readFile: (path: string) => { seen.push(path); return VALID },
    })
    expect(seen).toEqual(['/repo/release-notes/0.2.0.md'])
    expect(result).toMatchObject({ ok: true, body: VALID, summary: '1 highlight (de + en)' })
  })

  it('allows None. for a release without highlights', () => {
    const result = loadReleaseNotes('0.2.0', { readFile: () => '## Highlights\nNone.\n' })
    expect(result).toMatchObject({ ok: true, body: '## Highlights\nNone.\n', summary: 'no highlights (None.)' })
  })

  it('blocks when the file is missing', () => {
    const result = loadReleaseNotes('0.2.0', { readFile: () => { throw new Error('ENOENT') } })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain(notesPath('0.2.0'))
  })

  it('blocks when the file is empty or whitespace', () => {
    for (const text of ['', '  \n\t\n']) {
      const result = loadReleaseNotes('0.2.0', { readFile: () => text })
      expect(result.ok).toBe(false)
      expect(result.reason).toMatch(/empty/)
    }
  })

  it('blocks a bad format with file:line messages', () => {
    const result = loadReleaseNotes('0.2.0', {
      readFile: () => '## Highlights\n### de\n- **A.** a\n- **B.** b\n### en\n- **A.** a\n',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('release-notes/0.2.0.md:5: de has 2 bullets, en has 1')
  })

  it('blocks the old free-form notes', () => {
    expect(loadReleaseNotes('0.2.0', { readFile: () => 'Raw release body' }).ok).toBe(false)
  })
})

describe('notesStage (#693)', () => {
  it('reads the Stage line of the notes', () => {
    expect(notesStage(`${VALID}- Stage: beta\n`)).toBeNull() // a bullet is not a Stage line
    expect(notesStage(`${VALID}Stage: beta\n`)).toBe('beta')
    expect(notesStage('## Highlights\nNone.\n\n## Fixes\nStage: stable  \n')).toBe('stable')
  })

  it('parses the Stage line of the README template', () => {
    const readme = readFileSync('release-notes/README.md', 'utf8')
    const template = /## Template\s+```md\n([\s\S]*?)```/.exec(readme)?.[1] ?? ''
    expect(notesStage(template)).toBe('alpha')
    expect(loadReleaseNotes('0.2.0', { readFile: () => template.replace('...', 'A fix.') })).toMatchObject({ ok: true, stage: 'alpha' })
  })

  it('reads a missing or unknown stage as null', () => {
    expect(notesStage(VALID)).toBeNull()
    expect(notesStage('Stage: gamma\n')).toBeNull()
  })

  it('returns the stage with a valid file', () => {
    expect(loadReleaseNotes('0.2.0', { readFile: () => `${VALID}Stage: alpha\n` })).toMatchObject({ ok: true, stage: 'alpha' })
    expect(loadReleaseNotes('0.2.0', { readFile: () => VALID })).toMatchObject({ ok: true, stage: null })
  })
})
