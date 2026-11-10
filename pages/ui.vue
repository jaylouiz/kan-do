<!--
@page UiCatalog
@description Dev-only catalog of the UI kit (#65, epic #58; structure kd#127): an overview of the kit and the feature parts as live tiles, one page per component, and the tokens by group, all generated from the doc blocks, `catalog/` and the real stylesheets.
@usage /ui in `npm run dev` and in the E2E build. Every other build removes the route (`pages:extend`, lib/devPages.ts), so nothing of this page ships.
@responsibility
- One route, the view in the address (`?v=tokens.colors`, `?v=kit.action`, `?v=parts.board`, `?c=UButton`, `?v=all`; dev-tools/ui-catalog/catalogNav.ts), so every view can be linked and the back button works
- Sidebar navigation from 1024 px, the same list in a menu below; a search field that filters the tiles by name and text
- The viewport and sample-language switches sit in the top bar and apply to every sample
- Replaces the hand-written `/styleguide`; chrome is English (epic decision D2), light only
- Mounts the parts from `dev-tools/ui-catalog/`: nothing of the catalog sits in a folder shipped code imports from
- `data-kd-ui-catalog` marks the page; the build-output test (tests/config/ui-catalog-build-output.test.ts) searches a production build for it
- `data-kd-catalog-ready` is set once every entry has loaded; the specs wait for it
- Every link of the chrome is at least 24 px high (WCAG 2.2 target size), so the rule holds whatever sits next to it; `ui-shell.spec.ts` measures it
- A sample or tile preview never scrolls the page (`sampleScrollGuard`, kd#152): the page stays where it was loaded, so the sticky header covers no link by accident; `ui-shell.spec.ts` checks both
- Hides the app bar (`appNav: false`): a tool page, not a destination of the app
-->
<template>
  <div data-kd-ui-catalog class="px-safe min-h-dvh bg-page" :data-kd-catalog-ready="ready || undefined">
    <header class="pt-safe sticky top-0 z-20 border-b border-default bg-page">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 lg:px-6">
        <NuxtLink :to="{ path: '/ui' }" class="inline-flex min-h-6 items-center font-display text-lg text-highlighted">UI catalog</NuxtLink>
        <label class="flex min-w-40 flex-1 items-center gap-2 sm:max-w-xs">
          <span class="sr-only">Search components</span>
          <input
            v-model="search"
            type="search"
            placeholder="Search components"
            class="min-h-8 w-full rounded-md border border-default bg-default px-2.5 text-sm text-default placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
        </label>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-1" role="group" aria-label="Sample settings">
          <UiCatalogSegmentedChoice v-model="viewport" class="max-sm:hidden" label="Viewport" :options="[{ value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: '390 px' }]" />
          <UiCatalogSegmentedChoice :model-value="locale" label="Sample language" :options="[{ value: 'de', label: 'de' }, { value: 'en', label: 'en' }]" @update:model-value="chooseLocale" />
        </div>
      </div>
      <details ref="menu" class="border-t border-default px-4 py-2 lg:hidden">
        <summary class="cursor-pointer text-sm text-default">Menu</summary>
        <UiCatalogNav class="pt-3 pb-2" :manifest="manifest" :view="view" />
      </details>
    </header>

    <div class="flex items-start gap-8 px-4 lg:px-6">
      <aside class="sticky top-14 hidden max-h-dvh w-56 shrink-0 overflow-y-auto pt-6 pb-24 lg:block">
        <UiCatalogNav :manifest="manifest" :view="view" />
      </aside>
      <main class="min-w-0 flex-1 py-6 pb-24">
        <h1 class="sr-only">UI catalog</h1>
        <p v-if="!ready" class="text-sm text-muted" role="status">Loading entries…</p>
        <template v-else-if="words.length">
          <UiCatalogComponentGroups :title="`Search: ${search.trim()}`" :groups="found" :resolved="resolved" />
        </template>
        <template v-else-if="view.kind === 'component' && currentRow">
          <nav aria-label="Breadcrumb" class="mb-4 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <NuxtLink :to="{ path: '/ui', query: { v: crumb.tier } }" class="inline-flex min-h-6 items-center hover:underline hover:underline-offset-2">{{ crumb.tier === 'kit' ? 'Kit' : 'Feature parts' }}</NuxtLink>
            <span aria-hidden="true">/</span>
            <NuxtLink :to="{ path: '/ui', query: { v: crumb.id } }" class="inline-flex min-h-6 items-center hover:underline hover:underline-offset-2">{{ crumb.title }}</NuxtLink>
          </nav>
          <UiCatalogComponentCard :key="currentRow.name" :row="currentRow" :resolved="resolved[currentRow.name]" :viewport="viewport" />
          <nav aria-label="Neighbours" class="mt-12 flex justify-between gap-4 border-t border-default pt-4 text-sm">
            <NuxtLink v-if="around.previous" :to="{ path: '/ui', query: { c: around.previous.name } }" class="inline-flex min-h-6 items-center text-default hover:underline hover:underline-offset-2">← {{ around.previous.name }}</NuxtLink>
            <span v-else />
            <NuxtLink v-if="around.next" :to="{ path: '/ui', query: { c: around.next.name } }" class="inline-flex min-h-6 items-center text-default hover:underline hover:underline-offset-2">{{ around.next.name }} →</NuxtLink>
          </nav>
        </template>
        <UiCatalogTokensPart v-else-if="view.kind === 'tokens'" :group="view.group" />
        <UiCatalogComponentGroups
          v-else-if="view.kind === 'kit'"
          :title="view.category ? `Kit: ${kit[0]?.title ?? ''}` : 'Kit'"
          :intro="view.category ? undefined : KIT_INTRO"
          :groups="kit"
          :resolved="resolved"
          :link-groups="!view.category"
        />
        <UiCatalogComponentGroups
          v-else-if="view.kind === 'parts'"
          :title="view.area ? `Feature parts: ${parts[0]?.title ?? ''}` : 'Feature parts'"
          :intro="view.area ? undefined : PARTS_INTRO"
          :groups="parts"
          :resolved="resolved"
          :link-groups="!view.area"
        />
        <div v-else-if="view.kind === 'all'" class="space-y-16">
          <UiCatalogTokensPart group="*" />
          <UiCatalogComponentsPart :manifest="manifest" :resolved="resolved" :viewport="viewport" />
        </div>
        <div v-else class="space-y-14">
          <div>
            <h2 tabindex="-1" class="font-display text-2xl text-highlighted outline-none" data-kd-view-title>Overview</h2>
            <p class="mt-1 max-w-3xl text-sm text-muted">
              {{ kitCount }} kit components build every screen; {{ manifest.length - kitCount }} feature parts each serve one. Pick a tile for variants, states and when to use it.
            </p>
          </div>
          <UiCatalogComponentGroups title="Kit" :intro="KIT_INTRO" :groups="kit" :resolved="resolved" :heading-level="3" />
          <UiCatalogComponentGroups title="Feature parts" :intro="PARTS_INTRO" :groups="parts" :resolved="resolved" :heading-level="3" />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from '#imports'
import { LOCALE_STORAGE_KEY } from '~/utils/localeResolution'
import UiCatalogNav from '~/dev-tools/ui-catalog/CatalogNav.vue'
import UiCatalogComponentCard from '~/dev-tools/ui-catalog/ComponentCard.vue'
import UiCatalogComponentGroups from '~/dev-tools/ui-catalog/ComponentGroups.vue'
import UiCatalogComponentsPart from '~/dev-tools/ui-catalog/ComponentsPart.vue'
import UiCatalogSegmentedChoice from '~/dev-tools/ui-catalog/SegmentedChoice.vue'
import UiCatalogTokensPart from '~/dev-tools/ui-catalog/TokensPart.vue'
import { filterGroups, groupOfRow, kitGroups, neighbours, parseView, partGroups, searchWords } from '~/dev-tools/ui-catalog/catalogNav'
import { installSampleScrollGuard } from '~/dev-tools/ui-catalog/sampleScrollGuard'
import { useCatalog } from '~/dev-tools/ui-catalog/useCatalog'

definePageMeta({ appNav: false })

const KIT_INTRO = 'What a screen is built from: the Nuxt UI components in use, the shared primitives under components/ui and every app component with three or more consumers. Look here first.'
const PARTS_INTRO = 'Compositions that serve one screen or flow, by area. Reuse one only inside its own feature.'

const route = useRoute()
const { manifest, resolved, ready, load } = useCatalog()
const { locale, setLocale } = useI18n()

const viewport = ref<'desktop' | 'mobile'>('desktop')
const search = ref('')
const menu = ref<HTMLDetailsElement | null>(null)

const view = computed(() => parseView(route.query, manifest))
const words = computed(() => searchWords(search.value))
const allKit = computed(() => kitGroups(manifest))
const allParts = computed(() => partGroups(manifest))
const kitCount = computed(() => manifest.filter(row => row.tier === 'kit').length)

const kit = computed(() => {
  const current = view.value
  return current.kind === 'kit' && current.category ? allKit.value.filter(group => group.id === `kit.${current.category}`) : allKit.value
})
const parts = computed(() => {
  const current = view.value
  return current.kind === 'parts' && current.area ? allParts.value.filter(group => group.id === `parts.${current.area}`) : allParts.value
})
const found = computed(() => filterGroups([...allKit.value, ...allParts.value], words.value))

const currentRow = computed(() => {
  const current = view.value
  return current.kind === 'component' ? manifest.find(row => row.name === current.name) : undefined
})
const crumb = computed(() => (currentRow.value ? groupOfRow(currentRow.value) : { tier: 'kit' as const, id: 'kit', title: '' }))
const around = computed(() => (currentRow.value ? neighbours(currentRow.value, manifest) : {}))

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

// A new view starts at its top with the focus on its title, like a page change; the search ends, the phone menu closes.
watch(() => [route.query.v, route.query.c], async () => {
  search.value = ''
  if (menu.value) menu.value.open = false
  await nextTick()
  window.scrollTo({ top: 0 })
  document.querySelector<HTMLElement>('[data-kd-view-title]')?.focus({ preventScroll: true })
})

// Before any sample mounts: a sample never scrolls the page (kd#152)
const removeScrollGuard = import.meta.client ? installSampleScrollGuard() : undefined
onBeforeUnmount(() => removeScrollGuard?.())

onMounted(load)
</script>
