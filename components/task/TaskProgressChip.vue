<!--
@component TaskProgressChip
@kind primitive
@category display
@description The timebox label of a task card as its progress item (#388); in Jetzt a timer bar that shrinks with the remaining time (#450)
@usage Item of the TaskCard footer after the source icon, first when there is none (#584, #471; not on the add sheet's Jetzt draft)
@avoid Only the timebox label of a task card; not for the add sheet's Jetzt draft.
@responsibility
- Outside Jetzt: a light grey chip "45 min" (track and fill half a step lighter since #584) whose grey fill shows the spent share of the timebox (no colour, also not on overrun or done cards)
- In Jetzt: once the card has settled it springs wider (x axis only) into a bar across the whole footer, anchored at its own
  left edge (the footer start, or right after the source icon, #584, #471; in Jetzt under the icon, #704) and growing to the right over the carry-over dots and priority badge: "12 min ...... 45 min", fill primary, warning above 80 percent
- In Jetzt the fill is a timer (#450, as the Now window's line, `getTimerBarShare`): it starts full and shrinks toward the left
  with the remaining time; the colour still follows the spent share; over the timebox it is full and warning again, set at
  once (the step into the overrun never plays a refill). The labels stay spent and timebox, the progressbar value stays the
  spent share. Outside Jetzt the fill keeps the spent share (a record, also on done cards): it eases between the two when
  the card enters or leaves Jetzt
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
- The fill eases (700 ms) only for a change the eye can follow: a step below half a percentage point, which is every
  timer tick of a timebox of 4 minutes or more, is set at once (#275). The ease animates `width`, which is laid out
  again in every frame: eased per tick it kept a resting board at 43 layouts a second for a fill that moved less than
  a tenth of a pixel. A tick inside the 700 ms after a larger change still eases, so it never cuts that ease short
- Motion is CSS only; `prefers-reduced-motion` shows the end state at once (the global rule, `main.css`). Never takes pointer events. Its own choreography, kept off the tokens on purpose (#593): the 600 ms width spring (`--chip-duration`, `--chip-spring`), the 240 ms settle delay (`--chip-settle-delay`, after the card's 200 ms landing) and the 700 ms fill ease (`--chip-fill-duration`); everything else reads the tokens
- The width spring is the app's one spring: it marks the moment a label becomes the card's live status. It never runs
  on page load; the bar has no shadow, it sits flat on the card's own (#410)
- Warning accent in the 600 step: the 500 step measured 2.97:1 on the card surface (below the 3:1 non-text floor,
  WCAG 1.4.11), the 600 step 4.13:1. Text on every fill keeps 4.5:1 (`a11y.spec.ts`, Jetzt card at 50 %, 85 %, over)
- A silent progressbar: the value is the percent, no value text and no live region, so per-second updates stay quiet;
  without a timebox the name is the spent time and there is no value
- The timer bar keeps a minimum fill (2.5 rem: the icon with its padding), so the last stretch never shows a sliver and the icon stays on the fill; the spent label can still straddle the fill's edge (both sides keep 4.5:1)
- Accepted: the task sheet's ring still shows the spent share while the Jetzt bar shows the share left (a record next to a timer); the overrun differs from a fresh start by colour only (a "+12 min" label would be new copy, out of scope of #450)
- One footer height (#879): the chip and the Jetzt bar are both 24 px (1.5 rem, the footer badges' height), so entering
  Jetzt springs the width only; the bar text is the 14 px body step on every width, the clock 14 px, the radius half the height
- Accepted: in Jetzt the bar covers the carry-over dots and priority badge (TaskCard makes the group after the
  chip inert and fades the badge group at the footer's end out, #879, so the bar ends in one clean pill); the bar spans the whole footer (`--footer-w`) and starts under the source unit (#471, `--source-w`, both set by TaskCard; #704), the cloud or Reminders hint on top of it (the source icon is hidden under the bar); the spring overshoot may poke a few px past the footer padding, inside the card
-->
<template>
  <Transition name="chip-pop" :appear="popsOnMount">
    <span
      v-if="visible"
      class="chip-slot"
      :class="{ 'chip-slot--now': expanded, 'chip-slot--armed': armed, 'chip-slot--still': !morphing }"
      :style="{ '--chip-p': `${fillShare}%`, '--chip-fill-duration': fillSteps ? '0ms' : undefined }"
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleFormat } from '~/composables/useLocaleFormat'
import { getTimeboxRingColor, getTimerBarShare } from '~/utils/timeboxProgress'
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

/** The timer bar (#450): in Jetzt the fill is the share of the timebox that is *left* (full at the start, shrinking
 *  from the right, full and warning when over, as the Now window's line); outside Jetzt it stays the spent share, a
 *  record of work on a task that is not running (and of a done one). Follows `expanded`, the bar's own state, so the
 *  fill changes together with the card's morph. */
const timerBar = computed(() => (expanded.value ? getTimerBarShare(props.timeSpentSeconds, props.timeBoxSeconds) : null))
const fillShare = computed(() => timerBar.value?.share ?? percent.value)

/** Largest step of the fill, in percentage points, that is set at once instead of eased: one second of a 200 s timebox */
const TICK_STEP_MAX = 0.5
/** Length of the fill's ease; keep in step with `--chip-fill-duration` below */
const FILL_EASE_MS = 700
/** The fill takes its next width at once (a timer tick, or the step into the overrun, which must not refill the bar
 *  visibly): binds `--chip-fill-duration: 0ms`, so no `width` transition starts. Set by a sync watcher, so the render
 *  that writes the new `--chip-p` already carries it. */
const fillSteps = ref(false)
let easesUntil = 0
watch(() => [fillShare.value, timerBar.value?.over === true] as const, ([now, over], [was, wasOver]) => {
  const jump = Math.abs(now - was) >= TICK_STEP_MAX
  if (jump) easesUntil = performance.now() + FILL_EASE_MS
  fillSteps.value = !jump && performance.now() >= easesUntil
  if (over && !wasOver) {
    fillSteps.value = true
    easesUntil = 0
  }
}, { flush: 'sync' })

/** Transitions are on only after the first frames: the footer width is measured after the mount, and a page load
 *  must not play the bar's width from the unmeasured fallback to the footer width */
const armed = ref(false)
/** The chip's shape (width, height, padding, type) moves only while it changes state: the card enters or leaves
 *  Jetzt (#602). A remount of a card already in Jetzt, or the footer being measured late (the board page returning
 *  into view), must not replay the entrance, so geometry transitions are off outside this window. Sync, so the render
 *  that flips `expanded` already carries the class. Kept past the spring: 240 ms settle delay + 600 ms duration. */
const MORPH_WINDOW_MS = 1000
const morphing = ref(false)
let morphTimer: ReturnType<typeof setTimeout> | undefined
watch(expanded, () => {
  morphing.value = true
  clearTimeout(morphTimer)
  morphTimer = setTimeout(() => { morphing.value = false }, MORPH_WINDOW_MS)
}, { flush: 'sync' })
onBeforeUnmount(() => clearTimeout(morphTimer))
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
/* Component tokens (DESIGN.md, Progress chip). The width spring is a linear() easing with ~5 % overshoot that settles; only the width springs, height, text size and radius ease out without bounce. */
.chip-slot {
  --chip-h: 1.5rem; /* #879: one footer height, the same as the footer badges (TaskCard) */
  --chip-h-now: 1.5rem; /* #879: the Jetzt bar keeps the chip's height, only its width springs */
  --chip-radius-now: 0.75rem; /* half the bar height, so the bar reads as a pill */
  --chip-spring: linear(0, 0.032, 0.114, 0.225, 0.35, 0.477, 0.598, 0.707, 0.802, 0.88, 0.942, 0.989, 1.022, 1.044, 1.057, 1.063, 1.063, 1.059, 1.053, 1.045, 1.037, 1.029, 1.022, 1.015, 1.01, 1.005, 1.002, 1, 0.998, 0.997, 0.996, 0.996, 0.996, 0.996, 0.997, 0.997, 0.998, 0.998, 0.999, 0.999, 1);
  --chip-ease: var(--ease-emphasized);
  --chip-duration: 600ms;
  --chip-settle-delay: 240ms; /* the card lands first (drop glide 200 ms, `DND_MOTION`), then the label morphs */
  --chip-fill-duration: 700ms; /* `FILL_EASE_MS` in the script; a tick-sized step binds 0ms inline (#275) */
  --chip-radius: var(--ui-radius); /* the sibling UBadge radius */
  --chip-pad: 0.4375rem;
  --chip-text: var(--text-label); /* Label step */
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
.chip__sizer-icon { width: 0.75rem; flex-shrink: 0; }
.chip__sizer--boxless-now { font-size: var(--text-xs); padding-inline: 0.5rem; }

.chip {
  --chip-track: color-mix(in oklab, var(--ui-color-neutral-100), var(--ui-color-neutral-200)); /* #584 D2: half a step lighter than --ui-bg-muted (neutral-200); a whole step (neutral-100) left the track at 1.05:1 on the card sheet */
  --chip-fill: color-mix(in oklab, var(--ui-color-neutral-200), var(--ui-color-neutral-300)); /* #584 D2: half a step lighter than neutral-300 too; neutral-200 would sit at 1.07:1 on this track, so the spent share would vanish */
  --chip-accent: var(--ui-text-muted);
  position: absolute;
  left: 0; /* #584, #471: the bar starts at the chip's own position (the footer start, or after the source icon; in Jetzt under it, #704) and grows to the right */
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
  line-height: var(--lh-snug);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  isolation: isolate;
}
.chip-slot--armed .chip {
  transition:
    width var(--chip-duration) var(--chip-spring),
    left var(--chip-duration) var(--chip-spring), /* #704: the Jetzt bar's start under the source icon moves with the width, not ahead of it */
    height var(--chip-duration) var(--chip-ease),
    padding var(--chip-duration) var(--chip-ease),
    font-size var(--chip-duration) var(--chip-ease),
    border-radius var(--chip-duration) var(--chip-ease),
    background-color var(--duration-slow) var(--ease-standard);
}
.chip--boxless { width: auto; min-width: 100%; }
.chip-slot.chip-slot--still :is(.chip, .chip__icon, .chip__spent) { transition: color var(--duration-slow), background-color var(--duration-slow) var(--ease-standard); } /* #602: no state change, no geometry motion; the tone change still fades */
/* Colour coding in Jetzt only */
.chip--primary { --chip-fill: var(--ui-color-primary-200); --chip-accent: var(--ui-color-primary-600); }
.chip--warning { --chip-fill: var(--ui-color-warning-200); --chip-accent: var(--ui-color-warning-600); }

/* Jetzt: a bar across the whole footer (--footer-w), starting under the source unit before the chip (--source-w, #704) and over the items after the chip */
.chip--now {
  width: var(--footer-w, 100%);
  height: var(--chip-h-now);
  padding-inline: 0.75rem;
  font-size: var(--text-sm); /* body step, on every width (#879) */
  border-radius: var(--chip-radius-now);
}
.chip--now:not(.chip--boxless) {
  left: calc(-1 * var(--source-w, 0px));
  padding-inline-start: calc(0.75rem + var(--source-w, 0px)); /* the clock stays clear of the cloud or Reminders hint on top of the bar */
}
.chip-slot--armed .chip--now { transition-delay: var(--chip-settle-delay); }
.chip--now.chip--boxless { width: auto; min-width: 100%; font-size: var(--text-xs); --chip-track: var(--ui-color-primary-100); }

.chip__fill {
  position: absolute;
  inset: 0;
  z-index: -1;
  width: var(--chip-p);
  background: var(--chip-fill); /* straight inner edge (#704): no radius of its own, the track's overflow clips the outer corners */
}
.chip-slot--armed .chip__fill { transition: width var(--chip-fill-duration) var(--chip-ease), background-color var(--duration-slow) var(--ease-standard); }
.chip--boxless .chip__fill { width: 0; }
/* The timer bar never shrinks below the icon and its padding (#450 design review): the clock always sits on the fill, the fill stays a pill, and the overrun step starts from a pill */
.chip--now:not(.chip--boxless) .chip__fill { min-width: min(calc(2.5rem + var(--source-w, 0px)), 100%); }
.chip-slot--armed .chip--now .chip__fill { transition-delay: 0ms, var(--chip-settle-delay); }

.chip__content { display: inline-flex; align-items: center; gap: 0.25rem; width: 100%; min-width: 0; }
.chip__icon {
  width: 0.75rem;
  height: 0.75rem;
  flex-shrink: 0;
  color: var(--chip-accent);
}
.chip-slot--armed .chip__icon { transition: width var(--chip-duration) var(--chip-ease), height var(--chip-duration) var(--chip-ease), color var(--duration-slow); }
.chip--now .chip__icon { width: 0.875rem; height: 0.875rem; }
.chip-slot--armed .chip--now .chip__icon { transition-delay: var(--chip-settle-delay); }

/* Spent time slides in before the timebox; the timebox moves to the far end of the bar */
.chip__spent {
  display: grid;
  grid-template-columns: 0fr;
  margin-right: -0.25rem; /* collapsed: the empty column must not add a flex gap */
  opacity: 0;
}
.chip-slot--armed .chip__spent { transition: grid-template-columns var(--chip-duration) var(--chip-spring), margin-right var(--chip-duration) var(--chip-spring), opacity var(--duration-base) var(--ease-emphasized); }
.chip--now .chip__spent { grid-template-columns: 1fr; margin-right: 0; opacity: 1; }
.chip-slot--armed .chip--now .chip__spent { transition-delay: var(--chip-settle-delay); }
.chip__spent-inner { overflow: hidden; min-width: 0; }
.chip__box { margin-left: auto; }
.chip--now .chip__box { color: var(--ui-text-toned); }
.chip--boxless.chip--now .chip__box { color: var(--ui-text-highlighted); margin-left: 0; }
/* A chip that appears (no timebox: entering Jetzt or first time spent) pops in; leaving it pops back out */
.chip-pop-enter-active { animation: chip-pop var(--duration-slow) var(--chip-ease) var(--chip-settle-delay) both; }
.chip-pop-leave-active { animation: chip-pop var(--duration-base) var(--ease-standard) reverse both; }
@keyframes chip-pop { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }

@media (--phone) {
  .chip--now.chip--boxless,
  .chip__sizer--boxless-now { font-size: var(--text-sm); }
}
</style>
