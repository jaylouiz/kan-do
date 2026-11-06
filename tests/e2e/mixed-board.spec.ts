import { test, expect, type Page } from '@playwright/test'
import { seedMixedBoard, MIXED_SEED_TASKS } from './helpers/seed'

/**
 * Smoke for the mixed-board seed (#326, epic #264): Local and Notion tasks side by side. The Notion
 * fetch replaces only the Notion source's tasks, so the Local ones must still be on the board after it.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)

const storedTasks = (page: Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; source: string; externalId: string | null }> }
  return raw.tasks ?? []
})

test.describe('Mixed board seed (#326)', () => {
  test('seedMixedBoard shows Local and Notion tasks, and a Notion fetch leaves the Local ones alone', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context)
    const notionFetch = page.waitForResponse((res) => res.url().includes('/api/notion/query-data-source'))
    await page.goto(`${baseURL}/tasks`)
    await notionFetch // the Notion source was fetched and merged; only its tasks were replaced

    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()
    await expect(column(page, 'waiting').getByText('Lokal: Antwort abwarten')).toBeVisible()
    await expect(column(page, 'done').getByText('Lokal: Wäsche erledigt')).toBeVisible()

    const tasks = await storedTasks(page)
    expect(tasks).toHaveLength(MIXED_SEED_TASKS.length)
    expect(tasks.filter(t => t.source === 'local').every(t => t.externalId === null)).toBe(true)
    expect(tasks.filter(t => t.source === 'notion').every(t => t.externalId === t.id)).toBe(true)
    const board = await page.evaluate(() => JSON.parse(localStorage.getItem('board-store') ?? '{}'))
    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'notion' })
  })

  test('defaultSource local keeps Local as the default and syncs no Notion tasks away', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local' })
    await page.goto(`${baseURL}/tasks`)

    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    const board = await page.evaluate(() => JSON.parse(localStorage.getItem('board-store') ?? '{}'))
    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
  })

  test('?seed=mixed seeds the same board in the dev server', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks?seed=mixed`)
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    expect((await storedTasks(page)).map(t => t.source).sort()).toEqual(['local', 'local', 'local', 'notion', 'notion', 'notion', 'notion'])
  })

  test('?seed=mixed&default=local makes Local the default source', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks?seed=mixed&default=local`)
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()
    const board = await page.evaluate(() => JSON.parse(localStorage.getItem('board-store') ?? '{}'))
    expect(board.boardConfig.sources.default).toBe('local')
  })
})
