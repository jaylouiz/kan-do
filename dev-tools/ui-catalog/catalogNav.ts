/**
 * Pure navigation model of `/ui` (kd#127): which view the address names, what the sidebar lists, how the overview groups
 * and filters the components and which sample stands for a component on its tile. Nothing here touches the DOM or
 * Nuxt, so vitest covers it directly (tests/devtools/ui-catalog/catalogNav.test.ts).
 *
 * The page is one route. `?v=` names the view (`tokens`, `tokens.<group>`, `kit`, `kit.<category>`, `parts`,
 * `parts.<area>`, `all`), `?c=<Name>` opens one component, `?q=` filters by words. No `v` is the overview.
 */
import type { CatalogCategory, CatalogEntry, CatalogExample } from '~/catalog/types'
import { CATEGORY_TITLES, type ManifestRow, type ThemeAxis } from './catalogModel'

export type CatalogView
  = | { kind: 'overview' }
    | { kind: 'tokens', group?: string }
    | { kind: 'kit', category?: CatalogCategory }
    | { kind: 'parts', area?: string }
    | { kind: 'all' }
    | { kind: 'component', name: string }

type Query = Record<string, unknown>
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** The view an address names. An unknown component, category or area falls back to the nearest thing that exists. */
export function parseView(query: Query, rows: ManifestRow[]): CatalogView {
  const name = text(query.c)
  if (name && rows.some(row => row.name === name)) return { kind: 'component', name }
  const [head, tail] = text(query.v).split('.', 2)
  if (head === 'tokens') return { kind: 'tokens', group: tail || undefined }
  if (head === 'all') return { kind: 'all' }
  if (head === 'kit') {
    return { kind: 'kit', category: tail && tail in CATEGORY_TITLES ? (tail as CatalogCategory) : undefined }
  }
  if (head === 'parts') {
    return { kind: 'parts', area: tail && rows.some(row => row.tier === 'feature' && row.area === tail) ? tail : undefined }
  }
  return { kind: 'overview' }
}

/** The query that names a view; the overview is the bare address. */
export function viewQuery(view: CatalogView): Record<string, string> {
  if (view.kind === 'component') return { c: view.name }
  if (view.kind === 'tokens') return { v: view.group ? `tokens.${view.group}` : 'tokens' }
  if (view.kind === 'kit') return { v: view.category ? `kit.${view.category}` : 'kit' }
  if (view.kind === 'parts') return { v: view.area ? `parts.${view.area}` : 'parts' }
  if (view.kind === 'all') return { v: 'all' }
  return {}
}

/** The sections of the Tokens part, in page order: the sidebar lists them and the part takes its titles from here. */
export const TOKEN_SECTIONS: { id: string, title: string }[] = [
  { id: 'roles', title: 'Semantic colour roles' },
  { id: 'palettes', title: 'Palettes' },
  { id: 'colors', title: 'Surfaces and colour tokens' },
  { id: 'typography', title: 'Typography' },
  { id: 'radius', title: 'Radii' },
  { id: 'shadows', title: 'Shadows' },
  { id: 'spacing', title: 'Spacing and sizes' },
  { id: 'zIndex', title: 'Z-index' },
  { id: 'motion', title: 'Motion' },
  { id: 'breakpoints', title: 'Breakpoints' },
  { id: 'iconSizes', title: 'Icon sizes' },
  { id: 'other', title: 'Other custom properties' },
  { id: 'components', title: 'Component defaults from app.config' },
]
export const tokenSectionTitle = (id: string) => TOKEN_SECTIONS.find(section => section.id === id)?.title ?? id

/** Display names of the feature areas (the folders under `components/`); an area not listed shows its folder name. */
export const AREA_TITLES: Record<string, string> = {
  app: 'App',
  board: 'Board',
  task: 'Task',
  topic: 'Topic',
  recap: 'New-day recap',
  statistics: 'Statistics',
  trash: 'Trash',
  settings: 'Settings',
  setup: 'Setup',
  notion: 'Notion',
  sync: 'Sync',
  nav: 'App bar',
  feedback: 'Feedback',
  updates: 'Updates',
}
export const areaTitle = (area: string) => AREA_TITLES[area] ?? area

const KIND_ORDER: ManifestRow['kind'][] = ['primitive', 'component', 'compound', 'block']
const byKindThenName = (a: ManifestRow, b: ManifestRow) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)

