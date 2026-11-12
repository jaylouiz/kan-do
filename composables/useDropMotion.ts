import { computed, nextTick, toValue, type MaybeRefOrGetter } from 'vue'
import type { DropAnimationFunction } from '@dnd-kit/dom'
import { useBoardDragState, type DraggedStack } from '~/composables/useBoardDragState'

/**
 * The drag's timings on the JS side (kd#181). dnd-kit takes numbers, not custom properties, so these mirror the
 * tokens in `assets/css/main.css`: `--duration-base` (200 ms) for neighbours making room, the drop glide and the
 * set-down, `--ease-emphasized` for all three. Change both places together.
 */
export const DND_MOTION = {
  reorderMs: 200,
  dropMs: 200,
  setDownMs: 200,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const

/** How long `land` waits for dnd-kit's drop animation before it finishes on its own (a drop without a glide never calls it) */
const GLIDE_GRACE_MS = 150

/** dnd-kit's own marker of an overlay that is running its drop animation (`@dnd-kit/dom`, Feedback) */
const DROPPING_ATTRIBUTE = 'data-dnd-dropping'

/** Counts landings, so a drop animation that outlived its drop (the same card picked up and dropped again) cannot end the newer one */
let landingRun = 0
let fallbackTimer: ReturnType<typeof setTimeout> | undefined
let setDownTimer: ReturnType<typeof setTimeout> | undefined

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The end of a drag as motion (kd#181), visuals only: no store or drop logic.
 *
 * 1. `land(taskId, stack)` right after `onDragEnd`: the floating preview stays (Board.vue renders it from
 *    `landingTaskId`) and the real card shows as the slot (`kando-dnd-landing`, dnd.css) while the preview glides.
 * 2. `dropAnimation` is dnd-kit's drop animation: it glides the preview onto the card's rendered slot, then calls
 *    `setDown`. Its end is the signal that the preview is gone, so nothing watches class changes.
 * 3. `setDown` marks the card for one set-down animation (`kando-dnd-set-down`) and clears the mark after its length.
 *
 * `reset` (a new drag starts) drops both marks at once.
 */
export function useDropMotion() {
  const { dragState } = useBoardDragState()

  function reset() {
    clearTimeout(fallbackTimer)
    clearTimeout(setDownTimer)
    dragState.value.landingTaskId = null
    dragState.value.landingStack = null
    dragState.value.setDownTaskId = null
  }

  function setDown() {
    clearTimeout(fallbackTimer)
    const taskId = dragState.value.landingTaskId
    dragState.value.landingTaskId = null
    dragState.value.landingStack = null
    if (!taskId) return
    if (prefersReducedMotion()) return
    dragState.value.setDownTaskId = taskId
    clearTimeout(setDownTimer)
    setDownTimer = setTimeout(() => {
      if (dragState.value.setDownTaskId === taskId) dragState.value.setDownTaskId = null
    }, DND_MOTION.setDownMs)
  }

  function land(taskId: string, stack: DraggedStack | null) {
    reset()
    landingRun += 1
    dragState.value.landingTaskId = taskId
    dragState.value.landingStack = stack
    fallbackTimer = setTimeout(setDown, DND_MOTION.dropMs + GLIDE_GRACE_MS)
  }

  const dropAnimation: DropAnimationFunction = async ({ feedbackElement, translate }) => {
    const taskId = dragState.value.landingTaskId
    const run = landingRun
    if (!taskId) return
    // Vue renders the drop first, so the slot measured is the one the card ends in
    await nextTick()
    const target = document.querySelector(`.board :is(.task-wrapper, .task-stack)[data-task-id="${CSS.escape(taskId)}"]`)
    if (target && feedbackElement.isConnected && !prefersReducedMotion()) {
      const from = feedbackElement.getBoundingClientRect()
      const to = target.getBoundingClientRect()
      const [x = translate.x, y = translate.y] = getComputedStyle(feedbackElement).translate
        .split(' ')
        .map(part => Number.parseFloat(part))
        .map(value => (Number.isFinite(value) ? value : undefined))
      // dnd-kit pins the overlay's `translate` with `!important` unless it carries this attribute (its own drop
      // animation sets it the same way); an important declaration would beat the animation
      feedbackElement.setAttribute(DROPPING_ATTRIBUTE, '')
      await feedbackElement.animate(
        { translate: [`${x}px ${y}px 0`, `${x + to.left - from.left}px ${y + to.top - from.top}px 0`] },
        { duration: DND_MOTION.dropMs, easing: DND_MOTION.easing, fill: 'forwards' },
      ).finished.catch(() => undefined)
      feedbackElement.removeAttribute(DROPPING_ATTRIBUTE)
    }
    // A newer drop took over meanwhile: its own animation sets it down
    if (run === landingRun && dragState.value.landingTaskId === taskId) setDown()
  }

  return { land, setDown, reset, dropAnimation }
}

/**
 * The classes a card wrapper or a collapsed stack carries at the end of its drag (dnd.css): `kando-dnd-landing`
 * while the preview glides onto it, `kando-dnd-set-down` for the one animation after it.
 */
export function useDropMotionClasses(taskId: MaybeRefOrGetter<string>) {
  const { dragState } = useBoardDragState()
  return computed(() => ({
    'kando-dnd-landing': dragState.value.landingTaskId === toValue(taskId),
    'kando-dnd-set-down': dragState.value.setDownTaskId === toValue(taskId),
  }))
}
