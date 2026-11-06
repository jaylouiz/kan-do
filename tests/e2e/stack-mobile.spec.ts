import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { finger, activeColumnPage } from './helpers/dnd'
import { settleAnimations, settleStack, flushFrames, dwell } from './helpers/settle'
import { EDGE_HOLD_DWELL_MS } from './helpers/constants'

/**
 * Stacks at 390px (#147): a tap expands a stack, a tap on a member opens its sheet, a tap outside
 * collapses, press-and-hold drags a member, and the edge-scroll column switch still works while a
 * member is dragged. Touches are real CDP touch events, like in mobile-swipe.spec.ts.
 */

const NOW = new Date().toISOString()
const task = (o: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 1,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  topic: null,
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
})

const OPEN = [
  task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
  task({ id: 'a1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
  task({ id: 'a2', title: 'Farben abstimmen', status: 0, topic: 'Design' }),
  task({ id: 'a3', title: 'Raster festlegen', status: 0, topic: 'Design' }),
]

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

const stack = (page: Page) => page.locator('#column-open-list .task-stack')
const members = (page: Page) => page.locator('#column-open-list .task-wrapper[data-from-stack="Design"]')
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const order = (page: Page) =>
  page
    .locator('#column-open-list')
    .locator(':scope > .task-wrapper, :scope > .task-stack')
    .evaluateAll((els) => els.map((el) => `${el.classList.contains('task-stack') ? 'stack:' : ''}${el.getAttribute('data-task-id')}`))

test.beforeEach(async ({ context, page }) => {
  await seedLocalBoard(context, OPEN, {}, { enabled: true, key: 'topic' })
  await page.goto('/tasks')
  await expect(stack(page)).toBeVisible()
})

test('a tap expands the stack, a tap on a member opens its sheet', async ({ page }) => {
  await stack(page).tap()
  await expect(members(page)).toHaveCount(3)
  expect(page.url()).not.toContain('/tasks/a')

  await settleStack(page)
  await members(page).nth(1).locator('.task').tap()
  await expect(page).toHaveURL(/\/tasks\/a2/)
})

test('a double-tap on a collapsed stack expands it and opens no sheet; the second tap carries click.detail >= 2 (#154, 4d)', async ({ context, page }) => {
  const touch = finger(await context.newCDPSession(page), page)
  await page.evaluate(() => {
    const clicks: number[] = []
    ;(window as unknown as { __clickDetails: number[] }).__clickDetails = clicks
    document.addEventListener('click', (event) => clicks.push(event.detail), true)
  })
  const box = (await stack(page).boundingBox())!
  // a point in the lower half of the front card: after the expand the first member sits there
  const x = box.x + box.width / 2
  const y = box.y + 70

  await touch.start(x, y)
  await touch.end()
  await expect(members(page)).toHaveCount(3)
  const target = await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest('.task')?.getAttribute('data-task-id') ?? null, [x, y])
  expect(target).not.toBeNull() // the second tap lands on a member's card

  await touch.start(x, y)
  await touch.end()
  const readDetails = () => page.evaluate(() => (window as unknown as { __clickDetails: number[] }).__clickDetails)
  await expect.poll(async () => (await readDetails()).length).toBeGreaterThanOrEqual(2) // both taps' clicks have run
  await settleAnimations(page)

  const details = await readDetails()
  // Playwright's touch emulation reports the sequence; iOS Safari is checked by hand (PR description)
  console.log('click.detail of the two taps:', JSON.stringify(details))
  expect(details.at(-1)).toBeGreaterThanOrEqual(2)
  expect(page.url()).not.toContain('/tasks/a')
  await expect(members(page)).toHaveCount(3)
})

test('expansion stays when the page changes without a tap on the tab bar: swiping away and back (#154)', async ({ context, page }) => {
  const touch = finger(await context.newCDPSession(page), page)
  await stack(page).tap()
  await expect(members(page)).toHaveCount(3)

  // A tap on the tab bar would be an outside tap and collapse the stack; a swipe is not a click
  await touch.start(300, 400)
  await touch.moveTo(80, 410, 12)
  await touch.end()
  await expect.poll(() => activeColumnPage(page)).toBe(1)
  await touch.start(80, 400)
  await touch.moveTo(300, 410, 12)
  await touch.end()
  await expect.poll(() => activeColumnPage(page)).toBe(0)

  await expect(members(page)).toHaveCount(3)
  await expect(stack(page)).toHaveCount(0)
})

test('the header row fits 390px: pill and round X side by side, same pill width as collapsed, a 44px tap target that collapses (#578)', async ({ page }) => {
  const collapsedPill = (await stack(page).locator('.task-stack-pill').boundingBox())!
  await stack(page).tap()
  await expect(members(page)).toHaveCount(3)
  const header = page.locator('#column-open-list .task-stack-header')
  const close = header.getByRole('button', { name: 'Gruppe Design schließen' })
  await expect(header.locator('.task-stack-caption')).toHaveCount(0)
  await settleStack(page)
  const pill = (await header.locator('.task-stack-pill').boundingBox())!
  expect(Math.abs(pill.width - collapsedPill.width)).toBeLessThan(0.5)
  const box = (await close.boundingBox())!
  expect(Math.round(box.width)).toBe(24)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  expect(box.x).toBeGreaterThanOrEqual(pill.x + pill.width)
  // the 44px hit area: a tap 10px beside the 24px button still closes
  const headerBox = (await header.boundingBox())!
  expect(headerBox.height).toBeGreaterThanOrEqual(44)

  await close.tap({ position: { x: 12, y: 12 } })
  await expect(stack(page)).toHaveCount(1)
  await expect(header).toHaveCount(0)
})

test('a tap outside collapses the stack', async ({ page }) => {
  await stack(page).tap()
  await expect(members(page)).toHaveCount(3)
  await settleStack(page)

  // The column heading is outside every card
  await page.locator('#column-open h2').tap()
  await expect(stack(page)).toHaveCount(1)
  await expect(members(page)).toHaveCount(0)
})

test('press-and-hold drags a member within the group', async ({ context, page }) => {
  const touch = finger(await context.newCDPSession(page), page)
  await stack(page).tap()
  await expect(members(page)).toHaveCount(3)
  await settleStack(page)

  const from = (await card(page, 'a1').boundingBox())!
  const to = (await card(page, 'a3').boundingBox())!
  await touch.start(from.x + 40, from.y + from.height / 2)
  await expect(page.locator('.board.dragging')).toHaveCount(1)
  await touch.moveTo(to.x + 40, to.y + to.height - 12, 14, 20)
  await expect(members(page).last()).toHaveClass(/kando-dnd-dragged/) // the placeholder reached its slot
  await touch.end()

  await expect.poll(() => order(page)).toEqual(['u1', 'a2', 'a3', 'a1'])
  await expect(page.locator('.board.dragging')).toHaveCount(0)
  await expect(members(page)).toHaveCount(3)
})

test('the edge-scroll column switch still triggers while a member is dragged', async ({ context, page }) => {
  const touch = finger(await context.newCDPSession(page), page)
  await stack(page).tap()
  await expect(members(page)).toHaveCount(3)
  await settleStack(page)

  const from = (await card(page, 'a2').boundingBox())!
  await touch.start(from.x + 40, from.y + from.height / 2)
  await expect(page.locator('.board.dragging')).toHaveCount(1)
  await touch.moveTo(385, from.y + from.height / 2, 10, 20)
  await dwell(page, EDGE_HOLD_DWELL_MS) // past EDGE_HOLD_MS in the edge zone

  await expect.poll(() => activeColumnPage(page)).toBe(1)
  await touch.end()
})

test('a collapsed stack: a tap still expands it, a press-and-hold drags the whole stack, the edge dwell switches the column and Jetzt stays refused (#150)', async ({ context, page }) => {
  const touch = finger(await context.newCDPSession(page), page)
  const box = (await stack(page).boundingBox())!

  await touch.start(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.board.dragging')).toHaveCount(1)
  await expect(stack(page)).toHaveClass(/kando-dnd-dragged/)
  await expect(page.locator('.kando-dnd-preview.task-stack .task-stack__caption')).toHaveText('Design3')

  // Edge dwell: Offen -> the shared Jetzt/Wartet tab. useBoardSwipe stands down, the drag goes on.
  await touch.moveTo(385, box.y + box.height / 2, 10, 20)
  await dwell(page, EDGE_HOLD_DWELL_MS)
  await expect.poll(() => activeColumnPage(page)).toBe(1)
  await touch.moveTo(200, 400, 8, 20)
  await expect(page.locator('.kando-dnd-preview')).toBeVisible()
  await flushFrames(page)
  // Jetzt refuses a stack even though it is empty: no placeholder in it
  await expect(page.locator('#column-progress-list .kando-dnd-dragged')).toHaveCount(0)
  await touch.end()

  await expect(page.locator('.board.dragging')).toHaveCount(0)
  await expect(page.locator('#column-progress-list .task-wrapper, #column-progress-list .task-stack')).toHaveCount(0)
  await expect(page.locator('.task[data-task-id="a1"]').first()).toBeAttached()
  await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  // a drag never expands the stack
  await expect(members(page)).toHaveCount(0)
})
