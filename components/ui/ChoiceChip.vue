<!--
@component ChoiceChip
@kind primitive
@category input
@description The one control for "pick one of a few" (#72, kd#178): a pill-shaped answer chip at the field height (36 px, 44 px on a phone and on touch), in the primary wash with primary text; a darker wash on hover, the solid primary when picked. The new-card flow's answers, the timebox nudge's presets, its icon controls and the board menu's grouping choice are this one chip.
@usage <ChoiceChip :picked="picked === value" :current="value === current" @click="pick(value)">{{ label }}</ChoiceChip>; `square` for an icon alone where the options are symbols (give it an `aria-label`); `field` makes it read as the search field it opens (dashed outline, muted). A toggle that stays on beside others is the chip too: bind `picked` and keep `aria-pressed`. Native attributes (`disabled`, `aria-*`, `data-testid`, `type`) land on the button.
@avoid Not for an action (UButton), not for a property value of the task sheet (a list value is a TaskPropertySelect, a free one an InlineEditable; DESIGN.md "Components") and not for an option inside a list (a row of the select menu's item look, as NewCardOptionList). Options with a description are a ChoiceCard.
@responsibility
- Render one native `<button type="button">`; the host decides what a click means and sets `picked` (the answer just given, or the toggle that is on: solid primary, pressed in) and `current` (the value already set: a hairline ring)
- One height, `--field-h` (assets/css/main.css), and one shape; `square` makes an icon-only chip as wide as it is tall. There is no size or shape prop: a host that needs room (the new-card flow's grid) lays the chip out, it does not resize it
- Hover, press, the hand cursor and the disabled look come from the base layer (DESIGN.md "States"); the focus halo is `focus-ring`
- Key cues (`<kbd>`) and truncation spans are slot content; the host lays them out
-->
<template>
  <button
    type="button"
    class="choice-chip focus-ring"
    :class="{ 'is-picked': picked, 'is-current': current, 'choice-chip--field': field, 'choice-chip--square': square }"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineOptions({ name: 'ChoiceChip' });

withDefaults(
  defineProps<{
    /** The answer just given, or the toggle that is on (solid primary) */
    picked?: boolean;
    /** The value that is already set (hairline ring) */
    current?: boolean;
    /** A chip that reads as the search field it opens: dashed outline, muted, text cursor */
    field?: boolean;
    /** Holds only an icon: as wide as it is tall (give it an `aria-label`) */
    square?: boolean;
  }>(),
  { picked: false, current: false, field: false, square: false },
);
</script>

<style scoped>
.choice-chip {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-width: 0;
  height: var(--field-h);
  padding: 0 0.75rem;
  border-radius: 9999px; /* the stack pill's radius (TaskStackPill) */
  /* The primary wash with primary text: an answer reads as an option, not as a disabled grey pill (#114); `bg-primary/10` of StatsVerdict */
  background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
  color: var(--ui-primary);
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1rem;
  white-space: nowrap;
}

/* An icon alone: square */
.choice-chip--square {
  width: var(--field-h);
  padding: 0;
}

/* Hover: the wash one step darker (DESIGN.md "States"); the answer given is the solid primary and sits pressed in */
.choice-chip:hover:not(:disabled) {
  background: color-mix(in oklab, var(--ui-primary) 18%, transparent);
}

.choice-chip.is-picked,
.choice-chip.is-picked:hover:not(:disabled) {
  background: var(--ui-primary);
  color: var(--ui-bg);
  scale: 0.97;
}

.choice-chip.is-current:not(.is-picked) {
  box-shadow: inset 0 0 0 1px var(--ui-border-accented);
}

/* field: looks like the input it opens (dashed outline, muted text), so it reads as a field and not as a value (kd#16) */
.choice-chip--field {
  justify-content: flex-start;
  border: 1px dashed var(--ui-border-accented);
  background: transparent;
  color: var(--ui-text-muted);
  cursor: text;
}

.choice-chip.choice-chip--field:hover:not(:disabled) {
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

@media (prefers-reduced-motion: reduce) {
  .choice-chip.is-picked {
    scale: none;
  }
}
</style>
