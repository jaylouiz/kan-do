import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { settleStack } from './helpers/settle'

/**
 * A fast double-click on a collapsed stack (#111, #147): it expands, leaves no drag state or
 * inline styles behind, and an expanded member can still be dragged like any other card.
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

test.describe('Task stack: fast double-click', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, TASKS, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
  })

  test('does not get stuck in a drag state after a fast double-click', async ({ page }) => {
    await stack(page).dblclick()
    await expect(members(page)).toHaveCount(2)
    await settleStack(page)

    // No sheet, no drag classes, no inline drag styles on the cards
    expect(page.url()).not.toContain('/tasks/task-')
    for (const dragClass of ['kando-dnd-dragged', 'kando-dnd-placeholder']) {
      await expect(page.locator(`.${dragClass}`)).toHaveCount(0)
    }
    for (const card of await members(page).all()) {
      const style = await card.locator('.task').evaluate((el) => ({ transform: el.style.transform, position: el.style.position }))
      expect(style).toEqual({ transform: '', position: '' })
    }

    // Outside click collapses it again: the stack is back with both cards in order
    await page.click('body', { position: { x: 100, y: 100 } })
    await expect(stack(page)).toHaveCount(1)
    await expect(stack(page).locator('.task')).toHaveCount(2)
    await expect(stack(page).locator('.task').first()).toHaveAttribute('data-stack-index', '0')
    await expect(stack(page).locator('.task').nth(1)).toHaveAttribute('data-stack-index', '1')
  })

  test('an expanded card can be dragged like any other card', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(2)
    await settleStack(page)

    const card = members(page).first()
    const box = (await card.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 3 })

    // The board gets 'dragging' while any drag is active
    await expect(page.locator('.board')).toHaveClass(/dragging/, { timeout: 3000 })
    await page.mouse.up()

    await expect(page.locator('.board')).not.toHaveClass(/dragging/)
    await expect(members(page)).toHaveCount(2)
  })
})
