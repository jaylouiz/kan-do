import { test, expect, type Page } from '@playwright/test'
import { seedMixedBoard } from './helpers/seed'
import { moreButton, openMore, resync } from './helpers/appNav'

/**
 * Pending-sync marker and sync status (#319, #341). A change made while Notion cannot be reached keeps its
 * marker (persisted with the task) and shows the cloud on the card; the sync button names the source; the next
 * successful sync clears both. A healthy sync never flashes the cloud. A rejected token never opens the setup
 * dialog by itself: the sync button's popover offers the repair.
 *
 * "Unreachable" is the Notion API route aborted at the network (the page itself stays up); the Notion stub's
 * `fail=<status>` token is the rejected-token case.
 */

const TITLE = 'Fokusaufgabe vorbereiten' // page-1 of the stub (Offen)
const SETUP_TITLE = /Notion-Einstellungen|Mit Notion verbinden|Notion-Integration einrichten/
const CLOUD = '[data-testid="task-save-pending"]'

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()

async function moveTo(page: Page, title: string, target: string) {
  await card(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: target, exact: true }).click()
}

const storedTask = (page: Page, id: string) => page.evaluate((taskId) => {
  const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; pendingSync?: { attempts: number } }> }
  return raw.tasks?.find((t) => t.id === taskId)
}, id)

const blockNotion = (page: Page) => page.route('**/api/notion/**', (route) => route.abort('connectionrefused'))

test.describe('pending-sync marker (#319)', () => {
  test('a change while Notion is unreachable shows the cloud and names the source; the next sync clears both', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()
    await expect(page.locator(CLOUD)).toHaveCount(0)

    await blockNotion(page)
    await moveTo(page, TITLE, 'Warten')

    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible() // the change stays local
    await expect(card(page, TITLE).locator(CLOUD)).toBeVisible()
    await expect(card(page, TITLE).locator(CLOUD)).toHaveAttribute('aria-label', /Noch nicht in Notion gespeichert/)
    await expect(moreButton(page)).toHaveAccessibleName('Mehr, Verbindungsproblem')
    await expect((await openMore(page)).getByTestId('sync-problem-notion')).toContainText('Notion offline – Synchronisierung läuft weiter')
    await expect.poll(async () => (await storedTask(page, 'page-1'))?.pendingSync?.attempts ?? 0).toBeGreaterThan(0)

    await page.unroute('**/api/notion/**') // the connection is back
    const panel = await openMore(page)
    await expect(panel.getByTestId('sync-problem-notion')).toBeVisible()
    await panel.getByTestId('more-sync').click()

    await expect(page.locator(CLOUD)).toHaveCount(0)
    await expect(moreButton(page)).toHaveAccessibleName('Mehr')
    await expect(panel.getByTestId('sync-problem-notion')).toHaveCount(0)
    await expect(panel.getByTestId('more-sync')).toBeEnabled()
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'page-1'))?.pendingSync).toBeUndefined()
  })

  test('the marker survives a restart and is pushed afterwards', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()

    await blockNotion(page)
    await moveTo(page, TITLE, 'Warten')
    await expect(card(page, TITLE).locator(CLOUD)).toBeVisible()

    await page.reload() // still unreachable
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()
    await expect(card(page, TITLE).locator(CLOUD)).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'page-1'))?.pendingSync).toBeDefined()

    const pushed = page.waitForResponse((res) => res.url().includes('/api/notion/update-task') && res.ok())
    await page.unroute('**/api/notion/**')
    await page.reload()
    // The fetch of the recovered source keeps the local state and pushes it; the marker clears after the push
    await pushed
    await expect.poll(async () => (await storedTask(page, 'page-1'))?.pendingSync).toBeUndefined()
    await expect(page.locator(CLOUD)).toHaveCount(0)
    await page.reload()
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible() // Notion holds it now
  })

  test('a healthy sync never flashes the cloud', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context)
    await context.addInitScript(() => {
      const w = window as unknown as { __cloudSeen: number }
      w.__cloudSeen = 0
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          m.addedNodes.forEach((node) => {
            if (node instanceof Element && (node.matches('[data-testid="task-save-pending"]') || node.querySelector('[data-testid="task-save-pending"]'))) w.__cloudSeen++
          })
        }
      }).observe(document, { childList: true, subtree: true })
    })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()

    const write = page.waitForResponse((res) => res.url().includes('/api/notion/update-task'))
    await moveTo(page, TITLE, 'Warten')
    await write
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()
    await resync(page)

    expect(await page.evaluate(() => (window as unknown as { __cloudSeen: number }).__cloudSeen)).toBe(0)
    expect((await storedTask(page, 'page-1'))?.pendingSync).toBeUndefined()
  })

  test('Local tasks never show the cloud, also while Notion is unreachable', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()

    await blockNotion(page)
    await moveTo(page, 'Lokal: Einkauf planen', 'Warten')
    await moveTo(page, TITLE, 'Warten')

    await expect(card(page, TITLE).locator(CLOUD)).toBeVisible()
    await expect(card(page, 'Lokal: Einkauf planen').locator(CLOUD)).toHaveCount(0)
  })
})

test.describe('a rejected Notion token (#319 AC 5, #341)', () => {
  test('the tasks page opens no setup dialog by itself; the Mehr panel offers the repair', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` } })
    const rejected = page.waitForResponse((res) => res.url().includes('/api/notion/') && res.status() === 401)

    await page.goto(`${baseURL}/tasks`)
    await rejected
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible() // the tasks stay

    await expect(moreButton(page)).toHaveAccessibleName('Mehr, Verbindungsproblem')
    await expect(page.getByText(SETUP_TITLE)).toHaveCount(0)

    const panel = await openMore(page)
    await expect(panel.getByTestId('sync-problem-notion')).toContainText('Notion: Verbindung prüfen')
    const repair = page.getByTestId('sync-repair-notion')
    await expect(repair).toHaveText('Notion-Verbindung reparieren')
    await expect(page.getByText(SETUP_TITLE)).toHaveCount(0)

    await repair.click()
    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
    await expect(page.getByTestId('source-status-notion')).toHaveText('Verbindung prüfen')
    await expect(page.getByTestId('source-repair-notion')).toBeVisible()
  })
})