export interface CatalogGroup {
  /** `kit.<category>` or `parts.<area>`: also the `v` value that shows only this group. */
  id: string
  title: string
  rows: ManifestRow[]
}

/** The kit by category, in the order of `CATEGORY_TITLES`; library and app components together, smallest kind first. */
export function kitGroups(rows: ManifestRow[]): CatalogGroup[] {
  return (Object.keys(CATEGORY_TITLES) as CatalogCategory[])
    .map(category => ({
      id: `kit.${category}`,
      title: CATEGORY_TITLES[category],
      rows: rows.filter(row => row.tier === 'kit' && row.category === category).sort(byKindThenName),
    }))
    .filter(group => group.rows.length > 0)
}

/** The feature parts by area: the areas `AREA_TITLES` names first, in that order, then any other by name. */
export function partGroups(rows: ManifestRow[]): CatalogGroup[] {
  const parts = rows.filter(row => row.tier === 'feature')
  const known = Object.keys(AREA_TITLES)
  const areas = [...new Set(parts.map(row => row.area))].sort((a, b) => {
    const [ia, ib] = [known.indexOf(a), known.indexOf(b)]
    return (ia < 0 ? known.length : ia) - (ib < 0 ? known.length : ib) || a.localeCompare(b)
  })
  return areas.map(area => ({ id: `parts.${area}`, title: areaTitle(area), rows: parts.filter(row => row.area === area).sort(byKindThenName) }))
}

/** Lowercased words of a search text; an empty list matches everything. */
export const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Every word must sit in the name, description, usage, category title or area of the row. */
export function matchesSearch(row: ManifestRow, words: string[]): boolean {
  if (words.length === 0) return true
  const haystack = [row.name, row.description, row.usage, row.kind, CATEGORY_TITLES[row.category], row.category, areaTitle(row.area)].join(' ').toLowerCase()
  return words.every(word => haystack.includes(word))
}

/** The groups with only the rows a search matches; groups left empty drop out. */
export function filterGroups(groups: CatalogGroup[], words: string[]): CatalogGroup[] {
  if (words.length === 0) return groups
  return groups.map(group => ({ ...group, rows: group.rows.filter(row => matchesSearch(row, words)) })).filter(group => group.rows.length > 0)
}

/** Where a component sits: the group its tile is in, for the breadcrumb and the sidebar highlight. */
export function groupOfRow(row: ManifestRow): { tier: 'kit' | 'parts', id: string, title: string } {
  return row.tier === 'kit'
    ? { tier: 'kit', id: `kit.${row.category}`, title: CATEGORY_TITLES[row.category] }
    : { tier: 'parts', id: `parts.${row.area}`, title: areaTitle(row.area) }
}

/** The components before and after one in its group, for stepping through a category without going back. */
export function neighbours(row: ManifestRow, rows: ManifestRow[]): { previous?: ManifestRow, next?: ManifestRow } {
  const group = [...kitGroups(rows), ...partGroups(rows)].find(candidate => candidate.id === groupOfRow(row).id)
  const index = group?.rows.findIndex(candidate => candidate.name === row.name) ?? -1
  if (!group || index < 0) return {}
  return { previous: group.rows[index - 1], next: group.rows[index + 1] }
}

export interface TilePreview {
  /** The example to render, or the default cell of a matrix. */
  example: CatalogExample
  /** `state` when the example is one of the entry's states: a focus sample is not focused on a tile. */
  group: 'matrix' | 'variant' | 'state'
}

/**
 * The one sample that stands for a component on its tile: the default cell of a library matrix, else the first variant,
 * else the first state. `undefined` for an entry without samples, an overlay that opens from a button (a closed button
 * says nothing about the overlay) and a component without an entry.
 */
export function tilePreview(entry: CatalogEntry | undefined, axes: ThemeAxis[]): TilePreview | undefined {
  if (!entry || entry.sampleNote || entry.launch) return undefined
  if (entry.matrix) {
    const defaults = Object.fromEntries(axes.map(axis => [axis.axis, (axis.values.find(v => v.isDefault) ?? axis.values[0])?.value ?? '']))
    return { group: 'matrix', example: { id: 'default', props: { ...entry.matrix.props, ...defaults }, slot: entry.matrix.slot } }
  }
  const variant = entry.variants?.[0]
  if (variant) return { group: 'variant', example: variant }
  const state = entry.states[0]
  return state ? { group: 'state', example: state } : undefined
}
