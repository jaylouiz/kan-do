<!--
@component BoardColumnHeader
@kind component
@category display
@description Header component for kanban board columns
@usage Used at the top of each BoardColumn to display status title and visual indicators
@avoid Not a page header (PageHeader) and not the header of an expanded stack (TaskStackHeader).
@responsibility
- Displays column title with appropriate styling
- Shows status-specific icons (checkmark for Done column)
- Handles visual states for different statuses (waiting, empty)
- Offen only (`showAdd`, #248): a round soft icon-only add button at the end of the card-width track, vertically centred on
  the title line; the title stays centred exactly like the other columns' (the button is out of the flow, so it never moves
  the title). Click, Enter or Space emits `add`; while a draft is open (`addDisabled`) the button stays in place but is
  disabled, so the header never shifts. `addButtonEl()` lets the column return focus after a cancel. Same look as the
  stack header's close button (ghost UButton, `--fill-on-canvas` fill by CSS, 32px, 44px on touch)
-->
<template>
  <div
    :class="['column-header', { 'waiting-header': isWaiting, empty: isEmpty }]"
    class="relative flex items-center justify-center"
  >
    <h2 class="font-display" :class="{ 'column-header__marked': status === TaskStatus.Progress }">
      <UIcon v-if="status === TaskStatus.Done" name="i-ph-check-bold" class="column-header__mark" aria-hidden="true" />
      {{ title }}
    </h2>
    <div v-if="showAdd" class="column-header__track">
      <div class="column-header__add-row">
        <UButton
          ref="addButton"
          class="column-header__add"
          color="neutral"
          variant="ghost"
          square
          icon="i-ph-plus"
          data-testid="add-task-header-button"
          :aria-label="t('board.addTask')"
          :disabled="addDisabled"
          @click="emit('add')"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { TaskStatus } from "~/types/taskStatus";

defineOptions({ name: "BoardColumnHeader" });

/**
 * Props
 * @prop {string} title Title text to display in the column header
 * @prop {TaskStatus} status Task status associated with this column
 * @prop {number} taskCount Number of tasks in this column
 * @prop {boolean=} isEmpty Whether the column contains no tasks
 */
/**
 * Props for BoardColumnHeader component.
 */
const props = defineProps<{
  /** Title text to display in the column header */
  title: string;
  /** Task status associated with this column */
  status: TaskStatus;
  /** Number of tasks in this column */
  taskCount: number;
  /** Whether the column contains no tasks */
  isEmpty?: boolean;
  /** Shows the round add button (Offen only, #248) */
  showAdd?: boolean;
  /** A draft is open: the button stays in place but does nothing */
  addDisabled?: boolean;
}>();

const emit = defineEmits<{
  /** The add button was pressed (click, Enter or Space) */
  add: [];
}>();

const { t } = useI18n();
const addButton = ref<{ $el: HTMLElement } | null>(null);

/** The add button's element, where the column returns focus after a cancelled draft; null when there is none */
const addButtonEl = (): HTMLElement | null => addButton.value?.$el ?? null;

defineExpose({ addButtonEl });

/**
 * Whether this column represents the Waiting status
 */
const isWaiting = computed(() => props.status === TaskStatus.Waiting);

// Removed unused computed property
</script>

<style scoped>
  /* The marker (DESIGN.md "The Marker Rule"): a stroke of yellow text marker centred on the bottom edge (the baseline) of
     the Jetzt headline, its only use (#239). Static, a decoration without a meaning of its own; the ink on it keeps body contrast.
     Drawn by hand (kd#207): a layer of its own behind the word, tilted a little and with softly rounded, uneven
     ends, so it sits with the round serif instead of ruling a straight bar under it. The inset is a percentage of the
     h2 so it keeps scaling with the display step: 61% to 98% is a 37% tall stroke whose centre (79.5%) is the baseline
     (measured at the 36px display face, 41.4px line box: baseline at 79.7%). */
  h2.column-header__marked {
    position: relative;
    isolation: isolate; /* keeps the stroke's z-index -1 behind the word, above the page */
    padding-inline: 0.3em;
  }

  h2.column-header__marked::before {
    content: '';
    position: absolute;
    inset: 61% 0 2%;
    z-index: -1;
    border-radius: var(--radius-sm) var(--radius-md) var(--radius-sm) var(--radius-md);
    background: var(--marker);
    rotate: -1.6deg;
  }

  /* The done mark before "Erledigt" is the check icon the done cards use, not a text glyph: the display face has no
     check, and a fallback glyph changes with the font. Sized to the headline's x-height region and set on its
     baseline; decorative (aria-hidden), the column name carries the meaning. */
  .column-header__mark {
    display: inline-block; /* an svg is a block by the base styles */
    width: 0.8em;
    height: 0.8em;
    margin-inline-end: -0.05em;
    vertical-align: -0.06em;
  }

  h2 {
    z-index: 10;
    margin-top: 1.75rem;
    margin-bottom: 0;
    text-align: center;
    font-size: var(--text-display); /* display step; one size at every width (DESIGN.md ramp) */
    /* Weight and tracking of the display face spelled out: scoped CSS cannot use the utilities */
    font-weight: 500;
    letter-spacing: -0.02em;
    line-height: var(--lh-tight);
    color: var(--ui-text);
    transition: opacity var(--duration-fast) var(--ease-standard);
    transform: translateY(0vh);
    /* The colour follows the Erledigt drop wash (#124, BoardColumn) */
    transition:
      all 0.5s cubic-bezier(0.16, 1, 0.3, 1),
      color var(--done-wash-duration) var(--ease-standard);
  }

  .waiting-header h2 {
    margin-top: 2.5rem;
  }

  /* Add button (Offen, #248). The track mirrors the task list's side padding (board.css, BoardColumn: px-3, md:px-10) and
     the card box inside it, so the button's right edge is the cards' right edge. Out of the flow: the title stays centred
     in the header whatever the button does. Pointer events pass through everything but the button. */
  .column-header__track {
    position: absolute;
    inset: 0 0.75rem;
    pointer-events: none;
  }

  .column-header__add-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    width: min(var(--task-card-width), 100%);
    max-width: var(--task-card-max-width);
    margin-inline: auto;
    margin-top: 1.75rem; /* the h2's margin-top */
    height: calc(var(--text-display) * var(--lh-tight)); /* the h2's line box: the button centres on the title line */
  }

  /* The stack header's close button look (TaskStackHeader): round, soft grey on the canvas, one step deeper on hover */
  .column-header__add {
    pointer-events: auto;
    flex: none;
    width: 2rem;
    height: 2rem;
    min-width: 2rem;
    padding: 0;
    justify-content: center;
    border-radius: 9999px;
    background-color: var(--fill-on-canvas);
    color: var(--ui-text);
    cursor: pointer;
  }

  /* Disabled while a draft is open (DESIGN.md "Disabled"): the dimmed look, no hover answer, and the cursor says so */
  .column-header__add:disabled {
    cursor: not-allowed;
  }

  .column-header__add:hover:not(:disabled) {
    background-color: var(--fill-on-canvas-hover);
  }

  @media (--desktop) {
    .column-header__track {
      inset-inline: 2.5rem;
    }
  }

  @media (--phone) {
    /* the button ladder's 44px floor (the unlayered size above would outrank the theme's `min-h-11`) */
    .column-header__add {
      width: 2.75rem;
      height: 2.75rem;
      min-width: 2.75rem;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .column-header__add {
      transition: background-color var(--duration-fast) var(--ease-standard);
    }
  }
  
</style>
