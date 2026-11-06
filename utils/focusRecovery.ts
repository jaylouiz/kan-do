/**
 * @module focusRecovery
 * @description Moves focus after the focused element left the DOM (acknowledged/restored note),
 * so focus never falls back to <body>. Waits a few frames for the preferred element (it may still
 * be mid-Transition or not mounted yet), then falls back to a non-interactive landmark, which is
 * made temporarily focusable (tabindex removed again on blur).
 */

const MAX_FRAMES = 12

const focusable = (el: HTMLElement | null): el is HTMLElement => !!el && el.isConnected

/** Focuses `fallback` (adding a temporary tabindex) and cleans up on blur. */
function focusFallback(el: HTMLElement) {
  const hadTabindex = el.hasAttribute('tabindex')
  if (!hadTabindex) {
    el.setAttribute('tabindex', '-1')
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true })
  }
  el.focus({ preventScroll: true })
  // Focus did not stick (e.g. hidden): do not leave the temporary tabindex behind
  if (!hadTabindex && document.activeElement !== el) el.removeAttribute('tabindex')
}

/**
 * Focuses the first of `preferred` that resolves within a few animation frames; otherwise the
 * first resolvable `fallbacks` element (list, then heading).
 */
export function focusWhenReady(
  preferred: () => HTMLElement | null,
  fallbacks: Array<() => HTMLElement | null>,
): void {
  if (typeof window === 'undefined') return
  let frames = 0
  const attempt = () => {
    const el = preferred()
    if (focusable(el)) {
      el.focus({ preventScroll: true })
      if (document.activeElement === el) return
    }
    if (++frames < MAX_FRAMES) {
      requestAnimationFrame(attempt)
      return
    }
    for (const get of fallbacks) {
      const fb = get()
      if (focusable(fb)) {
        focusFallback(fb)
        return
      }
    }
  }
  attempt()
}

/** Focuses the first resolvable element right away (no waiting), temporary tabindex if needed. */
export function focusFirstAvailable(candidates: Array<() => HTMLElement | null>): void {
  for (const get of candidates) {
    const el = get()
    if (focusable(el)) {
      focusFallback(el)
      return
    }
  }
}

/**
 * The element that takes focus for a card just added (#125, #649): the card's wrapper (dnd-kit makes it focusable
 * only once registered, which can be after the add flow ends, so the same tabindex is set when it is missing), or,
 * for a card that joined a collapsed stack (#147), the stack's control (`data-task-id` names only the top card).
 */
export function findSavedCardElement(taskId: string): HTMLElement | null {
  const wrapper = document.querySelector<HTMLElement>(`.task-wrapper[data-task-id="${CSS.escape(taskId)}"]`)
  if (wrapper) {
    if (!wrapper.hasAttribute('tabindex')) wrapper.setAttribute('tabindex', '0')
    return wrapper
  }
  for (const stack of document.querySelectorAll<HTMLElement>('.task-stack[data-stack-task-ids]')) {
    try {
      const ids: unknown = JSON.parse(stack.dataset.stackTaskIds ?? '[]')
      if (Array.isArray(ids) && ids.includes(taskId)) return stack.querySelector<HTMLElement>('.task-stack__control')
    } catch {
      // a malformed attribute is not ours: keep looking
    }
  }
  return null
}
