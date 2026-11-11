/**
 * Pure logic of the `/ui` Components part (#66): which component sits in which section, which axis values a Nuxt UI
 * theme defines, which samples a matrix or an entry produces, and how copy given as an i18n key resolves. Nothing here
 * touches the DOM or Nuxt, so vitest covers it directly (tests/dev-tools/ui-catalog-model.test.ts).
 */
import type { CatalogCategory, CatalogEntry, CatalogExample, CatalogProps, CatalogValue, I18nRef } from '~/catalog/types'

/** One row of the manifest (`buildManifest()` in scripts/ui-manifest.mjs). */
export interface ManifestRow {
  name: string
  path: string
  source: 'app' | 'nuxt-ui'
  kind: 'primitive' | 'component' | 'compound' | 'block'
  category: CatalogCategory
  /** Derived by the manifest: `kit` (Nuxt UI, `components/ui/`, three or more consumers) or `feature` (serves one screen). */
  tier: 'kit' | 'feature'
  /** Folder under `components/`, `app` for the root, `nuxt-ui` for a library component. */
  area: string
  description: string
  usage: string
  avoid: string
  responsibility: string[]
  variants: string[]
  states: string[]
  usedBy: Record<string, number>
  /** Library rows only: the static prop values the app's templates pass (`size: ['lg', 'sm']`). */
  usedValues?: Record<string, string[]>
}

/** Display titles of the sections, in page order (epic #58 D2; the page chrome is English, these are the app's own names for the groups). */
export const CATEGORY_TITLES: Record<CatalogCategory, string> = {
  'input': 'Eingabe',
  'action': 'Aktion',
  'navigation': 'Navigation',
  'feedback': 'Feedback',
  'overlay': 'Overlay',
  'display': 'Darstellung',
  'layout': 'Layout',
}

/** Within a section blocks come last, under the components that contain them. */
const KIND_ORDER: ManifestRow['kind'][] = ['primitive', 'component', 'compound', 'block']

export interface CategorySection {
  category: CatalogCategory
  title: string
  rows: ManifestRow[]
}

/** The manifest grouped into sections in the order of `CATEGORY_TITLES`; empty sections are left out; rows sort by kind (blocks last), then name. */
export function groupByCategory(rows: ManifestRow[]): CategorySection[] {
  return (Object.keys(CATEGORY_TITLES) as CatalogCategory[])
    .map(category => ({
      category,
      title: CATEGORY_TITLES[category],
      rows: rows
        .filter(row => row.category === category)
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)),
    }))
    .filter(section => section.rows.length > 0)
}

export const isI18nRef = (value: unknown): value is I18nRef =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as I18nRef).$t === 'string' && Object.keys(value).length === 1

/** Replaces every `{ $t: key }` in a value (props, nested objects, arrays) by the translation. */
export function resolveValue(value: CatalogValue, t: (key: string) => string): CatalogValue {
  if (isI18nRef(value)) return t(value.$t)
  if (Array.isArray(value)) return value.map(item => resolveValue(item, t))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item as CatalogValue, t)]))
  }
  return value
}

export function resolveProps(props: CatalogProps | undefined, t: (key: string) => string): Record<string, CatalogValue> {
  return props ? (resolveValue(props, t) as Record<string, CatalogValue>) : {}
}

export function resolveSlot(slot: string | I18nRef | undefined, t: (key: string) => string): string | undefined {
  if (slot === undefined) return undefined
  return typeof slot === 'string' ? slot : t(slot.$t)
}

/** The shape of a Nuxt UI theme file (`.nuxt/ui/<name>.ts`) and of an `app.config.ts` override that this page reads. */
export interface ThemeLike {
  variants?: Record<string, Record<string, unknown>>
  defaultVariants?: Record<string, unknown>
}

export interface ThemeAxis {
  axis: string
  values: { value: string, isDefault: boolean }[]
}

/**
 * The values of each requested axis in the merged theme: the keys the generated theme defines, plus keys `app.config.ts` adds, so a
 * new colour, variant or size appears without an edit of the entry. The default comes from the config over the theme.
 * An axis the theme does not know is an error: the entry names an axis that does not exist.
 */
export function themeAxes(theme: ThemeLike, config: ThemeLike | undefined, axes: string[], only?: Record<string, string[]>): ThemeAxis[] {
  return axes.map((axis) => {
    const fromTheme = theme.variants?.[axis]
    if (!fromTheme) throw new Error(`The theme has no "${axis}" variant (axes: ${Object.keys(theme.variants ?? {}).join(', ')})`)
    const allowed = only?.[axis]
    const keys = [...new Set([...Object.keys(fromTheme), ...Object.keys(config?.variants?.[axis] ?? {})])].filter(key => !allowed || allowed.includes(key))
    const fallback = config?.defaultVariants?.[axis] ?? theme.defaultVariants?.[axis]
    return { axis, values: keys.map(value => ({ value, isDefault: String(fallback) === value })) }
  })
}

/**
 * The axes narrowed to what the app uses: the values its templates pass plus the theme default. An axis nothing sets
 * keeps only its default; one whose used values the theme does not know keeps all (a bound prop, not a static one).
 */
