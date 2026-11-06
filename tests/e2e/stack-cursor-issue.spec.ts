import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { settleStack } from './helpers/settle'

/**
 * Cursor of stack cards (#111, #147): no drag cursor after a fast double-click, and a grab cursor
 * only while an expanded card is actually dragged.
 */

const NOW = new Date().toISOString()
const task = (id: string, title: string): SeedTask => ({
  id,
  title,
  status: 0,
  priority: 1,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  topic: 'Design',
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
})

const TASKS = [task('task-1', 'First Task'), task('task-2', 'Second Task')]

const stack = (page: Page) => page.locator('#column-open-list .task-stack')
const members = (page: Page) => page.locator('#column-open-list .task-wrapper[data-from-stack="Design"]')
const cursorOf = (locator: ReturnType<Page['locator']>) => locator.evaluate((el) => getComputedStyle(el).cursor)

test.describe('Task stack: cursor', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, TASKS, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
  })

  test('shows no drag cursor after a fast double-click', async ({ page }) => {
    await stack(page).dblclick()
    await expect(members(page)).toHaveCount(2)
    await settleStack(page)

    const first = members(page).first().locator('.task')
    expect(['auto', 'pointer', 'default']).toContain(await cursorOf(first))
    await first.hover()
    expect(['auto', 'pointer', 'default']).toContain(await cursorOf(first))
  })

  test('shows a grab cursor only while a card is dragged', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(2)
    await settleStack(page)

    const card = members(page).first()
    const box = (await card.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(card.locator('.task')).not.toHaveCSS('cursor', 'grabbing')
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 3 })
    await expect(page.locator('.board')).toHaveClass(/dragging/, { timeout: 3000 })
    await expect(page.locator('.kando-dnd-preview')).toHaveCSS('cursor', 'grabbing')

    await page.mouse.up()
    await expect(page.locator('.board')).not.toHaveClass(/dragging/)
    await expect(members(page).first().locator('.task')).not.toHaveCSS('cursor', 'grabbing')
  })
})
