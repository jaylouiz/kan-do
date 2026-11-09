<!--
@component UiCatalogBoardHost
@description Sample host of the `/ui` Components part for store-bound board blocks (#77, epic #58 D2): mounts a component inside a throwaway Pinia filled with the demo board and a drag-and-drop provider, so `BoardColumn` and its parts render from `?seed=demo` content without touching the real stores.
@usage <UiCatalogBoardHost v-slot="{ tasksFor }"><BoardColumn :tasks="tasksFor('open')" ... /></UiCatalogBoardHost>; used by UiCatalogSample for entries with `host: 'board'`
@responsibility
- Create one fresh Pinia per sample (no persistence plugin, so no `appStorage` key is read or written) and provide it to everything below, so a store resolved while a descendant sets up is the sample's own, never the app's
- Seed it with the demo board (tasks, carried-over counters, topic styles) in a child (UiCatalogBoardSeed): `inject` in the providing component itself would still find the app's Pinia and let the stores' own cross-store lookups reach the real ones
- Provide a stack-expansion state of its own (`STACK_EXPANSION_STATE`): BoardColumn prunes and collapses stacks on mount, which must not touch the stacks expanded on the real board
- Give the active Pinia back to the app's when the sample unmounts
- Wrap the slot in a `DragDropProvider` and one column-wide frame (not `.board`: that is a three-column grid that is 300vw wide on a phone and at least a viewport high, a page layout and not a sample frame)
- Dev only: lives under dev-tools/ui-catalog/, imported through the catalog engine only
-->
<template>
  <DragDropProvider>
    <UiCatalogBoardSeed v-slot="{ tasksFor }">
      <div class="w-88 max-w-full" data-kd-board-host>
        <slot :tasks-for="tasksFor" />
      </div>
    </UiCatalogBoardSeed>
  </DragDropProvider>
</template>

<script setup lang="ts">
import { onBeforeUnmount, provide } from 'vue'
import { createPinia, getActivePinia, piniaSymbol, setActivePinia } from 'pinia'
import { DragDropProvider } from '@dnd-kit/vue'
import { STACK_EXPANSION_STATE, createStackExpansionState } from '~/composables/useStackExpansion'
import UiCatalogBoardSeed from './BoardSampleSeed.vue'

defineOptions({ name: 'UiCatalogBoardHost' })

const outer = getActivePinia()
provide(piniaSymbol, createPinia())
// BoardColumn prunes and clears stack expansion on mount; that module-level state belongs to the real board
provide(STACK_EXPANSION_STATE, createStackExpansionState())

// A store lookup below makes the sample's Pinia the active one; hand the app's back so code outside a component does not read it.
onBeforeUnmount(() => {
  if (outer) setActivePinia(outer)
})
</script>
