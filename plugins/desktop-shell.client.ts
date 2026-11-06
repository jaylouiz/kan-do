/**
 * @module desktop-shell
 * @description Marks `<html data-shell="desktop">` when the app runs inside Tauri (#614), before the first
 * render. CSS keys desktop-only behaviour on it (no rubber-band overscroll, `assets/css/utilities.css`), so the
 * web build keeps the browser's own scrolling. Same detection as everywhere else: `isTauri()`. Also keeps the
 * window draggable while a full-screen layer covers the drag strip (`lib/windowDrag.ts`).
 */
import { isTauri } from '~/utils/isTauri'
import { isLayerDragStart } from '~/lib/windowDrag'

export default defineNuxtPlugin(() => {
  if (!isTauri()) return
  document.documentElement.dataset.shell = 'desktop'

  const onLayerBar = (event: MouseEvent) =>
    isLayerDragStart(event, document.querySelector('.titlebar')?.getBoundingClientRect().height ?? 0)

  // The dialog dismisses on a pointerdown outside it: swallow that one (capture, before it), drag on the mousedown.
  document.addEventListener('pointerdown', (event) => {
    if (onLayerBar(event)) event.stopImmediatePropagation()
  }, true)
  document.addEventListener('mousedown', (event) => {
    if (event.detail !== 1 || !onLayerBar(event)) return
    event.preventDefault()
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
  })
})
