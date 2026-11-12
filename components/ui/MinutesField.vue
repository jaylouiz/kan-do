<!--
@component MinutesField
@kind primitive
@category input
@description The minutes value of a property row: a short number field with its unit ("min") beside it, on a dotted rule at rest and a filled, rounded field while it is edited. Timebox and time spent in the task sheet and the add form's Timebox are this one field.
@usage <MinutesField v-model.number="minutes" min="0" :aria-label="t('task.timebox')" data-testid="timebox-edit-input" @keydown.enter="save" />; or `:value` with `@input` where the host parses the value itself. Attributes and listeners land on the `<input>`.
@avoid Not a bordered form field (UInput) and not the in-card minutes of the timebox nudge (TaskTimeboxNudge, sized for the card). Only for a duration in minutes inside a label/value row.
@responsibility
- Render the row-high wrapper (the field height, `--field-h`), the number input without spin buttons, and the unit from `duration.unitMinute`
- At rest the value sits on the dotted rule of a free value (darker on hover); focused it is a field: the select's fill and radius and the one focus halo, which follows the rounded shape (kd#225: the halo was a sharp box around bare text). The text does not move between the two: the box reaches 8 px left of the value column, like InlineEditable's trigger
- `v-model.number` gives a number (the typed text while it is not one, like a native input); without `v-model` the host's `value` and `@input` apply unchanged
- The unit is decoration for sighted users; the host names the field (`aria-label` or `aria-labelledby`)
-->
<template>
  <div class="flex h-(--field-h) items-center gap-1.5">
    <input
      :value="model"
      type="number"
      class="minutes-field -ms-2 h-(--field-h) w-18 bg-transparent px-2 py-0 text-sm placeholder:text-muted focus-ring focus:rounded-md focus:bg-muted"
      v-bind="$attrs"
      @input="onInput"
    >
    <span class="text-sm text-muted">{{ t('duration.unitMinute') }}</span>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'MinutesField', inheritAttrs: false })

const [model, modifiers] = defineModel<number | string>()
const { t } = useI18n()

/** `.number` like a native `v-model.number`: the parsed number, or the raw text while it is not one. */
function onInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  const parsed = Number.parseFloat(raw)
  model.value = modifiers.number && !Number.isNaN(parsed) ? parsed : raw
}
</script>

<style scoped>
/* No spin buttons: the value is typed, and the field is too short for them. The rule is the bottom edge of a box
   whose other edges are transparent, so the text keeps its place when the box turns into the filled field. */
.minutes-field {
  appearance: textfield;
  border: 1px solid transparent;
  border-bottom: 1px dotted var(--ui-border-muted);
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard);
}

.minutes-field:hover {
  border-bottom-color: var(--ui-border-accented);
}

.minutes-field:focus {
  border-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .minutes-field {
    transition: none;
  }
}

.minutes-field::-webkit-inner-spin-button,
.minutes-field::-webkit-outer-spin-button {
  appearance: none;
}
</style>
