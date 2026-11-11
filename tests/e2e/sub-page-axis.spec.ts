import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, seedTrash, trashTask } from './helpers/seed'

/**
 * Sub-page column on the app bar's axis (#673). The sub-page layout owns the width: Einstellungen, its sub-pages and
 * Papierkorb sit in one centred 672 px column (`pageWidth: 'narrow'`), Statistik keeps the full container. At 390 px the
 * gutters are the phone's own (16 px) and nothing scrolls sideways.
 */

const NARROW = 672
const CONTAINER = 992 // `max-w-5xl` (1024) less the `px-4` gutters

/** The sub-page column: the content box inside the layout's `main` (672 px on a narrow page, the container less its gutters otherwise). */
async function column(page: Page) {
  const box = await page.getByTestId('sub-page-column').boundingBox()
  return box!
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test.describe('sub-page column (#673)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
    await seedTrash(context, [{ task: trashTask('trash-axis-1', 'Gelöschte Aufgabe') }])
  })

  test.describe('desktop 1280px', () => {
    test.use({ viewport: { width: 1280, height: 900 } })

    for (const path of ['/settings', '/trash', '/settings/topics']) {
      test(`${path}: one 672 px column centred on the axis`, async ({ page }) => {
        await page.goto(path)
        await expect(page.locator('main')).toBeVisible()
        const box = await column(page)
        expect(box.width).toBe(NARROW)
        expect(box.x + box.width / 2).toBeCloseTo(640, 0)
      })
    }

    // kd#179 (U18): a page title is the display role, the size of the column names
    test('/settings/topics: the page title is 36 px Fraunces', async ({ page }) => {
      await page.goto('/settings/topics')
      const title = page.locator('header.page-header h1')
      await expect(title).toBeVisible()
      const style = await title.evaluate((el) => ({ size: getComputedStyle(el).fontSize, family: getComputedStyle(el).fontFamily }))
      expect(style.size).toBe('36px')
      expect(style.family).toContain('Fraunces')
    })

    test('/settings/topics: the header title starts where the column starts', async ({ page }) => {
      await page.goto('/settings/topics')
      const title = await page.locator('header.page-header h1').boundingBox()
      const box = await column(page)
      expect(title!.x).toBe(box.x)
    })

    test('/statistics: the full container, centred as well', async ({ page }) => {
      await page.goto('/statistics')
      await expect(page.getByTestId('stats-verdict')).toBeVisible()
      const box = await column(page)
      expect(box.width).toBe(CONTAINER)
      expect(box.x + box.width / 2).toBeCloseTo(640, 0)
    })

    test('/statistics starts at the same top offset as /settings and /trash (no header, #686)', async ({ page }) => {
      const tops: number[] = []
      for (const path of ['/settings', '/trash', '/statistics']) {
        await page.goto(path)
        await expect(page.locator('main')).toBeVisible()
        tops.push((await column(page)).y)
      }
      expect(tops[2]).toBe(tops[0])
      expect(tops[1]).toBe(tops[0])
    })
  })

  test.describe('mobile 390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    for (const path of ['/settings', '/trash', '/statistics']) {
      test(`${path}: phone gutters, no sideways scroll`, async ({ page }) => {
        await page.goto(path)
        await expect(page.locator('main')).toBeVisible()
        const box = await column(page)
        expect(box.x).toBe(16)
        expect(box.width).toBe(358)
        await noSideScroll(page)
      })
    }
  })
})
