import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { KIT_MIN_CONSUMERS, UI_CATEGORIES, UI_KINDS, areaOf, buildManifest, catalogFiles, checkDocBlock, loadCatalogEntries, componentFiles, parseDocBlock, tierOf, usedValues } from '../../scripts/ui-manifest.mjs'

const block = (extra = '') => `<!--
@component Demo
@kind primitive
@category display
@description One line
continued
@usage Used in a page
@avoid Not for forms; use Other
@responsibility
- First duty
  that continues
- Second duty${extra}
-->
<template><div /></template>
`

describe('parseDocBlock', () => {
  it('reads tags and joins continuation lines', () => {
    const tags = parseDocBlock(block())!
    expect(tags.component).toBe('Demo')
    expect(tags.kind).toBe('primitive')
    expect(tags.description).toBe('One line\ncontinued')
    expect(tags.responsibility).toBe('- First duty\n  that continues\n- Second duty')
  })

  it('does not take an @-word inside a value for a tag', () => {
    const tags = parseDocBlock('<!--\n@component A\n@description Uses\n@dnd-kit/vue here\n-->')!
    expect(tags.description).toContain('@dnd-kit/vue')
  })

  it('returns null without a leading doc block', () => {
    expect(parseDocBlock('<template />')).toBeNull()
  })
})

describe('checkDocBlock', () => {
  it('accepts a complete block', () => {
    expect(checkDocBlock(block())).toEqual([])
  })

  it('names the missing tags and unknown values', () => {
    const source = block().replace('@kind primitive', '@kind widget').replace('@category display', '@category looks').replace(/@avoid .*\n/, '')
    expect(checkDocBlock(source)).toEqual([
      'missing @avoid',
      expect.stringContaining('@kind "widget"'),
      expect.stringContaining('@category "looks"'),
    ])
  })
})

describe('tier and area (derived, never tagged)', () => {
  const usedBy = (components: number) => ({ components, pages: 0, layouts: 0, app: 0 })

  it('a Nuxt UI component and everything under components/ui/ is kit', () => {
    expect(tierOf({ source: 'nuxt-ui', path: 'catalog/action/UButton.catalog.ts', usedBy: usedBy(0) })).toBe('kit')
    expect(tierOf({ source: 'app', path: 'components/ui/inline/InlineEditable.vue', usedBy: usedBy(1) })).toBe('kit')
  })

  it('another app component is kit from three consumers on, a feature part below', () => {
    const row = (count: number) => ({ source: 'app', path: 'components/task/TaskCard.vue', usedBy: usedBy(count) })
    expect(KIT_MIN_CONSUMERS).toBe(3)
    expect(tierOf(row(3))).toBe('kit')
    expect(tierOf(row(2))).toBe('feature')
  })

  it('the area is the folder under components/', () => {
    expect(areaOf({ source: 'app', path: 'components/notion/setup/wizard/steps/TokenStep.vue' })).toBe('notion')
    expect(areaOf({ source: 'app', path: 'components/CommandPalette.vue' })).toBe('app')
    expect(areaOf({ source: 'nuxt-ui', path: 'catalog/action/UButton.catalog.ts' })).toBe('nuxt-ui')
  })

  it('the manifest carries both on every row, and the kit stays the small part', () => {
    const manifest = buildManifest() as { tier: string, area: string, name: string }[]
    expect(manifest.every(row => ['kit', 'feature'].includes(row.tier) && row.area)).toBe(true)
    const kit = manifest.filter(row => row.tier === 'kit').map(row => row.name)
    expect(kit).toEqual(expect.arrayContaining(['UButton', 'ListRow', 'TaskCard', 'TopicMark']))
    expect(kit).not.toContain('NewCardFlow')
    expect(kit.length).toBeLessThan(manifest.length / 2)
  })
})

describe('usedValues (kd#127: /ui shows what the app uses first)', () => {
  const sources: [string, string][] = [
    ['a.vue', '<UButton size="sm" color="neutral" :variant="quiet" class="x">A</UButton>\n<UButton\n  size="lg"\n  icon="i-ph-x"\n/>'],
    ['b.vue', '<LazyUButton size="sm" variant="ghost" /><UButtonGroup size="xl" />'],
  ]

  it('collects the static values of the asked props across tags, multi-line and Lazy included', () => {
    expect(usedValues('UButton', sources, ['color', 'variant', 'size'])).toEqual({ color: ['neutral'], size: ['lg', 'sm'], variant: ['ghost'] })
  })

  it('leaves out bound props, other props and other components', () => {
    expect(usedValues('UButton', sources, ['size'])).toEqual({ size: ['lg', 'sm'] })
    expect(usedValues('UBadge', sources, ['size'])).toEqual({})
  })

  it('the manifest carries it on library rows only', () => {
    const manifest = buildManifest() as { name: string, source: string, usedValues?: Record<string, string[]> }[]
    expect(manifest.find(row => row.name === 'UButton')!.usedValues!.size).toEqual(expect.arrayContaining(['sm', 'lg']))
    expect(manifest.filter(row => row.source === 'app').every(row => row.usedValues === undefined)).toBe(true)
  })
})

describe('the derived manifest (#117: no committed file)', () => {
  const manifest = buildManifest()

  it('lists every component with a kind and one category from the list', () => {
    expect(manifest.filter((entry: { source: string }) => entry.source === 'app').map((entry: { path: string }) => entry.path)).toEqual(componentFiles())
    for (const entry of manifest) {
      expect(UI_KINDS, entry.path).toContain(entry.kind)
      expect(UI_CATEGORIES, entry.path).toContain(entry.category)
    }
  })

  it('adds one row per Nuxt UI entry of catalog/ after the app rows, with the entry text and the names it declares (#66)', () => {
    const sampleNote = new Set((loadCatalogEntries() as { entry: { component: string, sampleNote?: string } }[]).filter(l => l.entry.sampleNote).map(l => l.entry.component))
    const library = manifest.filter((entry: { source: string }) => entry.source === 'nuxt-ui')
    expect(library.map((entry: { path: string }) => entry.path)).toEqual(catalogFiles().filter(path => library.some((entry: { path: string }) => entry.path === path)))
    expect(manifest.slice(-library.length)).toEqual(library)
    for (const entry of library) {
      expect(entry.description, entry.name).not.toBe('')
      expect(UI_CATEGORIES, entry.name).toContain(entry.category)
      if (!sampleNote.has(entry.name)) expect(entry.variants.length, entry.name).toBeGreaterThan(0)
    }
  })

  it('is deterministic', () => {
    expect(JSON.stringify(buildManifest())).toBe(JSON.stringify(manifest))
  })

  it('is no committed file: a stale copy is what made clean merges of parallel UI PRs fail (#117)', () => {
    expect(existsSync(join(__dirname, '../../docs/design/ui-manifest.json'))).toBe(false)
  })
})
