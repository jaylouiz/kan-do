<!--
@component TaskTimer
@kind primitive
@category display
@description Time display component for task timeboxes
@usage Styleguide entry only: the cards show the timebox as TaskProgressChip (#388); German UI text
@avoid Rendered nowhere in the app today (only the styleguide); cards show the timebox as TaskProgressChip.
@responsibility
- Format total/remaining time from seconds
- Decide compact vs. full string depending on progress
-->
<template>
  <span class="inline-flex items-center gap-1 text-sm">
    <UIcon name="i-ph-clock-countdown" class="size-4" aria-hidden="true" />
    <span v-if="showRemaining">
      <template v-if="showFullTimeString"
        >{{ t('duration.remainingOfTotal', { remaining: remainingTimeString, total: timeBoxString }) }}</template
      >
      <template v-else>{{ t('duration.remainingCapital', { time: remainingTimeString }) }}</template>
    </span>
    <span v-else>{{ timeBoxString }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
/**
 * Script setup for TaskTimer: computes formatted time strings for total and
 * remaining time and exposes booleans to control display variants.
 */
/**
 * @component TaskTimer (script)
 * @description Script-API Dokumentation: definiert Props, Hilfsfunktionen und Computeds
 *  für die Anzeige von Gesamt- und Restzeit in deutscher UI. Nur Dev-Logs im
 *  Entwicklungsmodus.
 */
defineOptions({ name: 'TaskTimer' });
/**
 * Props for TaskTimer component.
 */
const props = defineProps({
  /** Total allocated time for the task in seconds */
  timeBoxSeconds: {
    type: Number,
    required: true,
  },
  /** Time already spent on the task in seconds */
  timeSpentSeconds: {
    type: Number,
    required: true,
  },
  /** Whether the task timer is currently running */
  isRunning: {
    type: Boolean,
    required: true,
  },
  /** Whether to show remaining time instead of total time */
  showRemaining: {
    type: Boolean,
    required: false,
    default: false,
  },
});

/**
 * Formats time in seconds to a human-readable string
 * @param seconds - Time in seconds to format
 * @param shouldRound - Whether to round the minutes
 * @returns Formatted time string (e.g., "45 min", "1:30 h")
 */
const { t } = useI18n();
const { formatDuration } = useLocaleFormat();
const formatTime = (seconds: number, shouldRound = false): string =>
  formatDuration(seconds, shouldRound ? "clockRounded" : "clock");

/**
 * Formatted string for the total timebox duration.
 */
const computeTimeBoxString = (): string => formatTime(props.timeBoxSeconds);

const timeBoxString = computed(computeTimeBoxString);

/**
 * Formatted string for the remaining time in the timebox.
 */
const computeRemainingTimeString = (): string => {
  const remainingSeconds = props.timeBoxSeconds - props.timeSpentSeconds;
  return formatTime(Math.max(0, remainingSeconds), true);
};

const remainingTimeString = computed(computeRemainingTimeString);

/**
 * Determines whether to show both remaining and total time.
 * Shows full format (X / Y) as soon as any time has been spent (after 1 minute).
 * Within the first minute, only show the remaining time.
 */
const computeShowFullTimeString = (): boolean => {
  const timeSpentMinutes = Math.floor(props.timeSpentSeconds / 60);
  
  // Show full string only after at least 1 minute has been spent
  // This ensures "noch 30 min" for the first minute, then "noch 29 min / 30 min" after
  return timeSpentMinutes >= 1;
};

const showFullTimeString = computed(computeShowFullTimeString);
</script>
