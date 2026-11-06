import { test, expect } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { settleAnimations } from './helpers/settle'

/**
 * Stack spacing (#195): the space below a collapsed stack equals the gap between two plain cards.
 * The details are a pill on the front card, so the stack's box ends at its last peek layer.
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
  task('p2', 'Plain zwei', null),
  ...[1, 2, 3].map((n) => task(`s${n}`, `Konzept ${n}`, 'Design')),
  task('p3', 'Plain drei', 'Solo'),
]

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 1000 }],
  ['mobile 390px', { width: 390, height: 1000 }],
] as const) {
  test(`gap below a collapsed stack equals the gap between plain cards, ${label}`, async ({ page, context }) => {
    await page.setViewportSize(viewport)
    await seedLocalBoard(context, SEED, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    const stack = page.locator('#column-open-list .task-stack')
    await expect(stack).toBeVisible()
    await settleAnimations(page)

    const boxes = await page.locator('#column-open-list > .task-wrapper, #column-open-list > .task-stack').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, stack: el.classList.contains('task-stack') }
      }),
    )
    const gaps = boxes.slice(1).map((b, i) => ({ gap: b.top - boxes[i]!.bottom, afterStack: boxes[i]!.stack }))
    const plain = gaps.find((g) => !g.afterStack)
    const afterStack = gaps.find((g) => g.afterStack)
    expect(plain).toBeDefined()
    expect(afterStack).toBeDefined()
    expect(Math.abs(afterStack!.gap - plain!.gap)).toBeLessThanOrEqual(1)
    // The list gap is 0.75rem (#584)
    expect(plain!.gap).toBeCloseTo(12, 0)
  })
}

for (const [column, status] of [['open', 0], ['waiting', 2], ['done', 3]] as const) {
  test(`the soft pill is centred on the front card, ${column} column (#195, #371)`, async ({ page, context }) => {
    const seed = SEED.map((t) => ({ ...t, status }))
    await seedLocalBoard(context, seed, {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    const stack = page.locator(`#column-${column}-list .task-stack`)
    await expect(stack).toBeVisible()
    await settleAnimations(page)
    const pill = stack.locator('.task-stack-pill')
    const front = (await stack.locator('.stacked-task--top').boundingBox())!
    const box = (await pill.boundingBox())!
    expect(Math.abs(box.x + box.width / 2 - (front.x + front.width / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(box.y + box.height / 2 - (front.y + front.height / 2))).toBeLessThanOrEqual(1)
    await expect(pill).toHaveCSS('border-top-left-radius', '9999px')
    await expect(pill.locator('.task-stack-pill__count')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)') // the segments carry the fill (#504)
  })
}
