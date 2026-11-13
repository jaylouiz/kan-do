import { computed, getCurrentScope, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/**
 * @composable useSwipeDeck
 * @description State and gesture logic of a swipe deck (#451): `count` cards in a fixed deal order (front card first);
 * the front card goes to the back on "next" and the last card comes back to the front on "prev". Nothing is persisted.
 * @usage `RecapDeck` renders the cards from `depthOf(index)` / `frontX` and wires the pointer and key handlers.
 * @responsibility
 * - Order: `offset` is the deal index of the front card, `position` (offset + 1) the counter; both wrap
 * - Keys: ←/→ move the deck and are `preventDefault`ed only when the deck can move (2+ cards); otherwise the key reaches the page
 * - Gestures: pointer drag past 80px (either way) or a tap (movement of 6px or less) goes next; a shorter drag snaps back;
 *   a cancelled pointer, a non-primary button or a second finger changes nothing
 * - Queue: input that arrives while a card is flying is kept in order, both directions, capped at 8 (a swipe dropped on a full
 *   queue resets the drag offset), and dropped on unmount
 * - Motion (#690): the moving card (next: the front card, prev: the back card) first slides sideways at full opacity (`out`,
 *   130ms; the deck accepts the next move from here), then the offset rotates and the card takes its new depth, i.e. it passes behind the deck (next) or comes to the front
 *   (prev), while the others step up or back (`settle`, 200ms). Nothing fades. With prefers-reduced-motion every move is applied
 *   at once (the media query is read at call time); direct drag feedback stays
 * - Announcement: `announceIndex` is set once per settled change (never for the first render, never during a queued burst)
 * - Timers: all cleared when the scope is disposed, no state is written afterwards
 */

/** Horizontal drag (px) past which a release counts as a swipe. */
export const DECK_SWIPE_THRESHOLD_PX = 80
/** Pointer movement (px) above which a press is a drag, not a tap. */
export const DECK_TAP_SLOP_PX = 6
/** Sideways slide of the moving card (ms); mirrors the `out` transition in `RecapDeck`. */
export const DECK_OUT_MS = 130
/** Settle to the new depth (ms); the CSS transition in `RecapDeck` is 300ms and may finish while the next move has started. */
export const DECK_SETTLE_MS = 200
/** One whole move (ms). */
export const DECK_MOVE_MS = DECK_OUT_MS + DECK_SETTLE_MS
/** Input that may wait while a card flies. */
export const DECK_QUEUE_MAX = 8
/** Fallback slide distance (px) when the caller does not measure the deck. */
const DEFAULT_FLY_DISTANCE_PX = 144

type Direction = 1 | -1
type Move = { type: 'next' | 'prev', dir: Direction }

/** The card that travels in the current move; it is the only one that leaves its layer geometry. */
export interface DeckMoving {
  /** Deal index of the card. */
  index: number
  /** Horizontal offset (px) while `out`; 0 while `settle`. */
  x: number
  stage: 'out' | 'settle'
  type: Move['type']
}

export interface SwipeDeckOptions {
  /** Number of cards in the deck. */
  count: MaybeRefOrGetter<number>
  /** Identity of the card list: a changed key resets the deck to its first card. */
  key?: MaybeRefOrGetter<string>
  /** Distance (px) the moving card slides sideways, measured when the move starts. */
  flyDistance?: () => number
}

/** The part of a PointerEvent the deck reads (a plain object is enough in tests). */
export interface DeckPointer {
  pointerId?: number
  pointerType?: string
  isPrimary?: boolean
  button?: number
  clientX: number
}

/** The part of a KeyboardEvent the deck reads. */
export interface DeckKey {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  target?: EventTarget | null
  currentTarget?: EventTarget | null
  preventDefault?: () => void
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useSwipeDeck(options: SwipeDeckOptions) {
  const count = computed(() => Math.max(0, toValue(options.count)))

  /** Deal index of the front card. */
  const offset = ref(0)
  /** Horizontal drag of the front card while the pointer is down. */
  const dx = ref(0)
  const dragging = ref(false)
  /** The card that travels in the current move, or null. */
  const moving = ref<DeckMoving | null>(null)
  /** Deal index to announce after a settled change, null until the first change. */
  const announceIndex = ref<number | null>(null)

  const position = computed(() => (count.value === 0 ? 0 : offset.value + 1))
  const canMove = computed(() => count.value > 1)
  /** The front card follows the finger, or slides sideways while it goes to the back. */
  const frontX = computed(() => (moving.value?.type === 'next' && moving.value.stage === 'out' ? moving.value.x : dx.value))

  /** Depth of a card: 0 is the front card. */
  function depthOf(index: number): number {
    const n = count.value
    return n === 0 ? 0 : (((index - offset.value) % n) + n) % n
  }

  let busy = false
  /** Identifies the latest move, so a settle marker never clears the marker of a newer move. */
  let moveToken = 0
  let disposed = false
  let queue: Move[] = []
  let settled = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function after(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {
      timers.delete(handle)
      if (!disposed) fn()
    }, ms)
    timers.add(handle)
    return handle
  }
  function clearTimers() {
    for (const handle of timers) clearTimeout(handle)
    timers.clear()
  }

  function rotate(type: Move['type']) {
    const n = count.value
    if (n < 2) return
    offset.value = type === 'next' ? (offset.value + 1) % n : (offset.value - 1 + n) % n
  }

  function settle() {
    if (offset.value === settled) return
    settled = offset.value
    announceIndex.value = offset.value
  }

  function drain() {
    const move = queue.shift()
    if (move) run(move)
    else settle()
  }

  function finish() {
    busy = false
    drain()
  }

  function run(move: Move) {
    if (count.value < 2) {
      dx.value = 0
      drain()
      return
    }
    if (prefersReducedMotion()) {
      rotate(move.type)
      dx.value = 0
      drain()
      return
    }
    busy = true
    moveToken++
    const n = count.value
    const distance = options.flyDistance?.() ?? DEFAULT_FLY_DISTANCE_PX
    const index = move.type === 'next' ? offset.value : (offset.value - 1 + n) % n
    moving.value = { index, x: (move.type === 'next' ? move.dir : -1) * distance, stage: 'out', type: move.type }
    dx.value = 0
    after(DECK_OUT_MS, () => {
      // The card now takes its new depth: z-order flips here, so it passes behind the deck (next) or in front of it (prev).
      rotate(move.type)
      const token = ++moveToken
      moving.value = { index, x: 0, stage: 'settle', type: move.type }
      // The deck takes the next move now (its card may start while this one still settles); only the marker lingers.
      after(DECK_SETTLE_MS, () => {
        if (token === moveToken) moving.value = null
      })
      finish()
    })
  }

  /** Returns false when the move was not accepted: no deck to move, or the queue is full. */
  function request(move: Move): boolean {
    if (count.value < 2) return false
    if (busy) {
      if (queue.length >= DECK_QUEUE_MAX) return false
      queue.push(move)
      return true
    }
    run(move)
    return true
  }

  /** Front card to the back; `dir` is the side it flies off to. */
  function next(dir: Direction = 1): boolean {
    return request({ type: 'next', dir })
  }
  /** Last card back to the front. */
  function prev(): boolean {
    return request({ type: 'prev', dir: 1 })
  }

  /* --- pointer ----------------------------------------------------------- */
  let pointerId: number | null = null
  let startX = 0
  let moved = false
  /** A press that started while a card was flying: it can still be a tap (queued), never a drag. */
  let tapOnly = false

  function onPointerDown(event: DeckPointer) {
    if (pointerId !== null) return
    if (event.isPrimary === false) return
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen' && (event.button ?? 0) !== 0) return
    pointerId = event.pointerId ?? 0
    startX = event.clientX
    moved = false
    tapOnly = busy
    dragging.value = !busy
  }
  function onPointerMove(event: DeckPointer) {
    if (pointerId === null || (event.pointerId ?? 0) !== pointerId) return
    const delta = event.clientX - startX
    if (Math.abs(delta) > DECK_TAP_SLOP_PX) moved = true
    if (!tapOnly) dx.value = delta
  }
  function onPointerUp(event: DeckPointer) {
    if (pointerId === null || (event.pointerId ?? 0) !== pointerId) return
    pointerId = null
    dragging.value = false
    const delta = tapOnly ? 0 : dx.value
    const wasTapOnly = tapOnly
    tapOnly = false
    if (!wasTapOnly && Math.abs(delta) > DECK_SWIPE_THRESHOLD_PX) {
      // A swipe that is not accepted (1-card deck, full queue) leaves the card at its home position.
      if (!next(delta < 0 ? -1 : 1)) dx.value = 0
      return
    }
    if (!moved) {
      dx.value = 0
      next(1)
      return
    }
    dx.value = 0
  }
  /** `pointercancel` and `lostpointercapture`: the browser took the gesture (vertical page scroll). No tap, no swipe. */
  function onPointerCancel() {
    if (pointerId === null) return
    pointerId = null
    dragging.value = false
    tapOnly = false
    dx.value = 0
  }

  /* --- keyboard ------------------------------------------------------------ */
  /** ← / →, only while the deck itself has focus and without a modifier. Returns true when it acted on the key. */
  function onKeydown(event: DeckKey): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return false
    if (event.target && event.currentTarget && event.target !== event.currentTarget) return false
    // Nothing to move (0 or 1 card): leave the key to the page.
    if (!canMove.value) return false
    event.preventDefault?.()
    if (event.key === 'ArrowRight') next(1)
    else prev()
    return true
  }

  function reset() {
    clearTimers()
    queue = []
    busy = false
    pointerId = null
    tapOnly = false
    offset.value = 0
    dx.value = 0
    moving.value = null
    dragging.value = false
    announceIndex.value = null
    settled = 0
  }

  watch(() => [toValue(options.key) ?? '', count.value] as const, (now, before) => {
    if (now[0] !== before[0] || now[1] !== before[1]) reset()
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      clearTimers()
      queue = []
    })
  }

  return {
    offset, position, count, canMove, dx, dragging, frontX, moving, announceIndex,
    depthOf, next, prev, reset,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeydown,
  }
}
