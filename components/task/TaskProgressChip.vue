<!--
@component TaskProgressChip
@kind primitive
@category display
@description The timebox label of a task card as its progress item (#388)
@usage First item of the TaskCard footer (#584; not on the add sheet's Jetzt draft)
@avoid Only the timebox label of a task card; not for the add sheet's Jetzt draft.
@responsibility
- Outside Jetzt: a light grey chip "45 min" (track and fill half a step lighter since #584) whose grey fill shows the spent share of the timebox (no colour, also not on overrun or done cards)
- In Jetzt: once the card has settled it springs wider (x axis only) into a bar across the whole footer, anchored at its own
  left edge (the footer start, #584) and growing to the right over the source icon, carry-over dots and priority badge: "12 min ...... 45 min", fill primary, warning above 80 percent
- No timebox: a spent-time chip that pops in when the card enters Jetzt and counts forward; outside Jetzt it stays
  as a quiet grey chip only once time was spent, otherwise there is no label
- Reserves its collapsed width in the footer row (hidden sizer), so the carry-over dots are the item that clips in a narrow footer
- Starts from the state the task's chip was last rendered in (`lib/timeboxChipMemory`), because a cross-column move
  mounts a fresh card; a page load with a card in Jetzt shows the bar at once
- While its own card is dragged (the card stays mounted as the hidden placeholder, also for a drop back into Jetzt)
  it counts as out of Jetzt, so it grows again on the drop instead of keeping the bar (#411). The grow starts two frames
  after the drop: dnd-kit re-inserts the card's node in the drop's own task, and a class flip with no style pass in
  between has nothing to ease from, so the morph was silent in production builds (#540)
- Never owns a timer: it only reads `timeSpentSeconds`, which the app-level driver advances (#352)
- Motion is CSS only; `prefers-reduced-motion` shows the end state at once. Never takes pointer events.
- The width spring is the app's one spring: it marks the moment a label becomes the card's live status. It never runs
  on page load; the bar has no shadow, it sits flat on the card's own (#410)
- Warning accent in the 600 step: the 500 step measured 2.97:1 on the card surface (below the 3:1 non-text floor,
  WCAG 1.4.11), the 600 step 4.13:1. Text on every fill keeps 4.5:1 (`a11y.spec.ts`, Jetzt card at 50 %, 85 %, over)
- A silent progressbar: the value is the percent, no value text and no live region, so per-second updates stay quiet;
  without a timebox the name is the spent time and there is no value
- Accepted: in Jetzt the bar covers the source icon, carry-over dots and priority badge (TaskCard makes the group after the
  chip inert); the spring overshoot may poke a few px past the footer padding, inside the card
-->
<template>
  <Transition name="chip-pop" :appear="popsOnMount">
    <span
      v-if="visible"
      class="chip-slot"
      :class="{ 'chip-slot--now': expanded, 'chip-slot--armed': armed }"
      :style="{ '--chip-p': `${percent}%` }"
    >
      <span class="chip__sizer" :class="{ 'chip__sizer--boxless-now': !hasBox && expanded }" aria-hidden="true">
        <span class="chip__sizer-icon" />{{ hasBox ? boxLabel : spentLabel }}
      </span>
      <span
        class="chip"
        :class="[`chip--${expanded ? tone : 'idle'}`, { 'chip--now': expanded, 'chip--boxless': !hasBox }]"
        role="progressbar"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="hasBox ? Math.round(percent) : undefined"
        :aria-label="ariaLabel"
        data-testid="task-progress-chip"
      >
        <span class="chip__fill" aria-hidden="true" />
        <span class="chip__content">
          <UIcon name="i-ph-clock" class="chip__icon" aria-hidden="true" />
          <span v-if="hasBox" class="chip__spent"><span class="chip__spent-inner">{{ spentLabel }}</span></span>
          <span class="chip__box">{{ hasBox ? boxLabel : spentLabel }}</span>
        </span>
      </span>
    </span>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { getTimeboxRingColor } from '~/utils/timeboxProgress'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { rememberInJetzt, startsExpanded, wasInJetzt } from '~/lib/timeboxChipMemory'

defineOptions({ name: 'TaskProgressChip' })

interface Props {
  /** Stable task id: keys the module memory that carries the chip's state across a card remount */
  taskId: string
  /** Allocated time in seconds; `null` or 0 means the task has no timebox */
  timeBoxSeconds: number | null
  /** Time worked so far in seconds (advanced by the task timer driver) */
  timeSpentSeconds: number
  /** The card is the current one in Jetzt (not the drag preview) */
  isNow: boolean
}

const props = defineProps<Props>()

const { t } = useI18n()
const { dragState } = useBoardDragState()
const { formatDuration, formatDurationParts } = useLocaleFormat()

/** In Jetzt and not in the pointer's hand: the card keeps its node as the placeholder while it is dragged, so a
 *  drop back into Jetzt changes no prop, and only this lets the bar shrink with the lift and grow with the drop */
const live = computed(() => props.isNow && dragState.value.draggedTaskId !== props.taskId)

const hasBox = computed(() => props.timeBoxSeconds !== null && props.timeBoxSeconds > 0)
/** Spent share of the timebox, clamped to 0-100 */
const percent = computed(() =>
  props.timeBoxSeconds !== null && props.timeBoxSeconds > 0
    ? Math.max(0, Math.min(100, (props.timeSpentSeconds / props.timeBoxSeconds) * 100))
    : 0,
)
/** Primary up to 80 percent, warning above (and beyond 100); the colour only shows in Jetzt */
const tone = computed(() => getTimeboxRingColor(percent.value, false))

const boxLabel = computed(() => formatDuration(props.timeBoxSeconds, 'clock'))
const spentLabel = computed(() => {
  if (props.timeSpentSeconds < 60) return `${t('task.underOneMinute')} ${t('duration.unitMinute')}`
  const { value, unit } = formatDurationParts(props.timeSpentSeconds, 'clockShort')
  return `${value} ${unit}`
})
const ariaLabel = computed(() =>
  hasBox.value
    ? t('task.timeboxProgressAria', { spent: spentLabel.value, box: boxLabel.value })
    : t('task.elapsedAria', { time: spentLabel.value }),
)

/** Without a timebox the chip exists in Jetzt, and elsewhere only once time was spent */
const visible = computed(() => hasBox.value || live.value || props.timeSpentSeconds > 0)

// A cross-column move mounts a fresh card: start from the state the chip was last rendered in, then flip on the
// next frames so the grow / shrink plays (the grow itself waits for the card to settle, in CSS). A chip without a
// timebox only pops, it has no bar to grow, so it follows the card at once.
const remembered = wasInJetzt(props.taskId)
const expanded = ref(hasBox.value ? startsExpanded(props.taskId, live.value) : live.value)
/** A boxless chip that mounts as the card lands in Jetzt pops in (a same-instance change is the Transition's job) */
const popsOnMount = !hasBox.value && live.value && remembered === false

/** Transitions are on only after the first frames: the footer width is measured after the mount, and a page load
 *  must not play the bar's width from the unmeasured fallback to the footer width */
const armed = ref(false)
/** Two frames on: the first style pass has seen the DOM as it is now, so a class flip in `run` has a before-change style to ease from */
const afterTwoFrames = (run: () => void) => requestAnimationFrame(() => requestAnimationFrame(run))
onMounted(() => {
  rememberInJetzt(props.taskId, live.value)
  afterTwoFrames(() => {
    armed.value = true
    expanded.value = live.value
  })
})
// Post flush: a drop into another column swaps this card for a fresh one in the same tick, and a stopped
// watcher never runs, so the new card still reads the preview's "left Jetzt" from the memory. The lift
// remembers nothing (the preview chip that mounts next must still start as the bar); the drop back does.
// The shrink is immediate. The grow waits two frames (#540): a drop back into Jetzt moves the card's DOM node
// (dnd-kit puts the placeholder back) in the same task as this flip, and an element that is re-inserted and
// restyled before any style pass has no before-change style, so it snaps to the bar without the morph. A production
// build does that work in one pass; `nuxt dev` re-inserts twice and flushes in between, so it hid the defect.
// Exception: a boxless chip with nothing spent is only visible while live, so this flush mounted it and it only
// pops; waiting would let it grow under the pop.
watch(live, (now) => {
  if (!now) {
    expanded.value = false
    return
  }
  rememberInJetzt(props.taskId, true)
  if (!hasBox.value && props.timeSpentSeconds === 0) {
    expanded.value = true
    return
  }
  afterTwoFrames(() => { expanded.value = live.value })
}, { flush: 'post' })
watch(() => props.isNow, (now) => {
  if (!now) rememberInJetzt(props.taskId, false)
})
</script>

<style scoped>
/* Component tokens (DESIGN.md, Progress chip). The width spring is a linear() easing with ~5 % overshoot that
   settles; only the width springs, height, text size and radius ease out without bounce. */
.chip-slot {
  --chip-h: 1.375rem;
  --chip-h-now: 1.875rem;
  --chip-radius-now: 0.9375rem; /* half the bar height */
  --chip-spring: linear(0, 0.032, 0.114, 0.225, 0.35, 0.477, 0.598, 0.707, 0.802, 0.88, 0.942, 0.989, 1.022, 1.044, 1.057, 1.063, 1.063, 1.059, 1.053, 1.045, 1.037, 1.029, 1.022, 1.015, 1.01, 1.005, 1.002, 1, 0.998, 0.997, 0.996, 0.996, 0.996, 0.996, 0.997, 0.997, 0.998, 0.998, 0.999, 0.999, 1);
  --chip-ease: cubic-bezier(0.2, 0, 0, 1);
  --chip-duration: 600ms;
  --chip-settle-delay: 240ms; /* the card lands first (drop animation ~150 ms), then the label morphs */
  --chip-fill-duration: 700ms;
  --chip-radius: var(--ui-radius); /* the sibling UBadge radius */
  --chip-pad: 0.4375rem;
  --chip-text: 0.6875rem; /* Label step */
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 1.75rem;
  min-width: 0;
  flex-shrink: 0; /* #584: a direct footer child now; the lead group shrinks (dots clip first), never the chip label */
  pointer-events: none;
}
.chip-slot--now { z-index: 5; }

/* Reserves the collapsed width in the footer so the row keeps its width rule (the dots clip first) */
.chip__sizer {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: var(--chip-h);
  padding-inline: var(--chip-pad);
  font-size: var(--chip-text);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  visibility: hidden;
}
.chip__sizer-icon { width: 0.8125rem; flex-shrink: 0; }
.chip__sizer--boxless-now { font-size: 0.75rem; padding-inline: 0.625rem; }

.chip {
  --chip-track: color-mix(in oklab, var(--ui-color-neutral-100), var(--ui-color-neutral-200)); /* #584 D2: half a step lighter than --ui-bg-muted (neutral-200); a whole step (neutral-100) left the track at 1.05:1 on the card sheet */
  --chip-fill: color-mix(in oklab, var(--ui-color-neutral-200), var(--ui-color-neutral-300)); /* #584 D2: half a step lighter than neutral-300 too; neutral-200 would sit at 1.07:1 on this track, so the spent share would vanish */
  --chip-accent: var(--ui-text-muted);
  position: absolute;
  left: 0; /* #584: the chip is the footer's first item; the bar grows to the right */
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  width: 100%;
  height: var(--chip-h);
  padding-inline: var(--chip-pad);
  border-radius: var(--chip-radius);
  background: var(--chip-track);
  color: var(--ui-text-highlighted);
  font-size: var(--chip-text);
  font-weight: 500;
  line-height: 1rem;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  isolation: isolate;
}
.chip-slot--armed .chip {
  transition:
    width var(--chip-duration) var(--chip-spring),
    height var(--chip-duration) var(--chip-ease),
    padding var(--chip-duration) var(--chip-ease),
    font-size var(--chip-duration) var(--chip-ease),
    border-radius var(--chip-duration) var(--chip-ease),
    background-color 240ms ease-in-out;
}
.chip--boxless { width: auto; min-width: 100%; }

/* Colour coding in Jetzt only */
.chip--primary { --chip-fill: var(--ui-color-primary-200); --chip-accent: var(--ui-color-primary-600); }
.chip--warning { --chip-fill: var(--ui-color-warning-200); --chip-accent: var(--ui-color-warning-600); }

/* Jetzt: a bar across the whole footer, over the items after the chip */
.chip--now {
  width: var(--footer-w, 100%);
  height: var(--chip-h-now);
  padding-inline: 0.75rem;
  font-size: 0.875rem; /* body step */
  border-radius: var(--chip-radius-now);
}
.chip-slot--armed .chip--now { transition-delay: var(--chip-settle-delay); }
.chip--now.chip--boxless { width: auto; min-width: 100%; font-size: 0.75rem; --chip-track: var(--ui-color-primary-100); }

.chip__fill {
  position: absolute;
  inset: 0;
  z-index: -1;
  width: var(--chip-p);
  background: var(--chip-fill);
  border-radius: inherit;
}
.chip-slot--armed .chip__fill { transition: width var(--chip-fill-duration) var(--chip-ease), background-color 300ms ease-in-out; }
.chip--boxless .chip__fill { width: 0; }
.chip-slot--armed .chip--now .chip__fill { transition-delay: 0ms, var(--chip-settle-delay); }

.chip__content { display: inline-flex; align-items: center; gap: 0.25rem; width: 100%; min-width: 0; }
.chip__icon {
  width: 0.8125rem;
  height: 0.8125rem;
  flex-shrink: 0;
  color: var(--chip-accent);
}
.chip-slot--armed .chip__icon { transition: width var(--chip-duration) var(--chip-ease), height var(--chip-duration) var(--chip-ease), color 300ms; }
.chip--now .chip__icon { width: 1.0625rem; height: 1.0625rem; }
.chip-slot--armed .chip--now .chip__icon { transition-delay: var(--chip-settle-delay); }

/* Spent time slides in before the timebox; the timebox moves to the far end of the bar */
.chip__spent {
  display: grid;
  grid-template-columns: 0fr;
  margin-right: -0.25rem; /* collapsed: the empty column must not add a flex gap */
  opacity: 0;
}
.chip-slot--armed .chip__spent { transition: grid-template-columns var(--chip-duration) var(--chip-spring), margin-right var(--chip-duration) var(--chip-spring), opacity 200ms ease-out; }
.chip--now .chip__spent { grid-template-columns: 1fr; margin-right: 0; opacity: 1; }
.chip-slot--armed .chip--now .chip__spent { transition-delay: var(--chip-settle-delay); }
.chip__spent-inner { overflow: hidden; min-width: 0; }
.chip__box { margin-left: auto; }
.chip--now .chip__box { color: var(--ui-text-toned); }
.chip--boxless.chip--now .chip__box { color: var(--ui-text-highlighted); margin-left: 0; }

/* A chip that appears (no timebox: entering Jetzt or first time spent) pops in; leaving it pops back out */
.chip-pop-enter-active { animation: chip-pop 240ms var(--chip-ease, ease-out) var(--chip-settle-delay, 240ms) both; }
.chip-pop-leave-active { animation: chip-pop 200ms ease-in reverse both; }
@keyframes chip-pop { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }

@media (max-width: 767px) {
  .chip-slot { --chip-text: 0.75rem; }
  .chip--now { font-size: 0.9375rem; } /* title step */
  .chip--now.chip--boxless,
  .chip__sizer--boxless-now { font-size: 0.875rem; }
}

@media (prefers-reduced-motion: reduce) {
  .chip-slot--armed .chip,
  .chip-slot--armed .chip__fill,
  .chip-slot--armed .chip__spent,
  .chip-slot--armed .chip__icon { transition: none; }
  .chip-pop-enter-active,
  .chip-pop-leave-active { animation: none; }
}
</style>
