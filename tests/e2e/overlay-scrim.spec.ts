/**
 * E2E: overlay scrim (issue #127). Every modal and drawer overlay darkens the page by the shared
 * `--overlay-scrim`; the task sheet is the one exception (transparent overlay, board-side spotlight).
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { openDayClose } from './helpers/appNav'

const overlay = (page: Page) => page.locator('[data-slot="overlay"]:visible')

/** Rasterises the computed overlay colour (any CSS colour syntax) to straight sRGB + alpha. */
const scrim = (page: Page) =>
  overlay(page).evaluate((el) => {
    const css = getComputedStyle(el).backgroundColor
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    ctx.fillStyle = css
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data as unknown as number[]
    return { css, alpha: a! / 255, luma: (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255 }
  })

/** Waits out the fade-in (200ms) by polling the computed alpha into the scrim band, then checks the colour is dark. */
const expectScrim = async (page: Page) => {
  await expect.poll(async () => (await scrim(page)).alpha, { message: 'overlay alpha reaches the scrim band' }).toBeGreaterThan(0.1)
  const { alpha, luma, css } = await scrim(page)
  expect(css, 'overlay must not be transparent').not.toBe('rgba(0, 0, 0, 0)')
  expect(luma, 'overlay must be dark, not light').toBeLessThan(0.2)
  expect(alpha).toBeLessThan(0.14)
}

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('day close overlay is a slight dark scrim, never a light wash', async ({ page }) => {
      await page.goto('/tasks')
      await openDayClose(page)
      await expect(page.getByRole('dialog', { name: 'Tag abschließen' })).toBeVisible()
      await expect(overlay(page)).toHaveCount(1)
      await expectScrim(page)
    })

    test('command palette overlay uses the same scrim', async ({ page }) => {
      await page.goto('/tasks')
      await page.locator('.task-wrapper').first().focus()
      await page.keyboard.press('ControlOrMeta+k')
      await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeVisible()
      await expect(overlay(page)).toHaveCount(1)
      await expectScrim(page)
    })

    test('task sheet overlay stays transparent', async ({ page }) => {
      await page.goto('/tasks/seed-open-1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(overlay(page)).toHaveCount(1)
      await expect(overlay(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    })
  })
}
