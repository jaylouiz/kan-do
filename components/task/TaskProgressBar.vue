<!--
@component TaskProgressBar
@kind primitive
@category display
@description Visual progress indicator for task timebox completion with remaining time display
@usage Styleguide entry only: the cards show the timebox as TaskProgressChip (#388)
@avoid Rendered nowhere in the app today (only the styleguide); cards show the timebox as TaskProgressChip.
@responsibility
- Displays visual progress of time spent vs. time allocated
- Provides smooth animation for time updates
- Calculates percentage of time remaining
- Shows remaining time overlaid on the bar with smart color transitions
-->
<template>
  <div class="task-progress-wrapper">
    <UProgress 
      v-model="percentage" 
      size="2xl" 
      animation="elastic" 
      :color="progressColor"
      :ui="{base: 'bg-elevated'}"
    />
    <span 
      class="task-progress-label flex items-center justify-center gap-1.5 text-xs"
      :class="labelColorClass"
    >
      <UIcon name="i-ph-clock-countdown" class="size-3.5" aria-hidden="true" />
      {{ t("duration.remaining", { time: remainingTimeString }) }}
    </span>
  </div>
</template>

<script setup lang="ts">
/**
 * @component TaskProgressBar (script)
 * @description Script-API Dokumentation: importiert Abhängigkeiten, definiert Props,
 *  berechnet Prozente/Farbe, animiert Fortschritt via rAF und räumt bei Unmount auf.
 */
import { ref, computed, watch, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useLocaleFormat } from "~/composables/useLocaleFormat";
/**
 * Script setup for TaskProgressBar: animates `timeSpentSeconds` to create a
 * smooth progress transition, computes remaining percentage and color, and
 * cleans up rAF on unmount.
 */

defineOptions({ name: 'TaskProgressBar' });

/**
 * Props for TaskProgressBar component.
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
});

/** Animated reference to time spent for smooth transitions */
const animatedTimeSpent = ref(props.timeSpentSeconds);

/**
 * Computes the percentage of time SPENT against the timebox.
 * Bar fills as work progresses, empty at start, full when time is up.
 * Clamps to [0, 100] to avoid floating point drift.
 */
const computePercentage = (): number => {
  if (props.timeBoxSeconds <= 0) return 0;
  const calculatedPercentage = (animatedTimeSpent.value / props.timeBoxSeconds) * 100;
  return Math.max(0, Math.min(100, calculatedPercentage));
};

const percentage = computed(computePercentage);

/**
 * Determines progress bar color from spent percentage.
 * Calm (primary) while time is plentiful; escalates to warning/error as budget runs out.
 * - < 80% spent  -> 'primary'
 * - 80–99% spent -> 'warning'
 * - >= 100% spent -> 'error'
 */
const computeProgressColor = (): 'error' | 'warning' | 'primary' => {
  const spentPercentage = percentage.value;
  if (spentPercentage >= 100) return 'error';
  if (spentPercentage > 80) return 'warning';
  return 'primary';
};

const progressColor = computed(computeProgressColor);

/**
 * Label color adapts to the fill position since bar now shows SPENT time.
 * - < 40% spent: label sits over unfilled track → muted text
 * - 40–60% spent: transition zone → text shadow for readability
 * - > 60% spent: label sits over filled bar → white text
 */
const computeLabelColorClass = (): string => {
  const spentPercentage = percentage.value;

  if (spentPercentage > 60) {
    return 'text-white';
  } else if (spentPercentage > 40) {
    return 'text-white label-transition';
  } else {
    return 'text-primary';
  }
};

const labelColorClass = computed(computeLabelColorClass);

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
 * Formatted string for the remaining time in the timebox.
 */
const computeRemainingTimeString = (): string => {
  const remainingSeconds = props.timeBoxSeconds - props.timeSpentSeconds;
  return formatTime(Math.max(0, remainingSeconds), true);
};

const remainingTimeString = computed(computeRemainingTimeString);

// rAF ID for in-flight animation frame
let animationFrame: number | undefined;

/**
 * Easing function easeInOutCubic used for smooth animation.
 */
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Animates the transition of time spent to the latest value using rAF.
 */
/**
 * Animates the transition of time spent value to `newValue` using rAF and
 * an easeInOutCubic easing. Cancels any in-flight animation first.
 */
const animateToNewTimeSpent = (newValue: number) => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);

  const startTime = performance.now();
  const startValue = animatedTimeSpent.value;
  const duration = 1000; // ms

  /** Single animation frame step computing eased interpolation */
  const step = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = easeInOutCubic(progress);
    animatedTimeSpent.value = startValue + (newValue - startValue) * easeProgress;
    if (progress < 1) animationFrame = requestAnimationFrame(step);
  };

  animationFrame = requestAnimationFrame(step);
};

/** Getter used by the watcher to track source changes */
const getTimeSpentProp = (): number => props.timeSpentSeconds;

/**
 * Smoothly animate the progress when `timeSpentSeconds` changes.
 */
watch(getTimeSpentProp, animateToNewTimeSpent, { immediate: true });

// Clean up animation frame on component unmount
/**
 * Cleanup any in-flight animation frame on component unmount.
 */
function cleanupAnimationFrame(): void {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
}

onUnmounted(cleanupAnimationFrame);
</script>

<style scoped>
.task-progress-wrapper {
  position: relative;
}

.task-progress-label {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 10;
  transition: color 300ms ease-in-out, text-shadow 300ms ease-in-out;
}

/* Transition zone: add text shadow for better readability */
.task-progress-label.label-transition {
  text-shadow: 
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 0 8px rgba(255, 255, 255, 0.4);
}
</style>
