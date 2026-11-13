/**
 * @module revealDraft
 * @description Brings a draft card into view when it mounts (#248). A draft stands at the start of its list, so on a
 * phone the page goes back to the top: the column title and the header add button stay with it (a `block: 'start'`
 * scroll, written for a draft at the end of a long list, pushed both out of view). Elsewhere `nearest` scrolls only when
 * the card is not visible.
 */

/** The closest ancestor that scrolls vertically (the Offen / Jetzt page on a phone) */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}

export function revealDraft(el: HTMLElement | null | undefined, { phone, reducedMotion }: { phone: boolean, reducedMotion: boolean }) {
  if (!el) return
  const behavior = reducedMotion ? 'auto' : 'smooth'
  const scroller = phone ? scrollParent(el) : null
  if (scroller) {
    scroller.scrollTo?.({ top: 0, behavior })
    return
  }
  el.scrollIntoView?.({ block: 'nearest', behavior })
}
