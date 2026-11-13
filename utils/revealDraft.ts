/**
 * @module revealDraft
 * @description Brings a draft card into view when it mounts (#248). A draft stands at the start of its list, so on a
 * phone the page goes back to the top: the column title and the header add button stay with it (a `block: 'start'`
 * scroll, written for a draft at the end of a long list, pushed both out of view). Elsewhere `nearest` scrolls only when
 * the card is not visible. After a save on a phone the saved card is brought clear of the toast that stands over the
 * lower part of the page (#665): the card lands at its sort place, which can be where the toast appears.
 */

/** The closest ancestor that scrolls vertically (the Offen / Jetzt page on a phone) */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
  }
  return null
}

/** The closest ancestor that scrolls by its overflow, whether or not its content overflows now (the Offen page can be full to the brim) */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return parent
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

/** One toast row (title and Details, #665) and the air kept between it and the card */
const TOAST_ROW = 76
const TOAST_GAP = 8

/** How far the page scrolls so a card ending at `cardBottom` ends above `limit`, never pushing its top above `floor` */
export function scrollDeltaClearOfToast(cardBottom: number, limit: number, cardTop: number, floor: number): number {
  return Math.max(0, Math.min(cardBottom - limit, cardTop - floor))
}

/** How long the page keeps the room made for the toast: its 5 s, a little over */
const TOAST_ROOM_MS = 6000
const roomTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

/**
 * Phone only: a saved card under the toast scrolls up just far enough to stand clear of it; anywhere else nothing
 * moves. A page whose cards fill the screen has nothing to scroll: it gets the missing room as bottom padding while
 * the toast stands, then gives it back (the toast covers that strip, nobody sees the page grow).
 */
export function revealSavedCard(el: HTMLElement | null | undefined, { phone, reducedMotion }: { phone: boolean, reducedMotion: boolean }) {
  if (!el || !phone) return
  const scroller = scrollParentOf(el)
  if (!scroller) return
  const toastBottom = parseFloat(getComputedStyle(document.querySelector('.kando-toaster') ?? document.body).bottom)
  const limit = window.innerHeight - (Number.isFinite(toastBottom) ? toastBottom : 0) - TOAST_ROW - TOAST_GAP
  const card = el.getBoundingClientRect()
  const delta = scrollDeltaClearOfToast(card.bottom, limit, card.top, scroller.getBoundingClientRect().top)
  if (delta <= 0) return
  const missing = delta - (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop)
  if (missing > 0) {
    const padding = parseFloat(getComputedStyle(scroller).paddingBottom) || 0
    // The page's list is its flexible child: it shrinks to fit rather than overflow, so the padding alone gives no room
    const children = Array.from(scroller.children) as HTMLElement[]
    for (const child of children) child.style.flexShrink = '0'
    scroller.style.paddingBottom = `${padding + missing}px`
    clearTimeout(roomTimers.get(scroller))
    roomTimers.set(scroller, setTimeout(() => {
      scroller.style.removeProperty('padding-bottom')
      for (const child of children) child.style.removeProperty('flex-shrink')
    }, TOAST_ROOM_MS))
  }
  scroller.scrollBy?.({ top: delta, behavior: reducedMotion ? 'auto' : 'smooth' })
}
