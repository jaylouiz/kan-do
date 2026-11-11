/**
 * @module layoutShift
 * @description E2E helpers for "nothing moves horizontally when the document scroll bar comes or goes" (#580, #669).
 * Headless Chromium hides scroll bars by default, and a macOS host with trackpad-only input makes it use overlay ones
 * (#612), which would pass without any fix: a spec using these helpers launches with
 * `ignoreDefaultArgs: ['--hide-scrollbars']` and calls `forceClassicScrollbar(page)` before `goto`: a styled
 * `::-webkit-scrollbar` is always classic and takes width. It must be there before the app starts, because
 * `plugins/scrollbar-gutter.client.ts` measures the bar at start and whenever it changes (a ResizeObserver on a hidden scrolling box). Never set
 * `scrollbar-width` or `scrollbar-color` in the app: Chrome then ignores that pseudo-element and the forced bar is gone.
 */
import { test, type Page } from '@playwright/test'

const FORCE_CLASSIC_SCROLLBAR = '::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }'

/**
 * Makes the document scrollbar classic (width-taking) whatever the OS scrollbar setting or attached devices are. Call before `goto`.
 * On a macOS host only, skips the test on a desktop viewport when the browser cannot keep the root gutter for that bar
 * (`keepsRootGutter`, #164). Never on Linux: CI always runs these cases, whatever the probe says there.
 */
export async function forceClassicScrollbar(page: Page): Promise<void> {
  const desktop = (page.viewportSize()?.width ?? 1280) > 767
  test.skip(process.platform === 'darwin' && desktop && !(await keepsRootGutter(page)), 'this browser keeps no root scrollbar-gutter for a forced classic bar (macOS overlay scroll bars, #164)')
  await page.addInitScript((css) => {
    const add = () => {
      const style = document.createElement('style')
      style.setAttribute('data-force-classic-scrollbar', '')
      style.textContent = css
      document.documentElement.appendChild(style)
    }
    // An init script can run before the parser has made <html> (seen on macOS, #164): wait for it instead of throwing
    if (document.documentElement) return add()
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return
      observer.disconnect()
      add()
    }).observe(document, { childList: true })
  }, FORCE_CLASSIC_SCROLLBAR)
}

/**
 * Whether this browser keeps the root's `scrollbar-gutter: stable` for a forced classic bar once scrolling is locked, measured
 * on a blank page with no app code. Chromium on a macOS host with overlay scroll bars draws the styled bar but drops the
 * gutter with it (#164): the zero-shift the app builds on that gutter cannot hold there, so a spec skips those cases with
 * this as the reason. Only consulted on macOS: the probe page is not a reliable witness on Linux (it reported no gutter
 * in CI, where the app's own cases pass), so it must not decide there.
 */
export async function keepsRootGutter(page: Page): Promise<boolean> {
  const probe = await page.context().newPage()
  try {
    await probe.setContent(`<!doctype html><html><head><style>${FORCE_CLASSIC_SCROLLBAR} html { scrollbar-gutter: stable; }</style></head><body><div style="height:300vh"></div></body></html>`)
    // Lay the scrolling page out first: the gutter is lost on the change from scrolling to locked, not on a page that starts locked
    const bar = await probe.evaluate(() => window.innerWidth - document.documentElement.clientWidth)
    await probe.evaluate(() => { document.body.style.overflow = 'hidden' })
    return bar > 0 && await probe.evaluate(() => window.innerWidth - document.documentElement.clientWidth) > 0
  } finally {
    await probe.close()
  }
}

export type Box = { x: number, width: number }

/** Tags every element once, so the same elements are compared before and after the page's nodes change. */
export const tagElements = (page: Page) =>
  page.evaluate(() => {
    document.querySelectorAll('body *').forEach((el, i) => el.setAttribute('data-shift-probe', String(i)))
  })

/** Horizontal boxes of every tagged element. */
export const boxes = (page: Page) =>
  page.evaluate(() => {
    const result: Record<string, Box & { label: string }> = {}
    document.querySelectorAll('[data-shift-probe]').forEach((el) => {
      const { x, width } = el.getBoundingClientRect()
      result[el.getAttribute('data-shift-probe')!] = { x, width, label: `${el.tagName}.${String(el.getAttribute('class') ?? '').slice(0, 40)}` }
    })
    return result
  })

/** The elements whose horizontal box differs between two snapshots, by label. */
export const moved = (before: Awaited<ReturnType<typeof boxes>>, after: Awaited<ReturnType<typeof boxes>>) =>
  Object.entries(before)
    .filter(([key, box]) => after[key] && (Math.abs(after[key].x - box.x) > 0.5 || Math.abs(after[key].width - box.width) > 0.5))
    .map(([key, box]) => `${box.label}: x ${box.x} -> ${after[key]!.x}, width ${box.width} -> ${after[key]!.width}`)

/** Width the document's scroll bar takes from the layout viewport (0 for overlay bars and while nothing scrolls). */
export const documentScrollbar = (page: Page) => page.evaluate(() => window.innerWidth - document.documentElement.clientWidth)
