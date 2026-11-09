import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildTokenCatalog, groupOf, splitRamps, summarizeAppConfig } from '../../../dev-tools/ui-catalog/tokens'

const root = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('groupOf', () => {
  it.each([
    ['--ui-text-muted', 'x', 'colors'],
    ['--focus-dusk', 'oklch(0.27 0.04 65)', 'colors'],
    ['--shadow-task', '1px 2px 4px red', 'shadows'],
    ['--ui-radius', '0.5rem', 'radius'],
    ['--task-card-radius', 'calc(var(--ui-radius) * 2)', 'radius'],
    ['--font-sans', 'Figtree', 'typography'],
    ['--lh-body', '1.55', 'typography'],
    ['--dnd-reorder-duration', '220ms', 'motion'],
    ['--sheet-fade-easing', 'cubic-bezier(0.2, 0, 0, 1)', 'motion'],
    ['--breakpoint-md', '48rem', 'breakpoints'],
    ['--task-list-gap', '0.75rem', 'spacing'],
    ['--task-card-width', '100%', 'spacing'],
    ['--stack-front-content-opacity', '0.4', 'other'],
    ['--task-card-border', '2px solid var(--color-white)', 'other'],
  ])('%s -> %s', (name, value, group) => {
    expect(groupOf(name, value)).toBe(group)
  })
})

describe('buildTokenCatalog (#65)', () => {
  it('lets a later source override an earlier one and remembers what it replaced', () => {
    const { tokens } = buildTokenCatalog([
      { file: 'default.css', css: ':root { --ui-radius: 0.25rem }' },
      { file: 'app.css', css: ':root {\n  --ui-radius: 0.5rem;\n}' },
    ])
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ value: '0.5rem', file: 'app.css', line: 2, replaces: { value: '0.25rem', file: 'default.css' } })
  })

  it('attaches media-query values to the base token, also from an earlier file, and skips .dark and component scopes', () => {
    const { tokens, scopedCount } = buildTokenCatalog([
      { file: 'a.css', css: '@media (max-width: 767px) { :root { --gap: 2rem } }' },
      { file: 'b.css', css: ':root { --gap: 1rem } .dark { --gap: 9rem } .card { --local: 1 }' },
    ])
    expect(tokens.map(t => t.name)).toEqual(['--gap'])
    expect(tokens[0]!.value).toBe('1rem')
    expect(tokens[0]!.responsive).toEqual([{ when: '@media (max-width: 767px)', value: '2rem', file: 'a.css', line: 1 }])
    expect(scopedCount).toBe(1)
  })

  it('takes only the listed families from a vendor theme and none of its colours', () => {
    const { tokens } = buildTokenCatalog([{ file: 'tw.css', vendor: 'tailwind', css: '@theme default { --color-red-50: #fff; --breakpoint-md: 48rem; --blur-sm: 8px; --text-xs: 0.75rem; --text-xs--line-height: 1.3 }' }])
    expect(tokens.map(t => t.name)).toEqual(['--breakpoint-md', '--text-xs', '--text-xs--line-height'])
  })

  it('collects numeric z-index literals of own sources only', () => {
    const { zIndexLiterals } = buildTokenCatalog([
      { file: 'tw.css', vendor: 'tailwind', css: '.x { z-index: 7 }' },
      { file: 'own.css', css: '.a { z-index: 40 } .b { z-index: auto } .c { z-index: calc(100 + 1) }' },
    ])
    expect(zIndexLiterals.map(d => [d.value, d.file])).toEqual([['40', 'own.css']])
  })

  it('reads the real sources: the tokens the issue names are found with their definition', () => {
    const catalog = buildTokenCatalog([
      { file: 'tailwindcss/theme.css', css: read('node_modules/tailwindcss/theme.css'), vendor: 'tailwind' },
      { file: 'assets/css/app-nav.css', css: read('assets/css/app-nav.css') },
      { file: 'assets/css/main.css', css: read('assets/css/main.css') },
    ])
    const by = (name: string) => catalog.tokens.find(t => t.name === name)
    expect(by('--task-list-gap')).toMatchObject({ group: 'spacing', value: '0.75rem', file: 'assets/css/main.css' })
    expect(by('--color-custom-ink-500')).toMatchObject({ group: 'colors', file: 'assets/css/main.css' })
    expect(by('--shadow-sheet')?.group).toBe('shadows')
    expect(by('--task-note-height')?.responsive).toHaveLength(1)
    expect(by('--breakpoint-md')).toMatchObject({ value: '48rem', file: 'tailwindcss/theme.css' })
    expect(by('--dnd-reorder-duration')?.group).toBe('motion')
    // an invented token is not there
    expect(by('--z-modal')).toBeUndefined()
  })
})

describe('splitRamps', () => {
  it('groups --color-<ramp>-<step> into ramps and leaves the rest', () => {
    const catalog = buildTokenCatalog([{ file: 'x.css', css: '@theme { --color-custom-ink-50: #fff; --color-custom-ink-100: #eee; --color-page: var(--ui-page-bg) }' }])
    const { ramps, rest } = splitRamps(catalog.tokens)
    expect(ramps.map(r => [r.name, r.steps.length])).toEqual([['custom-ink', 2]])
    expect(rest.map(t => t.name)).toEqual(['--color-page'])
  })
})

describe('summarizeAppConfig', () => {
  it('lists colour roles, radii and the components that carry defaults, slots or variants', () => {
    const summary = summarizeAppConfig({
      colors: { primary: 'custom-ink' },
      radius: { sm: '0.25rem' },
      icons: { close: 'i-ph-x' },
      modal: { slots: { header: 'x' }, variants: { overlay: {} } },
      button: { defaultVariants: { size: 'md', color: 'primary' } },
      weird: { nothing: 1 },
    })
    expect(summary.colorRoles).toEqual([{ role: 'primary', palette: 'custom-ink' }])
    expect(summary.radius).toEqual([{ key: 'sm', value: '0.25rem' }])
    expect(summary.components).toEqual([
      { name: 'button', defaultVariants: 'size: md, color: primary', slots: [], variants: [] },
      { name: 'modal', defaultVariants: '', slots: ['header'], variants: ['overlay'] },
    ])
  })
})
