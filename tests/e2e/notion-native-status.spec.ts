import { test, expect, type Page } from '@playwright/test'
import { seedNotionBoard } from './helpers/seed'
import { NOTION_STUB_API_KEY } from './helpers/constants'
import { openAddSheet } from './helpers/addSheet'

/**
 * A Notion database whose status column is the native Status type (#312). The stub token flag
 * `status=native` serves a native-Status schema and pages and rejects select-shaped filters and
 * writes with a 400 (502 through the proxy) the way Notion does, so a regression of the
 * detection fails here: the board would not load and no write would stick.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const TITLE = 'Fokusaufgabe vorbereiten' // page-1 in tests/fixtures/notion/tasks.json (Today → Offen)

const nativeToken = () => `${NOTION_STUB_API_KEY}:status=native:${crypto.randomUUID()}`

/** Drags a card onto a target with page.mouse (see docs/testing/e2e-dnd-patterns.md). */
async function dragCardTo(page: Page, title: string, targetSelector: string) {
  const src = (await page.locator('.task-wrapper', { hasText: title }).first().boundingBox())!
  const sx = src.x + src.width / 2
  const sy = src.y + src.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.move(sx + 10, sy + 10, { steps: 3 })
  await page.waitForTimeout(300)
  const dst = (await page.locator(targetSelector).boundingBox())!
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 40 })
  await page.waitForTimeout(300)
  await page.mouse.up()
}

test.describe('Notion native Status property', () => {
  test('loads the board and a drag Offen → Wartet writes a status value that reads back', async ({ context, page, baseURL }) => {
    const token = nativeToken()
    await seedNotionBoard(context, [], { token })

    const queries: Array<{ filter?: { or?: Array<Record<string, unknown>> } }> = []
    page.on('request', (req) => {
      if (req.url().endsWith('/api/notion/query-data-source') && req.method() === 'POST') queries.push(req.postDataJSON())
    })
    const updateRequest = page.waitForRequest((req) => req.url().includes('/api/notion/update-task'))

    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()
    expect(queries[0]?.filter?.or?.[0]).toEqual({ property: 'Status', status: { equals: 'Today' } })

    // Not Jetzt: the fixture already has a Doing task there and the WIP limit refuses a second one
    await dragCardTo(page, TITLE, '#column-waiting-list .task-wrapper')
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()

    expect((await updateRequest).postDataJSON().properties.Status).toEqual({ status: { name: 'Waiting' } })
    await expect
      .poll(async () => {
        const res = await page.request.get('/api/notion/pages?pageId=page-1', { headers: { Authorization: `Bearer ${token}` } })
        return (await res.json()).properties.Status?.status?.name
      })
      .toBe('Waiting')

    await page.reload()
    await expect(column(page, 'waiting').getByText(TITLE)).toBeVisible()
  })

  test('creating a task writes a status value the stub accepts', async ({ context, page, baseURL }) => {
    const token = nativeToken()
    await seedNotionBoard(context, [], { token })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()

    const createRequest = page.waitForRequest((req) => req.url().includes('/api/notion/create-task'))
    const created = page.waitForResponse((res) => res.url().includes('/api/notion/create-task'))
    await openAddSheet(page)
    const titleInput = page.locator('input[name="title"]')
    await titleInput.fill('Neue native Aufgabe')
    await titleInput.press('Enter')

    expect((await createRequest).postDataJSON().properties.Status).toEqual({ status: { name: 'Today' } })
    await page.waitForURL((url) => !url.toString().includes('/tasks/add'))
    await expect(column(page, 'open').getByText('Neue native Aufgabe')).toBeVisible()

    const { pageId } = await (await created).json()
    const read = await page.request.get(`/api/notion/pages?pageId=${pageId}`, { headers: { Authorization: `Bearer ${token}` } })
    expect((await read.json()).properties.Status).toEqual({ status: { name: 'Today' } })
  })

  test('the default stub stays a select database', async ({ context, page, baseURL }) => {
    await seedNotionBoard(context, [])
    const queries: Array<{ filter?: { or?: Array<Record<string, unknown>> } }> = []
    page.on('request', (req) => {
      if (req.url().endsWith('/api/notion/query-data-source') && req.method() === 'POST') queries.push(req.postDataJSON())
    })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(TITLE)).toBeVisible()
    expect(queries[0]?.filter?.or?.[0]).toEqual({ property: 'Status', select: { equals: 'Today' } })
  })
})
