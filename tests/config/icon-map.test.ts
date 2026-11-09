import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ICONS } from '~/lib/icons'

// Ratchet for the semantic icon map (#67). `lib/icons.ts` is the one place a mapped meaning names its
// icon; call sites bind `ICONS.<meaning>`. One notation: `i-ph-*`. The Iconify form `ph:<name>` is only
// valid in `nuxt.config.ts` (`icon.clientBundle.icons`). Comments count: reword a doc comment rather than
// whitelisting it. Walks the repo like icons-bundled.test.ts (same skip list).

const root = resolve(__dirname, '../..')
const SKIP_DIRS = new Set(['node_modules', 'src-tauri', 'tests', 'docs', 'release-notes', 'public'])
/** Files allowed to name a mapped glyph literally: the map itself and the Nuxt UI theme. */
const MAP_FILES = new Set(['lib/icons.ts', 'app.config.ts'])
const NOTATION_FILES = new Set(['nuxt.config.ts'])

// Every glyph a mapped meaning (or a competitor that lost, #67 Decisions) is drawn with.
const MAPPED_GLYPHS = [
  'caret-left', 'caret-left-bold', 'caret-right', 'caret-right-bold', 'arrow-left', 'arrow-right',
  'x', 'trash', 'archive', 'arrow-square-out', 'arrow-up-right', 'corners-out',
]

const LITERAL_NOTATION = /(?<![\w-])(?:i-)?ph:[a-z]/
const MAPPED_LITERAL = new RegExp(`(?<![\\w-])i-ph-(?:${MAPPED_GLYPHS.join('|')})(?![\\w-])`)

/** `ph:<name>` / `i-ph:<name>` spellings in `text`. */
export function findLiteralNotation(text: string): string[] {
  return text.split('\n').filter(line => LITERAL_NOTATION.test(line))
}

/** Lines of `text` that spell out a mapped glyph instead of using the map. */
export function findMappedLiterals(text: string): string[] {
  return text.split('\n').filter(line => MAPPED_LITERAL.test(line))
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

const rel = (file: string) => file.replace(`${root}/`, '')

describe('icon map ratchet', () => {
  it('app source uses the i-ph-* notation (ph:<name> only in nuxt.config.ts)', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      if (NOTATION_FILES.has(rel(file))) continue
      for (const line of findLiteralNotation(readFileSync(file, 'utf8'))) offenders.push(`${rel(file)}: ${line.trim()}`)
    }
    expect(offenders).toEqual([])
  })

  it('a mapped meaning never names its glyph outside lib/icons.ts and app.config.ts', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(root)) {
      if (MAP_FILES.has(rel(file))) continue
      for (const line of findMappedLiterals(readFileSync(file, 'utf8'))) offenders.push(`${rel(file)}: ${line.trim()}`)
    }
    expect(offenders).toEqual([])
  })

  it('catches offenders and lets the allowed spellings pass', () => {
    expect(findLiteralNotation('<UIcon name="ph:clock" />')).toHaveLength(1)
    expect(findLiteralNotation('<UIcon name="i-ph:clock" />')).toHaveLength(1)
    expect(findLiteralNotation('<UIcon name="i-ph-clock" /> x:y sm:max-w-md')).toEqual([])
    expect(findMappedLiterals('<UIcon name="i-ph-trash" />')).toHaveLength(1)
    expect(findMappedLiterals('icon: "i-ph-caret-left-bold"')).toHaveLength(1)
    expect(findMappedLiterals('<UIcon name="i-ph-x-circle" /> i-ph-trash-simple i-ph-caret-left-circle')).toEqual([])
    expect(findMappedLiterals('<UIcon :name="ICONS.delete" />')).toEqual([])
  })

  it('the map and its allowed files exist and use the notation', () => {
    for (const file of MAP_FILES) expect(readFileSync(join(root, file), 'utf8')).toContain('i-ph-')
    for (const glyph of Object.values(ICONS)) expect(glyph).toMatch(/^i-ph-[a-z0-9-]+$/)
  })

  it('every mapped glyph is a listed competitor, so the ratchet covers the whole map', () => {
    for (const glyph of Object.values(ICONS)) expect(MAPPED_GLYPHS).toContain(glyph.replace('i-ph-', ''))
  })

  it('the theme takes close and external from the map', async () => {
    vi.stubGlobal('defineAppConfig', (config: unknown) => config)
    const { default: config } = await import('~/app.config')
    const icons = (config as { ui: { icons: Record<string, string> } }).ui.icons
    expect(icons.close).toBe(ICONS.close)
    expect(icons.external).toBe(ICONS.external)
    vi.unstubAllGlobals()
  })
})
