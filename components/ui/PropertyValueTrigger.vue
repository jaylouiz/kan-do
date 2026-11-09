<!--
@component PropertyValueTrigger
@kind primitive
@category input
@description The text-style trigger of a value in the task sheet's label/value rows (#72): body text whose dotted rule appears on hover and focus, the same grammar as InlineEditable. It opens a picker (the date popover) or applies a value (a timebox preset or suggestion).
@usage <PropertyValueTrigger tone="value" class="-ms-2" inset @click="open">{{ text }}</PropertyValueTrigger>; `tone` `value` (a set value), `empty` (nothing set yet), `action` (a quiet text action such as a suggestion), `picked` (the preset that is set; pass `aria-pressed`). `inset` adds the horizontal padding the sheet's rows use.
@avoid Not a button look for actions (UButton), not for the choice of one answer of a question (ChoiceChip) and not for editing text in place (InlineEditable). The trigger carries a label/value pair only inside TaskPropertyRow.
@responsibility
- Render one native `<button type="button">` with the `task-property-value` rule (global CSS `assets/css/task-detail.css`: dotted rule on hover and focus, faint at rest on touch screens, focus ring)
- 32 px tall, 44 px on a phone (`max-md:min-h-11`); text-sm; the tone sets the colour, `picked` also the weight and underline
- Attributes (`aria-label`, `aria-pressed`, `data-testid`, `disabled`, handlers) land on the button
-->
<template>
  <button
    type="button"
    class="task-property-value flex min-h-8 cursor-pointer items-center rounded-sm text-sm max-md:min-h-11"
    :class="[inset ? 'px-2' : '', TONE[tone]]"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineOptions({ name: 'PropertyValueTrigger' });

type Tone = 'value' | 'empty' | 'action' | 'picked';

withDefaults(
  defineProps<{
    /** `value` a set value, `empty` nothing set yet, `action` a quiet text action, `picked` the preset that is set */
    tone?: Tone;
    /** The horizontal padding of the sheet's rows (`px-2`) */
    inset?: boolean;
  }>(),
  { tone: 'value', inset: false },
);

const TONE: Record<Tone, string> = {
  value: 'text-default',
  empty: 'text-muted',
  action: 'text-muted hover:text-default',
  picked: 'font-semibold text-highlighted underline underline-offset-4',
};
</script>
