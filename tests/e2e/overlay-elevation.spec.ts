/**
 * E2E: overlay elevation (issue #126). Every modal content lifts off the scrim by `--shadow-overlay`;
 * the context menu keeps Nuxt UI's stock shadow.
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { openDayClose } from './helpers/appNav'

const dialog = (page: Page) => page.getByRole('dialog')
const shadowOf = (page: Page, selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).boxShadow)

/** Splits a computed box-shadow stack into its layers (commas inside rgb()/rgba() don't count). */
const layersOf = (shadow: string) => shadow.split(/,\s*(?![^(]*\))/)

/** Computed box-shadow Nuxt UI's stock `shadow-lg` resolves to, probed instead of hard-coded. */
const stockShadow = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'shadow-lg'
    document.body.append(probe)
    const value = getComputedStyle(probe).boxShadow
    probe.remove()
    return value
  })

/** Computed value of the token as the browser serialises it inside a box-shadow stack. */
const overlayToken = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.boxShadow = 'var(--shadow-overlay)'
    document.body.append(probe)
    const value = getComputedStyle(probe).boxShadow
    probe.remove()
    return value
  })

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

const openPalette = async (page: Page) => {
  await page.goto('/tasks')
  await page.locator('.task-wrapper').first().focus()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(dialog(page)).toBeVisible()
}

for (const viewport of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    test('command palette carries --shadow-overlay with the hairline ring', async ({ page }) => {
      await openPalette(page)
      const token = await overlayToken(page)
      const stock = await stockShadow(page)
      expect(token).not.toBe('none')
      expect(stock, 'probe must resolve a real stock shadow').not.toBe('none')
      // Poll: the dialog animates in, so the first read can predate the final style.
      await expect.poll(async () => layersOf(await shadowOf(page, '[role="dialog"]'))).toEqual(
        expect.arrayContaining(layersOf(token)),
      )
      const layers = layersOf(await shadowOf(page, '[role="dialog"]'))
      expect(layers.some((l) => /\b0px 0px 0px 1px\b/.test(l)), 'hairline ring stays').toBe(true)
      // Tailwind's empty placeholder layers (transparent, 0 offsets) are shared by every shadow, so skip them.
      for (const stockLayer of layersOf(stock).filter((l) => !/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(l))) {
        expect(layers, 'stock shadow-lg must not survive').not.toContain(stockLayer)
      }
    })

    test('context menu keeps the stock shadow', async ({ page }) => {
      await page.goto('/tasks')
      await page.locator('.task-wrapper').first().click({ button: 'right' })
      await expect(page.getByRole('menu')).toBeVisible()
      const token = layersOf(await overlayToken(page))
      const stock = layersOf(await stockShadow(page))
      await expect.poll(async () => layersOf(await shadowOf(page, '[role="menu"]'))).toEqual(expect.arrayContaining(stock))
      const shadow = layersOf(await shadowOf(page, '[role="menu"]'))
      for (const layer of token) expect(shadow).not.toContain(layer)
    })
  })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('day close modal carries --shadow-overlay', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    const layers = layersOf(await overlayToken(page))
    await expect.poll(async () => layersOf(await shadowOf(page, '[role="dialog"]'))).toEqual(expect.arrayContaining(layers))
  })

  // Desktop only: on mobile day close is a sheet that does not take the overlay shadow (see the test above).
  test('a second modal (day close opened via palette) inherits the same elevation', async ({ page }) => {
    await openPalette(page)
    await page.getByRole('option', { name: /Tag abschließen/ }).click()
    // The palette leaves first, then the day-close dialog opens: wait until only the new one is left.
    await expect(page.getByRole('option', { name: /Tag abschließen/ })).toHaveCount(0)
    await expect(dialog(page)).toHaveCount(1)
    await expect(dialog(page)).toBeVisible()
    const layers = layersOf(await overlayToken(page))
    await expect.poll(async () => layersOf(await shadowOf(page, '[role="dialog"]'))).toEqual(expect.arrayContaining(layers))
  })
})
