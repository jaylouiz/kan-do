import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Proof for #59 that the live copy editor is dev-only: a build made WITHOUT KANDO_COPY_EDITOR=1 (npm run generate, or
// npm run build) contains none of the tool: no module, no UI marker, no route. It reads the build output, so it needs a
// build first and skips without one (like csp-build-output.test.ts):
//   npm run generate && npx vitest run tests/config/copy-editor-build-output.test.ts
//   COPY_EDITOR_BUILD_DIR=<dir> picks another output directory (a node-server build).
// CI runs exactly this after `npm run generate`, with COPY_EDITOR_REQUIRE_BUILD=1. The E2E build carries the tool on purpose (scripts/e2e-server.mjs).

const outputDir = resolve(process.env.COPY_EDITOR_BUILD_DIR ?? resolve(__dirname, '../../.output'))

// Strings only the tool (or its recorder) contains; each survives minification because it is a string literal.
const MARKERS = [
  'data-kando-copy-editor', // UI marker attribute
  'kando-copy-editor-edits', // localStorage key
  'x-kando-copy-editor', // request header
  '/api/dev/copy', // dev routes
  'Edit UI copy', // the command-bar entry
  'kando.copyEditor.recorder', // the postTranslation recorder
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

// Where the build is required (the dedicated CI step) a missing build fails: the proof must not pass by checking nothing.
// The plain `vitest run` of CI has no build and skips it.
describe.skipIf(!existsSync(outputDir) && !process.env.COPY_EDITOR_REQUIRE_BUILD)('a build without KANDO_COPY_EDITOR has no live copy editor (#59)', () => {
  const textFiles = existsSync(outputDir) ? files(outputDir).filter(path => /\.(m?js|css|html|json|mjs)$/.test(path)) : []

  it('has a build to look at', () => {
    expect(textFiles.length).toBeGreaterThan(5)
  })

  it.each(MARKERS)('contains no %s', (marker) => {
    const hits = textFiles.filter(path => readFileSync(path, 'utf8').includes(marker))
    expect(hits).toEqual([])
  })
})
