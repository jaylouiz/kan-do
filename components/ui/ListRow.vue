<!--
@component ListRow
@kind compound
@category display
@description One hairline-divided list row (#76): content on the left, trailing actions on the right (the slot's own flex children), no card. The static row holds whatever the slot gives it; the `action` row is one full-width button (open, expand) with the focus ring and a 44 px target.
@usage <ul class="divide-y divide-default"><ListRow density="roomy">…the row's own flex children, trailing buttons last…</ListRow></ul>; `action` with `@click` for a row that opens something; `#after` holds what unfolds below an action row.
@avoid Not a card (TaskCard, UCard) and not a table row (UTable); a row that is only text with no trailing part is a plain `<li>`.
@responsibility
- Render the `<li>`; the surrounding `<ul class="divide-y divide-default">` draws the hairlines
- `density` sets the vertical rhythm: roomy (sources), cozy (action rows), compact (backups)
- `action`: the slot (use a `<span class="flex …">` for its layout) sits inside one `<button>` with `focus-ring`, `min-h-11`, `aria-expanded` from `expanded`, `aria-label` from `label`; `focus()` is exposed for hosts that return focus to the row
- Attributes (`data-testid`, …) land on the `<li>`; `buttonTestid` names the action button
-->
<template>
  <li class="flex flex-wrap items-center gap-x-4" :class="action ? '' : DENSITY[density]" v-bind="$attrs">
    <template v-if="action">
      <button
        ref="button"
        type="button"
        class="block min-h-11 w-full text-left focus-ring"
        :class="[DENSITY[density], 'hover:text-highlighted']"
        :aria-expanded="expanded"
        :aria-label="label"
        :data-testid="buttonTestid"
        @click="emit('click')"
      >
        <slot />
      </button>
      <slot name="after" />
    </template>
    <template v-else>
      <slot />
    </template>
  </li>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ name: 'ListRow', inheritAttrs: false })

withDefaults(defineProps<{
  density?: 'roomy' | 'cozy' | 'compact'
  action?: boolean
  expanded?: boolean
  label?: string
  buttonTestid?: string
}>(), { density: 'cozy', action: false, expanded: undefined, label: undefined, buttonTestid: undefined })

const emit = defineEmits<{ click: [] }>()

const DENSITY = { roomy: 'py-4', cozy: 'py-2.5', compact: 'min-h-11 py-1.5' } as const

const button = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => button.value?.focus() })
</script>
