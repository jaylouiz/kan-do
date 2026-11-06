/**
 * Wide-screen board layout (#122): column tracks are capped at --board-column-max and centred.
 */
import { test, expect } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context)
})

test.describe('wide board layout', () => {
  test.use({ viewport: { width: 2560, height: 1000 } })

  test('columns stay a compact centred group at 2560px', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list')).toBeVisible()

    const maxPx = await page.evaluate(() => {
      const el = document.createElement('div')
      el.style.width = 'var(--board-column-max)'
      document.body.appendChild(el)
      const w = el.getBoundingClientRect().width
      el.remove()
      return w
    })
    const board = (await page.locator('.board').boundingBox())!
    const open = (await page.locator('#column-open').boundingBox())!
    const done = (await page.locator('#column-done').boundingBox())!

    expect(board.width).toBe(2560)
    expect(open.width).toBeCloseTo(maxPx, 0)
    expect(done.width).toBeCloseTo(maxPx, 0)
    const left = open.x
    const right = 2560 - (done.x + done.width)
    expect(left).toBeGreaterThan(300)
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
  })

  test('drag Open to Waiting via page.mouse at 2560px', async ({ page }) => {
    await page.goto('/tasks')
    const card = page.locator('#column-open-list .task-wrapper').first()
    await expect(card).toBeVisible()
    const id = await card.getAttribute('data-task-id')
    const box = await card.boundingBox()
    if (!box) throw new Error('task card has no bounding box')
    const sx = box.x + box.width / 2
    const sy = box.y + box.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx + 10, sy + 10, { steps: 3 })
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(1)
    const dz = await page.locator('#column-waiting-list .column-drop-zone').boundingBox()
    if (!dz) throw new Error('waiting drop zone has no bounding box')
    await page.mouse.move(dz.x + dz.width / 2, dz.y + dz.height / 2, { steps: 40 })
    await expect(page.locator('#column-waiting-list .kando-dnd-dragged')).toHaveCount(1)
    await page.mouse.up()
    await expect(page.locator(`#column-waiting-list .task-wrapper[data-task-id="${id}"]`)).toHaveCount(1)
    await expect(page.locator(`#column-open-list .task-wrapper[data-task-id="${id}"]`)).toHaveCount(0)
  })
})
