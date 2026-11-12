<!--
@component ListRow
@kind compound
@category display
@description One hairline-divided list row (#76, kd#180): content on the left, trailing actions on the right (the slot's own flex children), no card. One density (56 px at least) and one hover (a muted tint). The static row holds whatever the slot gives it; the `action` row is one full-width button (open, expand) with the focus ring and a 56 px target.
@usage <ul class="divide-y divide-default"><ListRow>…the row's own flex children, trailing buttons last…</ListRow></ul> inside a PageSheet; `action` with `@click` for a row that opens something; `to="/settings/github"` for a row that is a link to a page (the settings sub-pages, kd#179); `#after` holds what unfolds below an action row.
@avoid Not a card (TaskCard, UCard) and not a table row (UTable); a row that is only text with no trailing part is a plain `<li>`.
@responsibility
- Render the `<li>`; the surrounding `<ul class="divide-y divide-default">` draws the hairlines
- `to`: the row is one `NuxtLink` (it wins over `action`: no button, `expanded`, `label`, `#after` or `focus()`; `min-h-14`, focus ring), laid out `-mx-2 px-2` so its icon lines up with the rows of the list above (#683) and the tint has room around the text, `@click` is re-emitted so a host (a dialog) can close itself while the link navigates; `buttonTestid` names the link
- One density and one hover (kd#180): `min-h-14 py-3`, and on hover (action and link rows) a `bg-muted` wash with 12 px corners (`bg-elevated` is white and shows nothing on a white sheet); the row's own text colours stay
- `action`: the slot (use a `<span class="flex …">` for its layout) sits inside one `<button>` with `focus-ring`, `min-h-14`, the same `-mx-2 px-2` box as the link row (`box-content w-full`: a button does not stretch, so the box is the row's width plus the 8 px each side), `aria-expanded` from `expanded`, `aria-label` from `label`; `focus()` is exposed for hosts that return focus to the row
- Attributes (`data-testid`, …) land on the `<li>`; `buttonTestid` names the action button
-->
<template>
  <li :class="to || action ? '' : 'flex min-h-14 flex-wrap items-center gap-x-4 py-3'" v-bind="$attrs">
    <template v-if="action && !to">
      <button
        ref="button"
        type="button"
        class="-mx-2 box-content block min-h-14 w-full rounded-md px-2 py-3 text-left focus-ring hover:bg-muted"
        :aria-expanded="expanded"
        :aria-label="label"
        :data-testid="buttonTestid"
        @click="emit('click')"
      >
        <slot />
      </button>
      <slot name="after" />
    </template>
    <NuxtLink
      v-else-if="to"
      :to="to"
      class="-mx-2 block min-h-14 rounded-md px-2 py-3 focus-ring hover:bg-muted"
      :data-testid="buttonTestid"
      @click="emit('click')"
    >
      <slot />
    </NuxtLink>
    <template v-else>
      <slot />
    </template>
  </li>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineOptions({ name: 'ListRow', inheritAttrs: false })

withDefaults(defineProps<{
  action?: boolean
  /** A row that links to a page: one `NuxtLink` instead of the action button. */
  to?: string
  expanded?: boolean
  label?: string
  buttonTestid?: string
}>(), { action: false, to: undefined, expanded: undefined, label: undefined, buttonTestid: undefined })

const emit = defineEmits<{ click: [] }>()

const button = ref<HTMLButtonElement | null>(null)
defineExpose({ focus: () => button.value?.focus() })
</script>
