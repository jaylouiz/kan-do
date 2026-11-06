import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import collections from '@iconify/collections/collections.json'

// Icons from a collection that is not bundled are fetched from api.iconify.design at runtime, which
// the desktop CSP blocks (ADR 012, #228, #261). Only `ph` and `simple-icons` are installed and bundled,
// so this is an allow-list: any other collection fails, whatever its name.
//
// The scan walks the repo instead of a folder list, so a new top-level folder is covered by default.
// `nuxt.config.ts` `icon.clientBundle.scan.globInclude` must name the same folders: keep the two in step.

const root = resolve(__dirname, '../..')
const BUNDLED = ['ph', 'simple-icons']
// Not app source: dependencies, build output, Rust, tests (their fixtures name foreign icons on purpose),
// docs and assets. Dot directories (.git, .nuxt, .output, .claude, ...) are skipped as well.
const SKIP_DIRS = new Set(['node_modules', 'src-tauri', 'tests', 'docs', 'release-notes', 'public'])

// `i-<collection>-<name>` class strings (also `i-<collection>:<name>`). The lookbehind rejects words
// that merely contain `i-` (`multi-line`, `foo-i-bar`).
const CLASS_ICON = /(?<![\w-])i-([a-z0-9]+(?:-[a-z0-9]+)*)(:[a-z0-9][a-z0-9-]*)?(?![\w:])/g
// `'<collection>:<name>'` icon ids. A bare `'x:y'` is also an event name, a Tailwind variant or a
// storage key, so only strings whose prefix is a real Iconify collection count.
const ICONIFY_COLLECTIONS = new Set(Object.keys(collections))
const ID_ICON = /['"`]([a-z][a-z0-9]*(?:-[a-z0-9]+)*):[a-z0-9][a-z0-9-]*['"`]/g

const isBundled = (collection: string) => BUNDLED.includes(collection)

/** Icon references in `text` whose collection is not bundled. */
export function findUnbundledIcons(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(CLASS_ICON)) {
    const [whole, rest, colonName] = m
    if (colonName) {
      if (!isBundled(rest ?? '')) found.push(whole)
    } else if (!BUNDLED.some(c => (rest ?? '').startsWith(`${c}-`))) {
      // `i-<name>` with a single segment (`i-beam`, `i-18n`) is not a collection-qualified icon
      if ((rest ?? '').includes('-')) found.push(whole)
    }
  }
  for (const m of text.matchAll(ID_ICON)) {
    const collection = m[1] ?? ''
    if (ICONIFY_COLLECTIONS.has(collection) && !isBundled(collection)) found.push(m[0])
  }
  return found
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name.startsWith('.') || SKIP_DIRS.has(entry.name) ? [] : sourceFiles(path)
    }
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe('icon collections', () => {
  it('source only names icons from the bundled collections (ph, simple-icons)', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      for (const hit of findUnbundledIcons(readFileSync(file, 'utf8'))) offenders.push(`${file.replace(`${root}/`, '')}: ${hit}`)
    }
    expect(offenders).toEqual([])
  })

  it('is an allow-list: a collection nobody listed (i-solar-home) is caught', () => {
    expect(findUnbundledIcons('<UIcon name="i-solar-home" />')).toEqual(['i-solar-home'])
    expect(findUnbundledIcons('class="i-madeup-collection-icon"')).toEqual(['i-madeup-collection-icon'])
    expect(findUnbundledIcons('<UIcon name="i-lucide:home" />')).toEqual(['i-lucide:home'])
    expect(findUnbundledIcons("icon: 'solar:home'")).toEqual(["'solar:home'"])
  })

  it('accepts the bundled collections', () => {
    expect(findUnbundledIcons('<UIcon name="i-ph-play" class="i-simple-icons-todoist" />')).toEqual([])
    expect(findUnbundledIcons('<UIcon name="i-ph:clock-countdown" />')).toEqual([])
    expect(findUnbundledIcons("icon: 'ph:play', brand: 'simple-icons:notion'")).toEqual([])
  })

  it('does not trip over words that merely contain "i-"', () => {
    expect(findUnbundledIcons('multi-line foo-i-bar anti-aliased a-i-b')).toEqual([])
    expect(findUnbundledIcons("emit('update:open'); 'sm:max-w-md'; 'app:mounted'; 'hover:bg-elevated'")).toEqual([])
  })

  it('walks the repo, so folders outside a hand-kept list are covered', () => {
    const files = sourceFiles(root).map(f => f.replace(`${root}/`, ''))
    for (const expected of ['middleware/todoistOAuth.ts', 'server/utils/notionStub.ts', 'app/router.options.ts', 'nuxt.config.ts', 'app.vue']) {
      expect(files).toContain(expected)
    }
    expect(files.some(f => f.startsWith('node_modules/') || f.startsWith('tests/') || f.startsWith('.nuxt/'))).toBe(false)
  })
})
