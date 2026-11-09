<!--
@component ChoiceChip
@kind primitive
@category input
@description The one control for "pick one of a few" (#72): a round answer chip that fills with ink on hover and when picked, or a list row of a searchable option list. The new-card flow's answer pills, the timebox nudge's presets and icon controls and the new-card option rows are this one look.
@usage <ChoiceChip shape="pill" :picked="picked === value" :current="value === current" @click="pick(value)">{{ label }}</ChoiceChip>; `chip` (equal-width preset in a row), `icon` (square-round control, give it an `aria-label`), `row` (full-width option inside a list, `aria-current` marks the current one); `field` makes a pill read as the search field it opens. Native attributes (`disabled`, `aria-*`, `data-testid`) land on the button.
@avoid Not for an action (UButton), not for a toggle that stays on beside others (UButton soft/primary with `aria-pressed`, as the board menu's group-by chips) and not for a property value of the task sheet (PropertyValueTrigger).
@responsibility
- Render one native `<button type="button">`; the host decides what a click means and sets `picked` (the answer just given: ink fill, pressed in) and `current` (the value already set: a hairline ring)
- Shapes carry the geometry each site had: `pill` takes its height from `--choice-chip-h` (the new-card flow sets it to its control height), `chip` and `icon` are 36 px (44 px on a phone and on touch screens), `row` is a 32 px list row (44 px and larger text when `large`, the drawer's)
- Ink hover and the picked state ("one lamp": only the answered control is dark); visible focus ring; disabled `chip` and `icon` dim, a disabled `pill` keeps its look and loses the pointer
- Key cues (`<kbd>`) and truncation spans are slot content; the host lays them out
-->
<template>
  <button
    type="button"
    class="choice-chip"
    :class="[
      shape === 'row' ? rowClass : `choice-chip--${shape}`,
      { 'is-picked': picked, 'is-current': current, 'choice-chip--field': field },
    ]"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'ChoiceChip' });

const props = withDefaults(
  defineProps<{
    /** `pill` an answer of the new-card flow, `chip` an equal-width preset, `icon` a round icon control, `row` an option in a list */
    shape?: 'pill' | 'chip' | 'icon' | 'row';
    /** The answer just given (ink fill) */
    picked?: boolean;
    /** The value that is already set (hairline ring) */
    current?: boolean;
    /** A pill that reads as the search field it opens: dashed outline, muted, text cursor */
    field?: boolean;
    /** `row` only: the drawer's bigger targets and text */
    large?: boolean;
  }>(),
  { shape: 'pill', picked: false, current: false, field: false, large: false },
);

const rowClass = computed(
  () =>
    `choice-chip--row flex w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-default hover:bg-elevated focus-visible:bg-elevated aria-current:font-semibold aria-current:text-highlighted ${props.large ? 'min-h-11 text-base' : 'min-h-8 text-sm'}`,
);
</script>

<style scoped>
/* The three chip shapes share one look; the row has its own (utilities above) and none of this */
:where(.choice-chip:not(.choice-chip--row)) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  min-width: 0;
  border-radius: 9999px; /* the stack pill's radius (TaskStackPill) */
  background: var(--ui-bg-muted);
  color: var(--ui-text);
  font-weight: 500;
  line-height: 1rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--duration-fast) var(--ease-standard),
    color var(--duration-fast) var(--ease-standard),
    transform var(--duration-fast) var(--ease-standard);
}

/* pill: the new-card flow's answers; names of different length share the row by their own width */
.choice-chip--pill {
  flex: 0 1 auto;
  height: var(--choice-chip-h, 2rem);
  padding: 0 0.625rem;
  gap: 0.25rem;
  font-size: var(--text-sm);
}

/* chip: equal-width presets in a row; icon: the same height, square */
.choice-chip--chip,
.choice-chip--icon {
  height: 2.25rem;
  font-size: var(--text-xs);
}

.choice-chip--chip {
  flex: 1 1 0;
  padding: 0 0.75rem;
}

.choice-chip--icon {
  flex: 0 0 2.25rem;
  width: 2.25rem;
  padding: 0;
}

/* Ink hover; the picked one keeps it and presses in (one lamp: only the answered control is dark) */
.choice-chip:not(.choice-chip--row):hover:not(:disabled),
.choice-chip:not(.choice-chip--row):active:not(:disabled),
.choice-chip.is-picked {
  background: var(--ui-primary);
  color: var(--ui-bg);
}

.choice-chip:not(.choice-chip--row):active:not(:disabled),
.choice-chip.is-picked {
  transform: scale(0.97);
}

.choice-chip--pill.is-current:not(.is-picked) {
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

.choice-chip.choice-chip--field:hover:not(:disabled),
.choice-chip.choice-chip--field:active:not(:disabled) {
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.choice-chip:not(.choice-chip--row):focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.choice-chip--pill:disabled {
  cursor: default;
}

.choice-chip--chip:disabled,
.choice-chip--icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Phone and any touch screen: the 44 px touch floor */
@media (--phone), (hover: none) and (pointer: coarse) {
  .choice-chip--chip,
  .choice-chip--icon {
    height: 2.75rem;
  }

  .choice-chip--icon {
    flex-basis: 2.75rem;
    width: 2.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .choice-chip {
    transition-duration: 0ms;
  }

  .choice-chip--chip:active:not(:disabled),
  .choice-chip--chip.is-picked,
  .choice-chip--icon:active:not(:disabled) {
    transform: none;
  }
}
</style>
