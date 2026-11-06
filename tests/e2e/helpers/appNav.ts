/**
 * @module appNav
 * @description E2E helpers for the global app bar and its Mehr panel (#470, ADR 017). The bar sits at the top on
 * desktop and floats at the bottom on a phone; the panel is portalled, so everything inside it is scoped to
 * `[data-testid="more-panel"]`. Helpers wait on the panel and the route, never on a guessed duration.
 */

import { expect, type Locator, type Page } from '@playwright/test'

/** The bar (a `<nav>` named "Hauptnavigation"). */
export const appNav = (page: Page): Locator => page.getByTestId('app-nav')

/** The ⋯ button (accessible name "Mehr", or "Mehr, Verbindungsproblem" while a source fails). */
export const moreButton = (page: Page): Locator => page.getByTestId('app-nav-more')

/** The panel behind ⋯ (portalled to <body>). */
export const morePanel = (page: Page): Locator => page.getByTestId('more-panel')

/** The Erledigt footer CTA "Tag abschließen" (only while something is done today). */
export const dayCloseCta = (page: Page): Locator => page.getByTestId('day-close-cta')

/** Opens the panel (no-op when it is open) and waits until it is shown. */
export async function openMore(page: Page): Promise<Locator> {
  const panel = morePanel(page)
  if (!(await panel.isVisible())) await moreButton(page).click()
  await expect(panel).toBeVisible()
  return panel
}

/** Closes the panel with Escape (focus returns to ⋯) and waits until it is gone. */
export async function closeMore(page: Page): Promise<void> {
  if (!(await morePanel(page).isVisible())) return
  await page.keyboard.press('Escape')
  await expect(morePanel(page)).toBeHidden()
}

/** Panel rows by their test id (navigation rows leave the panel closed afterwards). */
export type MoreRow = 'trash' | 'settings' | 'update' | 'day-close' | 'sync'

/** Opens the panel and activates one row. The page shown as the bar's third segment has no row (#583). */
export async function chooseInMore(page: Page, row: MoreRow): Promise<void> {
  const panel = await openMore(page)
  const target = panel.getByTestId(`more-${row}`)
  await expect(target, `no "${row}" row in the Mehr panel: the page the bar shows as its third segment is not listed (#583)`).toBeVisible()
  await target.click()
}

/** The bar's third segment (#583): the page behind ⋯ the route is on (Einstellungen or Papierkorb). */
export const thirdItem = (page: Page): Locator => page.getByTestId('app-nav-place-more')

/** Waits until the bar is at rest: no segment grows or shrinks, the indicator has settled (`data-moving` is gone). */
export async function waitForNavIdle(page: Page): Promise<void> {
  await expect(appNav(page)).not.toHaveAttribute('data-moving', 'true')
}

/** The three groups of Einstellungen (#691): `?tab=board|sources|manage`, board by default. */
export type SettingsTab = 'board' | 'sources' | 'manage'
export const SETTINGS_TAB_NAMES: Record<SettingsTab, string> = { board: 'Board', sources: 'Aufgabenquellen', manage: 'Verwaltung' }

/** ⋯ -> Einstellungen: lands on `/settings`. Already on `/settings*`: the page is in the bar, nothing to do. */
export async function openSettings(page: Page, tab?: SettingsTab): Promise<void> {
  if (!/\/settings(\/|$)/.test(new URL(page.url()).pathname)) {
    await chooseInMore(page, 'settings')
    await expect(page).toHaveURL(/\/settings$/)
    await expect(morePanel(page)).toBeHidden() // gone, not fading: a fade skews contrast and screenshot reads
  }
  if (tab) {
    await page.getByRole('tab', { name: SETTINGS_TAB_NAMES[tab] }).click()
    await expect(page).toHaveURL(new RegExp(`/settings\\?tab=${tab}$`))
  }
}

/** ⋯ -> Papierkorb (n): lands on `/trash`. Already on `/trash`: the page is in the bar, nothing to do. */
export async function openTrash(page: Page): Promise<void> {
  if (/\/trash(\/|$)/.test(new URL(page.url()).pathname)) return
  await chooseInMore(page, 'trash')
  await expect(page).toHaveURL(/\/trash$/)
  await expect(morePanel(page)).toBeHidden()
}

/** ⋯ -> Tag abschließen (board only): opens the day-close dialog; the panel is closed first and focus sat on ⋯. */
export async function openDayClose(page: Page): Promise<void> {
  await chooseInMore(page, 'day-close')
  await expect(morePanel(page)).toBeHidden()
}

/** ⋯ -> Jetzt synchronisieren; the panel stays open while it runs. Resolves once the row is enabled again. */
export async function resync(page: Page): Promise<void> {
  const panel = await openMore(page)
  const row = panel.getByTestId('more-sync')
  await row.click()
  await expect(row).toBeEnabled()
}

/** Heute / Statistik in the bar: one click. Waits for the destination route. */
export async function goToPlace(page: Page, place: 'Heute' | 'Statistik'): Promise<void> {
  await appNav(page).getByRole(place === 'Heute' ? 'link' : 'link', { name: place }).click()
  await expect(page).toHaveURL(place === 'Heute' ? /\/tasks(\?.*)?$/ : /\/statistics$/)
}
