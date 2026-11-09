import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { buildManifest, catalogFiles, loadCatalogEntries } from '../../../scripts/ui-manifest.mjs'
import type { CatalogEntry } from '~/catalog/types'
import { entryProblems, LANDED_CATEGORIES, missingEntries } from '~/dev-tools/ui-catalog/validateEntry'
import type { ManifestRow } from '~/dev-tools/ui-catalog/catalogModel'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'

const ROOT = resolve(__dirname, '../../..')
const manifest = buildManifest() as ManifestRow[]
const loaded = loadCatalogEntries() as { path: string, entry: CatalogEntry }[]

function keysOf(messages: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    value && typeof value === 'object' ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`])
}
const locales = { de: new Set(keysOf(de)), en: new Set(keysOf(en)) }

function files(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) return []
    return statSync(path).isDirectory() ? files(path, accept) : accept(name) ? [path] : []
  })
}

describe('catalog entries (#66)', () => {
  it('ships entries for the proofs (UButton, ExternalLink), the Aktion slice (#71), the Darstellung slice (#76) and the feedback slice (#74), library components included', () => {
    const names = loaded.map(l => l.entry.component)
    expect(names).toEqual(expect.arrayContaining([
      'ExternalLink', 'UButton', 'ListRow', 'UBadge', 'UCard', 'UTable', 'UCollapsible', 'TaskCard', 'UAlert', 'EmptyNote',
      'AddTaskSlot', 'ColumnSortingControl', 'DataExportImport', 'TaskCardContextMenu', 'TaskCarryOverTriage', 'TaskTimeboxNudge', 'UDropdownMenu', 'ULink',
    ]))
  })

  it.each(loaded.map(l => [l.path, l.entry] as const))('%s validates against the manifest', (path, entry) => {
    expect(entryProblems(path, entry, manifest, locales)).toEqual([])
  })

  it('the manifest rows of the entries carry their variant and state names', () => {
    const button = manifest.find(r => r.name === 'UButton')!
    expect(button.source).toBe('nuxt-ui')
    expect(button.variants).toEqual(['color', 'variant', 'size'])
    expect(button.states).toEqual(['disabled', 'loading', 'focus', 'icon-only', 'long-text'])
    expect(manifest.find(r => r.name === 'ExternalLink')!.states).toContain('long-text')
  })

  it('fails on an entry whose component has no manifest row', () => {
    const { path, entry } = loaded[0]!
    expect(entryProblems(path, { ...entry, component: 'Nope' }, manifest)).toEqual(expect.arrayContaining([expect.stringContaining('Nope has no manifest row')]))
  })

  it('fails on an unknown state label, a repeated id, a wrong folder and a missing translation', () => {
    const entry = loaded.find(l => l.entry.component === 'UButton')!.entry
    const bad = { ...entry, states: [{ id: 'a', state: 'wobbly' }, { id: 'a', state: 'disabled', slot: { $t: 'no.such.key' } }] } as unknown as CatalogEntry
    const problems = entryProblems('catalog/input/UButton.catalog.ts', bad, manifest, locales)
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('unknown state "wobbly"'),
      expect.stringContaining('"a" is used twice'),
      expect.stringContaining('folder must be catalog/action/'),
      expect.stringContaining('no.such.key is missing in de'),
    ]))
  })

  it('an entry without samples says why, and one with samples does not (#71)', () => {
    const base = { component: 'TaskTimeboxNudge', source: 'app', alternatives: [], states: [] } as CatalogEntry
    const path = 'catalog/action/TaskTimeboxNudge.catalog.ts'
    expect(entryProblems(path, base, manifest)).toEqual(expect.arrayContaining([expect.stringContaining('sampleNote')]))
    expect(entryProblems(path, { ...base, sampleNote: 'needs the board store' }, manifest)).toEqual([])
    const withSamples = { ...base, sampleNote: 'x', states: [{ id: 'focus', state: 'focus' }] } as CatalogEntry
    expect(entryProblems(path, withSamples, manifest)).toEqual(expect.arrayContaining([expect.stringContaining('has samples')]))
  })

  it('a trigger example without a slot is rejected, as it would render nothing (#75)', () => {
    const entry = { component: 'UModal', source: 'nuxt-ui', theme: 'modal', alternatives: [], states: [], variants: [{ id: 'trigger', trigger: true }] } as CatalogEntry
    expect(entryProblems('catalog/overlay/UModal.catalog.ts', entry, manifest)).toEqual(expect.arrayContaining([expect.stringContaining('no slot')]))
  })

  it('a landed category needs an entry for each of its manifest components; a category that has not landed does not', () => {
    expect(LANDED_CATEGORIES).toEqual(['action', 'display', 'feedback', 'overlay']) // the category slices (#71 to #77) add theirs here
    expect(missingEntries(manifest, loaded.map(l => l.entry))).toEqual([])
    const missing = missingEntries(manifest, loaded.map(l => l.entry), ['navigation'])
    expect(missing).toContain('AppNav')
    expect(missing.length).toBeGreaterThan(0)
  })

  it('app entries leave their text to the doc block, so no description string is typed twice', () => {
    const sources = [
      'pages/ui.vue',
      ...files(join(ROOT, 'dev-tools/ui-catalog'), name => /\.(vue|ts)$/.test(name)).map(path => relative(ROOT, path)),
      ...catalogFiles(),
    ]
    const texts = new Map(sources.map(path => [path, readFileSync(join(ROOT, path), 'utf8').replace(/\s+/g, ' ')]))
    const offenders: string[] = []
    for (const row of manifest) {
      for (const field of ['description', 'usage', 'avoid'] as const) {
        const text = row[field]
        if (text.length < 20) continue
        for (const [path, source] of texts) {
          // a library entry is the one place its own text lives
          if (row.source === 'nuxt-ui' && path === row.path) continue
          if (source.includes(text)) offenders.push(`${row.name}.${field} also sits in ${path}`)
        }
      }
    }
    expect(offenders).toEqual([])
    // and a library entry's text is no doc block's
    const docBlocks = files(join(ROOT, 'components'), name => name.endsWith('.vue')).map(path => readFileSync(path, 'utf8').replace(/\s+/g, ' '))
    for (const row of manifest.filter(r => r.source === 'nuxt-ui')) {
      for (const field of ['description', 'usage', 'avoid'] as const) {
        expect(docBlocks.filter(block => block.includes(row[field])), `${row.name}.${field}`).toEqual([])
      }
    }
  })

  it('catalog/ is imported only from dev-tools/ui-catalog/ (the dev-only guarantee of #65 covers it through pages/ui.vue)', () => {
    const importsCatalog = /['"`](?:~|@|(?:\.\.?\/)+)\/?(?:\.\.\/)*catalog\//
    const roots = ['components', 'composables', 'layouts', 'lib', 'middleware', 'pages', 'plugins', 'store', 'types', 'utils', 'integrations', 'server', 'i18n']
    const offenders = [
      ...roots.flatMap(dir => (existsSync(join(ROOT, dir)) ? files(join(ROOT, dir), name => /\.(vue|ts)$/.test(name)) : [])),
      join(ROOT, 'app.vue'),
      join(ROOT, 'nuxt.config.ts'),
    ].filter(path => importsCatalog.test(readFileSync(path, 'utf8')))
    expect(offenders.map(path => relative(ROOT, path))).toEqual([])
    expect(readFileSync(join(ROOT, 'pages/ui.vue'), 'utf8')).toContain('dev-tools/ui-catalog/ComponentsPart.vue')
  })
})
