<!--
@component UiCatalogComponentCard
@description One component on `/ui` (#66, kd#127): its description, usage, avoid and alternatives from the manifest and the live samples of its entry; the page of a component, and one card of the one-page view.
@usage <UiCatalogComponentCard :row="row" :resolved="resolved[row.name]" :viewport="viewport" :heading-level="2" />
@responsibility
- Print the texts of the manifest row (doc block, or the entry of a Nuxt UI component) and never type one of them again; on a wide window the three texts sit side by side
- A library matrix shows the values the app uses first (`usedValues` of the manifest plus the theme default, compact: one grid and a strip per further axis); "Whole theme" shows every combination. `full` (the one-page view, which the fingerprint spec reads) starts on the whole theme
- A component without samples says why (`sampleNote`) or that it has no entry, and links the screen it lives on when the entry names one
- The viewport switch narrows the sample frame to 390 px; media queries still follow the window, so the real 390 px check stays the E2E viewport
- Chrome is English, light only; each matrix scrolls inside its own focusable region, so the page never scrolls sideways
-->
<template>
  <article :id="`component-${row.name}`" class="space-y-6" :aria-labelledby="`component-${row.name}-title`">
    <header class="space-y-1">
      <component :is="`h${headingLevel}`" :id="`component-${row.name}-title`" tabindex="-1" class="font-display text-2xl break-all text-highlighted outline-none" :data-kd-view-title="headingLevel === 2 ? '' : undefined">
        <code class="font-mono">{{ row.name }}</code>
      </component>
      <p class="text-xs wrap-break-word text-muted">
        {{ row.tier === 'kit' ? 'Kit' : 'Feature part' }} · {{ row.kind }} · {{ row.source === 'nuxt-ui' ? 'Nuxt UI' : row.path }} · {{ consumers }}
      </p>
    </header>

    <dl class="grid grid-cols-1 gap-x-10 gap-y-3 text-sm lg:grid-cols-3">
      <div>
        <dt class="text-xs text-muted">Description</dt>
        <dd class="wrap-break-word text-default">{{ row.description }}</dd>
      </div>
      <div>
        <dt class="text-xs text-muted">Usage</dt>
        <dd class="wrap-break-word text-default">{{ row.usage }}</dd>
      </div>
      <div>
        <dt class="text-xs text-muted">Avoid</dt>
        <dd class="wrap-break-word text-default">{{ row.avoid }}</dd>
      </div>
      <div v-if="entry?.alternatives.length" class="lg:col-span-3">
        <dt class="text-xs text-muted">Alternatives</dt>
        <dd class="text-default">
          <!-- a wrapping list with a gap, each link at least 24 px high: comma-run inline links fall below the WCAG 2.2 target size when they wrap -->
          <ul class="flex flex-wrap gap-x-4 gap-y-1">
            <li v-for="name in entry.alternatives" :key="name">
              <NuxtLink :to="{ path: '/ui', query: { c: name } }" class="inline-flex min-h-6 items-center underline underline-offset-2">{{ name }}</NuxtLink>
            </li>
          </ul>
        </dd>
      </div>
    </dl>

    <p v-if="entry?.screen" class="text-sm text-default">
      Lives on <NuxtLink :to="entry.screen" class="font-mono underline underline-offset-2">{{ entry.screen }}</NuxtLink>
    </p>

    <p v-if="!entry" class="max-w-2xl text-sm text-muted" data-testid="catalog-no-entry">No isolated preview: a feature part is reviewed on the screen it serves.</p>
    <p v-else-if="entry.sampleNote" class="max-w-2xl text-sm text-muted" data-testid="catalog-sample-note">No live sample: {{ entry.sampleNote }}</p>
    <p v-else-if="resolved?.error" role="alert" class="text-sm text-error">Could not render the samples: {{ resolved.error }}</p>
    <template v-else-if="component">
      <UiCatalogSegmentedChoice
        v-if="hasThemeChoice"
        v-model="values"
        label="Values"
        :options="[{ value: 'used', label: 'In use' }, { value: 'theme', label: 'Whole theme' }]"
      />

      <div :style="frameStyle" class="space-y-8" data-kd-sample-frame>
        <section
          v-for="section in matrix"
          :key="section.title"
          :aria-label="`${row.name} ${section.title || 'matrix'}`"
          class="space-y-1"
        >
          <component :is="`h${headingLevel + 1}`" v-if="section.title" class="text-xs text-muted">{{ section.title }}</component>
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

        <section v-if="entry.variants?.length" :aria-label="`${row.name} variants`" class="space-y-2">
          <component :is="`h${headingLevel + 1}`" class="text-xs text-muted">Variants</component>
          <ul class="flex flex-wrap items-start gap-x-8 gap-y-4">
            <li v-for="example in entry.variants" :key="example.id" class="max-w-full min-w-0 space-y-1">
              <p class="text-xs text-muted">{{ example.label ?? example.id }}</p>
              <UiCatalogSample
                :component="component" :sample-key="`${row.name}:variant:${example.id}`" :props="example.props" :slot-text="example.slot" :open="example.open" :trigger="example.trigger"
                :host="entry.host" :demo-tasks="example.demoTasks" :fixture="fixtureOf(example.fixture)" :launch="entry.launch"
              />
            </li>
          </ul>
        </section>

        <section v-if="entry.states.length" :aria-label="`${row.name} states`" class="space-y-2">
          <component :is="`h${headingLevel + 1}`" class="text-xs text-muted">States</component>
          <ul class="flex flex-wrap items-start gap-x-8 gap-y-4">
            <li v-for="example in entry.states" :key="example.id" class="max-w-full min-w-0 space-y-1">
              <p class="text-xs text-muted">{{ example.label ?? example.state }}</p>
              <UiCatalogSample
                :component="component" :sample-key="`${row.name}:state:${example.id}`" :state="example.state" :props="example.props" :slot-text="example.slot" :open="example.open" :trigger="example.trigger"
                :host="entry.host" :demo-tasks="example.demoTasks" :fixture="fixtureOf(example.fixture)" :launch="entry.launch"
              />
            </li>
          </ul>
        </section>
      </div>
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import UiCatalogSample from './CatalogSample.vue'
import UiCatalogSegmentedChoice from './SegmentedChoice.vue'
import { axesInUse, buildCompactMatrix, buildMatrix, type ManifestRow } from './catalogModel'
import type { ResolvedEntry } from './useCatalog'

defineOptions({ name: 'UiCatalogComponentCard' })

const props = withDefaults(defineProps<{
  row: ManifestRow
  resolved?: ResolvedEntry
  viewport: 'desktop' | 'mobile'
  /** 2 on the page of a component, 4 under a category heading of the one-page view. */
  headingLevel?: 2 | 4
  /** The one-page view: start on the whole theme, so every sample of the entry is on the page. */
  full?: boolean
}>(), { headingLevel: 2, full: false })

const entry = computed(() => props.resolved?.entry)
const component = computed(() => props.resolved?.component)
const fixtureOf = (name?: string) => (name ? props.resolved?.fixtures[name] : undefined)

const values = ref<'used' | 'theme'>(props.full ? 'theme' : 'used')
const axes = computed(() => props.resolved?.axes ?? [])
const usedAxes = computed(() => axesInUse(axes.value, props.row.usedValues))
/** The switch is there only when the theme defines more than the app uses. */
const hasThemeChoice = computed(() => Boolean(entry.value?.matrix) && usedAxes.value.some((axis, index) => axis.values.length < (axes.value[index]?.values.length ?? 0)))
const matrix = computed(() => {
  if (!entry.value?.matrix) return []
  return values.value === 'theme' || !hasThemeChoice.value ? buildMatrix(axes.value, entry.value.matrix.props) : buildCompactMatrix(usedAxes.value, entry.value.matrix.props)
})

const consumers = computed(() => {
  const count = Object.values(props.row.usedBy).reduce((sum, n) => sum + n, 0)
  return count === 1 ? 'used in 1 file' : `used in ${count} files`
})
const frameStyle = computed(() => (props.viewport === 'mobile' ? { width: '390px', maxWidth: '100%' } : undefined))
</script>
