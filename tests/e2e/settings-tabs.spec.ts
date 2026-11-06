import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'
import { installTauriStub } from './helpers/tauriStub'
import { openSettings } from './helpers/appNav'

/** #691: Einstellungen is a tab strip of three groups (Board, Aufgabenquellen, Verwaltung); the tab lives in `?tab=`. */

const tab = (page: Page, name: string) => page.getByRole('tab', { name })
const tabNames = (page: Page) => page.getByRole('tab').allTextContents()

test.describe('Einstellungen tabs (#691)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('three tabs in order, Board active by default and holding only Fokus', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    expect((await tabNames(page)).map(n => n.trim())).toEqual(['Board', 'Aufgabenquellen', 'Verwaltung'])
    await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('focus-switch')).toBeVisible()
    await expect(page.getByTestId('sources-connected')).toHaveCount(0)
    await expect(page.getByTestId('settings-subpages')).toHaveCount(0)
  })

  test('each group shows its own content; the tab is in the URL, an unknown tab falls back to Board', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'sources')
    await expect(page.getByTestId('sources-connected')).toBeVisible()
    await expect(page.getByTestId('sources-more')).toBeVisible()
    await expect(page.getByTestId('focus-switch')).toHaveCount(0)

    await openSettings(page, 'manage')
    const links = page.getByTestId('settings-subpage-link-label')
    await expect(links).toHaveText(['Themen und Aktivitäten', 'Daten & Speicher'])
    await expect(page.getByTestId('settings-tab-lead')).toContainText('Themen und Daten pflegst du hier')

    await page.goto('/settings?tab=nonsense')
    await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true')
    await page.goto('/settings?tab=manage')
    await expect(tab(page, 'Verwaltung')).toHaveAttribute('aria-selected', 'true')
  })

  test('back from a sub-page returns to the tab it was opened from', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await page.getByRole('link', { name: /Daten & Speicher/ }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings\?tab=manage$/)
    await expect(tab(page, 'Verwaltung')).toHaveAttribute('aria-selected', 'true')
  })

  test('leaving a sub-page through the app bar restores its tab', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await page.getByRole('link', { name: /Daten & Speicher/ }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await page.getByTestId('app-nav-place-more').click()
    await expect(page).toHaveURL(/\/settings\?tab=manage$/)
    await expect(tab(page, 'Verwaltung')).toHaveAttribute('aria-selected', 'true')
  })

  test('a tab click adds no history entry', async ({ page }) => {
    await page.goto('/settings')
    const before = await page.evaluate(() => history.length)
    await tab(page, 'Aufgabenquellen').click()
    await tab(page, 'Verwaltung').click()
    expect(await page.evaluate(() => history.length)).toBe(before)
  })

  test('keyboard: arrow keys move between the tabs', async ({ page }) => {
    await page.goto('/settings')
    await tab(page, 'Board').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, 'Aufgabenquellen')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=manage$/)
  })

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('all three labels are visible without horizontal scroll', async ({ page }) => {
      await page.goto('/settings')
      for (const name of ['Board', 'Aufgabenquellen', 'Verwaltung']) await expect(tab(page, name)).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  })
})

test.describe('Einstellungen tabs, desktop app (#691)', () => {
  test('Verwaltung also holds Updates and GitHub-Zugriff, each opening its page', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/settings?tab=manage')
    await expect(page.getByTestId('settings-tab-lead')).toContainText('Updates und Zugriffe')
    await expect(page.getByTestId('settings-subpage-link-label')).toHaveText(['Themen und Aktivitäten', 'Daten & Speicher', 'Updates', 'GitHub-Zugriff'])
    await page.getByRole('link', { name: /^Updates/ }).click()
    await expect(page).toHaveURL(/\/settings\/updates$/)
    await page.goBack()
    await page.getByRole('link', { name: /GitHub-Zugriff/ }).click()
    await expect(page).toHaveURL(/\/settings\/github$/)
  })
})
