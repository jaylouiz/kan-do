<!--
@component UiCatalogComponentsPart
@description The Components part of `/ui` (#66): every component of the manifest by category, with description, usage, avoid, alternatives, a variant and state switcher, a viewport switch and a de/en toggle for the sample copy.
@usage <UiCatalogComponentsPart /> inside `pages/ui.vue`.
@responsibility
- Build the sections from `docs/design/ui-manifest.json` (display titles Eingabe, Aktion, Navigation, Feedback, Overlay, Darstellung, Layout, Formularstruktur, Tastatur; blocks last) and the entries under `catalog/` (`import.meta.glob`); a component without an entry still shows its texts
- Resolve each entry's component (app component by its manifest path, Nuxt UI component from the library) and, for a Nuxt UI entry, the variant axes from the merged theme (`.nuxt/ui/<theme>.ts` plus `app.config.ts`), so nothing is retyped
- The language toggle sets the app locale (`kando-locale`, like `?lang=`): the sample copy changes, the chrome stays English (epic #58 D2)
- Sets `data-kd-catalog-ready` once every entry has loaded; the fingerprint spec waits for it
- Imported only from `pages/ui.vue`, so a build that drops the page drops this part and `catalog/` with it (tests/config/ui-catalog-build-output.test.ts)
-->
<template>
  <section id="components" tabindex="-1" aria-labelledby="components-title" class="scroll-mt-16 space-y-8 outline-none" :data-kd-catalog-ready="ready || undefined">
    <div>
      <h2 id="components-title" class="font-display text-2xl text-highlighted">Components</h2>
      <p class="mt-1 max-w-lg text-sm text-muted">
        {{ manifest.length }} components from the manifest, {{ entryCount }} with a catalog entry. Texts come from the doc blocks (Nuxt UI components: their entry), variants of a Nuxt UI component from the merged theme.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-x-8 gap-y-2" role="group" aria-label="Catalog settings">
      <UiCatalogSegmentedChoice
        v-model="viewport"
        label="Viewport"
        :options="[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: '390 px' }]"
      />
      <UiCatalogSegmentedChoice
        :model-value="locale"
        label="Sample language"
        :options="[{ value: 'de', label: 'de' }, { value: 'en', label: 'en' }]"
        @update:model-value="chooseLocale"
      />
    </div>
    <p class="-mt-4 max-w-lg text-xs text-muted">The viewport switch narrows the frame of the samples; media queries still follow the browser window. The language switch changes the app locale of the samples, not this page.</p>

    <p v-if="!ready" class="text-sm text-muted" role="status">Loading entries…</p>
    <template v-else>
      <section v-for="section in sections" :id="`components-${section.category}`" :key="section.category" :aria-labelledby="`components-${section.category}-title`" class="space-y-6">
        <h3 :id="`components-${section.category}-title`" class="font-display text-xl text-highlighted">{{ section.title }}</h3>
        <UiCatalogComponentCard
          v-for="row in section.rows"
          :key="row.name"
          :row="row"
          :entry="resolved[row.name]?.entry"
          :component="resolved[row.name]?.component"
          :axes="resolved[row.name]?.axes ?? []"
          :error="resolved[row.name]?.error"
          :viewport="viewport"
          @jump="jumpTo"
        />
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, markRaw, onMounted, ref, shallowReactive, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppConfig } from '#imports'
import manifestJson from '~/docs/design/ui-manifest.json'
import type { CatalogEntry } from '~/catalog/types'
import { LOCALE_STORAGE_KEY } from '~/utils/localeResolution'
import UiCatalogComponentCard from './ComponentCard.vue'
import UiCatalogSegmentedChoice from './SegmentedChoice.vue'
import { groupByCategory, themeAxes, type ManifestRow, type ThemeAxis, type ThemeLike } from './catalogModel'

defineOptions({ name: 'UiCatalogComponentsPart' })

interface Resolved {
  entry: CatalogEntry
  component: Component | null
  axes: ThemeAxis[]
  error?: string
}

const manifest = manifestJson as ManifestRow[]
const sections = computed(() => groupByCategory(manifest))

// Lazy globs: nothing loads until `onMounted`, and only the files an entry names are fetched.
const entryModules = import.meta.glob<{ default: CatalogEntry }>('../../catalog/**/*.catalog.ts')
const appComponents = import.meta.glob<{ default: Component }>('../../components/**/*.vue')
// Chart needs the optional peer `@tanstack/charts`, which the app does not install: a production build that reaches it fails, so it stays out of the glob
const libraryComponents = import.meta.glob<{ default: Component }>(['#ui/components/*.vue', '!#ui/components/Chart.vue'])
const themeModules = import.meta.glob<ThemeLike>('#build/ui/*.ts', { import: 'default' })

const { locale, setLocale } = useI18n()
const viewport = ref<'desktop' | 'mobile'>('desktop')
const ready = ref(false)
const entryCount = ref(0)
const resolved = shallowReactive<Record<string, Resolved>>({})

/** The language toggle is the app locale: set it and remember it the way `?lang=` does (`kando-locale`). */
async function chooseLocale(next: string) {
  if (next !== 'de' && next !== 'en') return
  await setLocale(next)
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
  } catch {
    // Storage blocked: the locale still applies for this session.
  }
}

const findGlob = <T,>(modules: Record<string, () => Promise<T>>, suffix: string) => Object.entries(modules).find(([path]) => path.endsWith(suffix))?.[1]

async function resolveEntry(entry: CatalogEntry): Promise<Resolved> {
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
      const appUi = useAppConfig().ui as Record<string, ThemeLike> | undefined
      // `app.config.ts` keys are camelCase (`selectMenu`), the theme files kebab-case (`select-menu`)
      const config = appUi?.[entry.theme ?? ''] ?? appUi?.[(entry.theme ?? '').replace(/-(\w)/g, (_, c: string) => c.toUpperCase())]
      axes = themeAxes(await loadTheme(), config, entry.matrix.axes)
    }
    return { entry, component, axes }
  } catch (error) {
    return { entry, component: null, axes: [], error: error instanceof Error ? error.message : String(error) }
  }
}

onMounted(async () => {
  const entries = await Promise.all(Object.values(entryModules).map(async load => (await load()).default))
  entryCount.value = entries.length
  for (const result of await Promise.all(entries.map(resolveEntry))) resolved[result.entry.component] = result
  ready.value = true
})

/** Hash links do not scroll under the app's router options (see pages/ui.vue), so an alternative's link scrolls and focuses itself. */
function jumpTo(name: string) {
  const target = document.getElementById(`component-${name}`)
  if (!target) return
  target.scrollIntoView({ block: 'start' })
  target.querySelector<HTMLElement>('h4')?.focus?.({ preventScroll: true })
}
</script>
