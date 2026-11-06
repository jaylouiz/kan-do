<!--
@component TaskProgressCircular
@description Circular variant of the task timebox progress indicator.
@usage Embed inside TaskCard or TaskDetail to show timebox completion in a compact, glanceable shape.
@responsibility
- Render an SVG ring that fills as time is spent against the timebox
- Escalate primary → warning (overrun is warning, never error); done teal on done cards (#124)
- Make the running state legible: minimum arc, tinted track, "<1 min" elapsed label
- Animate value changes smoothly via rAF
- Keep API symmetrical to TaskProgressBar so swap-in is trivial
- Stay framework-friendly: pure SVG + Nuxt UI semantic colour tokens
-->
<template>
  <div
    class="task-progress-circular"
    :class="[`task-progress-circular--${progressColor}`, { 'is-running': isRunning }]"
    :style="cssVars"
    role="progressbar"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="Math.round(percentage)"
    :aria-label="resolvedAriaLabel"
    :aria-valuetext="isRunning ? t('task.progressRunning', { time: labelTimeString }) : undefined"
  >
    <svg
      :viewBox="`0 0 ${size} ${size}`"
      class="task-progress-circular__svg"
      aria-hidden="true"
    >
      <circle
        class="task-progress-circular__track"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke-width="strokeWidth"
      />
      <circle
        class="task-progress-circular__indicator"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        :transform="`rotate(-90 ${center} ${center})`"
      />
    </svg>

    <div v-if="showLabel" class="task-progress-circular__label">
      <slot :percentage="percentage" :label="labelTimeString">
        <span class="task-progress-circular__label-text font-sans">
          <span class="task-progress-circular__label-number">{{ labelParts.number }}</span>
          <span class="task-progress-circular__label-unit">{{ labelParts.unit }}</span>
        </span>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useLocaleFormat } from "~/composables/useLocaleFormat";
import { getTimeboxRingColor, isUnderOneMinute, RUNNING_MIN_ARC_PERCENT } from "~/utils/timeboxProgress";

defineOptions({ name: "TaskProgressCircular" });

/**
 * Props for TaskProgressCircular.
 * Mirrors TaskProgressBar where applicable so the two can be swapped in templates.
 */
const props = withDefaults(
  defineProps<{
    /** Total allocated time for the task in seconds */
    timeBoxSeconds: number;
    /** Time already spent on the task in seconds */
    timeSpentSeconds: number;
    /** Whether the task timer is currently running (drives subtle motion cues) */
    isRunning?: boolean;
    /** Outer diameter of the ring in px at 100% text size (rendered in rem) */
    size?: number;
    /** Stroke width of the ring in px */
    strokeWidth?: number;
    /** Show the centred label (remaining time / slot content) */
    showLabel?: boolean;
    /** When true, label shows time spent instead of time remaining */
    showSpent?: boolean;
    /** Optional accessible label override (defaults to the translated "timebox progress") */
    ariaLabel?: string;
    /** Task is finished: the ring is done teal and never escalates */
    isDone?: boolean;
  }>(),
  {
    isRunning: false,
    size: 36,
    strokeWidth: 4,
    showLabel: true,
    showSpent: false,
    ariaLabel: undefined,
    isDone: false,
  },
);

const { t } = useI18n();
const resolvedAriaLabel = computed(() => props.ariaLabel ?? t("task.progressAria"));

/* --------------------------------------------------------------------------
 * Geometry
 * ------------------------------------------------------------------------ */
const center = computed(() => props.size / 2);
const radius = computed(() => (props.size - props.strokeWidth) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);

/* --------------------------------------------------------------------------
 * Animated value (rAF easing identical to TaskProgressBar)
 * ------------------------------------------------------------------------ */
const animatedTimeSpent = ref(props.timeSpentSeconds);

const computePercentage = (): number => {
  if (props.timeBoxSeconds <= 0) return 0;
  const pct = (animatedTimeSpent.value / props.timeBoxSeconds) * 100;
  return Math.max(0, Math.min(100, pct));
};
const percentage = computed(computePercentage);

/** A running timer always shows a small arc so it never reads as an empty ring with a dot */
const displayPercentage = computed(() =>
  props.isRunning && !props.isDone
    ? Math.max(percentage.value, RUNNING_MIN_ARC_PERCENT)
    : percentage.value,
);

const dashOffset = computed(
  () => circumference.value * (1 - displayPercentage.value / 100),
);

/* --------------------------------------------------------------------------
 * Colour escalation – kept consistent with TaskProgressBar
 * ------------------------------------------------------------------------ */
