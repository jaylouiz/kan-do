/**
 * @composable useOpenLayer
 * @description True while a layer opened on top of the board is open: a modal (dialog, drawer / slideover,
 * command palette) or a popper (popover, dropdown or context menu; not a tooltip). One shared signal instead of a flag per dialog (#394).
 * @responsibility
 * - Reka UI portals every layer to `<body>`; a modal also sets `pointer-events: none` on the body while it is open
 *   (its scroll lock), a popper mounts a `[data-reka-popper-content-wrapper]` child (a tooltip's holds a `role="tooltip"`). Both are read here.
 * - Watches `<body>` children and the body's `style` only (no subtree), so a ticking timer never wakes it.
 * - Client only; false during SSR / prerender.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

/** A tooltip is a hover hint, not a layer: it must not keep the board dimmed (focus returns to a trigger after a dialog closes) */
const POPPER_SELECTOR = '[data-reka-popper-content-wrapper]:not(:has([role="tooltip"]))'

export function useOpenLayer() {
  const layerOpen = ref(false)
  let observer: MutationObserver | null = null

  const read = () => {
    layerOpen.value = document.body.style.pointerEvents === 'none' || document.querySelector(POPPER_SELECTOR) !== null
  }

  onMounted(() => {
    read()
    observer = new MutationObserver(read)
    observer.observe(document.body, { childList: true, attributes: true, attributeFilter: ['style'] })
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return { layerOpen }
}
