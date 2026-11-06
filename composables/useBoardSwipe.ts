import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'

/** Movement (px) before a touch is classified as horizontal or vertical. */
export const SWIPE_LOCK_SLOP_PX = 10
/** One axis must beat the other by this factor to lock; near-diagonal moves stay undecided. */
export const SWIPE_AXIS_RATIO = 1.5
/** Fraction of the viewport width a drag must pass to commit to the neighbouring page. */
export const SWIPE_COMMIT_FRACTION = 0.25
/** Release velocity (px/ms) that commits a short flick. */
export const SWIPE_COMMIT_VELOCITY = 0.4
/** Share of the finger movement the board follows past the first / last page. */
export const SWIPE_EDGE_RESISTANCE = 0.3
/** Trailing window (ms) the release velocity is measured over. */
const VELOCITY_WINDOW_MS = 100

/** Targets whose touches belong to the control itself (typing, selecting, tapping), never to a swipe. */
const INTERACTIVE_SELECTOR = 'input, textarea, select, button, a, [contenteditable], [contenteditable="true"], .add-task-slot'
/** Open dialog / slideover / task sheet (Nuxt UI portals them as role="dialog"). */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"]'

/** True when the touch started on a control that must keep its own behaviour. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null
}

/** True while a modal overlay (task sheet, dialog, slideover) is open. */
export function hasOpenOverlay(): boolean {
  return typeof document !== 'undefined' && document.querySelector(OVERLAY_SELECTOR) !== null
}

export type SwipeAxis = 'x' | 'y'

/**
 * Classifies a touch after it moved (dx, dy) from its start. Returns null while the
 * movement is below the slop or too diagonal to call.
 */
export function resolveSwipeAxis(dx: number, dy: number): SwipeAxis | null {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.hypot(ax, ay) < SWIPE_LOCK_SLOP_PX) return null
  if (ax >= ay * SWIPE_AXIS_RATIO) return 'x'
  if (ay >= ax * SWIPE_AXIS_RATIO) return 'y'
  return null
}

/** Live board offset for a horizontal drag of `dx`, damped past the first and last page. */
export function applySwipeResistance(dx: number, tab: number, lastTab: number): number {
  const pastFirst = tab <= 0 && dx > 0
  const pastLast = tab >= lastTab && dx < 0
  return pastFirst || pastLast ? dx * SWIPE_EDGE_RESISTANCE : dx
}

interface SwipeTargetInput {
  dx: number
  /** Signed release velocity in px/ms (negative = leftwards). */
  velocity: number
  viewportWidth: number
  tab: number
  lastTab: number
}

/** Page to settle on after release: a neighbour on distance or velocity, otherwise `tab` (snap back). */
export function resolveSwipeTarget({ dx, velocity, viewportWidth, tab, lastTab }: SwipeTargetInput): number {
  const byDistance = Math.abs(dx) > viewportWidth * SWIPE_COMMIT_FRACTION
  const byVelocity = Math.abs(velocity) > SWIPE_COMMIT_VELOCITY && Math.sign(velocity) === Math.sign(dx)
  if (!byDistance && !byVelocity) return tab
  // Swiping left (dx < 0) reveals the next page.
  const next = dx < 0 ? tab + 1 : tab - 1
  return Math.min(Math.max(next, 0), lastTab)
}

interface UseBoardSwipeOptions {
  /** Settled page; stays the single source of truth, the live offset is transient. */
  activeTab: Ref<number>
  lastTab: number
  /** False on desktop and while a dnd-kit drag is active: the tracker then ignores/aborts touches. */
  isEnabled: () => boolean
  /** Called once on release with the page to settle on, only when it differs from `activeTab`. */
  onCommit: (tab: number) => void
}

interface Sample { t: number, x: number }

interface Tracking {
  pointerId: number
  startX: number
  startY: number
  axis: SwipeAxis | null
  samples: Sample[]
}

/**
 * Pointer-driven column-page swipe for the mobile board (#145). A touch locks to one axis
 * after a small slop: vertical is left to native scrolling (CSS `touch-action: pan-y`),
 * horizontal exposes `offsetPx` so the board follows the finger and commits on release by
 * distance or velocity. Never calls preventDefault, so dnd-kit can still take over a held touch.
 */
export function useBoardSwipe({ activeTab, lastTab, isEnabled, onCommit }: UseBoardSwipeOptions) {
  /** Transient pixel offset added to the settled translateX while a horizontal swipe is live. */
  const offsetPx = ref(0)
  /** True while locked horizontal; drives the class that disables the board transition. */
  const isSwiping = ref(false)

  let tracking: Tracking | null = null

  const detach = () => {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', cancel)
  }

  /** Abort without committing: snap back (the CSS transition is re-enabled once isSwiping drops). */
  function cancel() {
    tracking = null
    detach()
    isSwiping.value = false
    offsetPx.value = 0
  }

  const velocityOf = (samples: Sample[]): number => {
    const last = samples[samples.length - 1]
    if (!last) return 0
    const first = samples.find(s => last.t - s.t <= VELOCITY_WINDOW_MS)
    if (!first || first === last) return 0
    return (last.x - first.x) / (last.t - first.t)
  }

  const record = (state: Tracking, event: PointerEvent) => {
    state.samples.push({ t: event.timeStamp, x: event.clientX })
    const cutoff = event.timeStamp - VELOCITY_WINDOW_MS * 2
    while (state.samples.length > 2 && state.samples[0] && state.samples[0].t < cutoff) state.samples.shift()
  }

  function onPointerDown(event: PointerEvent) {
    if (tracking) {
      // A second finger turns the gesture into something else (pinch, two-finger scroll).
      // A stale state (its pointer ended without an up/cancel reaching us) must not swallow
      // this swipe: a fresh primary touch means the tracked pointer is gone, so start over.
      const stale = event.isPrimary && event.pointerId !== tracking.pointerId
      cancel()
      if (!stale) return
    }
    if (event.pointerType !== 'touch' || !event.isPrimary || !isEnabled()) return
    if (isInteractiveTarget(event.target) || hasOpenOverlay()) return
    tracking = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: null,
      samples: [{ t: event.timeStamp, x: event.clientX }],
    }
    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', cancel)
  }

  function onPointerMove(event: PointerEvent) {
    const state = tracking
    if (!state || event.pointerId !== state.pointerId) return
    if (!isEnabled() || hasOpenOverlay()) {
      cancel()
      return
    }
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    record(state, event)
    if (state.axis === null) {
      state.axis = resolveSwipeAxis(dx, dy)
      if (state.axis === 'x') isSwiping.value = true
    }
    if (state.axis === 'x') offsetPx.value = applySwipeResistance(dx, activeTab.value, lastTab)
  }

  function onPointerUp(event: PointerEvent) {
    const state = tracking
    if (!state || event.pointerId !== state.pointerId) return
    const dx = event.clientX - state.startX
    record(state, event)
    const settled = state.axis === 'x' && isEnabled()
      ? resolveSwipeTarget({
        dx,
        velocity: velocityOf(state.samples),
        viewportWidth: window.innerWidth,
        tab: activeTab.value,
        lastTab,
      })
      : activeTab.value
    const changed = settled !== activeTab.value
    cancel()
    if (changed) onCommit(settled)
  }

  // A dnd-kit drag (or leaving mobile) takes the touch over: drop the swipe without committing.
  watch(isEnabled, (enabled) => {
    if (!enabled && tracking) cancel()
  })

  if (getCurrentScope()) onScopeDispose(cancel)

  return { offsetPx, isSwiping, onPointerDown }
}
