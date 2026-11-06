/**
 * @module contrast
 * @description E2E helper that measures the WCAG contrast of a rendered text label (#632). It reads what is painted,
 * not what the CSS says: the glyphs are hidden, the box behind them is screenshotted and every pixel of an even sample grid is
 * compared with the label colour, so it holds through `backdrop-filter`, gradients, washes and card shadows where
 * a DOM walk over `background-color` is blind (#615). The pure math (`relativeLuminance`, `contrastRatio`,
 * `compositeOver`) is exported for unit tests (`tests/helpers/contrast.test.ts`).
 *
 * Chromium only for blurred surfaces: Playwright WebKit never paints `backdrop-filter`.
 * @usage `await expectContrast(page, appNav(page).getByTestId('app-nav-place-board'))` (4.5 by default, 3 for large text)
 * @responsibility Contrast of one text element at its resting state. Axe (`a11y.spec.ts`) stays the page-wide scan.
 */

import { expect, type Locator, type Page } from '@playwright/test'
import { settleAnimations } from './settle'

/** sRGB channels 0-255. */
export type Rgb = readonly [number, number, number]
/** A colour with alpha 0-1. */
export interface Rgba { r: number, g: number, b: number, a: number }

export interface ContrastResult {
  /** Lowest ratio over all sampled background pixels (worst case). */
  ratio: number
  /** The label colour as painted (alpha kept; the ratio composites it over each pixel). */
  foreground: Rgba
  /** The sampled pixel that gives `ratio`. */
  worstBackground: Rgb
}

export interface MeasureOptions {
  /** Pixels sampled per axis (default 20, so at most 400 per call). */
  samples?: number
  /** Share of each side left out of the sampling (default 0.15), so rounded corners and borders of a pill-shaped label do not count as "behind the text". */
  inset?: number
}

const channel = (v: number): number => {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio (1-21) of two opaque colours, order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Source-over: `fg` with its alpha painted onto the opaque `bg`. */
export function compositeOver(fg: Rgba, bg: Rgb): Rgb {
  return [fg.r * fg.a + bg[0] * (1 - fg.a), fg.g * fg.a + bg[1] * (1 - fg.a), fg.b * fg.a + bg[2] * (1 - fg.a)]
}

/** Worst (lowest) ratio of `fg` over a set of background pixels. */
export function worstContrast(fg: Rgba, backgrounds: readonly Rgb[]): { ratio: number, background: Rgb } {
  let worst: { ratio: number, background: Rgb } | null = null
  for (const background of backgrounds) {
    const ratio = contrastRatio(compositeOver(fg, background), background)
    if (!worst || ratio < worst.ratio) worst = { ratio, background }
  }
  if (!worst) throw new Error('no background pixels to measure against')
  return worst
}

const MARK = 'data-contrast-target'

/**
 * Cuts every transition on the page (the 150 ms colour transition of #615, and the chip or veil behind the label that
 * may still be fading), hides the glyphs of the element and all its descendants (text, svg fill, shadows), and returns the
 * label's resting colour. The colour is converted through a canvas, because computed values come back as
 * `color(srgb …)`, `color-mix()` or `oklch()` as well as `rgb()`; alpha is recovered by drawing it on black and on white.
 * Everything is one `<style>` plus one attribute, both removed by `restoreGlyphs`.
 */
async function hideGlyphs(target: Locator): Promise<Rgba> {
  return target.evaluate((el, mark) => {
    const style = document.createElement('style')
    style.setAttribute(mark, 'hide')
    style.textContent = `[${mark}], [${mark}] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; fill: transparent !important; stroke: transparent !important }
[${mark}]::before, [${mark}]::after, [${mark}] *::before, [${mark}] *::after { color: transparent !important; text-shadow: none !important }`
    // Transitions are cut first and the colour read before the hiding rule goes in
    const cut = document.createElement('style')
    cut.setAttribute(mark, 'cut')
    cut.textContent = '*, *::before, *::after { transition: none !important }'
    document.head.append(cut)
    void (el as HTMLElement).offsetWidth // reflow: in-flight transitions jump to their end value
    const css = getComputedStyle(el).color
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const paint = (under: string): number[] => {
      ctx.fillStyle = '#123456'
      ctx.fillStyle = css
      if (ctx.fillStyle === '#123456' && css !== 'rgb(18, 52, 86)') throw new Error(`contrast helper: cannot parse the computed colour "${css}"`)
      ctx.fillStyle = under
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      return Array.from(ctx.getImageData(0, 0, 1, 1).data)
    }
    const [br = 0, bg = 0, bb = 0] = paint('#000')
    const [wr = 0, wg = 0, wb = 0] = paint('#fff')
    const alpha = Math.min(1, Math.max(0, 1 - (wr - br + (wg - bg) + (wb - bb)) / (3 * 255)))
    const unpremultiply = (v: number): number => (alpha === 0 ? 0 : v / alpha)
    el.setAttribute(mark, '')
    document.head.append(style)
    return { r: unpremultiply(br), g: unpremultiply(bg), b: unpremultiply(bb), a: alpha }
  }, MARK)
}

async function restoreGlyphs(target: Locator): Promise<void> {
  await target.evaluate((el, mark) => {
    // Glyphs first, with transitions still cut, so the colour returns at once instead of fading back in
    el.removeAttribute(mark)
    document.querySelectorAll(`style[${mark}="hide"]`).forEach(node => node.remove())
    void document.body.offsetWidth
    document.querySelectorAll(`style[${mark}="cut"]`).forEach(node => node.remove())
  }, MARK)
}

/** Decodes a PNG in the page and samples an even grid of opaque pixels. */
async function samplePixels(page: Page, png: Buffer, samples: number, inset: number): Promise<Rgb[]> {
  const pixels = await page.evaluate(async ({ base64, n, edge }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0)
    const out: number[][] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = Math.min(image.width - 1, Math.floor(image.width * (edge + ((i + 0.5) / n) * (1 - 2 * edge))))
        const y = Math.min(image.height - 1, Math.floor(image.height * (edge + ((j + 0.5) / n) * (1 - 2 * edge))))
        const [r = 0, g = 0, b = 0] = ctx.getImageData(x, y, 1, 1).data
        out.push([r, g, b])
      }
    }
    return out
  }, { base64: png.toString('base64'), n: samples, edge: inset })
  return pixels.map(([r = 0, g = 0, b = 0]) => [r, g, b] as const)
}

