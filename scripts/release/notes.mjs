/**
 * Release-notes gate (#226). `release-notes/<version>.md` must exist and follow the Highlights format
 * (`release-notes/README.md`, parsed by `lib/releaseNotesFormat.mjs`, the same parser the app uses).
 * The file verbatim is the GitHub release body and the `notes` field of `latest.json`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseReleaseNotes } from '../../lib/releaseNotesFormat.mjs'

export const NOTES_DIR = 'release-notes'

/** Release stages (#693): chosen per release, recorded as a `Stage: <stage>` line in the notes (under `## Fixes`, which the parser skips). */
export const STAGES = ['alpha', 'beta', 'stable']

/** The stage a notes file records, or `null` when it has no (or an unknown) `Stage:` line. @param {string} text */
export function notesStage(text) {
  const stage = /^Stage: *(\S+) *$/m.exec(text)?.[1]
  return STAGES.includes(stage ?? '') ? stage : null
}

export function notesPath(version) {
  return `${NOTES_DIR}/${version}.md`
}

/**
 * @param {string} version plain `X.Y.Z`; the file name must match it
 * @param {{ root?: string, readFile?: (path: string) => string }} [options]
 * @returns {{ ok: boolean, body: string, reason?: string, summary?: string, stage?: string | null }}
 */
export function loadReleaseNotes(version, { root = '.', readFile = path => readFileSync(path, 'utf8') } = {}) {
  const relative = notesPath(version)
  let text
  try {
    text = readFile(join(root, relative))
  } catch {
    return { ok: false, body: '', reason: `${relative} is missing` }
  }
  if (!text.trim()) return { ok: false, body: '', reason: `${relative} is empty` }
  const parsed = parseReleaseNotes(text)
  if (!parsed.ok) {
    const reason = parsed.errors.map(error => `${relative}:${error.line}: ${error.message}`).join('\n')
    return { ok: false, body: '', reason }
  }
  const summary = parsed.highlights
    ? `${parsed.highlights.en.length} highlight${parsed.highlights.en.length === 1 ? '' : 's'} (de + en)`
    : 'no highlights (None.)'
  return { ok: true, body: text, summary, stage: notesStage(text) }
}
