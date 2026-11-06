import { test, expect, type Page } from '@playwright/test'
import { seedNotionBoard } from './helpers/seed'
import { NOTION_STUB_API_KEY } from './helpers/constants'

/**
 * Notion sync follows the query cursor (#311): a data source with more than 100 matching pages
 * reaches the store completely, not only the first page of 100. The stub token flag
 * `pages=<n>` pads the session with synthetic Today tasks up to n pages in total (the fixture
 * has 4); the board path is the browser proxy (`/api/notion/query-data-source`).
 */

const TOTAL = 130

const storedTaskIds = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('tasks-store')
    const tasks = raw ? (JSON.parse(raw).tasks as Array<{ id: string }>) : []
    return tasks.map((task) => task.id)
  })

test.describe('Notion sync pagination', () => {
  test('a data source with 130 matches reaches the store completely', async ({ context, page, baseURL }) => {
    const token = `${NOTION_STUB_API_KEY}:pages=${TOTAL}:${crypto.randomUUID()}`
    await seedNotionBoard(context, [], { token })

    const queries: Array<{ start_cursor?: string; page_size?: number }> = []
    page.on('request', (req) => {
      if (req.url().endsWith('/api/notion/query-data-source') && req.method() === 'POST') {
        queries.push(req.postDataJSON())
      }
    })

    await page.goto(`${baseURL}/tasks`)

    await expect.poll(async () => (await storedTaskIds(page)).length).toBe(TOTAL)
    const ids = await storedTaskIds(page)
    expect(new Set(ids).size).toBe(TOTAL)
    expect(ids).toContain('page-1')
    expect(ids).toContain(`stub-filler-${String(TOTAL - 4).padStart(3, '0')}`)

    // first request without a cursor, the follow-up carries the one the stub handed out
    expect(queries[0]?.start_cursor).toBeUndefined()
    expect(queries.some((query) => query.start_cursor !== undefined)).toBe(true)
    expect(queries.every((query) => query.page_size === 100)).toBe(true)
  })

  test('a single page of results needs exactly one query', async ({ context, page, baseURL }) => {
    await seedNotionBoard(context)

    const queries: string[] = []
    page.on('request', (req) => {
      if (req.url().endsWith('/api/notion/query-data-source') && req.method() === 'POST') {
        queries.push(req.postData() ?? '')
      }
    })

    await page.goto(`${baseURL}/tasks`)
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()

    expect(queries.length).toBeGreaterThan(0)
    expect(queries.every((body) => !body.includes('start_cursor'))).toBe(true)
  })
})
