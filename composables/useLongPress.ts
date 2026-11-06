import { ref } from 'vue'

interface LongPressOptions {
  /** Time in ms before long press fires (default: 750) */
  delay?: number
  /** Max pixel movement before cancelling (default: 14) */
  gracePx?: number
}

/**
 * Detects a long press gesture on touch/pen devices.
 * Ignores mouse pointers — desktop right-click goes through native contextmenu.
 *
 * Cancels automatically when the pointer moves more than gracePx pixels,
 * so a drag gesture never accidentally triggers the long press.
 *
 * @example
 * const { handlers, isPressing } = useLongPress(() => openMenu())
 * // <div v-bind="handlers" :class="{ pressing: isPressing }">
 */
export function useLongPress(onTrigger: () => void, options: LongPressOptions = {}) {
  const { delay = 750, gracePx = 14 } = options

  /** True while the user is in the hold window (for visual feedback) */
  const isPressing = ref(false)
  /** Pointer type of the most recent pointerdown event */
  const lastPointerType = ref<string>('mouse')
  /** True after the callback has fired (reset on next pointerdown) */
  const hasFired = ref(false)

  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0

  function start(event: PointerEvent) {
    lastPointerType.value = event.pointerType
    if (event.pointerType === 'mouse') return

    startX = event.clientX
    startY = event.clientY
    isPressing.value = true
    hasFired.value = false

    timer = setTimeout(() => {
      isPressing.value = false
      hasFired.value = true
      onTrigger()
    }, delay)
  }

  function move(event: PointerEvent) {
    if (!isPressing.value) return
    const dx = event.clientX - startX
    const dy = event.clientY - startY
    if (Math.sqrt(dx * dx + dy * dy) > gracePx) {
      cancel()
    }
  }

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    isPressing.value = false
  }

  return {
    /**
     * Spread onto the trigger element: `v-bind="handlers"`
     * Covers pointerdown / pointermove / pointerup / pointercancel / pointerleave.
     */
    handlers: {
      onPointerdown: start,
      onPointermove: move,
      onPointerup: cancel,
      onPointercancel: cancel,
      onPointerleave: cancel,
    },
    isPressing,
    hasFired,
    lastPointerType,
    cancel,
  }
}
