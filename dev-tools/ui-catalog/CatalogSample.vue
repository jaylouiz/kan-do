<!--
@component UiCatalogSample
@description One live sample of a component on `/ui` (#66, kd#127): the real component with the props and default slot of an entry example, from plain data or a fixture.
@usage <UiCatalogSample :component="Button" sample-key="UButton:state:disabled" :props="{ disabled: true }" slot-text="Save" />
@responsibility
- Render the component with `v-bind` of the resolved props and the slot text; the component is the one the app uses, never a copy
- Mark the wrapper `data-kd-sample="<component>:<group>:<id>"`; the fingerprint spec (tests/e2e/ui-catalog.spec.ts) records the computed styles of its first child (of the host frame `data-kd-board-host` for a hosted sample: the component, never the frame) by that key
- A tile preview (`preview`) is the same sample marked `data-kd-preview` instead: it repeats a sample of the component's page, so the fingerprint and the sample counts skip it
- Mark `data-kd-state="focus"` samples: the spec focuses them before it records (a focus ring exists only while focused)
- Entries with a `host` render inside it (UiCatalogBoardHost: throwaway Pinia with the demo board, #77) and receive the `tasks` of `demoTasks`
- A `fixture` runs inside the sample (and its host), so it reads and seeds the sample's own stores; its props go over the entry's
- An overlay entry (`launch`) shows an "Open" button that sets the named prop and takes it back when the overlay closes; it is marked `data-kd-launch`, not a fingerprinted sample (a closed overlay has no look)
- Resolve `{ $t: key }` copy with the active app locale, so the language toggle switches the sample copy and nothing else
-->
<template>
  <div
    class="inline-flex max-w-full min-w-0 items-center [&>*]:max-w-full"
    :data-kd-sample="preview || launch ? undefined : sampleKey"
    :data-kd-preview="preview ? sampleKey : undefined"
    :data-kd-launch="launch && !preview ? sampleKey : undefined"
    :data-kd-state="state || undefined"
  >
    <UButton v-if="launch" color="neutral" variant="outline" size="sm" @click="launched = true">Open</UButton>
    <UiCatalogBoardHost v-if="host === 'board'" v-slot="{ tasksFor }">
      <FixtureScope v-slot="{ fixtureProps }" :fixture="fixture" :context="fixtureContext">
        <component :is="component" v-bind="{ ...resolvedProps, ...(demoTasks ? { tasks: tasksFor(demoTasks) } : {}), ...fixtureProps, ...launchProps }" />
      </FixtureScope>
    </UiCatalogBoardHost>
    <FixtureScope v-else v-slot="{ fixtureProps }" :fixture="fixture" :context="fixtureContext">
      <component :is="component" v-bind="{ ...resolvedProps, ...fixtureProps, ...launchProps }">
        <UButton v-if="trigger && resolvedSlot !== undefined" color="neutral" variant="outline">{{ resolvedSlot }}</UButton>
        <template v-else-if="resolvedSlot !== undefined">{{ resolvedSlot }}</template>
      </component>
    </FixtureScope>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, ref, type Component, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CatalogDemoTasks, CatalogHost, CatalogProps, I18nRef } from '~/catalog/types'
import UiCatalogBoardHost from './BoardSampleHost.vue'
import { resolveProps, resolveSlot } from './catalogModel'
import type { CatalogFixture } from './useCatalog'

defineOptions({ name: 'UiCatalogSample' })

const props = defineProps<{
  component: Component
  sampleKey: string
  props?: CatalogProps
  slotText?: string | I18nRef
  state?: string
  open?: boolean
  trigger?: boolean
  host?: CatalogHost
  demoTasks?: CatalogDemoTasks
  /** The fixture of the example, already loaded (useCatalog). */
  fixture?: CatalogFixture
  /** Overlay entries: the prop that opens the component (`open`, `modelValue`). */
  launch?: string
  /** Tile preview: the same sample, outside the fingerprint. */
  preview?: boolean
}>()

/**
 * Runs the fixture during its own setup, below the sample host: a store the fixture resolves is the sample's Pinia, not
 * the app's (`inject` in the host itself would still find the app's). The props are built once; a locale switch
 * re-renders the copy an entry gives by key, a fixture's own text stays as built.
 */
const FixtureScope = defineComponent({
  name: 'UiCatalogFixtureScope',
  props: {
    fixture: { type: Function as PropType<CatalogFixture>, default: undefined },
    context: { type: Object as PropType<Parameters<CatalogFixture>[0]>, required: true },
  },
  setup(scopeProps, { slots }) {
    const fixtureProps = scopeProps.fixture ? scopeProps.fixture(scopeProps.context) : {}
    return () => slots.default?.({ fixtureProps })
  },
})

const { t, locale } = useI18n()
const fixtureContext = computed(() => ({ t, locale: locale.value }))
const resolvedProps = computed(() => {
  const resolved = resolveProps(props.props, t)
  return props.open ? { ...resolved, open: true } : resolved
})
const resolvedSlot = computed(() => resolveSlot(props.slotText, t))

const launched = ref(false)
const launchProps = computed(() => (props.launch
  ? { [props.launch]: launched.value, [`onUpdate:${props.launch}`]: (value: boolean) => { launched.value = value } }
  : {}))
</script>
