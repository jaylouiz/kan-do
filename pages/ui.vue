<!--
@page UiCatalog
@description Dev-only catalog of the UI kit (#65, epic #58): Tokens, generated from the real stylesheets and app config, and Components, generated from the manifest and the entries under `catalog/` (#66).
@usage /ui in `npm run dev` and in the E2E build. Every other build removes the route (`pages:extend`, lib/devPages.ts), so nothing of this page ships.
@responsibility
- Replaces the hand-written `/styleguide`; chrome is English (epic decision D2), light only
- Mounts the parts from `dev-tools/ui-catalog/`: nothing of the catalog sits in a folder shipped code imports from
- `data-kd-ui-catalog` marks the page; the build-output test (tests/config/ui-catalog-build-output.test.ts) searches a production build for it
- Hides the app bar (`appNav: false`): a tool page, not a destination of the app
-->
<template>
  <div data-kd-ui-catalog class="px-safe min-h-dvh bg-page">
    <header class="pt-safe sticky top-0 z-20 border-b border-default bg-page">
      <UContainer class="flex flex-wrap items-center gap-x-6 gap-y-1 py-2">
        <p class="font-display text-lg text-highlighted">UI catalog</p>
        <nav aria-label="Catalog parts" class="flex gap-1">
          <a
            v-for="part in PARTS"
            :key="part.id"
            :href="`#${part.id}`"
            class="rounded-md px-3 py-1.5 text-sm text-default hover:bg-muted"
            @click.prevent="goTo(part.id)"
          >
            {{ part.label }}
          </a>
        </nav>
      </UContainer>
    </header>
    <main>
      <UContainer class="space-y-16 py-8">
        <h1 class="sr-only">UI catalog</h1>
        <UiCatalogTokensPart />
        <UiCatalogComponentsPart />
      </UContainer>
    </main>
  </div>
</template>

<script setup lang="ts">
import UiCatalogTokensPart from '~/dev-tools/ui-catalog/TokensPart.vue'
import UiCatalogComponentsPart from '~/dev-tools/ui-catalog/ComponentsPart.vue'

definePageMeta({ appNav: false })

const PARTS = [
  { id: 'tokens', label: 'Tokens' },
  { id: 'components', label: 'Components' },
]

/** Hash links do not scroll under the app's router options, so the anchors scroll and move focus themselves. */
function goTo(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  target.scrollIntoView({ block: 'start' })
  target.focus({ preventScroll: true })
}
</script>
