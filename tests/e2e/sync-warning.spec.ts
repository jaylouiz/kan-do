import { test, expect, type Page } from '@playwright/test'
import { seedMixedBoard, fillerTasks, MIXED_SEED_TASKS, type SeedTask } from './helpers/seed'

/**
 * The sync warning (#337, per source in #318): when a source returns far fewer tasks than the board holds
 * for it, a dialog names the source and the fetch waits for the user's choice. Cancel keeps the board,
 * the confirmation applies the result. Local tasks never take part. The Notion stub returns its four
 * fixture pages, so 30 extra Notion tasks on the board make a drop of 88%.
 */

const NOTION_EXTRAS: SeedTask[] = fillerTasks(30).map((task) => ({ ...task, title: `Notion-Altlast ${task.title}`, source: 'notion', externalId: task.id }))

const storedTasks = (page: Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; source: string }> }
  return raw.tasks ?? []
})

test.describe('Sync warning per source (#337, #318)', () => {
  test('a Notion drop opens the warning, naming Notion and counting only Notion tasks', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Sync-Warnung')).toBeVisible()
    await expect(dialog.getByText('nur 4 von 34 Aufgaben aus Notion')).toBeVisible()
    await expect(dialog.getByText('Notion-Aufgaben auf dem Board: 34')).toBeVisible()
  })

  test('cancelling keeps the Notion tasks and the Local tasks on the board', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog).toBeHidden()

    const tasks = await storedTasks(page)
    expect(tasks.filter((task) => task.source === 'notion')).toHaveLength(34)
    expect(tasks.filter((task) => task.source === 'local')).toHaveLength(3)
  })

  test('confirming resumes the fetch: the Notion tasks follow the source, Local stays', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...NOTION_EXTRAS])
    await page.goto(`${baseURL}/tasks`)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Sync trotzdem durchführen' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await storedTasks(page)).filter((task) => task.source === 'notion').length).toBe(4)
    expect((await storedTasks(page)).filter((task) => task.source === 'local')).toHaveLength(3)
  })

  test('many Local tasks never raise the warning', async ({ context, page, baseURL }) => {
    const localExtras: SeedTask[] = fillerTasks(30).map((task) => ({ ...task, source: 'local', externalId: null }))
    await seedMixedBoard(context, [...MIXED_SEED_TASKS, ...localExtras])
    const notionFetch = page.waitForResponse((res) => res.url().includes('/api/notion/query-data-source'))
    await page.goto(`${baseURL}/tasks`)
    await notionFetch

    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
