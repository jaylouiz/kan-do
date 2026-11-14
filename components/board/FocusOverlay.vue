<!--
@component FocusOverlay
@kind primitive
@category display
@description The layer that calms the board while a task sits in Jetzt (#394): a soft radial pool of warm dusk
centred on the Jetzt card (a desk lamp), with a flat defocus under the whole layer.
@usage First child of `.board` in Board.vue, rendered only while the focus is possible (`focusEnabledNow`)
@avoid A calming layer, not a modal backdrop (ResponsiveOverlay) and never interactive; only while a task sits in Jetzt.
@responsibility
- Two sibling layers, tint and blur, each fading on its own: an ancestor with opacity is the backdrop root and would
  stop `backdrop-filter` from seeing the board
- Measures `#column-progress .task[data-current]` while it is visible or fading, so the pool follows the card (page
  scroll, resize, a new card): per frame until the card's box has rested for about half a second, then only when a
  signal says it may have moved (#275: a resize of the overlay, the card or the page, any scroll, and a check once a
  second that also notices a new card). Measuring in every frame for as long as the overlay was lit kept a resting
  board at 60 callbacks a second, and the overlay is lit exactly while nobody touches the app
- Accepted: a move none of the signals reports is followed within a second, not within a frame
- Never takes a pointer event, except on touch where it swallows the tap that dismisses it
- `aria-hidden`: purely visual, no DOM of the board is removed. Layer rules and gradient: board-focus-overlay.css
- Lit above it: only the Jetzt column (header and card, which lifts with `--shadow-task-lifted` while the overlay is
  visible), and on the phone the nav pill. The Erledigt footer sits below it (#503); on desktop the app bar (z 40) stays
  above it, undimmed (#694), and the overlay is `fixed` over the whole viewport. While it is lit a classic scroll bar takes the dusk tone. `--focus-dusk` is used only here and in that shadow, never as text, fill or border
- Accepted contrast trade-off (DESIGN.md "The Receding Text Rule"): the dimmed board is intentionally below 4.5:1 while the
  overlay is on. Measured 2026-10-29 from composited colours without the blur: worst case muted text on paper at the
  rim 3.13:1 (3.24:1 on a card, body text on a card 5.7:1); the lit Jetzt column keeps its normal contrast. #503 puts the Erledigt
  footer under the same trade-off (same rule, same reversal); the app bar is no longer dimmed (#694). It is reversible
  (mouse move, tap, the Fokus setting); `tests/e2e/a11y.spec.ts` exempts exactly what it covers
- Never covers a focused control (a key press hides it, WCAG 2.2 SC 2.4.11), never changes drop collision, and the
  Jetzt card stays laid out at its real size
-->
<template>
  <div
    ref="el"
    class="focus-overlay"
    :class="{ 'is-on': on, 'is-leaving': leaving, 'is-swallowing': swallowing }"
    :style="vars"
    aria-hidden="true"
    data-testid="focus-overlay"
  >
    <span class="focus-overlay__blur" />
    <span class="focus-overlay__tint" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { FOCUS_LEAVE_MS } from '~/composables/useFocusOverlay'

defineOptions({ name: 'FocusOverlay' })

const props = defineProps<{
  /** Visible (fading in) or hidden (fading out) */
  on: boolean
  /** The card left Jetzt: fade out slowly instead of the snappy hide, then Board.vue unmounts it */
  leaving?: boolean
  /** Touch mode: the overlay takes the tap that dismisses it */
  touch: boolean
  /** A touch just hid the overlay: keep absorbing for a moment so the click after the tap lands here */
  swallowTap: boolean
}>()

/** Length of the fade-out, plus a margin: the pool keeps following the card until it is gone */
const FADE_OUT_MS = FOCUS_LEAVE_MS

const el = ref<HTMLElement | null>(null)
const box = ref({ x: 0, y: 0, w: 288, h: 132 })

const vars = computed(() => ({
  '--fx': `${box.value.x}px`,
  '--fy': `${box.value.y}px`,
  '--fw': `${box.value.w}px`,
  '--fh': `${box.value.h}px`,
}))

const swallowing = computed(() => props.touch && (props.on || props.swallowTap))

/** Frames without a change after which the per-frame tracking stops: about half a second at 60 Hz */
const SETTLE_FRAMES = 30
/** The check for a move no signal reported, and for a new card in Jetzt */
const CHECK_MS = 1000

let raf = 0
let still = 0
let stopTimer: ReturnType<typeof setTimeout> | null = null
let checkTimer: ReturnType<typeof setInterval> | null = null
let observer: ResizeObserver | null = null
let observedBoard: Element | null = null
let observedCard: Element | null = null

/** Keeps the ResizeObserver on the element that is there now (the overlay mounts after the first call, a card can be replaced) */
const observe = (now: Element | null, was: Element | null) => {
  if (now === was) return now
  if (was) observer?.unobserve(was)
  if (now) observer?.observe(now)
  return now
}

/** Reads the card's box; true when it differs from the one the pool is drawn at */
const measure = (): boolean => {
  // The overlay's own box: the board on the phone, the whole viewport on desktop (fixed, board-focus-overlay.css)
  const board = el.value
  const card = document.querySelector<HTMLElement>('#column-progress .task[data-current]')
  observedBoard = observe(board, observedBoard)
  observedCard = observe(card, observedCard)
  if (!board || !card) return false
  const b = board.getBoundingClientRect()
  const c = card.getBoundingClientRect()
  const next = {
    x: Math.round(c.left - b.left + c.width / 2),
    y: Math.round(c.top - b.top + c.height / 2),
    w: Math.round(c.width),
    h: Math.round(c.height),
  }
  const cur = box.value
  if (next.x === cur.x && next.y === cur.y && next.w === cur.w && next.h === cur.h) return false
  box.value = next
  return true
}

const frame = () => {
  raf = 0
  still = measure() ? 0 : still + 1
  if (still < SETTLE_FRAMES) raf = requestAnimationFrame(frame)
}
/** Follows the card per frame until its box has rested for SETTLE_FRAMES; every signal starts it again */
const track = () => {
  still = 0
  if (!raf) raf = requestAnimationFrame(frame)
}

const stop = () => {
  cancelAnimationFrame(raf)
  raf = 0
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = null
  if (checkTimer) clearInterval(checkTimer)
  checkTimer = null
  observer?.disconnect()
  observer = null
  observedBoard = null
  observedCard = null
  document.removeEventListener('scroll', track, { capture: true })
}
const start = () => {
  // jsdom (unit tests) has no ResizeObserver: scroll and the check still report a move
  observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(track)
  observer?.observe(document.body)
  // Capturing: a scroll event does not bubble, and on the phone the column page scrolls, not the document
  document.addEventListener('scroll', track, { capture: true, passive: true })
  checkTimer = setInterval(() => {
    if (measure()) track()
  }, CHECK_MS)
  measure()
  track()
}

watch(
  () => props.on,
  (on) => {
    stop()
    start()
    // Hidden: the pool keeps following the card until the fade-out is over, then nothing runs
    if (!on) stopTimer = setTimeout(stop, FADE_OUT_MS)
  },
  { immediate: true },
)
onBeforeUnmount(stop)
</script>
