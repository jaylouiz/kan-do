/**
 * @module i18n.spec
 * @description E2E coverage for locale detection (?lang, navigator) and persistence.
 *
 * seedLocalBoard only writes `board-store` / `tasks-store`, so it never touches
 * the `kando-locale` key and is safe to run on every navigation.
 */

import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

const EN_HEADERS = ['Open', 'Now', 'Waiting', 'Done']
const DE_HEADERS = ['Offen', 'Jetzt', 'Wartet', 'Erledigt']

function columnHeading(page: Page, name: string) {
  // The Done header carries a decorative check icon (aria-hidden), so the name is the label alone.
  return page.getByRole('heading', { level: 2, name: new RegExp(`^${name}$`) })
}

async function expectHeaders(page: Page, visible: string[], hidden: string[]) {
  for (const name of visible) await expect(columnHeading(page, name)).toBeVisible()
  for (const name of hidden) await expect(columnHeading(page, name)).toHaveCount(0)
}

test.describe('i18n locale', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('switches to English via ?lang and persists across reload', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks?lang=en`)
    await expectHeaders(page, EN_HEADERS, ['Offen'])
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect.poll(() => new URL(page.url()).searchParams.has('lang')).toBe(false)

    await page.reload()
    await expectHeaders(page, EN_HEADERS, ['Offen'])
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(await page.evaluate(() => localStorage.getItem('kando-locale'))).toBe('en')
  })

  test('defaults to German for a de-DE browser', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`)
    await expectHeaders(page, DE_HEADERS, ['Open'])
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  })

  test.describe('en-US browser', () => {
    test.use({ locale: 'en-US' })

    test('detects English from navigator.languages', async ({ page, baseURL }) => {
      await page.goto(`${baseURL}/tasks`)
      await expectHeaders(page, EN_HEADERS, ['Offen'])
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    })
  })
})
