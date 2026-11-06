/**
 * @module timeboxChipMemory
 * @description Whether a task's progress chip (#388) was last rendered as the Jetzt bar, keyed by task id.
 * A cross-column move mounts a fresh `TaskCard`, so the chip cannot remember its own state: the new
 * instance reads the last state here and flips from it, which is what lets the grow / shrink play across
 * the mount. Module memory only: not persisted, not Pinia state, never reads storage.
 */

/** Cards that mount within this long of the first chip belong to the page load: they start as they are, no animation */
export const CHIP_BOOT_WINDOW_MS = 1500

const lastInJetzt = new Map<string, boolean>()
let bootStartedAt: number | null = null

/** The state the chip of this task was last rendered in; `undefined` when the page never rendered it */
export function wasInJetzt(id: string): boolean | undefined {
  return lastInJetzt.get(id)
}

export function rememberInJetzt(id: string, now: boolean): void {
  lastInJetzt.set(id, now)
}

/**
 * Whether a freshly mounted chip starts as the Jetzt bar. A known task continues from its last state;
 * an unknown one starts expanded only while the page is loading (a reload with a card in Jetzt shows the bar
 * at once), a task created later (add-and-start) grows like any card that lands in Jetzt.
 */
export function startsExpanded(id: string, isNow: boolean, clock: () => number = Date.now): boolean {
  const last = lastInJetzt.get(id)
  if (last !== undefined) return last
  const at = clock()
  bootStartedAt ??= at
  return isNow && at - bootStartedAt <= CHIP_BOOT_WINDOW_MS
}

/** Test seam: forget everything, including the page-load window */
export function resetTimeboxChipMemory(): void {
  lastInJetzt.clear()
  bootStartedAt = null
}
