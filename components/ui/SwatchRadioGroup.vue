<!--
@component SwatchRadioGroup
@kind primitive
@category input
@description One choice from a small set of swatches or glyphs, shown as round colour swatches or a grid of glyph cells (#72; the topic editor's Farbe and Symbol, #431). A radio group whose options are pictures, not labelled rows.
@usage <SwatchRadioGroup v-model="hue" variant="swatch" :options="[{ key: null, label: 'keine' }, { key: 'red', label: 'Rot' }]" :label="t('topic.editor.color')" item-testid="topic-hue"><template #option="{ option }">…the swatch…</template></SwatchRadioGroup>; `variant="glyph"` with `:columns="5"` for a grid (ArrowUp/Down move by a row); `@pick` fires on a click, not on arrow keys.
@avoid Not for options that carry a text label (URadioGroup), not for a card choice with an icon and a description (reka-ui RadioGroup as in LocalSetupFlow) and not for a toggle of one setting (USwitch, UCheckbox).
@responsibility
- Render `role="radiogroup"` with one native `<button role="radio">` per option (`aria-checked`, `aria-label` from the option); roving tabindex: the selected option (else the first) is the one Tab stop
- Arrow keys move the focus and the selection to the neighbour (wrapping), Home/End to the ends, with `columns` Up/Down by a row (`utils/radioArrowKeys`); no library radio group does a grid, which is why this stays a hand-built role (decision D3 of #72)
- `swatch` 28 px round (40 px on a phone, the ring marks the selection), `glyph` 40 px cells (the `none` cell in a hairline); the solid ink focus ring
- Option content (the dot, the glyph) is the `option` slot; `focusSelected()` is exposed for hosts that move focus in on open
- `item-testid` names the options `<prefix>-<key|none>`; attributes of the host (the group's `data-testid`) land on the group
-->
<template>
  <div role="radiogroup" :aria-label="label">
    <button
      v-for="(option, index) in options"
      :key="option.key ?? 'none'"
      :ref="(el) => setRef(el, index)"
      type="button"
      role="radio"
      class="swatch-radio"
      :class="[`swatch-radio--${variant}`, option.key === null ? 'swatch-radio--none' : '']"
      :aria-checked="model === option.key"
      :aria-label="option.label"
      :tabindex="tabbable === index ? 0 : -1"
      :data-testid="itemTestid ? `${itemTestid}-${option.key ?? 'none'}` : undefined"
      @click="onClick(option)"
      @keydown="onKey"
    >
      <slot name="option" :option="option" :selected="model === option.key" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { onRadioKeydown } from '~/utils/radioArrowKeys';

defineOptions({ name: 'SwatchRadioGroup' });

interface SwatchOption {
  /** `null` is the "none" option */
  key: string | null;
  /** The accessible name */
  label: string;
}

const props = withDefaults(
  defineProps<{
    options: readonly SwatchOption[];
    /** The group's accessible name */
    label: string;
    variant?: 'swatch' | 'glyph';
    /** Grid width: ArrowUp/Down move by this many options */
    columns?: number;
    /** Prefix of the options' test ids */
    itemTestid?: string;
  }>(),
  { variant: 'swatch', columns: 1, itemTestid: undefined },
);

const model = defineModel<string | null>({ required: true });
const emit = defineEmits<{ pick: [key: string | null] }>();

const refs: HTMLElement[] = [];
const setRef = (el: unknown, index: number) => {
  if (el instanceof HTMLElement) refs[index] = el;
};

// Roving tabindex: the selected option (else the first) is the one Tab stops on
const tabbable = computed(() => Math.max(0, props.options.findIndex((option) => option.key === model.value)));

function onClick(option: SwatchOption) {
  model.value = option.key;
  emit('pick', option.key);
}

function onKey(event: KeyboardEvent) {
  const next = onRadioKeydown(event, refs, props.columns);
  if (next !== null) model.value = props.options[next]?.key ?? null;
}

function focusSelected(options?: FocusOptions) {
  refs[tabbable.value]?.focus(options);
}

defineExpose({ focusSelected });
</script>

<style scoped>
.swatch-radio {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.swatch-radio:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

/* Swatches: 28px, 40px on touch widths (#431). The ring marks the selection; focus is the project's solid ink ring. */
.swatch-radio--swatch {
  width: 1.75rem;
  height: 1.75rem;
  border: 2px solid transparent;
  border-radius: 50%;
}

.swatch-radio--swatch[aria-checked='true'] {
  border-color: var(--ui-text-highlighted);
}

.swatch-radio--glyph {
  height: 2.5rem;
  border-radius: var(--ui-radius);
  color: var(--ui-text-muted);
}

/* The "none" cell sits in a hairline, so it reads as an option beside the glyphs and not as an empty slot (#114) */
.swatch-radio--glyph.swatch-radio--none {
  box-shadow: inset 0 0 0 1px var(--ui-border);
}

.swatch-radio--glyph:hover {
  background: var(--ui-bg-muted);
}

.swatch-radio--glyph[aria-checked='true'] {
  background: var(--ui-bg-accented);
}

@media (--phone) {
  .swatch-radio--swatch {
    width: 2.5rem;
    height: 2.5rem;
  }
}
</style>
