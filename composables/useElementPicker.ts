/**
 * @composable useElementPicker
 * @description Element picker for the feedback dialog (#227): while active, every pointer and key
 * event is intercepted in the capture phase so a pick never clicks, drags or navigates, and the
 * page (dnd-kit included) sees none of it. The candidate follows the pointer or the keyboard
 * (Tab/Shift+Tab walk focusable elements, ArrowUp the parent, ArrowDown the first child, Enter picks,
 * Escape cancels). `ElementPickerBar` renders the hint bar, the outline and the live region.
 * @responsibility Capture-phase listeners and their cleanup; candidate state; nothing is stored.
 */
import { computed, readonly, shallowRef } from 'vue'
import { describeElement, elementLabel } from '~/lib/feedback/describeElement'
import type { ElementInfo } from '~/lib/feedback/types'

/** Marks the picker's own UI: its events are neither swallowed nor offered as candidates. */
export const PICKER_UI_ATTR = 'data-feedback-picker'

/** Events the page must not see while picking. `click` is handled separately: it is the pick. */
const SWALLOWED_POINTER_EVENTS = [
  'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick',
  'touchstart', 'touchend', 'dragstart', 'selectstart',
] as const

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"]'

const active = shallowRef(false)
const candidate = shallowRef<Element | null>(null)
let resolvePick: ((info: ElementInfo | null) => void) | null = null
let stopListening: (() => void) | null = null

const isPickerUi = (el: Element | null) => !!el?.closest(`[${PICKER_UI_ATTR}]`)

function visibleFocusables(): Element[] {
  return [...document.querySelectorAll(FOCUSABLE)].filter((el) => {
    if (isPickerUi(el) || el.closest('[inert], [aria-hidden="true"]')) return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
}

function finish(info: ElementInfo | null) {
  stopListening?.()
  stopListening = null
  active.value = false
  candidate.value = null
  const resolve = resolvePick
  resolvePick = null
  resolve?.(info)
}

function pickCurrent() {
  const el = candidate.value
  finish(el ? describeElement(el) : null)
}

function stop(event: Event) {
  event.preventDefault()
  event.stopImmediatePropagation()
}

function onKeydown(event: KeyboardEvent) {
  // The picker's own buttons (cancel) keep their native keys.
  if (isPickerUi(event.target as Element | null) && event.key !== 'Escape') return
  stop(event)
  const current = candidate.value
  switch (event.key) {
    case 'Escape':
      finish(null)
      break
    case 'Enter':
      // Nothing outlined yet: stay in the picker rather than ending it with a null pick.
      if (current) pickCurrent()
      break
    case 'ArrowUp':
      if (current?.parentElement && current.parentElement !== document.documentElement) candidate.value = current.parentElement
      break
    case 'ArrowDown': {
      const child = current ? [...current.children].find(c => !isPickerUi(c)) : undefined
      if (child) candidate.value = child
      break
    }
    case 'Tab': {
      const list = visibleFocusables()
      if (!list.length) break
      const at = current ? list.findIndex(el => el === current || el.contains(current)) : -1
      const next = event.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : (at + 1) % list.length
      candidate.value = list[next] ?? null
      break
    }
  }
}

function onPointerMove(event: PointerEvent) {
  const el = document.elementFromPoint(event.clientX, event.clientY)
  if (el && !isPickerUi(el) && el !== document.documentElement) candidate.value = el
}

function onClick(event: MouseEvent) {
  if (isPickerUi(event.target as Element | null)) return
  stop(event)
  const el = document.elementFromPoint(event.clientX, event.clientY)
  if (el && !isPickerUi(el)) candidate.value = el
  pickCurrent()
}

function onSwallow(event: Event) {
  if (isPickerUi(event.target as Element | null)) return
  stop(event)
}

export function useElementPicker() {
  /**
   * Starts picking. Resolves with the picked element's description, or `null` when cancelled.
   * Only one pick runs at a time; a second call cancels the first.
   */
  function start(): Promise<ElementInfo | null> {
    if (typeof document === 'undefined') return Promise.resolve(null)
    finish(null)
    active.value = true
    // Keyboard start: the focused element, but only while it is on screen (the dialog just left).
    const initial = document.activeElement
    const onScreen = !!initial && initial.isConnected && initial.getClientRects().length > 0
    candidate.value = initial && onScreen && initial !== document.body && !isPickerUi(initial) ? initial : null
    const options = { capture: true } as const
    document.addEventListener('keydown', onKeydown, options)
    document.addEventListener('keyup', stop, options)
    document.addEventListener('pointermove', onPointerMove, options)
    document.addEventListener('click', onClick, options)
    for (const name of SWALLOWED_POINTER_EVENTS) document.addEventListener(name, onSwallow, options)
    stopListening = () => {
      document.removeEventListener('keydown', onKeydown, options)
      document.removeEventListener('keyup', stop, options)
      document.removeEventListener('pointermove', onPointerMove, options)
      document.removeEventListener('click', onClick, options)
      for (const name of SWALLOWED_POINTER_EVENTS) document.removeEventListener(name, onSwallow, options)
    }
    return new Promise((resolve) => { resolvePick = resolve })
  }

  function cancel() {
    finish(null)
  }

  const label = computed(() => (candidate.value ? elementLabel(candidate.value) : ''))

  // `candidate` is returned through a computed: `readonly()` would proxy the DOM element.
  return { active: readonly(active), candidate: computed(() => candidate.value), label, start, cancel }
}
