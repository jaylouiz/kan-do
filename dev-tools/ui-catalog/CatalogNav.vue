<!--
@component UiCatalogNav
@description The navigation of `/ui` (kd#127): Overview, the token groups, the kit by category and the feature parts by area, each with its count.
@usage <UiCatalogNav :manifest="manifest" :view="view" /> in the sidebar of `pages/ui.vue` (and in its menu on a phone)
@responsibility
- List what the page holds from the manifest and the token sections, never a typed list of components
- The token groups unfold only inside the Tokens view (twelve links that would push the kit off a laptop screen); kit and feature parts are always listed
- Mark the current view (`aria-current="page"`); the page of a component marks the group it sits in
- Links are plain router links to `/ui?v=...`, so every view has an address and the back button works
- Chrome of the dev tool: English, light only
-->
<template>
  <nav aria-label="Catalog" class="space-y-5 text-sm">
    <ul class="space-y-0.5">
      <li><NuxtLink :to="{ path: '/ui' }" :class="linkClass(current === '')" :aria-current="current === '' ? 'page' : undefined">Overview</NuxtLink></li>
    </ul>
    <div v-for="section in sections" :key="section.id" class="space-y-1">
      <NuxtLink :to="{ path: '/ui', query: { v: section.id } }" class="block px-2 text-xs font-medium text-muted hover:text-default" :aria-current="current === section.id ? 'page' : undefined">
        {{ section.title }}
      </NuxtLink>
      <ul v-if="section.open" class="space-y-0.5">
        <li v-for="item in section.items" :key="item.id">
          <NuxtLink :to="{ path: '/ui', query: { v: item.id } }" :class="linkClass(current === item.id)" :aria-current="current === item.id ? 'page' : undefined">
            <span class="min-w-0 truncate">{{ item.title }}</span>
            <span v-if="item.count !== undefined" class="text-xs" :class="current === item.id ? 'text-inverted' : 'text-muted'">{{ item.count }}</span>
          </NuxtLink>
        </li>
      </ul>
    </div>
    <ul class="space-y-0.5 border-t border-default pt-3">
      <li><NuxtLink :to="{ path: '/ui', query: { v: 'all' } }" :class="linkClass(current === 'all')" :aria-current="current === 'all' ? 'page' : undefined">Everything on one page</NuxtLink></li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TOKEN_SECTIONS, groupOfRow, kitGroups, partGroups, viewQuery, type CatalogView } from './catalogNav'
import type { ManifestRow } from './catalogModel'

defineOptions({ name: 'UiCatalogNav' })

const props = defineProps<{
  manifest: ManifestRow[]
  view: CatalogView
}>()

/** The `v` value of the current view; a component's page counts as its group. */
const current = computed(() => {
  if (props.view.kind === 'component') {
    const name = props.view.name
    const row = props.manifest.find(candidate => candidate.name === name)
    return row ? groupOfRow(row).id : ''
  }
  return viewQuery(props.view).v ?? ''
})

const sections = computed(() => [
  { id: 'tokens', title: 'Tokens', open: current.value.startsWith('tokens'), items: TOKEN_SECTIONS.map(section => ({ id: `tokens.${section.id}`, title: section.title, count: undefined as number | undefined })) },
  { id: 'kit', title: 'Kit', open: true, items: kitGroups(props.manifest).map(group => ({ id: group.id, title: group.title, count: group.rows.length })) },
  { id: 'parts', title: 'Feature parts', open: true, items: partGroups(props.manifest).map(group => ({ id: group.id, title: group.title, count: group.rows.length })) },
])

const linkClass = (active: boolean) => [
  'flex items-center justify-between gap-2 rounded-md px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
  active ? 'bg-inverted text-inverted' : 'text-default hover:bg-elevated',
]
</script>
