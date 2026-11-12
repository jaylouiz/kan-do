<!--
@component TaskCompletionBurst
@kind primitive
@category feedback
@description The earned celebration of a completion (#692, DESIGN.md "Behaviour"): a short burst of small
green pieces that flies out of the card's check, around and over the card, and fades.
@usage Rendered by TaskCard while a completion plays (the card decides when); it tells the card when it is over.
@avoid Only the completion celebration, driven by TaskCard; no other success feedback uses it.
@responsibility
- Draws 24 fixed pieces (6 x 12 px rectangles and 10 px dots, deterministic so screenshots are stable) in the done-green tints
  `success-200..500` plus `neutral-400`, flying out along an ellipse of ~175-230 x 88-133 px around the card centre,
  where the confirmation check shows (#124). Look constants are the round-1 prototype's variant A.
- Plays once, 900 ms (a piece may start up to 90 ms late), animates only `transform` and `opacity`, so the card and the
  board never reflow. It sits above neighbouring cards and takes no pointer events: the next drag works while it plays.
- Owns its lifetime: the store flag behind the in-card confirmation ends at 800 ms, the burst runs a little longer.
  It emits `done` after its last piece ends (a timer is the fallback when no animation event comes).
- Decorative: `aria-hidden`, no focus, no text. Reduced motion: the card does not mount it and the CSS hides it.
- Pieces extend over neighbouring cards and clip at the edge of the screen: `.board-container` on mobile, `.board` on
  desktop (board.css, `overflow: clip`), so a card in the right column never grows the page sideways.
-->
<template>
  <span class="completion-burst" aria-hidden="true" data-testid="completion-burst" @animationend="onPieceEnd">
    <i
      v-for="(piece, index) in PIECES"
      :key="index"
      class="completion-burst__piece"
      :class="[`completion-burst__piece--${piece.shape}`, `completion-burst__piece--c${piece.tint}`]"
      :style="{ '--dx': `${piece.dx}px`, '--dy': `${piece.dy}px`, '--rot': `${piece.rot}deg`, '--delay': `${piece.delay}ms` }"
    />
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

defineOptions({ name: 'TaskCompletionBurst' })

const emit = defineEmits<{ done: [] }>()

/** One piece's flight: target offset from the card centre, spin, and its start delay */
interface Piece {
  dx: number
  dy: number
  rot: number
  delay: number
  shape: 'rect' | 'dot'
  tint: number
}

const COUNT = 24
const TINTS = 5
/** Burst length (the `completion-burst-fly` animation in the style block below, keep both in step) plus the longest start delay; the fallback timer ends the burst a bit after */
const DURATION_MS = 900
const MAX_DELAY_MS = 90
const FALLBACK_MS = DURATION_MS + MAX_DELAY_MS + 100

// Deterministic pseudo-random numbers (Park-Miller): the same burst every time, stable in screenshots and tests
const PIECES: Piece[] = (() => {
  let seed = 7
  const next = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  return Array.from({ length: COUNT }, (_, i) => {
    const angle = (i / COUNT) * Math.PI * 2 + next() * 0.4
    const rx = 175 + next() * 55
    const ry = 88 + next() * 45
    return {
      dx: Math.round(Math.cos(angle) * rx),
      dy: Math.round(Math.sin(angle) * ry),
      rot: Math.round((next() - 0.5) * 540),
      delay: Math.round(next() * MAX_DELAY_MS),
      shape: i % 3 === 1 ? 'dot' : 'rect',
      tint: i % TINTS,
    } satisfies Piece
  })
})()

let remaining = COUNT
let timer: ReturnType<typeof setTimeout> | undefined
let finished = false

function finish() {
  if (finished) return
  finished = true
  clearTimeout(timer)
  emit('done')
}

function onPieceEnd() {
  remaining -= 1
  if (remaining <= 0) finish()
}

onMounted(() => {
  timer = setTimeout(finish, FALLBACK_MS)
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style>
/* A zero-size anchor at the card centre; the pieces fly out of it. Above the confirmation layer (z-index 20) and
   the neighbouring cards, never in the way of a pointer. */
.completion-burst {
  position: absolute;
  inset: 0;
  z-index: var(--z-card-layer);
  pointer-events: none;
}

.completion-burst__piece {
  position: absolute;
  left: calc(50% - 5px);
  top: calc(50% - 5px);
  width: 10px;
  height: 10px;
  border-radius: calc(var(--ui-radius) / 4); /* a hair of rounding on the 6 x 12 px rectangles and 10 px dots: a recorded exception to the closed radius scale (kd#181), a particle is decoration, not a surface */
  background-color: var(--completion-burst-tint);
  opacity: 0;
  animation: completion-burst-fly 900ms cubic-bezier(0.15, 0.7, 0.3, 1) var(--delay) 1 both;
}

.completion-burst__piece--rect {
  width: 6px;
  height: 12px;
  left: calc(50% - 3px);
  top: calc(50% - 6px);
}

.completion-burst__piece--dot {
  border-radius: 50%;
}

/* The done-green ramp plus one neutral (design-system tokens only) */
.completion-burst__piece--c0 { --completion-burst-tint: var(--ui-color-success-300); }
.completion-burst__piece--c1 { --completion-burst-tint: var(--ui-color-success-400); }
.completion-burst__piece--c2 { --completion-burst-tint: var(--ui-color-success-500); }
.completion-burst__piece--c3 { --completion-burst-tint: var(--ui-color-success-200); }
.completion-burst__piece--c4 { --completion-burst-tint: var(--ui-color-neutral-400); }

/* Flies out fast and settles (the easing), stays opaque for the first 70 %, then fades. The 14 px sag at the end
   is the only gravity. */
@keyframes completion-burst-fly {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0) scale(0.5);
  }
  70% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(var(--dx), calc(var(--dy) + 14px)) rotate(var(--rot)) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .completion-burst {
    display: none;
  }
}
</style>