/**
 * Worst-case contrast of the target's text colour over what is painted behind it. Point `target` at the element
 * that holds the text; the outer `inset` share of its box is skipped (pill corners, borders), the rest is sampled on
 * an even grid, so a one-pixel feature between grid points can be missed. The temporary style is removed even when the
 * measure throws. Waits for running animations first; for a surface that fades in, assert it is shown and at rest first.
 */
export async function measureContrast(page: Page, target: Locator, options: MeasureOptions = {}): Promise<ContrastResult> {
  const inset = options.inset ?? 0.15
  if (!(inset >= 0 && inset < 0.5)) throw new Error(`contrast helper: inset must be in [0, 0.5), got ${inset}`)
  await settleAnimations(page)
  let foreground: Rgba
  try {
    foreground = await hideGlyphs(target)
    const png = await target.screenshot({ animations: 'disabled', caret: 'hide' })
    const worst = worstContrast(foreground, await samplePixels(page, png, options.samples ?? 20, inset))
    return { ratio: worst.ratio, foreground, worstBackground: worst.background }
  }
  finally {
    await restoreGlyphs(target)
  }
}

/** Asserts the worst-case contrast of the target's label is at least `min` (WCAG AA: 4.5, large text 3). */
export async function expectContrast(page: Page, target: Locator, min = 4.5, options: MeasureOptions = {}): Promise<ContrastResult> {
  const result = await measureContrast(page, target, options)
  const { foreground: f, worstBackground: b } = result
  expect(
    result.ratio,
    `contrast ${result.ratio.toFixed(2)}:1 < ${min}:1 (label rgba(${[f.r, f.g, f.b].map(Math.round).join(', ')}, ${f.a.toFixed(2)}) over rgb(${b.map(Math.round).join(', ')}))`,
  ).toBeGreaterThanOrEqual(min)
  return result
}
