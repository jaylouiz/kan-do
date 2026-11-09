import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Proof for #65 that the dev-only pages are dev-only: a build made WITHOUT KANDO_UI_CATALOG=1 (npm run generate, or
// `nuxt build` with NITRO_PRESET=node-server) has no /ui, /styleguide or /error-test route and none of the catalog's
// strings. It reads the build output, so it runs only when told which build is meant: a plain `vitest run` skips it,
// because whatever `.output` happens to exist may be stale or from another checkout (a pre-PR build still holds /styleguide).
//   npm run generate && UI_CATALOG_BUILD_DIR=.output npx vitest run tests/config/ui-catalog-build-output.test.ts
//   UI_CATALOG_BUILD_DIR=<dir> picks the output directory (also a node-server build).
// CI and `npm run release` run this after the build with UI_CATALOG_REQUIRE_BUILD=1 (default `.output`; no build then
// fails instead of skipping, and they never skip). The E2E build carries the catalog on purpose (scripts/e2e-server.mjs).

const outputDir = resolve(process.env.UI_CATALOG_BUILD_DIR ?? resolve(__dirname, '../../.output'))
// Opt-in: a build the caller named, or a step that requires one. Never an `.output` found by chance.
const requested = Boolean(process.env.UI_CATALOG_REQUIRE_BUILD || process.env.UI_CATALOG_BUILD_DIR)

// Strings only the catalog page and its parts contain; each survives minification because it is a string literal.
const MARKERS = [
  'data-kd-ui-catalog', // the page's marker attribute
  'Semantic colour roles', // a Tokens-part heading
  'Component defaults from app.config', // a Tokens-part heading
  'data-kd-sample', // the Components part's sample wrapper (#66): the engine and, through it, catalog/ and the manifest import
  'Sample language', // a Components-part control label
  'data-kd-board-host', // the sample host of the store-bound board blocks (#77): a throwaway Pinia with the demo board
]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe.skipIf(!requested || (!existsSync(outputDir) && !process.env.UI_CATALOG_REQUIRE_BUILD))('a build without KANDO_UI_CATALOG has no /ui, /styleguide or /error-test (#65)', () => {
  const textFiles = existsSync(outputDir) ? files(outputDir).filter(path => /\.(m?js|css|html|json)$/.test(path)) : []
  const text = textFiles.map(path => ({ path, source: readFileSync(path, 'utf8') }))

  it('has a build to look at, with the shipped routes in its router manifest', () => {
    expect(textFiles.length).toBeGreaterThan(5)
    // the positive control: a vacuous scan (minified route table not found) must not pass
    expect(text.filter(t => /path:\s*["'`]\/welcome["'`]/.test(t.source)).length).toBeGreaterThan(0)
  })

  it.each(['/ui', '/styleguide', '/error-test'])('has no %s route record', (route) => {
    const record = new RegExp('path:\\s*["\'`]' + route + '["\'`]')
    expect(text.filter(t => record.test(t.source)).map(t => t.path)).toEqual([])
  })

  it.each(MARKERS)('contains no %s', (marker) => {
    expect(text.filter(t => t.source.includes(marker)).map(t => t.path)).toEqual([])
  })
})
