import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { focusUntilActive, settleAnimations, settleStack } from './helpers/settle'

/**
 * Opening cards of a stack (#111, #147): a double-click on a collapsed stack expands it and never
 * opens a sheet; an expanded member behaves like any other card (a click opens it, #25).
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

const TASKS = [task('task-1', 'First Task'), task('task-2', 'Second Task'), task('task-3', 'Third Task')]

const stack = (page: Page) => page.locator('#column-open-list .task-stack')
const members = (page: Page) => page.locator('#column-open-list .task-wrapper[data-from-stack="Design"]')

test.describe('Task stack: opening cards', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, TASKS, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    await expect(stack(page)).toBeVisible()
  })

  test('double-clicking a collapsed stack expands it and opens no sheet', async ({ page }) => {
    await stack(page).dblclick()
    await expect(members(page)).toHaveCount(3)
    await settleAnimations(page)

    expect(page.url()).not.toContain('/tasks/task-')
    await expect(stack(page)).toHaveCount(0)
    await expect(members(page)).toHaveCount(3)
  })

  test('a slow double-click on a collapsed stack opens no sheet either (#154)', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
    await settleStack(page) // past the old 300ms guard: the expand beat is over

    await page.evaluate(() => {
      const clicks: number[] = []
      ;(window as unknown as { __clickDetails: number[] }).__clickDetails = clicks
      document.addEventListener('click', (event) => clicks.push(event.detail), true)
    })
    // The second click of the sequence: one press that carries click count 2
    const box = (await members(page).first().locator('.task').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ clickCount: 2 })
    await page.mouse.up({ clickCount: 2 })
    // Positive signal: the click reached the page, so the negative below cannot pass before the handler ran
    await expect.poll(() => page.evaluate(() => (window as unknown as { __clickDetails: number[] }).__clickDetails.at(-1))).toBe(2)
    await settleAnimations(page)

    expect(page.url()).not.toContain('/tasks/task-')
    await expect(members(page)).toHaveCount(3)
  })

  test('clicking a member of an expanded stack opens its sheet (#25)', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)

    // A new click sequence ends the post-expand guard: no waiting needed (#154)
    await members(page).first().locator('.task').click()

    await page.waitForURL(/\/tasks\/task-1/)
    await expect(page.locator('[aria-labelledby="notes-heading"]')).toBeVisible()
  })

  test('Enter on a focused member opens its sheet', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)

    await focusUntilActive(members(page).nth(1))
    await page.keyboard.press('Enter')

    await page.waitForURL(/\/tasks\/task-2/)
  })
})
