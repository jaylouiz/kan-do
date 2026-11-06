import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'

/** Half the 2.75rem edge arrow, in rem: the arrow is centred on the header row. */
const HALF_ARROW_REM = 1.375

/**
 * Vertical offset (px) that centres the drag edge arrows on the active column page's h2 (#231).
 * `null` means "not measured": CSS falls back to the unscrolled position and always clamps
 * at safe-area-top + 0.5rem, so a scrolled-away header never pulls the arrows into the thumb zone.
 * The passive, rAF-throttled scroll listener exists only while `isActive` is true.
 */
export function useEdgeIndicatorTop(options: {
  isActive: Ref<boolean>
  activeTab: Ref<number>
  getPage: (tab: number) => HTMLElement | null
}) {
  const top = ref<number | null>(null)
  let page: HTMLElement | null = null
  let frame = 0

  function measure() {
    frame = 0
    const header = page?.querySelector('h2')
    if (!header) {
      top.value = null
      return
    }
    const rect = header.getBoundingClientRect()
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    top.value = rect.top + rect.height / 2 - HALF_ARROW_REM * rem
  }

  function onScroll() {
    if (frame === 0) frame = requestAnimationFrame(measure)
  }

  function detach() {
    page?.removeEventListener('scroll', onScroll)
    page = null
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }

  function attach() {
    detach()
    page = options.getPage(options.activeTab.value)
    page?.addEventListener('scroll', onScroll, { passive: true })
    measure()
  }

  watch([options.isActive, options.activeTab], ([active]) => {
    if (!import.meta.client) return
    if (active) {
      attach()
    } else {
      detach()
      top.value = null
    }
  }, { flush: 'post' })

  if (getCurrentScope()) onScopeDispose(detach)

  return { top }
}
