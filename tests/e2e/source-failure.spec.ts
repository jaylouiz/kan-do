import { test, expect, type Page } from '@playwright/test'
import { seedMixedBoard } from './helpers/seed'
import { resync } from './helpers/appNav'

/**
 * A Notion source the API rejects is marked in the health store, keeps its tasks and the sync never opens the
 * setup dialog by itself, neither on load nor on a refresh (#318, #340). The web server passes a Notion 401, 403
 * and 404 through, so a deleted or unshared database is `broken` here as on the desktop client, which calls Notion
 * directly (#342). The 401 case, with the
 * popover's repair entry, is in `pending-sync.spec.ts` (#319, #341).
 */

const SETUP_TITLE = /Notion-Einstellungen|Mit Notion verbinden|Notion-Integration einrichten/

const notionHealth = (page: Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('integration-health-store') ?? '{}') as { sources?: { notion?: { status: string; lastSuccessfulSync: number | null } } }
  return raw.sources?.notion
})

const CASES = [
  { failStatus: 404, responseStatus: 404, health: 'broken' },
] as const

for (const { failStatus, responseStatus, health } of CASES) {
  test(`Notion fails with ${failStatus}: the source is ${health}, the tasks stay, no setup dialog opens on load or refresh`, async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { token: `notion_test_stub:fail=${failStatus}:${crypto.randomUUID()}` } })
    const rejected = () => page.waitForResponse((res) => res.url().includes('/api/notion/') && res.status() === responseStatus)

    const first = rejected()
    await page.goto(`${baseURL}/tasks`)
    await first

    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await expect(page.locator('#column-open-list').getByText('Lokal: Einkauf planen')).toBeVisible()
    await expect.poll(async () => (await notionHealth(page))?.status).toBe(health)
    await expect(page.getByText(SETUP_TITLE)).toHaveCount(0)

    const second = rejected()
    await resync(page)
    await second
    await expect.poll(async () => (await notionHealth(page))?.status).toBe(health)
    expect((await notionHealth(page))?.lastSuccessfulSync).toBeNull()
    await expect(page.getByText(SETUP_TITLE)).toHaveCount(0)
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
  })
}