export function axesInUse(axes: ThemeAxis[], used: Record<string, string[]> | undefined): ThemeAxis[] {
  return axes.map((axis) => {
    const wanted = new Set(used?.[axis.axis] ?? [])
    const values = axis.values.filter(v => v.isDefault || wanted.has(v.value))
    return { axis: axis.axis, values: values.length ? values : axis.values }
  })
}

/** `''` shows every value of an axis. */
export type AxisFilter = Record<string, string>

export interface MatrixCell {
  /** `<axis values joined by />`, e.g. `primary/solid/md`; also the fingerprint key part. */
  id: string
  /** Column header value (the second axis). */
  col: string
  props: Record<string, CatalogValue>
}

export interface MatrixRow {
  value: string
  cells: MatrixCell[]
}

export interface MatrixSection {
  /** `size md`: the values of the axes beyond the first two; `''` when the matrix has only two axes. */
  title: string
  cols: string[]
  rows: MatrixRow[]
}

/**
 * Lays the matrix out: the first axis is the rows, the second the columns, every combination of the others its own section.
 * `filter` narrows an axis to one value (the variant switcher). Fewer than two axes still works: a single axis is one row.
 */
export function buildMatrix(axes: ThemeAxis[], base: CatalogProps | undefined, filter: AxisFilter = {}): MatrixSection[] {
  const pick = (axis: ThemeAxis | undefined) => (axis ? axis.values.map(v => v.value).filter(v => !filter[axis.axis] || filter[axis.axis] === v) : [''])
  const [rowAxis, colAxis, ...rest] = axes
  const sections = rest.reduce<Record<string, string>[]>(
    (combos, axis) => combos.flatMap(combo => pick(axis).map(value => ({ ...combo, [axis.axis]: value }))),
    [{}],
  )
  const rowValues = pick(rowAxis)
  const colValues = pick(colAxis)
  return sections.map(fixed => ({
    title: Object.entries(fixed).map(([axis, value]) => `${axis} ${value}`).join(' · '),
    cols: colValues,
    rows: rowValues.map(row => ({
      value: row,
      cells: colValues.map((col) => {
        const chosen = { ...(rowAxis ? { [rowAxis.axis]: row } : {}), ...(colAxis ? { [colAxis.axis]: col } : {}), ...fixed }
        return {
          id: axes.map(axis => chosen[axis.axis]).join('/'),
          col,
          props: { ...base, ...chosen },
        }
      }),
    })),
  }))
}

/**
 * The matrix as the app uses it, small enough to take in at once: one grid of the first two axes with every further
 * axis at its default, then one strip per further axis that walks its other values with the rest at their defaults.
 * Every cell id also exists in `buildMatrix`, and none repeats, so the samples keep their fingerprint keys.
 */
export function buildCompactMatrix(axes: ThemeAxis[], base: CatalogProps | undefined): MatrixSection[] {
  const fallback = (axis: ThemeAxis) => (axis.values.find(v => v.isDefault) ?? axis.values[0])?.value ?? ''
  const defaults: Record<string, string> = Object.fromEntries(axes.map(axis => [axis.axis, fallback(axis)]))
  const cell = (chosen: Record<string, string>, col: string): MatrixCell => ({ id: axes.map(axis => chosen[axis.axis]).join('/'), col, props: { ...base, ...chosen } })
  const [rowAxis, colAxis, ...rest] = axes
  if (!rowAxis) return []
  const cols = colAxis ? colAxis.values.map(v => v.value) : ['']
  const main: MatrixSection = {
    title: rest.map(axis => `${axis.axis} ${defaults[axis.axis]}`).join(' · '),
    cols,
    rows: rowAxis.values.map(row => ({
      value: row.value,
      cells: cols.map(col => cell({ ...defaults, [rowAxis.axis]: row.value, ...(colAxis ? { [colAxis.axis]: col } : {}) }, col)),
    })),
  }
  const strips = rest
    .map((axis) => {
      const others = axis.values.map(v => v.value).filter(value => value !== defaults[axis.axis])
      return {
        title: `${axis.axis}, other values`,
        cols: others,
        rows: [{ value: [defaults[rowAxis.axis], colAxis ? defaults[colAxis.axis] : ''].filter(Boolean).join(' '), cells: others.map(value => cell({ ...defaults, [axis.axis]: value }, value)) }],
      }
    })
    .filter(strip => strip.cols.length > 0)
  return [main, ...strips]
}

/** Every sample id an entry produces for a theme (matrix, variants, states), as `<component>:<group>:<id>`; the fingerprint spec and the vitest test both key on it. */
export function sampleKeys(entry: CatalogEntry, axes: ThemeAxis[]): string[] {
  const keys: string[] = []
  if (entry.matrix) {
    for (const section of buildMatrix(axes, entry.matrix.props)) {
      for (const row of section.rows) for (const cell of row.cells) keys.push(`${entry.component}:matrix:${cell.id}`)
    }
  }
  for (const variant of entry.variants ?? []) keys.push(`${entry.component}:variant:${variant.id}`)
  for (const state of entry.states) keys.push(`${entry.component}:state:${state.id}`)
  return keys
}

/** Props of an example as the page renders them: `open: true` adds the prop an overlay needs to show itself. */
export function exampleProps(example: CatalogExample, t: (key: string) => string): Record<string, CatalogValue> {
  const props = resolveProps(example.props, t)
  return example.open ? { ...props, open: true } : props
}
