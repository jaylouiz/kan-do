/**
 * @composable useFocusOverlay
 * @description Show/hide state machine of the Jetzt focus overlay (the "desk lamp", #394).
 * @responsibility
 * - Mouse / pen: a real pointer move (>= 3px), a pointer press or a key press (not a lone modifier) hides the
 *   overlay at once; it returns after MOUSE_IDLE_MS without movement (KEY_IDLE_MS after a key). The window losing
 *   focus or the tab being hidden shows it; regaining focus behaves like a mouse move.
 * - Touch: the first tap outside the Now card, its column and (phone only) the nav pill hides it and is swallowed
 *   (`swallowTap` keeps the overlay in the way for a moment, so the click that follows the tap lands on it, not on a
 *   card). Any later tap restarts the TOUCH_IDLE_MS timer; the overlay returns after it.
 * - `enabled` (setting on, a card in Jetzt, no drag, no sheet, no open layer, on the Jetzt page) gates everything:
 *   off means hidden and no timers; on again means it warms up after RETURN_DELAY_MS.
 * - All time is `setTimeout`, so tests drive it with fake timers.
 */
import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

export const MOUSE_IDLE_MS = 2500
export const KEY_IDLE_MS = 4000
export const TOUCH_IDLE_MS = 8000
export const RETURN_DELAY_MS = 900
export const SWALLOW_MS = 450
export const MOVE_THRESHOLD_PX = 3
/** How long Board.vue keeps the overlay mounted to fade it out after the card left Jetzt (the CSS fade is 600 ms) */
export const FOCUS_LEAVE_MS = 800

/**
 * Parts that stay lit above the overlay: a tap there is a plain interaction and keeps the focus. Keep in step with the
 * lifted parts in assets/css/board-focus-overlay.css: the Jetzt column (`#column-progress`) and the app bar / nav pill
 * (`[data-app-nav]`, #694) at every width. The Erledigt footer sits below the overlay (#503), so a tap there is swallowed
 * like one on any other board chrome.
 */
export const FOCUS_SAFE_SELECTOR = '#column-progress, [data-app-nav]'

export function useFocusOverlay(enabled: Ref<boolean>) {
  const shown = ref(false)
  const pointerKind = ref<'mouse' | 'touch'>('mouse')
  /** True for a moment after a touch hid the overlay, so the tap that did it is not also a click on a card */
  const swallowTap = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let swallowTimer: ReturnType<typeof setTimeout> | null = null
  let lastX = -1
  let lastY = -1

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const showLater = (ms: number) => {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      if (enabled.value) shown.value = true
    }, ms)
  }
  const hide = (returnAfter: number) => {
    if (!enabled.value) return
    shown.value = false
    showLater(returnAfter)
  }

  const isSafe = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return target.closest(FOCUS_SAFE_SELECTOR) !== null
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    pointerKind.value = 'mouse'
    const moved = lastX < 0 || Math.hypot(e.clientX - lastX, e.clientY - lastY) >= MOVE_THRESHOLD_PX
    if (!moved) return
    lastX = e.clientX
    lastY = e.clientY
    hide(MOUSE_IDLE_MS)
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') {
      pointerKind.value = 'mouse'
      hide(MOUSE_IDLE_MS)
      return
    }
    pointerKind.value = 'touch'
    if (!shown.value || isSafe(e.target)) {
      // Plain interaction (or already hidden): it only restarts the return timer
      if (!shown.value && enabled.value) showLater(TOUCH_IDLE_MS)
      return
    }
    swallowTap.value = true
    if (swallowTimer) clearTimeout(swallowTimer)
    swallowTimer = setTimeout(() => {
      swallowTap.value = false
      swallowTimer = null
    }, SWALLOW_MS)
    hide(TOUCH_IDLE_MS)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return
    hide(KEY_IDLE_MS)
  }

  const onBlur = () => {
    clearTimer()
    if (enabled.value) shown.value = true
  }
  const onFocus = () => hide(MOUSE_IDLE_MS)
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onBlur()
  }

  watch(
    enabled,
    (on, was) => {
      if (!on) {
        clearTimer()
        shown.value = false
        return
      }
      // First appearance on load shows at once; coming back (drag ended, sheet closed, page returned) after a beat
      if (was === undefined) shown.value = document.hasFocus()
      else showLater(RETURN_DELAY_MS)
    },
    { immediate: true },
  )

  onMounted(() => {
    pointerKind.value = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse'
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    window.addEventListener('keydown', onKeyDown, { passive: true })
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    if (enabled.value && document.hasFocus()) shown.value = true
  })
  onBeforeUnmount(() => {
    clearTimer()
    if (swallowTimer) clearTimeout(swallowTimer)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { shown, pointerKind, swallowTap }
}
