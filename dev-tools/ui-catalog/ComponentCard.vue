<!--
@component UiCatalogComponentCard
@description One component in the `/ui` Components part (#66): its description, usage, avoid and alternatives from the manifest, a variant and state switcher, and the live samples of its entry.
@usage <UiCatalogComponentCard :row="row" :entry="entry" :component="component" :axes="axes" :viewport="viewport" />
@responsibility
- Print the texts of the manifest row (doc block, or the entry of a Nuxt UI component) and never type one of them again
- A component without an entry shows its texts and says so; an entry whose component or theme could not be loaded shows the error instead of the samples
- Switchers: one per theme axis (or one over the named variants) and one over the state labels, each defaulting to "All"; the fingerprint spec reads the default, everything shown
- The viewport switch narrows the sample frame to 390 px; media queries still follow the window, so the real 390 px check stays the E2E viewport
- Chrome is English, light only; each matrix scrolls inside its own focusable region, so the page never scrolls sideways
-->
<template>
  <article :id="`component-${row.name}`" class="space-y-4 border-t border-default pt-6" :aria-labelledby="`component-${row.name}-title`">
    <header class="space-y-1">
      <h4 :id="`component-${row.name}-title`" tabindex="-1" class="font-display text-lg text-highlighted outline-none">
        <code class="font-mono">{{ row.name }}</code>
      </h4>
      <p class="text-xs text-muted">
        {{ row.kind }} · {{ row.source === 'nuxt-ui' ? 'Nuxt UI' : row.path }}
      </p>
    </header>

    <dl class="space-y-2 text-sm">
      <div>
        <dt class="text-xs text-muted">Description</dt>
        <dd class="break-words text-default">{{ row.description }}</dd>
      </div>
      <div>
        <dt class="text-xs text-muted">Usage</dt>
        <dd class="break-words text-default">{{ row.usage }}</dd>
      </div>
      <div>
        <dt class="text-xs text-muted">Avoid</dt>
        <dd class="break-words text-default">{{ row.avoid }}</dd>
      </div>
      <div v-if="entry?.alternatives.length">
        <dt class="text-xs text-muted">Alternatives</dt>
        <dd class="text-default">
          <template v-for="(name, index) in entry.alternatives" :key="name">
            <a :href="`#component-${name}`" class="underline underline-offset-2" @click.prevent="$emit('jump', name)">{{ name }}</a><template v-if="index < entry.alternatives.length - 1">, </template>
          </template>
        </dd>
      </div>
    </dl>

    <p v-if="!entry" class="text-sm text-muted">No catalog entry yet: its samples arrive with its category slice.</p>
    <p v-else-if="error" role="alert" class="text-sm text-error">Could not render the samples: {{ error }}</p>
    <template v-else-if="component">
      <div class="space-y-2">
        <template v-if="entry.matrix">
          <UiCatalogSegmentedChoice
            v-for="axis in axes"
            :key="axis.axis"
            :model-value="axisFilter[axis.axis] ?? ''"
            :label="axis.axis"
            :options="[{ value: '', label: 'All' }, ...axis.values.map(v => ({ value: v.value, label: v.isDefault ? `${v.value} (default)` : v.value }))]"
            @update:model-value="axisFilter[axis.axis] = $event"
          />
        </template>
        <UiCatalogSegmentedChoice
          v-if="entry.variants?.length"
          v-model="variantFilter"
          label="variant"
          :options="[{ value: '', label: 'All' }, ...entry.variants.map(v => ({ value: v.id, label: v.label ?? v.id }))]"
        />
        <UiCatalogSegmentedChoice
          v-if="entry.states.length"
          v-model="stateFilter"
          label="state"
          :options="[{ value: '', label: 'All' }, ...entry.states.map(s => ({ value: s.id, label: s.label ?? s.id }))]"
        />
      </div>

      <div :style="frameStyle" class="space-y-6">
        <section
          v-for="section in matrix"
          :key="section.title"
          :aria-label="`${row.name} ${section.title || 'matrix'}`"
          class="space-y-1"
        >
          <h5 v-if="section.title" class="text-xs text-muted">{{ section.title }}</h5>
          <div role="region" :aria-label="`${row.name} ${section.title || 'matrix'} samples`" tabindex="0" class="overflow-x-auto outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary">
            <table class="border-separate border-spacing-x-3 border-spacing-y-2 text-left">
              <thead>
                <tr>
                  <td />
                  <th v-for="col in section.cols" :key="col" scope="col" class="text-xs font-normal text-muted">{{ col }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="matrixRow in section.rows" :key="matrixRow.value">
                  <th scope="row" class="pr-2 text-xs font-normal text-muted">{{ matrixRow.value }}</th>
                  <td v-for="cell in matrixRow.cells" :key="cell.id">
                    <UiCatalogSample :component="component" :sample-key="`${row.name}:matrix:${cell.id}`" :props="cell.props" :slot-text="entry.matrix?.slot" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="shownVariants.length" :aria-label="`${row.name} variants`" class="space-y-2">
          <h5 class="text-xs text-muted">Variants</h5>
          <ul class="flex flex-wrap items-end gap-x-6 gap-y-3">
            <li v-for="example in shownVariants" :key="example.id" class="min-w-0 space-y-1">
              <p class="text-xs text-muted">{{ example.label ?? example.id }}</p>
              <UiCatalogSample :component="component" :sample-key="`${row.name}:variant:${example.id}`" :props="example.props" :slot-text="example.slot" :open="example.open" />
            </li>
          </ul>
        </section>

        <section v-if="shownStates.length" :aria-label="`${row.name} states`" class="space-y-2">
          <h5 class="text-xs text-muted">States</h5>
          <ul class="flex flex-wrap items-end gap-x-6 gap-y-3">
            <li v-for="example in shownStates" :key="example.id" class="min-w-0 space-y-1">
              <p class="text-xs text-muted">{{ example.label ?? example.state }}</p>
              <UiCatalogSample :component="component" :sample-key="`${row.name}:state:${example.id}`" :state="example.state" :props="example.props" :slot-text="example.slot" :open="example.open" />
            </li>
          </ul>
        </section>
      </div>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, reactive, ref, type Component } from 'vue'
import type { CatalogEntry } from '~/catalog/types'
import UiCatalogSample from './CatalogSample.vue'
import UiCatalogSegmentedChoice from './SegmentedChoice.vue'
import { buildMatrix, type ManifestRow, type ThemeAxis } from './catalogModel'

defineOptions({ name: 'UiCatalogComponentCard' })

const props = defineProps<{
  row: ManifestRow
  entry?: CatalogEntry
  component?: Component | null
  axes: ThemeAxis[]
  viewport: 'desktop' | 'mobile'
  error?: string
}>()

defineEmits<{ jump: [name: string] }>()

const axisFilter = reactive<Record<string, string>>({})
const variantFilter = ref('')
const stateFilter = ref('')

const matrix = computed(() => (props.entry?.matrix ? buildMatrix(props.axes, props.entry.matrix.props, axisFilter) : []))
const shownVariants = computed(() => (props.entry?.variants ?? []).filter(v => !variantFilter.value || v.id === variantFilter.value))
const shownStates = computed(() => (props.entry?.states ?? []).filter(s => !stateFilter.value || s.id === stateFilter.value))
const frameStyle = computed(() => (props.viewport === 'mobile' ? { width: '390px', maxWidth: '100%' } : undefined))
</script>
