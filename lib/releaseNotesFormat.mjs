/**
 * Release-notes format (#226): the one parser shared by `npm run release` (validation, release body)
 * and the app (bundled `release-notes/<X.Y.Z>.md`, parsed at runtime). Plain ESM with JSDoc types so
 * Node runs it without a build step; `releaseNotesFormat.d.mts` types it for Nuxt. The format is
 * documented in `release-notes/README.md`.
 *
 * Only `## Highlights` is read. `## Fixes` is skipped unvalidated and never reaches the UI.
 */

/** @typedef {{ title: string, text: string }} Bullet */
/** @typedef {{ de: Bullet[], en: Bullet[] }} Highlights */
/** @typedef {{ line: number, message: string }} ParseError */
/** @typedef {{ ok: true, highlights: Highlights | null } | { ok: false, errors: ParseError[] }} ParseResult */

export const MAX_BULLETS = 5
const LANGUAGES = ['de', 'en']
const NONE_LINE = 'None.'
const BULLET = /^- \*\*([^*]*\.)\*\* (\S.*)$/
const HTML = /<[A-Za-z/!?]/
const LINK = /!?\[[^\]]*\]\([^)]*\)/

/** @returns {number} negative, 0 or positive like `Array.sort`; plain `X.Y.Z` only */
export function compareVersions(a, b) {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0)
  }
  return 0
}

/**
 * Checks one bullet line and returns the parsed bullet, or the reason it is invalid.
 * @returns {{ bullet: Bullet } | { error: string }}
 */
function parseBullet(raw) {
  if (/^\s+[-*+]/.test(raw)) return { error: 'Nested lists are not allowed. Write one flat list.' }
  if (!raw.startsWith('- ')) return { error: 'Expected a bullet like "- **Title.** One sentence."' }
  if (HTML.test(raw)) return { error: 'Raw HTML is not allowed. Use plain text.' }
  if (LINK.test(raw)) return { error: 'Links and images are not allowed. Use plain text.' }
  const match = BULLET.exec(raw)
  if (!match) return { error: 'Use "- **Title.** One sentence." (bold title ending in a full stop, then text).' }
  const [, title, text] = match
  if (text.includes('**')) return { error: 'Bold is only allowed for the title.' }
  return { bullet: { title: title.trim(), text: text.trim() } }
}

/**
 * @param {string} text the whole file
 * @returns {ParseResult}
 */
export function parseReleaseNotes(text) {
  /** @type {ParseError[]} */
  const errors = []
  const fail = (line, message) => errors.push({ line, message })
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd())

  /** @type {{ name: string, line: number }[]} */
  const sections = []
  for (let i = 0; i < lines.length; i++) {
    const heading = /^## (.*)$/.exec(lines[i])
    if (heading) sections.push({ name: heading[1].trim(), line: i + 1 })
  }

  const firstHeadingLine = sections[0]?.line ?? lines.length + 1
  for (let i = 0; i < firstHeadingLine - 1; i++) {
    if (lines[i].trim()) {
      fail(i + 1, 'Content before "## Highlights" is not allowed. Start the file with "## Highlights".')
      break
    }
  }

  const seen = new Set()
  for (const section of sections) {
    if (section.name !== 'Highlights' && section.name !== 'Fixes') {
      fail(section.line, `Unknown section "## ${section.name}". Only "## Highlights" and "## Fixes" exist.`)
    } else if (seen.has(section.name)) {
      fail(section.line, `Duplicate section "## ${section.name}".`)
    }
    seen.add(section.name)
  }

  const highlightsIndex = sections.findIndex(section => section.name === 'Highlights')
  if (highlightsIndex === -1) {
    fail(1, 'Missing "## Highlights" section. Add it first, or "None." for a release without highlights.')
    return { ok: false, errors }
  }
  if (highlightsIndex > 0) fail(sections[highlightsIndex].line, '"## Highlights" must be the first section.')

  const start = sections[highlightsIndex].line
  const end = (sections[highlightsIndex + 1]?.line ?? lines.length + 1) - 1
  const body = []
  for (let n = start + 1; n <= end; n++) {
    if (lines[n - 1].trim()) body.push({ n, raw: lines[n - 1] })
  }

  if (body.length === 1 && body[0].raw.trim() === NONE_LINE) {
    return errors.length ? { ok: false, errors } : { ok: true, highlights: null }
  }
  if (body.length === 0) {
    fail(start, 'The "## Highlights" section is empty. Add "### de" and "### en" bullets, or only "None.".')
    return { ok: false, errors }
  }

  /** @type {Record<string, { line: number, bullets: Bullet[] }>} */
  const subsections = {}
  let current = null
  for (const { n, raw } of body) {
    const sub = /^### (.*)$/.exec(raw)
    if (sub) {
      const name = sub[1].trim()
      if (!LANGUAGES.includes(name)) {
        fail(n, `Unknown subsection "### ${name}". Use "### de" and "### en".`)
        current = null
      } else if (subsections[name]) {
        fail(n, `Duplicate subsection "### ${name}".`)
        current = null
      } else {
        current = subsections[name] = { line: n, bullets: [] }
      }
      continue
    }
    if (raw.trim() === NONE_LINE) {
      fail(n, '"None." must be the only line of "## Highlights". Remove the other lines or this one.')
      continue
    }
    if (!current) {
      fail(n, 'Put bullets under "### de" or "### en".')
      continue
    }
    const parsed = parseBullet(raw)
    if ('error' in parsed) fail(n, parsed.error)
    else current.bullets.push(parsed.bullet)
  }

  for (const language of LANGUAGES) {
    const sub = subsections[language]
    if (!sub) {
      fail(start, `Missing "### ${language}" subsection under "## Highlights".`)
    } else if (sub.bullets.length === 0) {
      fail(sub.line, `"### ${language}" has no bullets. Add 1 to ${MAX_BULLETS}.`)
    } else if (sub.bullets.length > MAX_BULLETS) {
      fail(sub.line, `${language} has ${sub.bullets.length} bullets, the maximum is ${MAX_BULLETS}. Keep only the most important.`)
    }
  }
  const de = subsections.de
  const en = subsections.en
  if (de && en && de.bullets.length > 0 && en.bullets.length > 0 && de.bullets.length !== en.bullets.length) {
    fail(en.line, `de has ${de.bullets.length} bullets, en has ${en.bullets.length}. Both languages need the same number.`)
  }

  if (errors.length) return { ok: false, errors: errors.sort((a, b) => a.line - b.line) }
  return { ok: true, highlights: { de: de.bullets, en: en.bullets } }
}
