/**
 * @module addSheet
 * @description Opens the add sheet (/tasks/add) the way a user still reaches it since the Offen add button adds in the
 * card itself (#649): through the command palette entry "Aufgabe hinzufügen". The shortcut is retried until the page
 * has hydrated and the palette is up, so a spec may call it right after `goto`.
 */

import { expect, type Page } from '@playwright/test'

export async function openAddSheet(page: Page): Promise<void> {
  const entry = page.getByRole('option', { name: 'Aufgabe hinzufügen' })
  await expect(async () => {
    if (!(await entry.isVisible())) await page.keyboard.press('ControlOrMeta+k')
    await entry.click({ timeout: 1500 })
  }).toPass({ timeout: 15_000 })
  await page.waitForURL(/\/tasks\/add/)
  await expect(page.getByPlaceholder('Aufgabe benennen…')).toBeFocused()
}
