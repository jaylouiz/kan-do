<!--
@component TaskPriorityBadge
@kind primitive
@category display
@description Visual indicator for task priority level (low, regular, high; #617)
@usage Used within task cards to display priority status
@avoid Only the three priority levels on a card; statuses are columns, not badges.
@responsibility
- Displays appropriate priority indicator based on task priority level
- Done cards show no priority badge (#124, TaskCard)
-->
<template>
  <UTooltip :text="t('task.priorityTooltip')">
    <UBadge
      :size="size"
      variant="soft"
      color="neutral"
      :icon="priorityIcon"
      class="priority bg-muted"
      :class="prioCssClass"
    >
      {{ priorityLabel }}
    </UBadge>
  </UTooltip>
</template>

<script setup lang="ts">
import { getPriorityLabel } from "~/utils/taskStatusMappings";
import { useI18n } from "vue-i18n";
import { HIGH, normalizePriority } from "~/lib/priority";

defineOptions({ name: 'TaskPriorityBadge' });

const { t } = useI18n();

/**
 * Props
 * @prop {number|string} priority Task priority level (1-3; no priority reads as Normal, a stored 4 as High)
 * @prop {string=} size Badge size
 */
const props = withDefaults(defineProps<{
  /** Task priority level (number 1-3) */
  priority: number | string;
  /** Size of the badge (xs, sm, md, lg) */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}>(), {
  size: 'sm',
});

/**
 * The level 1-3 (no priority reads as Normal, #653)
 */
const priorityValue = computed(() => normalizePriority(props.priority));

/**
 * Converts priority value to a alphanumeric label
 */
const priorityLabel = computed(() => {
  const level = priorityValue.value;
  return getPriorityLabel(level);
});

/**
 * Icon displayed for active tasks based on priority level
 */
const priorityIcon = computed(() => {
  switch (priorityValue.value) {
    case 2:
      return "i-ph-number-circle-two";
    case HIGH:
      return "i-ph-exclamation-mark";
    default:
      return "i-ph-number-circle-one";
  }
});

/**
 * CSS class for styling: only High carries a tint (the warning tone, DESIGN.md "Warning Orange"), by level
 * alone, so the same level looks the same on every board (#617, replaces the board-relative tint of #504)
 */
const prioCssClass = computed(() => (priorityValue.value === HIGH ? "priority-high" : ""));
</script>

<style scoped>
/* Priority badge colors mapped to semantic tokens */

.priority-high {
  background-color: var(--ui-color-warning-100);
  color: var(--ui-color-warning-700);
}
</style>
