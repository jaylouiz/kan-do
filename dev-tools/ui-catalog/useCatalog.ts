/**
 * Loads what the `/ui` Components views render (kd#127, engine of #66): the manifest rows, each entry under `catalog/`,
 * the component an entry names (app component by its manifest path, Nuxt UI component from the library), the theme axes
 * of a library matrix and the fixtures its examples ask for. One load per page visit, shared by every view.
 *
 * Dev only: imported from `dev-tools/ui-catalog/` and `pages/ui.vue`, so a build that drops the page drops this file and
 * `catalog/` with it (tests/config/ui-catalog-build-output.test.ts).
 */
import { markRaw, ref, shallowReactive, type Component } from 'vue'
import { useAppConfig } from '#imports'
import type { CatalogEntry } from '~/catalog/types'
import { themeAxes, type ManifestRow, type ThemeAxis, type ThemeLike } from './catalogModel'

/** Props a fixture returns; it runs inside the sample (and its host), so it may read and seed the sample's stores. */
export type CatalogFixture = (context: { t: (key: string) => string, locale: string }) => Record<string, unknown>

export interface ResolvedEntry {
  entry: CatalogEntry
  component: Component | null
  axes: ThemeAxis[]
  fixtures: Record<string, CatalogFixture>
  error?: string
}

// Computed by nuxt.config.ts from the doc blocks and catalog/ (build time, #117); no committed file.
const manifest: ManifestRow[] = __UI_MANIFEST__

// Lazy globs: nothing loads until the page asks, and only the files an entry names are fetched.
const entryModules = import.meta.glob<{ default: CatalogEntry }>('../../catalog/**/*.catalog.ts')
const appComponents = import.meta.glob<{ default: Component }>('../../components/**/*.vue')
// Chart needs the optional peer `@tanstack/charts`, which the app does not install: a production build that reaches it fails, so it stays out of the glob
const libraryComponents = import.meta.glob<{ default: Component }>(['#ui/components/*.vue', '!#ui/components/Chart.vue'])
const themeModules = import.meta.glob<ThemeLike>('#build/ui/*.ts', { import: 'default' })
const fixtureModules = import.meta.glob<{ default: CatalogFixture }>('./fixtures/*.ts')

const findGlob = <T>(modules: Record<string, () => Promise<T>>, suffix: string) => Object.entries(modules).find(([path]) => path.endsWith(suffix))?.[1]

async function resolveEntry(entry: CatalogEntry, appUi: Record<string, ThemeLike> | undefined): Promise<ResolvedEntry> {
  const row = manifest.find(r => r.name === entry.component)
  try {
    if (!row) throw new Error(`no manifest row for ${entry.component}`)
    const loadComponent = row.source === 'nuxt-ui'
      ? findGlob(libraryComponents, `/components/${entry.component.replace(/^U/, '')}.vue`)
      : findGlob(appComponents, `/${row.path}`)
    if (!loadComponent) throw new Error(`no component file for ${entry.component}`)
    const component = markRaw((await loadComponent()).default)
    let axes: ThemeAxis[] = []
    if (entry.matrix) {
      const loadTheme = findGlob(themeModules, `/ui/${entry.theme}.ts`)
      if (!loadTheme) throw new Error(`no theme "${entry.theme}"`)
      // `app.config.ts` keys are camelCase (`selectMenu`), the theme files kebab-case (`select-menu`)
      const config = appUi?.[entry.theme ?? ''] ?? appUi?.[(entry.theme ?? '').replace(/-(\w)/g, (_, c: string) => c.toUpperCase())]
      axes = themeAxes(await loadTheme(), config, entry.matrix.axes, entry.matrix.only)
    }
    const fixtures: Record<string, CatalogFixture> = {}
    for (const name of new Set([...(entry.variants ?? []), ...entry.states].map(example => example.fixture).filter((n): n is string => !!n))) {
      const loadFixture = findGlob(fixtureModules, `/fixtures/${name}.ts`)
      if (!loadFixture) throw new Error(`no fixture "${name}" (dev-tools/ui-catalog/fixtures/${name}.ts)`)
      fixtures[name] = (await loadFixture()).default
    }
    return { entry, component, axes, fixtures }
  } catch (error) {
    return { entry, component: null, axes: [], fixtures: {}, error: error instanceof Error ? error.message : String(error) }
  }
}

const resolved = shallowReactive<Record<string, ResolvedEntry>>({})
const ready = ref(false)
let loading: Promise<void> | null = null

/** The manifest, the resolved entries by component name, and `ready` once every entry has loaded. `load()` is idempotent. */
export function useCatalog() {
  const appUi = useAppConfig().ui as Record<string, ThemeLike> | undefined
  function load(): Promise<void> {
    loading ??= (async () => {
      const entries = await Promise.all(Object.values(entryModules).map(async loadEntry => (await loadEntry()).default))
      for (const result of await Promise.all(entries.map(entry => resolveEntry(entry, appUi)))) resolved[result.entry.component] = result
      ready.value = true
    })()
    return loading
  }
  return { manifest, resolved, ready, load }
}
