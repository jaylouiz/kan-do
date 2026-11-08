/** Number of phone column pages (Offen, Jetzt + Wartet, Erledigt). */
export const PAGE_DOT_COUNT = 3

/**
 * Fractional page position of the board: the settled page minus the live finger offset in
 * viewport widths (a swipe left, offset < 0, moves towards the next page), clamped to the pages.
 */
export function pageProgress(activeTab: number, offsetPx: number, viewportWidth: number): number {
  const raw = viewportWidth > 0 ? activeTab - offsetPx / viewportWidth : activeTab
  return Math.min(Math.max(raw, 0), PAGE_DOT_COUNT - 1)
}

/** How much dot `index` is the active one (1 = fully, 0 = not at all) at a fractional `progress`. */
export function dotWeight(index: number, progress: number): number {
  return Math.max(0, 1 - Math.abs(progress - index))
}
