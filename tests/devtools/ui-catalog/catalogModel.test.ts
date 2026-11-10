import { describe, expect, it } from 'vitest'
import { buildMatrix, exampleProps, groupByCategory, resolveSlot, resolveValue, sampleKeys, themeAxes, type ManifestRow } from '~/dev-tools/ui-catalog/catalogModel'
import type { CatalogEntry } from '~/catalog/types'

const theme = {
  variants: {
    color: { primary: '', error: '' },
    variant: { solid: '', ghost: '' },
    size: { sm: '', md: '', lg: '' },
    block: { true: '', false: '' },
  },
  defaultVariants: { color: 'primary', variant: 'solid', size: 'sm' },
}

const row = (name: string, category: ManifestRow['category'], kind: ManifestRow['kind']): ManifestRow => ({
  name, path: `components/${name}.vue`, source: 'app', kind, category, tier: 'feature', area: 'app', description: '', usage: '', avoid: '', responsibility: [], variants: [], states: [], usedBy: {},
})

describe('groupByCategory', () => {
  it('orders the sections as the issue lists them, leaves empty ones out and puts blocks last', () => {
    const sections = groupByCategory([
      row('Zeta', 'layout', 'component'),
      row('Block', 'action', 'block'),
      row('Beta', 'action', 'primitive'),
      row('Alpha', 'action', 'component'),
      row('Field', 'input', 'primitive'),
    ])
    expect(sections.map(s => s.title)).toEqual(['Eingabe', 'Aktion', 'Layout'])
    expect(sections[1]!.rows.map(r => r.name)).toEqual(['Beta', 'Alpha', 'Block'])
  })
})

describe('themeAxes', () => {
  it('reads the values of each axis from the theme and marks the default', () => {
    const axes = themeAxes(theme, undefined, ['color', 'size'])
    expect(axes[0]!.values.map(v => v.value)).toEqual(['primary', 'error'])
    expect(axes[1]!.values.filter(v => v.isDefault).map(v => v.value)).toEqual(['sm'])
  })

  it('a value app.config.ts adds appears without an entry edit, and its default wins over the theme', () => {
    const axes = themeAxes(theme, { variants: { size: { xl: {} } }, defaultVariants: { size: 'md' } }, ['size'])
    expect(axes[0]!.values.map(v => v.value)).toEqual(['sm', 'md', 'lg', 'xl'])
    expect(axes[0]!.values.find(v => v.isDefault)?.value).toBe('md')
  })

  it('rejects an axis the theme does not know', () => {
    expect(() => themeAxes(theme, undefined, ['colour'])).toThrow(/no "colour" variant/)
  })
})

describe('buildMatrix', () => {
  const axes = themeAxes(theme, undefined, ['color', 'variant', 'size'])

  it('has every color x variant x size combination: sections by size, rows by color, columns by variant', () => {
    const sections = buildMatrix(axes, { label: 'x' })
    expect(sections.map(s => s.title)).toEqual(['size sm', 'size md', 'size lg'])
    const ids = sections.flatMap(s => s.rows.flatMap(r => r.cells.map(c => c.id)))
    expect(ids).toHaveLength(2 * 2 * 3)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('error/ghost/lg')
    expect(sections[1]!.rows[1]!.cells[0]!.props).toEqual({ label: 'x', color: 'error', variant: 'solid', size: 'md' })
  })

  it('narrows to one value per axis (the variant switcher) and keeps the ids', () => {
    const sections = buildMatrix(axes, undefined, { size: 'md', color: 'error' })
    expect(sections.map(s => s.title)).toEqual(['size md'])
    expect(sections[0]!.rows.map(r => r.value)).toEqual(['error'])
    expect(sections[0]!.cols).toEqual(['solid', 'ghost'])
  })

  it('lays out a single axis as one row', () => {
    const sections = buildMatrix(themeAxes(theme, undefined, ['size']), undefined)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.rows).toHaveLength(3)
  })
})

describe('copy resolution', () => {
  const t = (key: string) => `<${key}>`

  it('resolves { $t } in props, nested values and the slot', () => {
    expect(resolveValue({ label: { $t: 'a.b' }, nested: [{ $t: 'c' }, 'plain'] }, t)).toEqual({ label: '<a.b>', nested: ['<c>', 'plain'] })
    expect(resolveSlot({ $t: 'x' }, t)).toBe('<x>')
    expect(resolveSlot('Literal', t)).toBe('Literal')
    expect(resolveSlot(undefined, t)).toBeUndefined()
  })

  it('does not take an object with other keys for a reference', () => {
    expect(resolveValue({ $t: 'x', other: 1 }, t)).toEqual({ $t: 'x', other: 1 })
  })

  it('an overlay example renders open', () => {
    expect(exampleProps({ id: 'o', open: true, props: { title: { $t: 'k' } } }, t)).toEqual({ title: '<k>', open: true })
  })
})

describe('sampleKeys', () => {
  it('names every sample as component:group:id', () => {
    const entry: CatalogEntry = {
      component: 'UDemo', source: 'nuxt-ui', alternatives: [], theme: 'demo',
      matrix: { axes: ['color', 'size'] },
      variants: [{ id: 'plain' }],
      states: [{ id: 'disabled', state: 'disabled' }],
    }
    const keys = sampleKeys(entry, themeAxes(theme, undefined, ['color', 'size']))
    expect(keys).toHaveLength(2 * 3 + 2)
    expect(keys).toContain('UDemo:matrix:primary/sm')
    expect(keys.slice(-2)).toEqual(['UDemo:variant:plain', 'UDemo:state:disabled'])
  })
})
