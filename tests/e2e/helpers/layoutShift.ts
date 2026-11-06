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
import type { Page } from '@playwright/test'

const FORCE_CLASSIC_SCROLLBAR = '::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }'

/** Makes the document scrollbar classic (width-taking) whatever the OS scrollbar setting or attached devices are. Call before `goto`. */
export const forceClassicScrollbar = (page: Page) =>
  page.addInitScript((css) => {
    const style = document.createElement('style')
    style.textContent = css
    document.documentElement.appendChild(style)
  }, FORCE_CLASSIC_SCROLLBAR)

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
