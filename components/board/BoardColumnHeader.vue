<!--
@component BoardColumnHeader
@description Header component for kanban board columns
@usage Used at the top of each BoardColumn to display status title and visual indicators
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
    <h2 class="font-display">
      <span v-if="status === TaskStatus.Done" aria-hidden="true">{{ doneMark }}</span>
      {{ title }}
    </h2>
  </div>
</template>

<script setup lang="ts">
import { TaskStatus } from "~/types/taskStatus";

defineOptions({ name: "BoardColumnHeader" });

/** Language-neutral checkmark shown in the Done column header */
const doneMark = "✓";

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
  h2 {
    z-index: 10;
    margin-top: 1.75rem;
    margin-bottom: 0;
    text-align: center;
    font-size: 2.25rem; /* display step; one size at every width (DESIGN.md ramp) */
    /* Weight and tracking spelled out: scoped CSS cannot use the font-semibold / tracking-display utilities */
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: var(--lh-tight);
    color: var(--ui-text-muted);
    transition: opacity 100ms ease-out;
    transform: translateY(0vh);
    /* The colour follows the Erledigt drop wash (#124, BoardColumn) */
    transition:
      all 0.5s cubic-bezier(0.16, 1, 0.3, 1),
      color var(--done-wash-duration) cubic-bezier(0.4, 0, 0.2, 1);
  }

  .waiting-header h2 {
    margin-top: 1.25rem;
  }
  
</style>
