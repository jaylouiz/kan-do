/**
 * E2E: no layout shift when the document scroll bar appears or disappears (issue #669). With a classic bar the
 * layout width depends on whether the page scrolls: expanding a stack past the viewport height, or leaving a short
 * board for the (taller) statistics page, used to shift everything sideways. `scrollbar-gutter: stable` on <html>
 * (assets/css/utilities.css) reserves the bar's space, so nothing may move horizontally.
 *
 * Like `scrollbar-shift.spec.ts` (#580, the scroll-lock case) this launches with real scroll bars and forces a
 * classic one (`helpers/layoutShift.ts`); headless Chromium would otherwise hide it and pass without the fix.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, fillerTasks, SEED_TASKS, type SeedTask } from './helpers/seed'
import { goToPlace, waitForNavIdle } from './helpers/appNav'
import { forceClassicScrollbar, tagElements, boxes, moved } from './helpers/layoutShift'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const at = new Date().toISOString()
const designTask = (id: string, title: string): SeedTask => ({
  id, title, status: 0, priority: 1, topic: 'Design', timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: at, updatedAt: at,
})
/** One stack of five, nothing else: collapsed it is short, expanded it is four cards taller (a phone's 700px column overflows only then, #260). */
const STACK = [
  designTask('d1', 'Konzept ausarbeiten'), designTask('d2', 'Farben abstimmen'), designTask('d3', 'Raster festlegen'),
  designTask('d4', 'Schrift wählen'), designTask('d5', 'Prototyp bauen'),
]
const GROUP_BY_TOPIC = { enabled: true, key: 'topic' }

/** Whether the document is taller than the viewport, i.e. whether a bar is drawn. */
const scrolls = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)

for (const viewport of [{ name: 'desktop', width: 1280 }, { name: 'wide', width: 1800 }, { name: 'mobile', width: 390 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: 700 } })

    test('expanding and collapsing a stack past the viewport height moves nothing horizontally', async ({ page, context }) => {
      await seedLocalBoard(context, STACK, {}, GROUP_BY_TOPIC)
      await forceClassicScrollbar(page)
      await page.goto('/tasks')
      const stack = page.locator('#column-open-list .task-stack[data-stack-key="Design"]')
      await expect(stack).toBeVisible()
      const mobile = viewport.width <= 767
      // Shrink a desktop viewport to the collapsed page, so only the expanded stack overflows. A phone keeps its height: the board
      // scrolls inside its column, and a viewport shorter than the Jetzt page needs would scroll the document for a reason of its own
      if (!mobile) await page.setViewportSize({ width: viewport.width, height: await page.evaluate(() => document.documentElement.scrollHeight) })
      const columnScrolls = () => page.locator('#column-open').evaluate(el => el.scrollHeight > el.clientHeight)
      const overflowing = () => (mobile ? columnScrolls() : scrolls(page))
      expect(await overflowing(), 'collapsed: fits, no bar').toBe(false)
      // The phone board is sized from the layout, never 100vw, which includes the gutter and made the document 15px
      // too wide: a click or focus then scrolled the whole page sideways, at random times (#269). The probe is
      // deterministic: a document wider than its layout accepts the scroll
      if (mobile) expect(await page.evaluate(() => { window.scrollTo(15, 0); const x = window.scrollX; window.scrollTo(0, 0); return x }), 'the document cannot scroll sideways').toBe(0)
      await tagElements(page)
      const before = await boxes(page)

      await stack.click()
      await expect.poll(overflowing, { message: 'expanded: the page scrolls, a bar would be drawn' }).toBe(true)
      // The phone's document never scrolls itself, its column does (#260)
      if (mobile) expect(await scrolls(page), 'expanded: the column scrolls, not the page').toBe(false)
      expect(moved(before, await boxes(page))).toEqual([])

      await page.locator('#column-open-list [data-stack-header="Design"] button').click()
      await expect.poll(overflowing).toBe(false)
      await expect.poll(async () => moved(before, await boxes(page))).toEqual([])
    })
  })
}

test.describe('statistics page', () => {
  test.use({ viewport: { width: 1280, height: 700 } })

  test('switching between a short board and the statistics page moves the app bar and background nowhere', async ({ page, context }) => {
    await seedLocalBoard(context, SEED_TASKS)
    await forceClassicScrollbar(page)
    await page.goto('/tasks')
    await expect(page.locator('.task-wrapper').first()).toBeVisible()
    expect(await scrolls(page), 'the board fits').toBe(false)
    await tagElements(page)
    const before = await boxes(page)

    // The selection indicator slides to the new place on purpose: it is not a shift
    const shifts = async () => (moved(before, await boxes(page))).filter(line => !line.includes('app-nav-indicator'))

    await goToPlace(page, 'Statistik')
    await waitForNavIdle(page)
    // The pages differ in height: that is the difference a bar would make visible
    await expect.poll(() => scrolls(page), { message: 'the statistics page scrolls' }).toBe(true)
    expect(await shifts()).toEqual([])

    await goToPlace(page, 'Heute')
    await expect(page.locator('.task-wrapper').first()).toBeVisible()
    await waitForNavIdle(page)
    await expect.poll(shifts).toEqual([])
  })
})

// A board that already scrolls keeps its layout when a long list is added (a plain reload of the same page)
test('a board that scrolls and one that does not share one layout width', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 700 })
  await forceClassicScrollbar(page)
  const nav = async (tasks: SeedTask[]) => {
    await seedLocalBoard(context, tasks)
    await page.goto('/tasks')
    await expect(page.locator('.task-wrapper').first()).toBeVisible()
    return { scrolls: await scrolls(page), x: await page.locator('.app-nav-brand').evaluate(el => el.getBoundingClientRect().x) }
  }
  const short = await nav(SEED_TASKS)
  expect(short.scrolls).toBe(false)
  const long = await nav([...SEED_TASKS, ...fillerTasks(30, 0)])
  expect(long.scrolls).toBe(true)
  expect(long.x).toBeCloseTo(short.x, 0)
})

// The OS can switch a host between overlay and classic bars while the app runs (a mouse is attached, the setting changes)
test('the gutter follows the bar style while the page is open', async ({ page, context }) => {
  await seedLocalBoard(context, SEED_TASKS)
  const setBar = (css: string) => page.evaluate((text) => {
    let style = document.getElementById('bar-style')
    if (!style) {
      style = document.createElement('style')
      style.id = 'bar-style'
      document.head.appendChild(style)
    }
    style.textContent = text
  }, css)
  const hasGutter = () => page.evaluate(() => document.documentElement.classList.contains('kando-classic-scrollbar'))
  await page.goto('/tasks')
  await expect(page.locator('.task-wrapper').first()).toBeVisible()

  await setBar('::-webkit-scrollbar { display: none; }')
  await expect.poll(hasGutter, { message: 'no bar takes width: no gutter' }).toBe(false)
  await setBar('::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }')
  await expect.poll(hasGutter, { message: 'a classic bar appeared: gutter' }).toBe(true)
  await setBar('::-webkit-scrollbar { display: none; }')
  await expect.poll(hasGutter).toBe(false)
})
