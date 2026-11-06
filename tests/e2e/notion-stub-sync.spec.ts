import { test, expect, type Page } from '@playwright/test'
import { seedNotionBoard, DEFAULT_NOTION_SEED_CONFIG } from './helpers/seed'

/**
 * The server-side Notion stub keeps page state per session token: a status write is
 * read back by the app's bidirectional sync and survives a reload (fresh data-source query).
 * Uses seedNotionBoard defaults only — they must match tests/fixtures/notion/databases.json.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const TITLE = 'Fokusaufgabe vorbereiten' // page-1 in tests/fixtures/notion/tasks.json (Today → Offen)

async function moveTo(page: Page, title: string, target: string) {
  await page.locator('.task-wrapper', { hasText: title }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: target, exact: true }).click()
}

test.describe('Notion stub page state', () => {
  test('seed defaults load the stub board and a status write sticks', async ({ context, page, baseURL }) => {
    await seedNotionBoard(context)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()

    const readBack = page.waitForResponse((res) => res.url().includes('/api/notion/pages?pageId=page-1'))
    await moveTo(page, TITLE, 'Warten')
    await readBack
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(0)

    await page.reload()
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()
  })

  test('a new test starts from the fixture again', async ({ context, page, baseURL }) => {
    await seedNotionBoard(context)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()
  })
})

test.describe('Custom property the task has no entry for yet (#184)', () => {
  const config = {
    propertyMapping: {
      ...DEFAULT_NOTION_SEED_CONFIG.propertyMapping,
      customProperties: [{ key: 'kommentar', name: 'Kommentar', type: 'text', enabled: true }],
    },
  }

  test('a value typed into the empty row is kept, synced and survives a reload', async ({ context, page, baseURL }) => {
    await seedNotionBoard(context, undefined, config)
    await page.goto(`${baseURL}/tasks/page-1`)
    await expect(page.getByRole('dialog')).toBeVisible()
    const row = page.getByTestId('task-property-row').filter({ hasText: 'Kommentar' })
    await expect(row).toBeVisible()

    const write = page.waitForRequest((req) => req.url().includes('/api/notion/update-task'))
    await row.getByRole('button', { name: /^Kommentar: / }).click()
    const input = row.getByRole('textbox', { name: 'Kommentar' })
    await input.fill('Erster Stand')
    await input.press('Enter')

    expect(JSON.stringify((await write).postDataJSON())).toContain('Erster Stand')
    await expect(row.getByRole('button', { name: 'Kommentar: Erster Stand' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(
      page.getByTestId('task-property-row').filter({ hasText: 'Kommentar' }).getByRole('button', { name: 'Kommentar: Erster Stand' }),
    ).toBeVisible()
  })

  test('saving an empty value on the missing row syncs nothing', async ({ context, page, baseURL }) => {
    await seedNotionBoard(context, undefined, config)
    await page.goto(`${baseURL}/tasks/page-1`)
    await expect(page.getByRole('dialog')).toBeVisible()
    const row = page.getByTestId('task-property-row').filter({ hasText: 'Kommentar' })
    const writes: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/notion/update-task')) writes.push(req.url())
    })
    await row.getByRole('button', { name: /^Kommentar: / }).click()
    const input = row.getByRole('textbox', { name: 'Kommentar' })
    await input.fill('')
    await input.press('Enter')

    await expect(row).toBeVisible()
    await page.waitForTimeout(500)
    expect(writes).toEqual([])
  })
})
