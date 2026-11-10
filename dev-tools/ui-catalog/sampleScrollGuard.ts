/**
 * @module sampleScrollGuard
 * @description Keeps the samples and tile previews of `/ui` from scrolling the page (kd#152). Some app components bring
 * themselves into view when they mount (`TaskDraftCard`, the add slot's draft: `scrollIntoView({ block: 'nearest',
 * behavior: 'smooth' })`), which is right on the board and wrong in a catalog: the overview slid about 2860 px down on
 * every load, to wherever those tiles happened to be. Besides moving the page under the reader, it left the sticky header
 * over whatever link stood there, so axe's target-size result depended on which tiles exist, on font metrics and on
 * whether the scan ran before or after the slide.
 *
 * While the page is mounted, `Element.prototype.scrollIntoView` does nothing for an element inside a sample
 * (`data-kd-sample`, `data-kd-preview`, `data-kd-launch`, the frame of a component's page); everything else scrolls as usual. CSS cannot
 * stop it (`scrollIntoView` walks every scrollable ancestor up to the viewport), and the components keep their behaviour
 * for the app. Dev tool only: `/ui` is removed from every shipped build.
 */

const SAMPLE = '[data-kd-sample], [data-kd-preview], [data-kd-launch], [data-kd-sample-frame]'

/** Installs the guard and returns the function that removes it. Call it before the samples mount (page setup, client only). */
export function installSampleScrollGuard(): () => void {
  if (typeof Element === 'undefined') return () => {}
  const original = Element.prototype.scrollIntoView
  if (typeof original !== 'function') return () => {}
  const guarded = function (this: Element, ...args: Parameters<Element['scrollIntoView']>) {
    if (this.closest(SAMPLE)) return
    original.apply(this, args)
  }
  Element.prototype.scrollIntoView = guarded
  return () => {
    // Only take back our own patch: another one installed later stays
    if (Element.prototype.scrollIntoView === guarded) Element.prototype.scrollIntoView = original
  }
}
