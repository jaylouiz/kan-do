<!--
@component FocusOverlay
@description The layer that calms the board while a task sits in Jetzt (#394): a soft radial pool of warm dusk
centred on the Jetzt card (a desk lamp), with a flat defocus under the whole layer.
@usage First child of `.board` in Board.vue, rendered only while the focus is possible (`focusEnabledNow`)
@responsibility
- Two sibling layers, tint and blur, each fading on its own: an ancestor with opacity is the backdrop root and would
  stop `backdrop-filter` from seeing the board
- Measures `#column-progress .task[data-current]` per frame while it is visible or fading, so the pool follows the
  card (page scroll on the phone, resize, a new card)
- Never takes a pointer event, except on touch where it swallows the tap that dismisses it
- `aria-hidden`: purely visual, no DOM of the board is removed. Layer rules and gradient: board-focus-overlay.css
- Lit above it: only the Jetzt column (header and card, which lifts with `--shadow-task-lifted` while the overlay is
  visible), and on the phone the nav pill. The Erledigt footer sits below it (#503); on desktop the app bar (z 40) stays
  above it, undimmed (#694), and the overlay is `fixed` over the whole viewport. While it is lit a classic scroll bar takes the dusk tone. `--focus-dusk` is used only here and in that shadow, never as text, fill or border
- Accepted contrast trade-off (DESIGN.md "Receding Text"): the dimmed board is intentionally below 4.5:1 while the
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

let raf = 0
let stopTimer: ReturnType<typeof setTimeout> | null = null

const measure = () => {
  // The overlay's own box: the board on the phone, the whole viewport on desktop (fixed, board-focus-overlay.css)
  const board = el.value
  const card = document.querySelector<HTMLElement>('#column-progress .task[data-current]')
  if (board && card) {
    const b = board.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    const next = {
      x: Math.round(c.left - b.left + c.width / 2),
      y: Math.round(c.top - b.top + c.height / 2),
      w: Math.round(c.width),
      h: Math.round(c.height),
    }
    const cur = box.value
    if (next.x !== cur.x || next.y !== cur.y || next.w !== cur.w || next.h !== cur.h) box.value = next
  }
  raf = requestAnimationFrame(measure)
}
const stop = () => {
  cancelAnimationFrame(raf)
  raf = 0
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = null
}

watch(
  () => props.on,
  (on) => {
    stop()
    if (on) {
      measure()
    } else {
      raf = requestAnimationFrame(measure)
      stopTimer = setTimeout(stop, FADE_OUT_MS)
    }
  },
  { immediate: true },
)
onBeforeUnmount(stop)
</script>
