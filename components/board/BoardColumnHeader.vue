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
-->
<template>
  <div
    :class="['column-header', { 'waiting-header': isWaiting, empty: isEmpty }]"
    class="flex items-center justify-center"
  >
    <h2 class="font-display" :class="{ 'column-header__marked': status === TaskStatus.Progress }">
      <UIcon v-if="status === TaskStatus.Done" name="i-ph-check-bold" class="column-header__mark" aria-hidden="true" />
      {{ title }}
    </h2>
  </div>
</template>

<script setup lang="ts">
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
}>();

/**
 * Whether this column represents the Waiting status
 */
const isWaiting = computed(() => props.status === TaskStatus.Waiting);

// Removed unused computed property
</script>

<style scoped>
  /* The marker (DESIGN.md "The Marker Rule"): a stroke of yellow text marker through the lower half of the Jetzt
     headline, its only use. Static, a decoration without a meaning of its own; the ink on it keeps body contrast. */
  h2.column-header__marked {
    padding-inline: 0.3em;
    border-radius: var(--radius-sm);
    background: linear-gradient(transparent 0 56%, var(--marker) 56% 90%, transparent 90%) no-repeat;
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
  
</style>
