<!--
@component TaskCompletionBurst
@kind primitive
@category feedback
@description The earned celebration of a completion (#692, DESIGN.md "Behaviour"): a short burst of small
green pieces that flies out of the card's check, around and over the card, and fades.
@usage Rendered by TaskCard while a completion plays (the card decides when); it tells the card when it is over.
@avoid Only the completion celebration, driven by TaskCard; no other success feedback uses it.
@responsibility
- Draws 40 fixed pieces (8 x 16 px rectangles and 12 px dots, deterministic so screenshots are stable) in the done-green
  tints `success-200..500`, warning-orange `secondary-300/400`, sky `info-300/400` and the marker yellow, flying out along an
  ellipse of ~230-310 x 120-180 px around the card centre, where the confirmation check shows (#124). #295 made it
  bolder, bigger and more colourful at the owner's request (a recorded exception to "The Status Is Not Decoration
  Rule", DESIGN.md "Earned celebration"); raspberry (error) and the topic hues stay out.
- Plays once, 1200 ms (a piece may start up to 100 ms late), animates only `transform` and `opacity`, so the card and the
  board never reflow. It sits above neighbouring cards and takes no pointer events: the next drag works while it plays.
- Owns its lifetime: independent of the store flag behind the in-card confirmation (1.3 s, 2.2 s with the message).
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

const COUNT = 40
const TINTS = 8
/** Burst length (the `completion-burst-fly` animation in the style block below, keep both in step) plus the longest start delay; the fallback timer ends the burst a bit after */
const DURATION_MS = 1200
const MAX_DELAY_MS = 100
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
    const rx = 230 + next() * 80
    const ry = 120 + next() * 60
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
  left: calc(50% - 6px);
  top: calc(50% - 6px);
  width: 12px;
  height: 12px;
  border-radius: calc(var(--ui-radius) / 4); /* a hair of rounding on the 8 x 16 px rectangles and 12 px dots: a recorded exception to the closed radius scale (kd#181), a particle is decoration, not a surface */
  background-color: var(--completion-burst-tint);
  opacity: 0;
  animation: completion-burst-fly 1200ms cubic-bezier(0.15, 0.7, 0.3, 1) var(--delay) 1 both;
}

.completion-burst__piece--rect {
  width: 8px;
  height: 16px;
  left: calc(50% - 4px);
  top: calc(50% - 8px);
}

.completion-burst__piece--dot {
  border-radius: 50%;
}

/* The done-green ramp, warning-orange, sky and marker yellow (design-system tokens only; #295) */
.completion-burst__piece--c0 { --completion-burst-tint: var(--ui-color-success-300); }
.completion-burst__piece--c1 { --completion-burst-tint: var(--ui-color-secondary-400); }
.completion-burst__piece--c2 { --completion-burst-tint: var(--ui-color-success-500); }
.completion-burst__piece--c3 { --completion-burst-tint: var(--ui-color-info-300); }
.completion-burst__piece--c4 { --completion-burst-tint: var(--marker); }
.completion-burst__piece--c5 { --completion-burst-tint: var(--ui-color-success-200); }
.completion-burst__piece--c6 { --completion-burst-tint: var(--ui-color-secondary-300); }
.completion-burst__piece--c7 { --completion-burst-tint: var(--ui-color-info-400); }

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
