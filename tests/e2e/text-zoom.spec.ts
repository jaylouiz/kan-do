/**
 * @description E2E for #66 (R4): 200% text size must not break the board.
 * Simulates browser text zoom by raising the root font-size and asserts
 * (WCAG 1.4.4 / 1.4.10) that nothing overflows horizontally and the timebox
 * chip text (#388) stays inside its chip.
 */
import { test, expect } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

const ZOOM_CSS = 'html { font-size: 200% !important; }'

test.describe('200% text zoom (#66)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('board does not overflow horizontally at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tasks')
    await page.addStyleTag({ content: ZOOM_CSS })

    const done = page.locator('#column-done')
    await expect(done).toBeVisible()

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      doneRight: document.querySelector('#column-done')!.getBoundingClientRect().right,
    }))
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
    expect(metrics.doneRight).toBeLessThanOrEqual(metrics.innerWidth)
  })

  test('chips scale with text size (rem, not px)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tasks')
    const chip = page.locator('#column-open .task span.font-medium').first()
    await expect(chip).toBeVisible()
    const before = await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    await page.addStyleTag({ content: ZOOM_CSS })
    const after = await chip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(after).toBeCloseTo(before * 2, 1)
  })

  test('timebox chip text stays inside the chip, collapsed and as the Jetzt bar (#388)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/tasks')
    await page.addStyleTag({ content: ZOOM_CSS })

    for (const column of ['#column-open', '#column-progress']) {
      const chip = page.locator(`${column} [data-testid="task-progress-chip"]`).first()
      const label = chip.locator('.chip__box')
      await expect(label).toBeVisible()
      // The Jetzt bar springs wider after the card settled: measure the end state
      await expect.poll(async () => {
        const chipBox = (await chip.boundingBox())!
        const labelBox = (await label.boundingBox())!
        return labelBox.x >= chipBox.x - 0.5
          && labelBox.x + labelBox.width <= chipBox.x + chipBox.width + 0.5
          && labelBox.height <= chipBox.height
      }, { timeout: 5000 }).toBe(true)
    }
  })

  test('mobile reflow at 320px has no page-level horizontal scroll (WCAG 1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/tasks')
    await expect(page.locator('#column-open')).toBeVisible()
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
  })
})
