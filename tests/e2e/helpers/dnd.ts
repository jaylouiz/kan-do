/**
 * @module dnd
 * @description Shared E2E helpers for page.mouse drags on the board (docs/testing/e2e-dnd-patterns.md):
 * pick a card up, hover a target, dwell in an edge zone. They wait on drag state, never on a guessed
 * duration; the one real dwell is the edge hold, routed through `dwell()`.
 */

import { expect, type CDPSession, type Locator, type Page } from '@playwright/test'
import { EDGE_HOLD_DWELL_MS } from './constants'
import { dwell, flushFrames } from './settle'

/** The centre of a visible locator, in viewport coordinates. */
export async function center(target: Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error('Target not visible')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Resolves once the previous drop has settled, so the next press is a fresh gesture: no `.board.dragging`,
 * no `.task--confirming` (the ~800 ms in-card done confirmation after a drop into Erledigt, #124) and no
 * running finite animation (the drop's own motion on cards, stacks and pills, transitions included). A press
 * during any of these silently does not start a drag (#408). The timebox nudge's 8 s countdown is not a drop
 * motion and is left out. Never call it mid-drag: a held drag pauses animations that would then never finish.
 */
export async function dropSettled(page: Page) {
  await expect(page.locator('.board.dragging')).toHaveCount(0)
  await expect(page.locator('.task--confirming')).toHaveCount(0)
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const running = document.getAnimations().filter((animation) => {
      if (animation.effect?.getComputedTiming().iterations === Infinity) return false
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null
      return !target?.closest('.nudge')
    })
    const stuck = new Promise<never>((_, reject) => setTimeout(() => {
      const targets = running.filter(animation => animation.playState !== 'finished').map((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null
        return `${target?.tagName.toLowerCase() ?? 'unknown'}.${target?.className ?? ''} (${animation.playState})`
      })
      reject(new Error(`dropSettled: animations did not finish within 5 s: ${targets.join(', ')}`))
    }, 5000))
    await Promise.race([Promise.all(running.map(animation => animation.finished.catch(() => undefined))), stuck])
  })
}

/**
 * Presses on the card (or stack) and moves past the activation distance; returns once the drag is live.
 * It first waits for the previous drop to settle (`dropSettled`), so a drop followed at once by a pick-up needs no wait.
 * `at` presses that many pixels from the top-left corner instead of the centre (a card whose centre is a control).
 */
export async function pickUp(page: Page, source: Locator, { at }: { at?: { x: number; y: number } } = {}) {
  await dropSettled(page)
  const box = at ? await source.boundingBox() : null
  if (at && !box) throw new Error('Target not visible')
  const { x, y } = box && at ? { x: box.x + at.x, y: box.y + at.y } : await center(source)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 10, y + 10, { steps: 3 })
  await expect(page.locator('.board.dragging')).toHaveCount(1)
  await expect(page.locator('.kando-dnd-preview')).toBeVisible()
  await expect(page.locator('.kando-dnd-dragged')).toHaveCount(1)
}

/**
 * Moves the pointer onto `target` (its centre, or `y` pixels below its top edge) and returns once dnd-kit
 * named the target's column as the hovered one (`.dragover`, also while Jetzt refuses the drop), then
 * until the landing slot (`.kando-dnd-dragged`) holds its place in the DOM and its box for a few frames.
 * `.dragover` alone is not enough: a second hover in the same column already has it while dnd-kit is
 * still reordering. The caller asserts the state it expects after that, with `expect`/`expect.poll`.
 */
export async function hover(page: Page, target: Locator, { fromTop }: { fromTop?: number } = {}) {
  const box = await target.boundingBox()
  if (!box) throw new Error('Drop target not visible')
  await page.mouse.move(box.x + box.width / 2, fromTop === undefined ? box.y + box.height / 2 : box.y + fromTop, { steps: 25 })
  const column = target.locator('xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " column ")]')
  await expect(column).toHaveClass(/\bdragover\b/)
  await landingSlotSettled(page)
}

/** Resolves once the dragged placeholder kept its parent, index and box for 4 frames in a row (max 180 frames). */
async function landingSlotSettled(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const STABLE_FRAMES = 4
    const MAX_FRAMES = 180
    const snapshot = () => {
      const el = document.querySelector('.kando-dnd-dragged')
      if (!el?.parentElement) return 'none'
      const r = el.getBoundingClientRect()
      return [el.parentElement.id, Array.prototype.indexOf.call(el.parentElement.children, el), r.x, r.y, r.width, r.height].join('|')
    }
    let last = snapshot()
    let stable = 0
    let frames = 0
    const tick = () => {
      const now = snapshot()
      stable = now === last ? stable + 1 : 0
      last = now
      frames += 1
      if (stable >= STABLE_FRAMES || frames >= MAX_FRAMES) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

/** The column page the phone board shows (0 Offen, 1 Jetzt + Wartet, 2 Erledigt): `data-mobile-page` on `.board` (#470). */
export async function activeColumnPage(page: Page): Promise<number> {
  return Number(await page.locator('.board').getAttribute('data-mobile-page'))
}

/**
 * Brings column page `index` into view with real touch swipes (the tabs are gone, #470). Each swipe moves one page;
 * the helper waits for the board to report the new page before the next one.
 */
export async function showColumnPage(page: Page, index: 0 | 1 | 2) {
  await expect(page.locator('.board')).toHaveAttribute('data-mobile-page', /^\d$/) // a `?seed=` mode reloads once: wait for the reloaded board; a swipe lost before that is thrown again below
  const touch = finger(await page.context().newCDPSession(page), page)
  let swipes = 0
  while (swipes < 8) {
    const current = await activeColumnPage(page)
    if (current === index) break
    const forward = index > current
    const next = current + (forward ? 1 : -1)
    await touch.start(forward ? 300 : 90, 400)
    await touch.moveTo(forward ? 80 : 310, 410, 12)
    await touch.end()
    swipes++
    // A swipe lost to a page reload (seed modes reload once) or to an unfinished render is thrown again
    await expect.poll(() => activeColumnPage(page), { timeout: 2500 }).toBe(next).catch(() => undefined)
  }
  await expect.poll(() => activeColumnPage(page)).toBe(index)
  // The page slides in over 320 ms: a box measured or a tap aimed before it rests is off by the rest of the slide
  await expect.poll(() => page.locator('.board').evaluate((el, target) => {
    const transform = getComputedStyle(el).transform
    const x = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41
    return Math.round(x + target * window.innerWidth)
  }, index)).toBe(0)
}

/**
 * Dwells in an edge zone of the 390px board until it switches to the neighbouring page, then moves the pointer
 * back to the middle. Returns once the switch happened and dnd-kit re-measured the droppables.
 */
export async function edgeDwell(page: Page, side: 'left' | 'right') {
  const from = await activeColumnPage(page)
  const to = from + (side === 'left' ? -1 : 1)
  await page.mouse.move(side === 'left' ? 10 : 380, 400, { steps: 10 })
  await dwell(page, EDGE_HOLD_DWELL_MS) // past EDGE_HOLD_MS in the edge zone
  await expect.poll(() => activeColumnPage(page)).toBe(to)
  await flushFrames(page) // refreshDroppableShapes runs two frames after the switch
  await page.mouse.move(195, 400, { steps: 10 })
  await flushFrames(page)
}

export interface Finger {
  start: (x: number, y: number) => Promise<void>
  moveTo: (x: number, y: number, steps?: number, stepMs?: number) => Promise<void>
  end: () => Promise<void>
}

/**
 * One finger as real CDP touch events (`Input.dispatchTouchEvent`), the touch counterpart of `pickUp`: `start`
 * first waits for the previous drop to settle (`dropSettled`), so a touch right after a drop is a fresh gesture.
 * `moveTo` paces its steps with `dwell` (pacing between synthetic moves, not a wait).
 */
export function finger(cdp: CDPSession, page: Page): Finger {
  let x = 0
  let y = 0
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Array<{ x: number; y: number }>) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints })
  return {
    async start(startX, startY) {
      await dropSettled(page)
      x = startX
      y = startY
      await send('touchStart', [{ x, y }])
    },
    async moveTo(toX, toY, steps = 10, stepMs = 16) {
      const fromX = x
      const fromY = y
      for (let i = 1; i <= steps; i++) {
        x = fromX + ((toX - fromX) * i) / steps
        y = fromY + ((toY - fromY) * i) / steps
        await send('touchMove', [{ x, y }])
        await dwell(page, stepMs)
      }
    },
    async end() {
      await send('touchEnd', [])
    },
  }
}
