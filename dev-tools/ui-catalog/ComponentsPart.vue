<!--
@component UiCatalogComponentsPart
@description The one-page view of the `/ui` components (#66, kd#127): every component of the manifest by category with its texts and every sample of its entry, the whole theme of a library matrix included.
@usage <UiCatalogComponentsPart :manifest="manifest" :resolved="resolved" :viewport="viewport" /> for `/ui?v=all`
@responsibility
- Sections by category (display titles Eingabe, Aktion, Navigation, Feedback, Overlay, Darstellung, Layout; blocks last), each component as a full card
- Everything is on the page at once: the style fingerprint (tests/e2e/ui-catalog.spec.ts) reads this view, and it is the view to search with the browser's find
- Imported only from `pages/ui.vue`, so a build that drops the page drops this part and `catalog/` with it (tests/config/ui-catalog-build-output.test.ts)
-->
<template>
  <section id="components" aria-labelledby="components-title" class="space-y-10">
    <div>
      <h2 id="components-title" tabindex="-1" class="font-display text-2xl text-highlighted outline-none" data-kd-view-title>Components</h2>
      <p class="mt-1 max-w-3xl text-sm text-muted">
        {{ manifest.length }} components from the manifest, {{ entryCount }} with a catalog entry. Texts come from the doc blocks (Nuxt UI components: their entry), variants of a Nuxt UI component from the merged theme.
      </p>
    </div>
    <section v-for="section in sections" :id="`components-${section.category}`" :key="section.category" :aria-labelledby="`components-${section.category}-title`" class="space-y-10">
      <h3 :id="`components-${section.category}-title`" class="font-display text-xl text-highlighted">{{ section.title }}</h3>
      <UiCatalogComponentCard
        v-for="row in section.rows"
        :key="row.name"
        :row="row"
        :resolved="resolved[row.name]"
        :viewport="viewport"
        :heading-level="4"
        full
        class="border-t border-default pt-6"
      />
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UiCatalogComponentCard from './ComponentCard.vue'
import { groupByCategory, type ManifestRow } from './catalogModel'
import type { ResolvedEntry } from './useCatalog'

defineOptions({ name: 'UiCatalogComponentsPart' })

const props = defineProps<{
  manifest: ManifestRow[]
  resolved: Record<string, ResolvedEntry>
  viewport: 'desktop' | 'mobile'
}>()

const sections = computed(() => groupByCategory(props.manifest))
const entryCount = computed(() => Object.keys(props.resolved).length)
</script>