const progressColor = computed(() => getTimeboxRingColor(percentage.value, props.isDone));


/**
 * Map semantic colour to Nuxt UI CSS variables so the ring picks up the
 * active theme (light/dark) without hard-coded hex values.
 */
/**
 * Scale the centred label so larger rings use the comfortable reading size
 * (matching the percentage-slot variant) while small rings gracefully shrink.
 * Thresholds keyed off the outer diameter:
 *  - >= 56 px → 0.875rem (Tailwind `text-sm`)
 *  - >= 40 px → 0.8125rem
 *  -  < 40 px → 0.6875rem (compact, fits inside task-card footers)
 */
const computeLabelFontSize = (): string => {
  if (props.size >= 56) return "0.875rem";
  if (props.size > 48) return "0.8125rem";
  return "0.6875rem";
};

const ringColorVar = (color: string): string => {
  // Done fill uses the 700 step: 4.55:1 on the card (the 600 step is 3.04:1, too close to the 3:1 bar)
  if (color === "success") return "var(--ui-color-success-700)";
  if (color === "warning") return "var(--ui-color-warning-600)";
  return `var(--ui-${color})`;
};

const cssVars = computed(() => ({
  // Ring diameter in rem so it scales with the label under text zoom (WCAG 1.4.4, #66)
  "--task-progress-circular-size": `${props.size / 16}rem`,
  // Warning uses the 600 step: the 500 step is 2.97:1 on the card surface (< 3:1, WCAG 1.4.11)
  "--task-progress-circular-color": ringColorVar(progressColor.value),
  "--task-progress-circular-label-size": computeLabelFontSize(),
}));

/* --------------------------------------------------------------------------
 * Remaining time formatting – kept compact for in-card use
 * ------------------------------------------------------------------------ */
const { formatDurationParts } = useLocaleFormat();

const labelParts = computed(() => {
  if (props.showSpent && isUnderOneMinute(props.timeSpentSeconds)) {
    return { number: t("task.underOneMinute"), unit: t("duration.unitMinute") };
  }
  const seconds = props.showSpent
    ? props.timeSpentSeconds
    : props.timeBoxSeconds - props.timeSpentSeconds;
  const { value, unit } = formatDurationParts(seconds, "clockShort");
  return { number: value, unit };
});

const labelTimeString = computed(() => `${labelParts.value.number} ${labelParts.value.unit}`);

/* --------------------------------------------------------------------------
 * rAF animation
 * ------------------------------------------------------------------------ */
let animationFrame: number | undefined;

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const animateToNewTimeSpent = (newValue: number) => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);

  const startTime = performance.now();
  const startValue = animatedTimeSpent.value;
  const duration = 1000;

  const step = (now: number) => {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = easeInOutCubic(progress);
    animatedTimeSpent.value = startValue + (newValue - startValue) * eased;
    if (progress < 1) animationFrame = requestAnimationFrame(step);
  };

  animationFrame = requestAnimationFrame(step);
};

watch(() => props.timeSpentSeconds, animateToNewTimeSpent, { immediate: true });

onUnmounted(() => {
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
});
</script>

<style scoped>
.task-progress-circular {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  color: var(--task-progress-circular-color, var(--ui-primary));
}

.task-progress-circular__svg {
  display: block;
  width: var(--task-progress-circular-size);
  height: var(--task-progress-circular-size);
  overflow: visible;
}

.task-progress-circular__track {
  stroke: var(--ui-border);
  opacity: 0.6;
}

.task-progress-circular__indicator {
  stroke: currentColor;
  transition:
    stroke-dashoffset 200ms cubic-bezier(0.2, 0, 0, 1),
    stroke 240ms ease-in-out;
}

/* Done (#124): a solid success-100 track under the success-700 fill */
.task-progress-circular--success .task-progress-circular__track {
  stroke: var(--ui-color-success-100);
  opacity: 1;
}

/* Running: the track is tinted; no moving parts, the ring only shows progress */
.task-progress-circular.is-running .task-progress-circular__track {
  stroke: currentColor;
  opacity: 0.22;
}

.task-progress-circular__label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.task-progress-circular__label-text {
  font-size: var(--task-progress-circular-label-size, 0.6875rem);
  font-weight: 500;
  color: var(--ui-text-muted);
  transition: color 240ms ease-in-out;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.1;
}

/* Running: stronger label so the elapsed time reads at a glance */
.task-progress-circular.is-running .task-progress-circular__label-text {
  color: var(--ui-text-highlighted);
}

@media (prefers-reduced-motion: reduce) {
  .task-progress-circular__indicator {
    transition: none;
  }
}
</style>
