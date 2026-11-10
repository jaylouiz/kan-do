<!--
@component PropertyValueTrigger
@kind primitive
@category input
@description The text-style trigger of a free value in the task sheet's label/value rows (#72): body text with a faint dotted rule at rest (darker on hover and focus, #114), the same grammar as InlineEditable. It opens the date popover or applies a value (a timebox preset or suggestion); a value that opens a list is a TaskPropertySelect.
@usage <PropertyValueTrigger tone="value" class="-ms-2" inset @click="open">{{ text }}</PropertyValueTrigger>; `tone` `value` (a set value), `empty` (nothing set yet), `action` (a quiet text action such as a suggestion), `picked` (the preset that is set; pass `aria-pressed`). `inset` adds the horizontal padding the sheet's rows use.
@avoid Not a button look for actions (UButton), not for the choice of one answer of a question (ChoiceChip), not for a value that opens a list (TaskPropertySelect) and not for editing text in place (InlineEditable). The trigger carries a label/value pair only inside TaskPropertyRow.
@responsibility
- Render one native `<button type="button">` with the `task-property-value` rule (global CSS `assets/css/task-detail.css`: faint dotted rule at rest on every pointer, darker on hover and focus, focus ring)
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
