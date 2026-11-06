import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalBoard } from './helpers/seed'
import { settleAnimations } from './helpers/settle'
import { installTauriStub } from './helpers/tauriStub'

/** #226: "What's new" after an update (fixture: release-notes/0.1.0.md, stubbed app version 0.1.0). */

const LAST_SEEN = 'kando-last-seen-version'
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Was ist neu' })
const toast = (page: Page) => page.getByText('Aktualisiert auf Version 0.1.0', { exact: true })
const toastButton = (page: Page) => page.getByRole('button', { name: 'Was ist neu' })
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette' })

/** Seeds last-seen once per tab session, so a reload keeps whatever the app stored. */
async function seedLastSeen(context: BrowserContext, value: string | null) {
  await context.addInitScript(([key, seeded]) => {
    if (sessionStorage.getItem('__lastSeenSeeded')) return
    sessionStorage.setItem('__lastSeenSeeded', '1')
    if (seeded !== null) localStorage.setItem(key, seeded)
  }, [LAST_SEEN, value] as const)
}

async function startDesktop(context: BrowserContext, page: Page, lastSeen: string | null, url = '/tasks') {
  await seedLocalBoard(context)
  await installTauriStub(context, { update: { appVersion: '0.1.0' } })
  await seedLastSeen(context, lastSeen)
  await page.goto(url)
}

const lastSeen = (page: Page) => page.evaluate(key => localStorage.getItem(key), LAST_SEEN)

test.describe("What's new (desktop)", () => {
  test('shows a toast after an update; its button opens the dialog and last-seen is already stored', async ({ context, page }) => {
    await startDesktop(context, page, '0.0.0')
    await expect(toast(page)).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => lastSeen(page)).toBe('0.1.0')

    await toastButton(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByRole('heading', { name: 'Version 0.1.0' })).toBeVisible()
    await expect(dialog(page).getByText('Update-Hinweise.')).toBeVisible()
    await expect(dialog(page)).not.toContainText('Fixes')
    await expect(dialog(page)).not.toContainText('first tagged release')
    await expect(page.getByTestId('whats-new-close')).toHaveText('Schließen')

    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    expect(await lastSeen(page)).toBe('0.1.0')

    // Reload on purpose (#512): checks that the stored last-seen version keeps the toast away on the next load
    await page.reload()
    await expect(page.locator('#column-open-list .task-wrapper').first()).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(toast(page)).toHaveCount(0)
    await expect(dialog(page)).toHaveCount(0)
  })

  test('shows the toast in English with ?lang=en', async ({ context, page }) => {
    await startDesktop(context, page, '0.0.0', '/tasks?lang=en')
    await expect(page.getByText('Updated to version 0.1.0', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: "What's new" }).click()
    const en = page.getByRole('dialog', { name: "What's new" })
    await expect(en.getByText('Update notes.')).toBeVisible()
    await expect(en.getByTestId('whats-new-close')).toHaveText('Close')
  })

  test('waits during onboarding', async ({ context, page }) => {
    await installTauriStub(context, { update: { appVersion: '0.1.0' } })
    await seedLastSeen(context, '0.0.0')
    await page.goto('/welcome')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(toast(page)).toHaveCount(0)
    expect(await lastSeen(page)).toBe('0.0.0')
  })

  test('palette re-opens it without touching last-seen', async ({ context, page }) => {
    await startDesktop(context, page, '0.1.0')
    await expect(page.locator('#column-open-list .task-wrapper').first()).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await palette(page).getByText('Was ist neu').click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByText('Update-Hinweise.')).toBeVisible()
    await expect(page.getByTestId('whats-new-close')).toHaveText('Schließen')
    await page.getByTestId('whats-new-close').click()
    await expect(dialog(page)).toHaveCount(0)
    expect(await lastSeen(page)).toBe('0.1.0')
  })

  test('the button on /settings/updates re-opens it', async ({ context, page }) => {
    await startDesktop(context, page, '0.1.0', '/settings/updates')
    await page.getByTestId('updates-whats-new').click()
    await expect(dialog(page)).toBeVisible()
    await expect(page.getByTestId('whats-new-close')).toHaveText('Schließen')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    expect(await lastSeen(page)).toBe('0.1.0')
  })

  test('has no serious accessibility violations and a desktop screenshot', async ({ context, page }, testInfo) => {
    await startDesktop(context, page, '0.0.0')
    await expect(toast(page)).toBeVisible()
    await settleAnimations(page)
    await expectNoBlockingViolations(page)
    await toastButton(page).click()
    await expect(dialog(page)).toBeVisible()
    await settleAnimations(page)
    await expectNoBlockingViolations(page)
    await page.screenshot({ path: testInfo.outputPath('whats-new.png') })
  })
})

async function expectNoBlockingViolations(page: Page) {
  {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(blocking.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  }
}

test.describe("What's new (web)", () => {
  test('shows no dialog and no palette command', async ({ context, page }) => {
    await seedLocalBoard(context)
    await seedLastSeen(context, '0.0.0')
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.waitForTimeout(1000)
    await expect(dialog(page)).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page).getByText('Statistik öffnen')).toBeVisible()
    await expect(palette(page).getByText('Was ist neu')).toHaveCount(0)
  })
})
