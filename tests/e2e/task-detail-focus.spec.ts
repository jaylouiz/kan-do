/**
 * E2E: task sheet (USlideover desktop / UDrawer mobile) focus and dismissal behaviour.
 * Covers initial focus, focus trap, focus return, Escape vs inline edit,
 * close animation before navigation and reduced motion (issue #31).
 */
import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

const CARD = '[data-task-id="seed-open-1"]'

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

async function openFromCard(page: Page) {
  await page.goto('/tasks')
  const card = page.locator(CARD).first()
  await expect(card).toBeVisible()
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/tasks\/seed-open-1/)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('task-detail-header')).toBeVisible()
  return dialog
}

const insideDialog = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))

test.describe('desktop slideover', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('is a right-hand sheet with an accessible name', async ({ page }) => {
    const dialog = await openFromCard(page)
    await page.waitForTimeout(400)
    const box = await dialog.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.x + box!.width).toBeGreaterThan(1440 - 2)
    expect(box!.width).toBeLessThanOrEqual(576 + 2)
    expect(box!.height).toBeGreaterThan(890)
    await expect(page.getByRole('dialog', { name: 'Konzept ausarbeiten' })).toBeVisible()
  })

  test('moves focus into the dialog on open', async ({ page }) => {
    await openFromCard(page)
    expect(await insideDialog(page)).toBe(true)
  })

  test('Tab and Shift+Tab never leave the dialog', async ({ page }) => {
    await openFromCard(page)
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      expect(await insideDialog(page)).toBe(true)
    }
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await insideDialog(page)).toBe(true)
    }
  })

  test('Escape closes, navigates to /tasks and returns focus to the card', async ({ page }) => {
    await openFromCard(page)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator(CARD).first()).toBeFocused()
  })

  test('has no close button; Escape and the overlay are the ways out', async ({ page }) => {
    const dialog = await openFromCard(page)
    await expect(dialog.getByRole('button', { name: 'Schließen' })).toHaveCount(0)
  })

  test('overlay click closes the sheet', async ({ page }) => {
    await openFromCard(page)
    // Past the 600 ms double-click guard (kd#25): an earlier outside press is a second click of the opening double-click
    await page.waitForTimeout(700)
    await page.mouse.click(100, 450)
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('the route only changes after the close animation', async ({ page }) => {
    await openFromCard(page)
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    // Right after Escape the dialog is still animating out and the URL has not changed yet.
    await expect(page).toHaveURL(/\/tasks\/seed-open-1/)
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('Escape in an active inline edit cancels the edit only', async ({ page }) => {
    const dialog = await openFromCard(page)
    await page.waitForTimeout(400)
    const header = page.getByTestId('task-detail-header')
    await header.getByText('Konzept ausarbeiten').click()
    const input = header.locator('input, textarea').first()
    await expect(input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(/\/tasks\/seed-open-1/)
    // A second Escape closes the sheet.
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('deep link: closing sends focus to the board, not body', async ({ page }) => {
    await page.goto('/tasks/seed-open-1')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.locator('main')).toBeFocused()
    await expect(page.locator('main')).toHaveCSS('outline-style', 'none') // #644
  })

  // #644: the board container is only a programmatic focus target, so it must never draw a focus ring
  const boardOutline = (page: Page) =>
    page.locator('main[data-task-sheet-return]').evaluate((el) => ({
      focused: el === document.activeElement,
      outlineStyle: getComputedStyle(el).outlineStyle,
    }))

  test('add route: Escape sends focus to the board without a focus ring (#644)', async ({ page }) => {
    await page.goto('/tasks/add')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('main')).toBeFocused()
    expect(await boardOutline(page)).toEqual({ focused: true, outlineStyle: 'none' })
  })

  test('add route: a click on the board closes the sheet and leaves no ring on the board (#644)', async ({ page }) => {
    await page.goto('/tasks/add')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await page.mouse.click(100, 450)
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect((await boardOutline(page)).outlineStyle).not.toBe('auto')
  })

  test('the board container is no tab stop after the sheet closed, real controls keep their ring (#644)', async ({ page }) => {
    await page.goto('/tasks/add')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await expect(page.locator('main')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect.poll(() => page.locator('main[data-task-sheet-return]').getAttribute('tabindex')).toBeNull()
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return { isMain: el.matches('main'), focusVisible: el.matches(':focus-visible'), outlineStyle: getComputedStyle(el.matches('.task-wrapper') ? el.querySelector('.task')! : el).outlineStyle }
    })
    expect(ring.isMain).toBe(false)
    expect(ring.focusVisible).toBe(true)
    expect(ring.outlineStyle).not.toBe('none')
  })

  test('reduced motion: no slide animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const dialog = await openFromCard(page)
    const duration = await dialog.evaluate((el) => getComputedStyle(el).animationDuration)
    expect(parseFloat(duration)).toBeLessThanOrEqual(0.001)
  })

  test('add route uses the same sheet with footer actions', async ({ page }) => {
    await page.goto('/tasks/add')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading').first()).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeVisible()
  })

  test('add route: Escape in a field with a draft keeps the sheet open', async ({ page }) => {
    await page.goto('/tasks/add')
    const input = page.getByRole('dialog').locator('input').first()
    await input.fill('Entwurf')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    await expect(page).toHaveURL(/\/tasks\/add/)
    await expect(input).toHaveValue('Entwurf')
  })

  test('Cancel slides the sheet out with its content before the route changes', async ({ page }) => {
    await page.goto('/tasks/add')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    // Still on the nested route while the sheet leaves, with the form still rendered
    await expect(page).toHaveURL(/\/tasks\/add/)
    await expect(dialog.locator('input').first()).toBeAttached()
    await expect(page).toHaveURL(/\/tasks$/)
  })
})

test.describe('mobile drawer (390px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('is a bottom drawer above the tab bar', async ({ page }) => {
    await page.goto('/tasks/seed-open-1')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('task-detail-header')).toBeVisible()
    await page.waitForTimeout(600)
    const box = await dialog.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.width).toBeGreaterThan(385)
    expect(box!.y + box!.height).toBeGreaterThan(844 - 2)
    expect(box!.y).toBeGreaterThan(0)
    // The sheet is the topmost element at its bottom edge (not covered by the tab bar).
    const topIsDialog = await page.evaluate(() => {
      const el = document.elementFromPoint(195, 840)
      return !!el?.closest('[role="dialog"]')
    })
    expect(topIsDialog).toBe(true)
  })

  test('moves focus into the drawer on open and keeps Tab inside', async ({ page }) => {
    await openFromCard(page)
    await expect.poll(() => insideDialog(page)).toBe(true)
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab')
      expect(await insideDialog(page)).toBe(true)
    }
  })

  test('Escape returns focus to the card', async ({ page }) => {
    await openFromCard(page)
    await expect.poll(() => insideDialog(page)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.locator(CARD).first()).toBeFocused()
  })

  test('Escape closes and navigates to /tasks', async ({ page }) => {
    await page.goto('/tasks/seed-open-1')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(600)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('swipe down closes the drawer', async ({ page }) => {
    await page.goto('/tasks/seed-open-1')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await page.waitForTimeout(600)
    const box = (await dialog.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + 12 // the handle
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(x, y + i * 40)
    await page.mouse.up()
    await expect(page).toHaveURL(/\/tasks$/)
  })
})
