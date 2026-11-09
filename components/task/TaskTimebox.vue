<!--
@component TaskTimebox
@kind primitive
@category display
@description Static timebox display component showing total allocated time
@usage Unused since `/styleguide` went (#65): the cards show the timebox as TaskProgressChip (#388)
@avoid Not on cards: they show the timebox as TaskProgressChip.
@responsibility
- Format timebox duration from seconds
- Display with clock icon
- Static display (no dynamic countdown)
-->
<template>
  <UBadge
    size="sm"
    variant="soft"
    color="neutral"
    icon="i-ph-clock"
  >
    {{ timeBoxString }}
  </UBadge>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useLocaleFormat } from '~/composables/useLocaleFormat'

defineOptions({ name: 'TaskTimebox' });

/**
 * Props for TaskTimebox component.
 */
const props = defineProps({
  /** Total allocated time for the task in seconds */
  timeBoxSeconds: {
    type: Number,
    required: true,
  },
});

/**
 * Formats time in seconds to a human-readable string
 * @param seconds - Time in seconds to format
 * @returns Formatted time string (e.g., "45 min", "1:30 h")
 */
const { formatDuration } = useLocaleFormat();
const formatTime = (seconds: number): string => formatDuration(seconds, "clock");

/**
 * Formatted string for the total timebox duration.
 */
const computeTimeBoxString = (): string => formatTime(props.timeBoxSeconds);

const timeBoxString = computed(computeTimeBoxString);
</script>

