import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MANIFEST_PATH, UI_CATEGORIES, UI_KINDS, buildManifest, catalogFiles, checkDocBlock, loadCatalogEntries, componentFiles, parseDocBlock, renderManifest } from '../../scripts/ui-manifest.mjs'

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

describe('docs/design/ui-manifest.json', () => {
  const manifest = buildManifest()

  it('lists every component with a kind and one category from the list', () => {
    expect(manifest.filter((entry: { source: string }) => entry.source === 'app').map((entry: { path: string }) => entry.path)).toEqual(componentFiles())
    for (const entry of manifest) {
      expect(UI_KINDS, entry.path).toContain(entry.kind)
      expect(UI_CATEGORIES, entry.path).toContain(entry.category)
    }
  })

  it('adds one row per Nuxt UI entry of catalog/ after the app rows, with the entry text and the names it declares (#66)', () => {
    const noSamples = new Set((loadCatalogEntries() as { entry: { component: string, noSamples?: string } }[]).filter(l => l.entry.noSamples).map(l => l.entry.component))
    const library = manifest.filter((entry: { source: string }) => entry.source === 'nuxt-ui')
    expect(library.map((entry: { path: string }) => entry.path)).toEqual(catalogFiles().filter(path => library.some((entry: { path: string }) => entry.path === path)))
    expect(manifest.slice(-library.length)).toEqual(library)
    for (const entry of library) {
      expect(entry.description, entry.name).not.toBe('')
      expect(UI_CATEGORIES, entry.name).toContain(entry.category)
      if (!noSamples.has(entry.name)) expect(entry.variants.length, entry.name).toBeGreaterThan(0)
    }
  })

  it('is deterministic', () => {
    expect(renderManifest(buildManifest())).toBe(renderManifest(manifest))
  })

  it('is up to date: run `npm run ui:manifest` after a doc-block edit', () => {
    expect(readFileSync(MANIFEST_PATH, 'utf8')).toBe(renderManifest(manifest))
  })
})
