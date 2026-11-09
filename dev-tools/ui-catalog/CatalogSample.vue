<!--
@component UiCatalogSample
@description One live sample of a component in the `/ui` Components part (#66): the real component with the props and default slot of an entry example.
@usage <UiCatalogSample :component="Button" sample-key="UButton:state:disabled" :props="{ disabled: true }" slot-text="Save" />
@responsibility
- Render the component with `v-bind` of the resolved props and the slot text; the component is the one the app uses, never a copy
- Mark the wrapper `data-kd-sample="<component>:<group>:<id>"`; the fingerprint spec (tests/e2e/ui-catalog.spec.ts) records the computed styles of its first child by that key
- Mark `data-kd-state="focus"` samples: the spec focuses them before it records (a focus ring exists only while focused)
- Resolve `{ $t: key }` copy with the active app locale, so the language toggle switches the sample copy and nothing else
-->
<template>
  <div class="inline-flex max-w-full min-w-0 items-center" :data-kd-sample="sampleKey" :data-kd-state="state || undefined">
    <component :is="component" v-bind="resolvedProps">
      <template v-if="resolvedSlot !== undefined">{{ resolvedSlot }}</template>
    </component>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CatalogProps, I18nRef } from '~/catalog/types'
import { resolveProps, resolveSlot } from './catalogModel'

defineOptions({ name: 'UiCatalogSample' })

const props = defineProps<{
  component: Component
  sampleKey: string
  props?: CatalogProps
  slotText?: string | I18nRef
  state?: string
  open?: boolean
}>()

const { t } = useI18n()
const resolvedProps = computed(() => {
  const resolved = resolveProps(props.props, t)
  return props.open ? { ...resolved, open: true } : resolved
})
const resolvedSlot = computed(() => resolveSlot(props.slotText, t))
</script>
