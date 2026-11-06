import { onBeforeUnmount, watch, type Ref } from 'vue'
import { useBoardDragState } from '~/composables/useBoardDragState'

interface ColumnStackCollapseOptions {
  /** The column's task list: a click is "inside" when it lands on one of its stacks or members */
  listEl: Ref<HTMLElement | null>
  /** Whether the column has an expanded stack; the listeners exist only then */
  hasExpanded: () => boolean
  /** A click outside: collapse every group except `keepKey` (the group that was clicked, if any) */
  onOutsideClick: (keepKey: string | null) => void
  /** Escape: collapse the column's expanded groups and hand focus back */
  onEscape: () => void
}

/** What a click means for a column: `outside` collapses all but `keepKey` (the clicked group) */
interface ClickVerdict { outside: boolean, keepKey: string | null }

/**
 * Outside click and Escape for the expanded stacks of one column (#147): one document listener per
 * column, attached while it has an expanded stack. A click inside the stack's members or header row, or on
 * another stack, never counts as outside.
 *
 * A click is classified once, in the capture listener, while its target is still in the DOM (a
 * click on a collapsed stack removes its target before the bubble listener runs); the bubble
 * listener only acts on that verdict. A target that is removed by its own click outside every list
 * (portaled menu item, toast close, draft cancel) is therefore an outside click, as one that stays.
 *
 * Gestures that end a drag are scoped by event, not by a time window (#154):
 * - The click that ends a drag is the first pointer click after the drag ended that lands where the
 *   pointer was released, until a `pointerdown` (a new gesture) or `keyup` (a keyboard drop has no
 *   click) clears the flag. A click without a pointer behind it (`detail` 0, or somewhere else than
 *   the release point) is a synthetic activation from VoiceOver, TalkBack or voice control and is
 *   never the drag's. The stack's own handler (`BoardColumn.expandStack`) and the document listener
 *   see the same event, so they match it by identity (`isDragClick`) instead of consuming a counter.
 * - The Escape keydown that cancels a keyboard drag is the one that arrived while the drag ran,
 *   remembered in the capture phase on window (before dnd-kit handles it). The next Escape collapses.
 *
 * A click without a pointer on an item of an open overlay (the palette's Enter) is the keyboard choosing a command,
 * not an outside click: the stack stays (#476). A pointer click on it is outside, as before.
 *
 * Escape is read on window (bubble), after overlays and dnd-kit's keyboard drag have handled it on
 * the document, so `defaultPrevented` tells whether someone else already used it.
 *
 * @returns `isDragActive`: a drag is running (also guards the expand click); `isDragClick(event)`:
 *   whether `event` is the click that ended a drag
 */
