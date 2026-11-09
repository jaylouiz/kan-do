/**
 * Entry types of the `/ui` Components part (#66, epic #58 D2): one `catalog/<category>/<Name>.catalog.ts` per
 * component declares its variants and states as data. The page (`dev-tools/ui-catalog/`) renders them; nothing here is
 * app code, and nothing outside `dev-tools/ui-catalog/` and `scripts/ui-manifest.mjs` imports an entry (the dev-only
 * guarantee of #65: `pages/ui.vue` is removed from every other build, and with it everything it reaches).
 *
 * Entries are plain data (`export default { ... } satisfies CatalogEntry`, only a type import from here), so Node can
 * read them without a bundler: `scripts/ui-manifest.mjs` loads them to put the library components and the variant and
 * state names into `docs/design/ui-manifest.json`.
 *
 * Description, usage and avoid of a custom component come from its doc block (the manifest); a Nuxt UI component has no
 * doc block, so its entry carries them (`source: 'nuxt-ui'`). Each text lives in exactly one place.
 */

/** Where a component comes from: this repo (`components/`, doc block) or the Nuxt UI library (entry carries the text). */
export type CatalogSource = 'app' | 'nuxt-ui'

/** Labels of a state example. The test rejects an entry that uses another one. */
export const CATALOG_STATES = ['disabled', 'loading', 'empty', 'error', 'focus', 'long-text', 'icon-only', 'selected', 'open'] as const
export type CatalogState = (typeof CATALOG_STATES)[number]

/** Same list as the `@kind` and `@category` grammar of the doc blocks (scripts/ui-manifest.mjs). */
export type CatalogKind = 'primitive' | 'component' | 'compound' | 'block'
export type CatalogCategory = 'input' | 'form-structure' | 'action' | 'navigation' | 'keyboard' | 'feedback' | 'overlay' | 'display' | 'layout'

/** Copy by i18n key: the page resolves it with the language toggle's locale, so de/en shows the other translation. */
export interface I18nRef {
  $t: string
}

export type CatalogValue = string | number | boolean | null | I18nRef | CatalogValue[] | { [key: string]: CatalogValue }
export type CatalogProps = Record<string, CatalogValue>

/** One rendered sample: props and the default slot of the component. */
export interface CatalogExample {
  /** Unique within the entry; also the fingerprint key. */
  id: string
  /** Shown above the sample; defaults to the id. */
  label?: string
  props?: CatalogProps
  /** Default slot content: text, or an i18n key. */
  slot?: string | I18nRef
  /** Overlays: the sample renders open (`open: true` is passed as a prop); they need a trigger or `open` to show at all. */
  open?: boolean
}

export interface CatalogStateExample extends CatalogExample {
  state: CatalogState
}

/** The theme-derived matrix of a Nuxt UI component: every combination of the listed theme axes (`color`, `variant`, `size`). */
export interface CatalogMatrix {
  /** Axis names as the merged theme names them. The first two are rows and columns, further axes split the grid into sections. */
  axes: string[]
  /** Props and slot every cell shares. */
  props?: CatalogProps
  slot?: string | I18nRef
}

export interface CatalogEntry {
  /** Component name as written in a template: `UButton`, `ExternalLink`. For an app component it equals the manifest `name`. */
  component: string
  source: CatalogSource
  /** `nuxt-ui` only; an app component takes these from its doc block. */
  kind?: CatalogKind
  category?: CatalogCategory
  description?: string
  usage?: string
  avoid?: string
  /** Names of other components that cover a neighbouring job (each must have a manifest row). */
  alternatives: string[]
  /** `nuxt-ui` only: the theme the matrix and the axis values are read from (`.nuxt/ui/<theme>.ts` merged with `app.config.ts`). */
  theme?: string
  matrix?: CatalogMatrix
  /** Named variants of an app component (the variants of a Nuxt UI component come from `matrix`). */
  variants?: CatalogExample[]
  states: CatalogStateExample[]
  /** Why the entry has no live sample (a block that reads a store, a composable or a page's data): shown instead of the samples; variants and states then stay empty. */
  sampleNote?: string
}
