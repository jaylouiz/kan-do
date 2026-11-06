/**
 * @module neighbourCard
 * @description The card that should take focus when the card `id` leaves the board (a delete, #579, #457):
 * the next sibling card in the same list, else the previous one. Gaps and stack headers are not cards.
 */

/** Escapes an id for a CSS attribute selector (jsdom may lack `CSS.escape`). */
const cssEscape = (id: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'))

/** The board card (`.task-wrapper`) of task `id`, or null. */
export function findCardElement(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>(`.task-wrapper[data-task-id="${cssEscape(id)}"]`)
}

/** Task id of the next (else previous) sibling card of card `id`, or null. Call before the card is removed. */
export function neighbourCardId(id: string): string | null {
  const el = findCardElement(id)
  if (!el) return null
  const isCard = (n: Element) => n.matches('.task-wrapper[data-task-id]')
  // A gap of an earlier delete (still inside its undo window) stands between neighbours: step over it
  const find = (step: (n: Element) => Element | null): string | null => {
    for (let n = step(el); n; n = step(n)) {
      if (isCard(n)) return (n as HTMLElement).dataset.taskId ?? null
      if (!n.matches('.task-gap')) return null
    }
    return null
  }
  return find(n => n.nextElementSibling) ?? find(n => n.previousElementSibling)
}
