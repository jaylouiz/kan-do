import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { settleAnimations } from './helpers/settle'
import { pickUp } from './helpers/dnd'

/**
 * Stack width (#641): a collapsed stack and an expanded stack's header follow their column down like a
 * card does (`min(var(--task-stack-width), 100%)`), instead of keeping the 18rem of a wide window. At the
 * desktop app's 800px window the column is 267px and the card 187px.
 */

const NOW = new Date().toISOString()
const task = (id: string, title: string, topic: string | null): SeedTask => ({
  id,
  title,
  status: 0,
  priority: 1,
  activity: null,
  topic,
  topicColorCode: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
})

const SEED = [
  task('p1', 'Plain eins', null),
  ...[1, 2, 3].map((n) => task(`s${n}`, `Konzept ${n}`, 'Design')),
]

const LIST = '#column-open-list'

const width = async (loc: Locator) => (await loc.boundingBox())!

async function openBoard(page: Page, context: Parameters<typeof seedLocalBoard>[0], viewportWidth: number) {
  await page.setViewportSize({ width: viewportWidth, height: 1000 })
  await seedLocalBoard(context, SEED, {}, { enabled: true, key: 'topic' })
  await page.goto('/tasks')
  await expect(page.locator(`${LIST} .task-stack`)).toBeVisible()
  await settleAnimations(page)
}

for (const [label, viewportWidth, cardWidth] of [
  ['800px desktop app window', 800, 187],
  ['1280px desktop', 1280, 288],
  ['390px mobile', 390, 280],
] as const) {
  test(`a collapsed stack is as wide as a plain card in its column, ${label} (#641)`, async ({ page, context }) => {
    await openBoard(page, context, viewportWidth)
    const card = await width(page.locator(`${LIST} .task-wrapper .task`).first())
    const stack = await width(page.locator(`${LIST} .task-stack`))
    const column = await width(page.locator(LIST))

    expect(Math.abs(stack.width - card.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(stack.x - card.x)).toBeLessThanOrEqual(1)
    expect(stack.x + stack.width).toBeLessThanOrEqual(column.x + column.width + 1)
    expect(stack.x).toBeGreaterThanOrEqual(column.x - 1)
    expect(card.width).toBeCloseTo(cardWidth, -1)
  })
}

test('an expanded stack header is as wide as the cards under it at 800px (#641)', async ({ page, context }) => {
  await openBoard(page, context, 800)
  await page.locator(`${LIST} .task-stack__control`).click()
  const header = page.locator(`${LIST} [data-stack-header="Design"]`)
  await expect(header).toBeVisible()
  await settleAnimations(page)

  const head = await width(header)
  const member = await width(page.locator(`${LIST} .task-wrapper .task`).nth(1))
  const column = await width(page.locator(LIST))
  expect(Math.abs(head.width - member.width)).toBeLessThanOrEqual(1)
  expect(head.x + head.width).toBeLessThanOrEqual(column.x + column.width + 1)
  const close = await width(header.locator('button'))
  expect(close.x + close.width).toBeLessThanOrEqual(head.x + head.width + 1)
})

test('the floating stack face has the width of the stack it was lifted from at 800px (#641)', async ({ page, context }) => {
  await openBoard(page, context, 800)
  const stack = page.locator(`${LIST} .task-stack`)
  const source = (await width(stack)).width
  await pickUp(page, stack)
  // offsetWidth ignores the preview's 2deg tilt, which widens its bounding box
  const preview = await page.locator('.kando-dnd-preview.task-stack').evaluate((el) => (el as HTMLElement).offsetWidth)
  expect(Math.abs(preview - source)).toBeLessThanOrEqual(1)
  await page.mouse.up()
})