export function useColumnStackCollapse(options: ColumnStackCollapseOptions) {
  const { dragState } = useBoardDragState()

  // A drag ended and no new gesture started since: a pointer click at the release point belongs to the drag
  let afterDrag = false
  let dragClick: Event | null = null
  // Where the last pointer was released; the click that ends a drag lands there
  let release: { x: number, y: number } | null = null

  // dnd-kit ends the drag on this same pointerup, so the position is known before the click arrives
  function onPointerUpCapture(event: Event) {
    release = event instanceof MouseEvent ? { x: event.clientX, y: event.clientY } : null
  }

  /** Slack for sub-pixel pointer coordinates against the integer click position */
  const RELEASE_TOLERANCE_PX = 2
  function isAtRelease(event: MouseEvent): boolean {
    return release !== null
      && Math.abs(event.clientX - release.x) <= RELEASE_TOLERANCE_PX
      && Math.abs(event.clientY - release.y) <= RELEASE_TOLERANCE_PX
  }

  // sync: the drag flag is cleared in onDragEnd, before a following click or key event is handled.
  // Read-only: it never touches the drag.
  watch(
    () => dragState.value.isDragging,
    (dragging) => {
      if (dragging) return
      afterDrag = true
      dragClick = null
    },
    { flush: 'sync' },
  )

  const isDragActive = () => dragState.value.isDragging

  /** Whether `event` is the click that ended a drag; asks of the same event all get the same answer */
  function isDragClick(event: Event): boolean {
    if (dragClick === event) return true
    if (!afterDrag) return false
    // Assistive tech and `element.click()` send a click with no pointer (detail 0, no release point)
    if (!(event instanceof MouseEvent) || event.detail === 0 || !isAtRelease(event)) return false
    afterDrag = false
    dragClick = event
    return true
  }

  function endDragGesture() {
    afterDrag = false
    dragClick = null
  }

  /**
   * A click without a pointer (`detail` 0) on an item of an open overlay is the keyboard choosing a command
   * (Enter in the palette makes its list dispatch a click on the item, #476): the user never left the board, so
   * it does not collapse. A pointer click on the same item is still outside, like a click into the palette's
   * search field (decision in #476).
   */
  function isOverlayActivation(event: MouseEvent, target: Element): boolean {
    return event.detail === 0 && target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !== null
  }

  /**
   * Classifies a click by its target, which must still be in the DOM. A collapsed stack's own click
   * expands it, so it is never an outside click; a member or header row keeps its group; anything
   * else, in this list or not, is outside.
   */
  function classify(target: Element): ClickVerdict | null {
    const list = options.listEl.value
    if (!list) return null
    const hit = target.closest<HTMLElement>('[data-from-stack], [data-stack-header], .task-stack')
    if (!hit || !list.contains(hit)) return { outside: true, keepKey: null }
    if (!hit.matches('[data-from-stack], [data-stack-header]')) return { outside: false, keepKey: null }
    return { outside: true, keepKey: hit.dataset.fromStack ?? hit.dataset.stackHeader ?? null }
  }

  // The verdict of the click being dispatched, made before any handler re-rendered the DOM
  let verdict: { event: Event, value: ClickVerdict | null } | null = null

  /**
   * Runs first, while the click's target is still in the DOM, and classifies the click once. A click
   * on a collapsed stack removes its own target (the stack is re-rendered as members) before
   * onClick runs, and a click on a portaled menu item, toast close or draft cancel may remove its
   * target too; a classification made after that could not tell whose element it was.
   */
  function onClickCapture(event: MouseEvent) {
    const target = event.target
    verdict = { event, value: target instanceof Element && !isOverlayActivation(event, target) ? classify(target) : null }
  }

  function onClick(event: MouseEvent) {
    const target = event.target
    if (!options.listEl.value || !(target instanceof Element) || isDragActive() || isDragClick(event)) return
    // The click that expanded a stack reaches the document after Vue re-rendered and attached this
    // listener (microtasks run between listeners): it is not an outside click.
    if (event.timeStamp < attachedAt) return
    // Without a verdict (the capture listener did not see this event) a connected target is
    // classified live; a detached one cannot be placed, so the click is ignored.
    const result = verdict?.event === event ? verdict.value : target.isConnected ? classify(target) : null
    verdict = null
    if (result?.outside) options.onOutsideClick(result.keepKey)
  }

  /** Something else owns Escape right now: a sheet, menu or the palette is open */
  const hasOpenOverlay = () => document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null

  const isEditable = (target: EventTarget | null) =>
    target instanceof Element && target.closest('input, textarea, select, [contenteditable]') !== null

  // The Escape that arrived while a drag ran belongs to the drag (cancel), even though the drag is
  // over by the time onKeydown runs. Window capture runs before dnd-kit's document listener.
  let dragEscape: Event | null = null
  function onKeydownCapture(event: KeyboardEvent) {
    dragEscape = event.key === 'Escape' && isDragActive() ? event : null
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (dragEscape === event || isDragActive() || isEditable(event.target) || hasOpenOverlay()) return
    options.onEscape()
  }

  let attached = false
  let attachedAt = 0
  function attach() {
    if (attached) return
    attached = true
    attachedAt = performance.now()
    document.addEventListener('click', onClickCapture, true)
    document.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeydownCapture, true)
    window.addEventListener('keydown', onKeydown)
  }
  function detach() {
    if (!attached) return
    attached = false
    document.removeEventListener('click', onClickCapture, true)
    document.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKeydownCapture, true)
    window.removeEventListener('keydown', onKeydown)
    dragEscape = null
  }

  // Always on (a collapsed stack needs the drag-click check before anything is expanded): a new
  // pointer gesture or a key release ends the "click after a drag" window; the release is recorded
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', endDragGesture, true)
    document.addEventListener('pointerup', onPointerUpCapture, true)
    document.addEventListener('keyup', endDragGesture, true)
  }

  watch(options.hasExpanded, (active) => (active ? attach() : detach()), { immediate: true })
  onBeforeUnmount(() => {
    detach()
    document.removeEventListener('pointerdown', endDragGesture, true)
    document.removeEventListener('pointerup', onPointerUpCapture, true)
    document.removeEventListener('keyup', endDragGesture, true)
  })

  return { isDragActive, isDragClick }
}
