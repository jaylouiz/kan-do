import { test, expect } from '@playwright/test'
import { LONG_TITLE, LONG_TITLE_3_LINE, longTitleStackSeed, seedLocalBoard } from './helpers/seed'
import { settleAnimations } from './helpers/settle'

/**
 * Stack pill on the front card (#371, reverses #282): the pill is centred on both axes of the front
 * card whatever the title length or the column (Offen, Erledigt); the wash is wider than the pill
 * and stays inside the card; the front card's content is muted.
 */

const TITLES = {
  '1-line': 'Kurz',
  '3-line': LONG_TITLE_3_LINE,
  'max-clamp': LONG_TITLE.repeat(4),
} as const

for (const [viewportLabel, viewport] of [
  ['desktop', { width: 1280, height: 1000 }],
  ['mobile 390px', { width: 390, height: 1000 }],
] as const) {
  for (const [column, status] of [['open', 0], ['done', 3]] as const) {
   // Topic-less front cards are grouped by priority (grouping by topic would not stack them)
   for (const [topicLabel, withTopic] of [['with topic', true], ['without topic', false]] as const) {
    for (const [titleLabel, title] of Object.entries(TITLES)) {
      test(`pill is centred on the ${titleLabel} front card ${topicLabel}, ${column}, ${viewportLabel} (#371)`, async ({ page, context }) => {
        await page.setViewportSize(viewport)
        const seed = longTitleStackSeed(status, { withTopic, frontTitle: title })
        await seedLocalBoard(context, seed, {}, { enabled: true, key: withTopic ? 'topic' : 'priority' })
        await page.goto('/tasks')
        const stack = page.locator(`#column-${column}-list .task-stack`)
        await expect(stack).toBeVisible()
        await settleAnimations(page)

        const front = (await stack.locator('.stacked-task--top').boundingBox())!
        const pill = (await stack.locator('.task-stack-pill').boundingBox())!
        const wash = (await stack.locator('.task-stack__pill-layer').boundingBox())!

        // Centred on both axes of the front card
        expect(Math.abs(pill.x + pill.width / 2 - (front.x + front.width / 2))).toBeLessThanOrEqual(1)
        expect(Math.abs(pill.y + pill.height / 2 - (front.y + front.height / 2))).toBeLessThanOrEqual(1)
        // The layer (wash box) covers the front card; the wash itself is clipped to it
        expect(wash.height).toBeGreaterThanOrEqual(front.height - 1)
        expect(wash.width).toBeGreaterThan(pill.width)
        // The card's own content is muted, the pill is not
        const content = stack.locator('.stacked-task--top > *').first()
        await expect.poll(async () => Number(await content.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.6)
        await expect(stack.locator('.task-stack-pill')).toHaveCSS('opacity', '1')
      })
    }
   }
  }
}

test('front card keeps its height when the stack expands and collapses, 390px (#282)', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  const seed = longTitleStackSeed(0, { frontTitle: TITLES['max-clamp'] })
  await seedLocalBoard(context, seed, {}, { enabled: true, key: 'topic' })
  await page.goto('/tasks')
  const stack = page.locator('#column-open-list .task-stack')
  await expect(stack).toBeVisible()
  await settleAnimations(page)
  const collapsed = (await stack.locator('.stacked-task--top').boundingBox())!.height

  await stack.locator('.task-stack__control').click()
  const first = page.locator('#column-open-list [data-from-stack][data-stack-position="first"]')
  await expect(first).toBeVisible()
  await settleAnimations(page)
  const expanded = (await first.locator('.task').boundingBox())!.height
  expect(Math.abs(expanded - collapsed)).toBeLessThanOrEqual(1)
})

/**
 * Split-capsule pill (#504): the property segment is capped at 10rem and truncates, the count segment
 * never shrinks, and the capsule stays inside the stack, on desktop and at 390px.
 */
for (const [viewportLabel, viewport] of [
  ['desktop', { width: 1280, height: 1000 }],
  ['mobile 390px', { width: 390, height: 1000 }],
] as const) {
  test(`pill caps a long topic at 10rem and keeps the count whole, ${viewportLabel} (#504)`, async ({ page, context }) => {
    await page.setViewportSize(viewport)
    const seed = longTitleStackSeed(0).map((t) => ({ ...t, topic: 'Kundenprojekt Hausverwaltung Süd' }))
    await seedLocalBoard(context, seed, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    const stack = page.locator('#column-open-list .task-stack')
    await expect(stack).toBeVisible()
    await settleAnimations(page)

    const pill = stack.locator('.task-stack-pill')
    const prop = (await pill.locator('.task-stack-pill__prop').boundingBox())!
    const count = (await pill.locator('.task-stack-pill__count').boundingBox())!
    const box = (await pill.boundingBox())!
    const front = (await stack.locator('.stacked-task--top').boundingBox())!
    const rem = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))

    // Property segment capped at 10rem, name truncated with an ellipsis
    expect(prop.width).toBeLessThanOrEqual(10 * rem + 1)
    const text = pill.locator('.task-stack-pill__text')
    expect(await text.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    // Count segment: icon and number, no word, never squeezed
    await expect(pill.locator('.task-stack-pill__count')).toHaveText('3')
    expect(count.width).toBeLessThan(60)
    // One capsule within the stack, centred on the front card, hairline between the segments
    expect(box.width).toBeLessThanOrEqual(front.width)
    expect(Math.abs(box.x + box.width / 2 - (front.x + front.width / 2))).toBeLessThanOrEqual(1)
    await expect(pill.locator('.task-stack-pill__count')).toHaveCSS('border-inline-start-width', '1px')
    // The full name stays in the control's accessible name
    await expect(stack.locator('.task-stack__control')).toHaveAttribute('aria-label', /Kundenprojekt Hausverwaltung Süd/)
  })
}
