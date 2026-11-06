import { describe, expect, it } from 'vitest'
import { compareVersions, parseReleaseNotes } from '~/lib/releaseNotesFormat.mjs'

const valid = `## Highlights
### de
- **Titel eins.** Ein Satz dazu.
- **Titel zwei.** Noch ein Satz.
### en
- **Title one.** A sentence.
- **Title two.** Another sentence.

## Fixes
- anything <b>goes</b> [here](x)
`

function errorsOf(text: string) {
  const result = parseReleaseNotes(text)
  if (result.ok) throw new Error('expected errors')
  return result.errors
}

describe('parseReleaseNotes', () => {
  it('parses both languages and ignores Fixes', () => {
    expect(parseReleaseNotes(valid)).toEqual({
      ok: true,
      highlights: {
        de: [{ title: 'Titel eins.', text: 'Ein Satz dazu.' }, { title: 'Titel zwei.', text: 'Noch ein Satz.' }],
        en: [{ title: 'Title one.', text: 'A sentence.' }, { title: 'Title two.', text: 'Another sentence.' }],
      },
    })
  })

  it('accepts None. and CRLF line endings', () => {
    expect(parseReleaseNotes('## Highlights\nNone.\n')).toEqual({ ok: true, highlights: null })
    expect(parseReleaseNotes(valid.replace(/\n/g, '\r\n')).ok).toBe(true)
  })

  it('rejects content before ## Highlights, with its line', () => {
    expect(errorsOf('Intro\n\n## Highlights\nNone.')[0]).toMatchObject({ line: 1 })
  })

  it('rejects a missing Highlights section and a Highlights section that is not first', () => {
    expect(errorsOf('## Fixes\n- x')[0]?.message).toMatch(/Missing "## Highlights"/)
    const late = errorsOf(`## Fixes\n- x\n${valid}`)
    expect(late).toContainEqual(expect.objectContaining({ line: 3, message: expect.stringMatching(/must be the first/) }))
  })

  it('rejects unknown and duplicate sections', () => {
    expect(errorsOf(`${valid}\n## Fixs\n- x`)).toContainEqual(expect.objectContaining({ line: 12, message: expect.stringMatching(/Unknown section "## Fixs"/) }))
    expect(errorsOf(`${valid}\n## Fixes\n- y`)).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/Duplicate section/) }))
  })

  it('rejects an empty Highlights section and None. mixed with content', () => {
    expect(errorsOf('## Highlights\n\n## Fixes\n- x')[0]).toMatchObject({ line: 1 })
    expect(errorsOf('## Highlights\nNone.\n### de\n- **A.** b\n### en\n- **A.** b')).toContainEqual(
      expect.objectContaining({ line: 2, message: expect.stringMatching(/only line/) }),
    )
  })

  it('rejects a missing language and unknown subsections', () => {
    expect(errorsOf('## Highlights\n### de\n- **A.** b')[0]?.message).toMatch(/Missing "### en"/)
    expect(errorsOf('## Highlights\n### fr\n- **A.** b\n### de\n- **A.** b\n### en\n- **A.** b')).toContainEqual(
      expect.objectContaining({ line: 2, message: expect.stringMatching(/Unknown subsection/) }),
    )
  })

  it('reports different bullet counts with the line of ### en', () => {
    const text = '## Highlights\n### de\n- **A.** a\n- **B.** b\n### en\n- **A.** a'
    expect(errorsOf(text)).toEqual([{ line: 5, message: expect.stringContaining('de has 2 bullets, en has 1') }])
  })

  it('enforces 1 to 5 bullets', () => {
    expect(errorsOf('## Highlights\n### de\n### en\n- **A.** a')).toContainEqual(
      expect.objectContaining({ line: 2, message: expect.stringMatching(/no bullets/) }),
    )
    const six = Array.from({ length: 6 }, (_, i) => `- **T${i}.** x`).join('\n')
    expect(errorsOf(`## Highlights\n### de\n${six}\n### en\n${six}`)).toContainEqual(
      expect.objectContaining({ line: 2, message: expect.stringMatching(/maximum is 5/) }),
    )
  })

  it.each([
    ['plain text', '- Just text', 'Use "- **Title.**'],
    ['no bold title', '- Title. Text', 'Use "- **Title.**'],
    ['no full stop in the bold run', '- **Title** Text.', 'Use "- **Title.**'],
    ['no text after the title', '- **Title.**', 'Use "- **Title.**'],
    ['raw HTML', '- **Title.** Use <script>alert(1)</script>', 'HTML'],
    ['a link', '- **Title.** See [docs](https://x.y)', 'Links'],
    ['an image', '- **Title.** ![x](y.png)', 'Links'],
    ['bold in the text', '- **Title.** Some **bold** text', 'Bold is only'],
    ['a nested list', '  - **Title.** Nested', 'Nested'],
    ['a non-bullet line', 'Prose line', 'Expected a bullet like'],
  ])('rejects %s with the bullet line number', (_name, bullet, hint) => {
    const errors = errorsOf(`## Highlights\n### de\n${bullet}\n### en\n- **T.** t`)
    expect(errors.find(error => error.line === 3)?.message).toContain(hint)
  })

  it('rejects bullets outside a language subsection', () => {
    expect(errorsOf('## Highlights\n- **A.** a\n### de\n- **A.** a\n### en\n- **A.** a')[0]).toMatchObject({ line: 2 })
  })

  it('collects every error, sorted by line', () => {
    const errors = errorsOf('Intro\n## Highlights\n### de\n- bad\n### en\n- also bad\n## Typo')
    expect(errors.map(error => error.line)).toEqual([...errors.map(error => error.line)].sort((a, b) => a - b))
    expect(errors.length).toBeGreaterThanOrEqual(4)
  })
})

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0)
  })
})
