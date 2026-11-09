<!--
@component UiCatalogSegmentedChoice
@description One labelled group of toggle buttons for the `/ui` Components part (#66): the variant, state, viewport and language switchers.
@usage <UiCatalogSegmentedChoice v-model="state" label="State" :options="[{ value: '', label: 'All' }, { value: 'disabled', label: 'disabled' }]" />
@responsibility
- A fieldset with a legend; each option is a native button with `aria-pressed`, so it works from the keyboard and reads right in a screen reader
- Single choice; the options decide what an empty value means (the callers use `''` for "All")
- Chrome of the dev tool: English, light only, semantic tokens
-->
<template>
  <fieldset class="flex flex-wrap items-center gap-x-2 gap-y-1">
    <legend class="float-left mr-2 text-xs text-muted">{{ label }}</legend>
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="model === option.value"
      class="min-h-8 rounded-md border px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      :class="model === option.value ? 'border-inverted bg-inverted text-inverted' : 'border-default bg-default text-default hover:bg-muted'"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </fieldset>
</template>

<script setup lang="ts">
defineOptions({ name: 'UiCatalogSegmentedChoice' })

defineProps<{
  label: string
  options: { value: string, label: string }[]
}>()

const model = defineModel<string>({ required: true })
</script>
