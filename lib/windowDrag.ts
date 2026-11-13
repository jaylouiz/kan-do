/**
 * @module windowDrag
 * @description Window dragging under full-screen layers (#614). The desktop window has no title bar; the `.titlebar`
 * strip in `app.vue` is the drag area, but every full-screen layer covers it, so with a task sheet, dialog or the
 * new-day recap open the window could not be moved, where a native title bar always could. A press on the layer's top
 * row, the height of the bar row, starts the drag instead (`plugins/desktop-shell.client.ts`).
 * Two kinds of layer count: Nuxt UI overlay scrims (`data-slot="overlay"`, the press must hit the scrim itself, never
 * the dialog beside it) and any custom layer that carries `data-window-drag-layer` (a press on its empty area counts,
 * a press on a button, link or field inside it does not). A new full-screen layer above the strip sets the marker.
 * The press never reaches the dialog's outside-click handling, so dragging the window does not dismiss the dialog.
 * Double click to zoom stays on the strip; on a layer it does nothing.
 */

/** Nuxt UI marks every overlay scrim with `data-slot="overlay"`. */
const SCRIM_SELECTOR = '[data-slot="overlay"]'
/** Marker for a custom full-screen layer (today the new-day recap stage, which since #262 runs behind the bar row) that should hand its bar row to the window drag. */
const LAYER_SELECTOR = '[data-window-drag-layer]'
const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, summary, label, [role="button"], [contenteditable]'

interface PressLike {
  button: number
  clientY: number
  target: EventTarget | null
}

/** True for a left press on a full-screen layer's empty area, inside the top `barHeight` px (the bar row). */
export function isLayerDragStart(press: PressLike, barHeight: number): boolean {
  if (press.button !== 0) return false
  if (press.clientY >= barHeight) return false
  const { target } = press
  if (!(target instanceof Element)) return false
  if (target.matches(SCRIM_SELECTOR)) return true
  return target.closest(LAYER_SELECTOR) !== null && target.closest(INTERACTIVE_SELECTOR) === null
}
