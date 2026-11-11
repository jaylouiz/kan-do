<!--
@component MinutesField
@kind primitive
@category input
@description The minutes value of a property row: a short number field on a dotted rule with its unit ("min") beside it. Timebox and time spent in the task sheet and the add form's Timebox are this one field.
@usage <MinutesField v-model.number="minutes" min="0" :aria-label="t('task.timebox')" data-testid="timebox-edit-input" @keydown.enter="save" />; or `:value` with `@input` where the host parses the value itself. Attributes and listeners land on the `<input>`.
@avoid Not a bordered form field (UInput) and not the in-card minutes of the timebox nudge (TaskTimeboxNudge, sized for the card). Only for a duration in minutes inside a label/value row.
@responsibility
- Render the row-high wrapper (the field height, `--field-h`), the number input without spin buttons on a dotted rule, and the unit from `duration.unitMinute`
- `v-model.number` gives a number (the typed text while it is not one, like a native input); without `v-model` the host's `value` and `@input` apply unchanged
- The unit is decoration for sighted users; the host names the field (`aria-label` or `aria-labelledby`)
-->
<template>
  <div class="flex h-(--field-h) items-center gap-1.5">
    <input
      :value="model"
      type="number"
      class="minutes-field h-(--field-h) w-14 border-0 border-b border-dotted border-muted bg-transparent py-0 text-sm placeholder:text-muted focus-ring"
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
/* No spin buttons: the value is typed, and the field is too short for them */
.minutes-field {
  appearance: textfield;
}

.minutes-field::-webkit-inner-spin-button,
.minutes-field::-webkit-outer-spin-button {
  appearance: none;
}
</style>
