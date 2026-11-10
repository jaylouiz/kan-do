<!--
@component AppDialog
@kind compound
@category overlay
@description The one dialog of the app: a UModal in one of the three named widths, with the theme's header, rules and footer.
@usage <AppDialog v-model:open="isOpen" size="sm" :title="t('...')"> with `#body` and `#footer`. `size`: `sm` confirmations and one-field prompts, `md` (default) settings and simple forms, `lg` wide content (wizard, task detail). `hide-description` keeps a `description` for screen readers only. Every other UModal prop, event and slot passes through (`dismissible`, `close`, `content`, `@after:leave`).
@avoid Not for an overlay that becomes a bottom drawer on a phone (ResponsiveOverlay), not for the task sheet (TaskSheet), and never a bare UModal with its own max-width class.
@responsibility
- Apply the width of `utils/modalSizes.ts` by name, so no call site passes a `ui` prop for it
- Merge a call site's `ui` (placing a part: a flush body, a scrolling body) over the width and the hidden description
- Pass attributes, events and every slot through to UModal unchanged
-->
<template>
  <UModal v-bind="$attrs" :ui="mergedUi">
    <template v-for="(_, name) in $slots" :key="name" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MODAL_WIDTH, type ModalWidth } from '~/utils/modalSizes'

defineOptions({ name: 'AppDialog', inheritAttrs: false })

const props = withDefaults(defineProps<{
  size?: ModalWidth
  /** Keep the description for assistive tech and hide it visually (a title that says it all). */
  hideDescription?: boolean
  /** Places a part of the modal (body padding, scrolling); the width comes from `size`. */
  ui?: Record<string, string>
}>(), { size: 'md', hideDescription: false, ui: undefined })

const mergedUi = computed(() => ({
  content: MODAL_WIDTH[props.size],
  ...(props.hideDescription ? { description: 'sr-only' } : {}),
  ...props.ui,
}))
</script>
