import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { moreButton, morePanel } from './helpers/appNav'

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette' })

/** Issue #101: Cmd/Ctrl+K command palette (keyboard only, no new single-key bindings). */
test.describe('Command palette', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(column(page, 'open').locator('.task-wrapper')).toHaveCount(2)
  })

  test('opens with Ctrl+K, filters, shows empty state, Esc returns focus to the card', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeVisible()
    await expect(palette(page).getByText('Verschieben nach Erledigt')).toBeVisible()

    await page.keyboard.type('statis')
    await expect(palette(page).getByText('Statistik öffnen')).toBeVisible()
    await expect(palette(page).getByText('Verschieben nach Erledigt')).toHaveCount(0)

    await page.keyboard.type('zzzzqq')
    await expect(palette(page).getByRole('status')).toContainText('Keine Befehle')

    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()
    await expect(card(page, 'Dokumentation lesen')).toBeFocused()
  })

  test('Ctrl+K opens it on every platform (#23: Meta+K alone left Windows/Linux out)', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('Control+k')
    await expect(palette(page)).toBeVisible()
  })

  test('the ⋯ panel has a visible Befehle row that opens it (#23)', async ({ page }) => {
    await moreButton(page).click()
    const row = morePanel(page).getByTestId('more-commands')
    await expect(row).toContainText('Befehle')
    await expect(row.locator('kbd')).toHaveCount(2)
    await row.click()
    await expect(morePanel(page)).toBeHidden()
    await expect(palette(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()
  })

  test('Statistik öffnen goes to the statistics page', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('statis')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/statistics/)
  })

  test('first runnable row is highlighted on open and global commands are above the fold', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('ControlOrMeta+k')
    const options = palette(page).getByRole('option')
    await expect(options.first()).toHaveAttribute('data-highlighted')
    await expect(options.first()).not.toHaveAttribute('data-disabled')
    await expect(palette(page).getByRole('option', { name: 'Aufgabe hinzufügen' })).toBeInViewport()
  })

  test('card commands are hidden when no card has focus', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeVisible()
    await expect(palette(page).getByText('Aufgabe hinzufügen')).toBeVisible()
    await expect(palette(page).getByText('Verschieben nach Erledigt')).toHaveCount(0)
  })

  test('moves the focused card to Erledigt (with undo toast) via keyboard', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('erledigt')
    await page.keyboard.press('Enter')
    await expect(palette(page)).toBeHidden()
    await expect(column(page, 'done').getByText('Dokumentation lesen')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rückgängig', includeHidden: true }).first()).toBeVisible()
  })

  test('refuses a second Jetzt task with a visible reason', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('ControlOrMeta+k')
    const jetzt = palette(page).getByRole('option', { name: /Verschieben nach Jetzt/ })
    await expect(jetzt).toContainText('Jetzt belegt')
    await expect(jetzt).toHaveAttribute('data-disabled')
    await page.keyboard.press('Escape')
    await expect(column(page, 'progress').locator('.task-wrapper')).toHaveCount(1)
  })

  test('delete from the palette is undoable', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('löschen')
    await page.keyboard.press('Enter')
    await expect(card(page, 'Dokumentation lesen')).toHaveCount(0)
    await expect(palette(page)).toBeHidden()
    await expect(card(page, 'Konzept ausarbeiten')).toBeFocused()
    await page.getByRole('button', { name: 'Rückgängig', includeHidden: true }).first().click()
    await expect(card(page, 'Dokumentation lesen')).toBeVisible()
  })

  test('Add task opens the existing form', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('hinzufügen')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/tasks\/add/)
  })

  test('does not open while typing in an input', async ({ page }) => {
    await page.goto('/tasks/add')
    await page.getByRole('textbox').first().focus()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeHidden()
  })

  /** Highlight must be visible: the row's ::before wash differs from the dialog surface. */
  const highlightIsVisible = (page: Page) => page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]')!
    const row = document.querySelector('[role="option"][data-highlighted]')!
    const wash = getComputedStyle(row, '::before').backgroundColor
    return { wash, surface: getComputedStyle(dialog).backgroundColor }
  })

  test('arrow keys move a visible highlight; Enter runs the highlighted command', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('ControlOrMeta+k')
    const highlighted = palette(page).locator('[role="option"][data-highlighted]')
    await expect(highlighted).toHaveText(/Verschieben nach Wartet/)

    await page.keyboard.press('ArrowDown')
    await expect(highlighted).toHaveText(/Verschieben nach Erledigt/)
    await page.keyboard.press('ArrowDown')
    await expect(highlighted).toHaveText(/Aufgabe hinzufügen/)
    await page.keyboard.press('ArrowUp')
    await expect(highlighted).toHaveText(/Verschieben nach Erledigt/)

    // The highlighted row must be distinguishable (was elevated/50 on an elevated surface: invisible)
    await expect.poll(async () => {
      const { wash, surface } = await highlightIsVisible(page)
      return wash !== surface && !wash.includes('/') // solid wash, not a translucent/transparent one
    }, { message: 'highlighted row must not blend into the dialog surface' }).toBe(true)

    await page.keyboard.press('Enter')
    await expect(palette(page)).toBeHidden()
    await expect(column(page, 'done').getByText('Dokumentation lesen')).toBeVisible()
  })

  test('a single filter result is highlighted so Enter runs it', async ({ page }) => {
    await card(page, 'Dokumentation lesen').focus()
    await page.keyboard.press('ControlOrMeta+k')
    await page.keyboard.type('Details')
    await expect(palette(page).getByRole('option')).toHaveCount(1)
    await expect(palette(page).locator('[role="option"][data-highlighted]')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(palette(page)).toBeHidden()
    await expect(page).toHaveURL(/\/tasks\/[^/]+$/)
  })
})
