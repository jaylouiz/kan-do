<!--
@component UiCatalogComponentGroups
@description Overview grids of `/ui` (kd#127): the components of one or more groups (a kit category, a feature area) as tiles under their group title.
@usage <UiCatalogComponentGroups title="Kit" :groups="kitGroups(manifest)" :resolved="resolved" :heading-level="2" />
@responsibility
- One heading per group with its count, linked to the view that shows only that group, and a grid of tiles that uses the page width (two columns on a phone, up to six on a wide window)
- Say so when a search leaves nothing
- Chrome of the dev tool: English, light only
-->
<template>
  <section class="space-y-6" :aria-labelledby="titleId">
    <div>
      <component :is="`h${headingLevel}`" :id="titleId" tabindex="-1" class="font-display text-2xl text-highlighted outline-none" :data-kd-view-title="headingLevel === 2 ? '' : undefined">{{ title }}</component>
      <p v-if="intro" class="mt-1 max-w-3xl text-sm text-muted">{{ intro }}</p>
    </div>
    <p v-if="groups.length === 0" class="text-sm text-default">Nothing matches.</p>
    <section v-for="group in groups" :key="group.id" :aria-labelledby="`group-${group.id}`" class="space-y-3">
      <component :is="`h${headingLevel + 1}`" :id="`group-${group.id}`" class="flex items-baseline gap-2 font-display text-lg text-highlighted">
        <NuxtLink v-if="linkGroups" :to="{ path: '/ui', query: { v: group.id } }" class="hover:underline hover:underline-offset-2">{{ group.title }}</NuxtLink>
        <template v-else>{{ group.title }}</template>
        <span class="font-sans text-xs text-muted">{{ group.rows.length }}</span>
      </component>
      <ul class="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        <UiCatalogComponentTile v-for="row in group.rows" :key="row.name" :row="row" :resolved="resolved[row.name]" />
      </ul>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UiCatalogComponentTile from './ComponentTile.vue'
import type { CatalogGroup } from './catalogNav'
import type { ResolvedEntry } from './useCatalog'

defineOptions({ name: 'UiCatalogComponentGroups' })

const props = withDefaults(defineProps<{
  title: string
  intro?: string
  groups: CatalogGroup[]
  resolved: Record<string, ResolvedEntry>
  headingLevel?: 2 | 3
  /** Link each group title to its own view (off when the view already is that group). */
  linkGroups?: boolean
}>(), { intro: undefined, headingLevel: 2, linkGroups: true })

const titleId = computed(() => `groups-${props.title.toLowerCase().replace(/[^a-z]+/g, '-')}`)
</script>
