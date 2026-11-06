import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, seedNotionBoard } from './helpers/seed'

/**
 * #104: a cross-column drag must go through the shared status-change path, so it
 * syncs upstream (Notion stub) and records completion statistics like the context menu does.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)

/** Drags a card onto a target with page.mouse (see docs/testing/e2e-dnd-patterns.md). */
async function dragCardTo(page: Page, title: string, target: Locator) {
  const card = page.locator('.task-wrapper', { hasText: title }).first()
  const src = (await card.boundingBox())!
  const sx = src.x + src.width / 2
  const sy = src.y + src.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.waitForTimeout(150)
  await page.mouse.move(sx + 10, sy + 10, { steps: 3 })
  await page.waitForTimeout(300)
  const dst = (await target.boundingBox())!
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 40 })
  await page.waitForTimeout(300)
  await page.mouse.up()
}

/** Persisted completion records (pinia-plugin-persistedstate key = store id). */
async function completionTaskIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('taskStatistics')
    if (!raw) return []
    const parsed = JSON.parse(raw) as { completionRecords?: Array<{ taskId: string }> }
    return (parsed.completionRecords ?? []).map(r => r.taskId)
  })
}

async function persistedTask(page: Page, id: string) {
  return page.evaluate((taskId) => {
    const raw = localStorage.getItem('tasks-store')
    const parsed = raw ? JSON.parse(raw) as { tasks: Array<{ id: string; status: number; completedAt?: string | null }> } : { tasks: [] }
    return parsed.tasks.find(t => t.id === taskId) ?? null
  }, id)
}

test.describe('Drag between columns uses the shared status change (#104)', () => {
  test('local: drag to Erledigt records completion; the reverse drag removes it', async ({ context, page, baseURL }) => {
    await seedLocalBoard(context)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').locator('.task-wrapper')).toHaveCount(2)

    await dragCardTo(page, 'Dokumentation lesen', page.locator('#column-done .column-drop-zone'))
    await expect(column(page, 'done').getByText('Dokumentation lesen')).toBeVisible()

    await expect.poll(() => completionTaskIds(page)).toContain('seed-open-2')
    await expect.poll(async () => (await persistedTask(page, 'seed-open-2'))?.completedAt ?? null).not.toBeNull()

    // No undo toast on the drag path (#136): the reverse drag is the undo and drops the record again
    await expect(page.locator('.task-confirm')).toHaveCount(0, { timeout: 2000 })
    await dragCardTo(page, 'Dokumentation lesen', column(page, 'open').locator('.task-wrapper').first())
    await expect(column(page, 'open').getByText('Dokumentation lesen')).toBeVisible()
    await expect.poll(() => completionTaskIds(page)).not.toContain('seed-open-2')
  })

  test('notion stub: drag to Erledigt writes the Done status upstream', async ({ context, page, baseURL }) => {
    // Database/data source ids must match tests/fixtures/notion/databases.json
    await seedNotionBoard(context, undefined, { databaseId: 'db-123', dataSourceId: 'ds-123' })
    await page.goto(`${baseURL}/tasks`)
    // The stub's tasks.json replaces the seeded tasks after the first fetch
    const title = 'Fokusaufgabe vorbereiten'
    await expect(column(page, 'open').getByText(title)).toBeVisible()

    // The stub answers GET page with {}; serve the page as Notion would return it after the write,
    // otherwise the bidirectional sync parses an empty page and moves the card back.
    await page.route('**/api/notion/pages?pageId=page-1', route => route.fulfill({
      json: {
        id: 'page-1',
        properties: {
          Name: { title: [{ plain_text: title }] },
          Status: { select: { name: 'Done' } },
          Timebox: { number: 90 },
          Aufwand: { number: 60 },
        },
      },
    }))

    const updateRequest = page.waitForRequest((req) => {
      if (!req.url().includes('/api/notion/update-task')) return false
      const body = req.postDataJSON() as { properties?: Record<string, { select?: { name?: string } }> } | null
      return body?.properties?.Status?.select?.name === 'Done'
    })

    // Drop onto the existing Erledigt card (sortable target in the Done group)
    await dragCardTo(page, title, column(page, 'done').locator('.task-wrapper').first())
    await updateRequest
    await expect(column(page, 'done').getByText(title)).toBeVisible()
    await expect.poll(async () => (await persistedTask(page, 'page-1'))?.status).toBe(3)
    await expect.poll(() => completionTaskIds(page)).toContain('page-1')
  })
})
