/**
 * @module scrollbar-gutter
 * @description Marks `<html class="kando-classic-scrollbar">` while the browser draws classic scroll bars that take
 * width from the layout (#669), before the first render (the app is a SPA, `ssr: false`). CSS reserves the bar's space
 * on that class only (`scrollbar-gutter: stable`, `assets/css/utilities.css`), so a bar that appears or goes never
 * shifts the layout. Overlay bars (macOS trackpad, touch, hidden-scrollbar test browsers) take no width and get no
 * gutter: Chromium reserves one even where it hides the bars, so the property alone would shift every layout there.
 * The width is measured on a hidden scrolling box that stays in the page: a ResizeObserver on it fires when the bar
 * style changes (macOS switches between overlay and classic when a mouse is attached or the setting changes), with no
 * polling and no forced layout per window event.
 */
const CLASS_NAME = 'kando-classic-scrollbar'

export default defineNuxtPlugin(() => {
  const root = document.documentElement
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.inert = true
  probe.style.cssText = 'position:fixed;top:-9999px;width:100px;height:100px;overflow:scroll;visibility:hidden;pointer-events:none'
  root.appendChild(probe)

  // offsetWidth - clientWidth: what the box loses to its bar (0 for overlay and hidden bars)
  const update = () => root.classList.toggle(CLASS_NAME, probe.offsetWidth - probe.clientWidth > 0)
  update()
  new ResizeObserver(update).observe(probe)
})
