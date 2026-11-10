<!--
@component UiCatalogComponentTile
@description One component on an overview of `/ui` (kd#127): a small live preview, its name, what it is and a link to its page.
@usage <UiCatalogComponentTile :row="row" :resolved="resolved[row.name]" /> inside a list (it renders an `li`)
@responsibility
- Show one sample of the entry (`tilePreview`: the default cell of a library matrix, else the first variant or state), scaled down, clipped and inert: a tile is a picture of the component, its page is where it is used
- A component without a sample shows its kind in the preview area instead, so every tile has the same shape
- The name is the link; it stretches over the whole tile, so the tile is one target and reads as one link in a screen reader. The link's own box is 24 px high: axe measures that box, not the stretched area (WCAG 2.2 target size)
- Chrome of the dev tool: English, light only, semantic tokens
-->
<template>
  <li class="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-default bg-default focus-within:border-inverted hover:border-accented" :data-kd-tile="row.name">
    <div class="flex h-28 items-center justify-center overflow-hidden border-b border-default bg-page p-3" aria-hidden="true" inert>
      <div v-if="preview && component" class="pointer-events-none flex max-h-full max-w-full scale-75 items-center justify-center">
        <UiCatalogSample
          :component="component" :sample-key="`${row.name}:${preview.group}:${preview.example.id}`" :props="preview.example.props" :slot-text="preview.example.slot" :open="preview.example.open"
          :trigger="preview.example.trigger" :host="resolved?.entry.host" :demo-tasks="preview.example.demoTasks" :fixture="preview.example.fixture ? resolved?.fixtures[preview.example.fixture] : undefined" preview
        />
      </div>
      <span v-else class="font-display text-lg text-dimmed">{{ resolved?.entry.launch ? 'overlay' : row.kind }}</span>
    </div>
    <div class="min-w-0 space-y-0.5 p-3">
      <NuxtLink :to="{ path: '/ui', query: { c: row.name } }" class="block min-h-6 truncate font-mono text-sm/6 text-highlighted after:absolute after:inset-0 focus-visible:outline-none">
        {{ row.name }}
      </NuxtLink>
      <p class="line-clamp-2 text-xs text-muted">{{ row.description }}</p>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UiCatalogSample from './CatalogSample.vue'
import { tilePreview } from './catalogNav'
import type { ManifestRow } from './catalogModel'
import type { ResolvedEntry } from './useCatalog'

defineOptions({ name: 'UiCatalogComponentTile' })

const props = defineProps<{
  row: ManifestRow
  resolved?: ResolvedEntry
}>()

const component = computed(() => props.resolved?.component)
const preview = computed(() => (props.resolved?.error ? undefined : tilePreview(props.resolved?.entry, props.resolved?.axes ?? [])))
</script>
