import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp } from './helpers/dnd'
import { closeMore, openMore } from './helpers/appNav'

/**
 * Drag-and-drop in grouped columns (#135). Grouped columns render ungrouped cards first, then
 * each group by its first task; groups of 2+ are a stack (not a sortable). The sortable indices
 * are dense over the draggable cards and the drop index maps against the same list, so a card
 * lands at the slot the landing placeholder showed. Drags use page.mouse
 * (docs/testing/e2e-dnd-patterns.md).
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

// Store order of Offen: a1, u1, a2, u2, b1, c1 -> rendered u1, u2, [a1 a2], b1, c1
const OPEN = [
  task({ id: 'a1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
  task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
  task({ id: 'a2', title: 'Farben abstimmen', status: 0, topic: 'Design' }),
  task({ id: 'u2', title: 'Angebot schicken', status: 0 }),
  task({ id: 'b1', title: 'API prüfen', status: 0, topic: 'Backend' }),
  task({ id: 'c1', title: 'Rechnung ablegen', status: 0, topic: 'Finanzen' }),
]
// Wartet: two single cards
const WAITING = [
  task({ id: 'w1', title: 'Blocker klären', status: 2 }),
  task({ id: 'w2', title: 'Freigabe abwarten', status: 2 }),
]

const GROUP_BY_TOPIC = { enabled: true, key: 'topic' }

const openList = (page: Page) => page.locator('#column-open-list')
const waitingList = (page: Page) => page.locator('#column-waiting-list')
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)

/** Ids of the list's items top to bottom (a stack counts once, by its top card). */
const order = (list: Locator) =>
  list
    .locator(':scope > .task-wrapper, :scope > .task-stack')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-task-id')))

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(card(page, 'u1')).toBeVisible()
}

/** Hovers near the top (or bottom) edge of a card so the landing slot opens before (or after) it. */
async function hoverEdge(page: Page, target: Locator, edge: 'top' | 'bottom') {
  const box = await target.boundingBox()
  if (!box) throw new Error('Drop target not visible')
  const y = edge === 'top' ? box.y + 10 : box.y + box.height - 10
  await page.mouse.move(box.x + box.width / 2, y, { steps: 30 })
  await page.waitForTimeout(400)
}

// Six cards in Offen: tall enough that the last ones sit below a 720px viewport
test.use({ viewport: { width: 1280, height: 1100 } })

test('grouped Offen: an ungrouped card reorders below another one across a stack, and it persists', async ({ page, context }) => {
  // Seeded once, so the reload restores the saved order
  await seedLocalBoard(context, [...OPEN, ...WAITING], {}, GROUP_BY_TOPIC, { once: true })
  await gotoBoard(page)
  await expect.poll(() => order(openList(page))).toEqual(['u1', 'u2', 'a1', 'b1', 'c1'])

  await pickUp(page, card(page, 'u1'))
  await hoverEdge(page, card(page, 'u2'), 'bottom')
  await page.mouse.up()

  await expect.poll(() => order(openList(page))).toEqual(['u2', 'u1', 'a1', 'b1', 'c1'])
  await page.reload()
  await expect(card(page, 'u1')).toBeVisible()
  await expect.poll(() => order(openList(page))).toEqual(['u2', 'u1', 'a1', 'b1', 'c1'])
})

test.describe('Drag-and-drop in grouped columns (#135)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [...OPEN, ...WAITING], {}, GROUP_BY_TOPIC)
  })

  test('a single-card group moved above another one swaps the groups, the stack stays whole', async ({ page }) => {
    await gotoBoard(page)

    await pickUp(page, card(page, 'c1'))
    await hoverEdge(page, card(page, 'b1'), 'top')
    await page.mouse.up()

    await expect.poll(() => order(openList(page))).toEqual(['u1', 'u2', 'a1', 'c1', 'b1'])
    const stack = openList(page).locator('.task-stack')
    await expect(stack).toHaveCount(1)
    await expect(stack).toHaveAttribute('data-stack-task-ids', /a1/)
    await expect(stack).toHaveAttribute('data-stack-size', '2')
  })

  test('a card dragged into grouped Wartet lands between two single cards', async ({ page }) => {
    await gotoBoard(page)

    await pickUp(page, card(page, 'u1'))
    await hoverEdge(page, card(page, 'w2'), 'top')

    // Clone feedback moves DOM: the landing slot sits in the destination list
    await expect(waitingList(page).locator('.task-wrapper.kando-dnd-dragged')).toHaveCount(1)

    await page.mouse.up()

    await expect.poll(() => order(waitingList(page))).toEqual(['w1', 'u1', 'w2'])
    await expect.poll(() => order(openList(page))).toEqual(['u2', 'a1', 'b1', 'c1'])
  })
})

test.describe('Drag-and-drop in grouped columns: preview and drop agree (#135)', () => {
  // Offen: two single-card groups above a stack, one below -> rendered x1, y1, [s1 s2], z1
  const ABOVE_STACK = [
    task({ id: 'x1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
    task({ id: 'y1', title: 'API prüfen', status: 0, topic: 'Backend' }),
    task({ id: 's1', title: 'Rechnung ablegen', status: 0, topic: 'Finanzen' }),
    task({ id: 's2', title: 'Belege sammeln', status: 0, topic: 'Finanzen' }),
    task({ id: 'z1', title: 'Dokumentation lesen', status: 0, topic: 'Doku' }),
  ]

  test('a card dragged down onto a card above a stack lands above the stack, as previewed', async ({ page, context }) => {
    await seedLocalBoard(context, ABOVE_STACK, {}, GROUP_BY_TOPIC)
    await page.goto('/tasks')
    await expect(card(page, 'x1')).toBeVisible()
    await expect.poll(() => order(openList(page))).toEqual(['x1', 'y1', 's1', 'z1'])

    await pickUp(page, card(page, 'x1'))
    await hoverEdge(page, card(page, 'y1'), 'bottom')
    // dnd-kit previews x1 between y1 and the stack
    await expect.poll(() => order(openList(page))).toEqual(['y1', 'x1', 's1', 'z1'])
    await page.mouse.up()

    await expect.poll(() => order(openList(page))).toEqual(['y1', 'x1', 's1', 'z1'])
  })

  test('a drop that grouping snaps back puts the card back in its place', async ({ page, context }) => {
    await seedLocalBoard(context, [...OPEN, ...WAITING], {}, GROUP_BY_TOPIC)
    await gotoBoard(page)

    // An ungrouped card dropped below the groups: grouping keeps it in the ungrouped section
    await pickUp(page, card(page, 'u2'))
    await hoverEdge(page, card(page, 'c1'), 'bottom')
    await page.mouse.up()

    await page.waitForTimeout(1000)
    await expect.poll(() => order(openList(page))).toEqual(['u1', 'u2', 'a1', 'b1', 'c1'])
  })
})

test('stack by activity (#505): the chip stacks tasks of one activity, ignores topic, and survives a reload', async ({ page, context }) => {
  // Same activity, different topics: only the activity chip stacks them. `n1` has none and stays a card.
  const tasks = [
    task({ id: 'p1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design', activity: 'Planung' }),
    task({ id: 'n1', title: 'Dokumentation lesen', status: 0 }),
    task({ id: 'p2', title: 'Angebot schicken', status: 0, topic: 'Finanzen', activity: ' Planung ' }),
    task({ id: 'e1', title: 'API prüfen', status: 0, topic: 'Backend', activity: 'Entwicklung' }),
  ]
  await seedLocalBoard(context, tasks, {}, { enabled: true, key: 'topic' }, { once: true })
  await page.goto('/tasks')
  await expect(card(page, 'n1')).toBeVisible()
  await expect(openList(page).locator('.task-stack')).toHaveCount(0)

  const panel = await openMore(page)
  const chips = panel.getByRole('group', { name: 'Gruppieren nach' }).getByRole('button')
  await expect(chips).toHaveText(['Thema', 'Aktivität', 'Priorität'])
  await chips.getByText('Aktivität').click()
  await expect(panel.getByRole('button', { name: 'Aktivität' })).toHaveAttribute('aria-pressed', 'true')
  await closeMore(page)

  const stack = openList(page).locator('.task-stack')
  await expect(stack).toHaveCount(1)
  await expect(stack).toHaveAttribute('data-stack-size', '2')
  await expect(stack).toHaveAttribute('data-stack-task-ids', /p1/)
  await expect(stack.locator('.task-stack__control')).toHaveAccessibleName(/Planung/)
  await expect.poll(() => order(openList(page))).toEqual(['n1', 'p1', 'e1'])

  await page.reload()
  await expect(card(page, 'n1')).toBeVisible()
  await expect(openList(page).locator('.task-stack')).toHaveAttribute('data-stack-size', '2')
})
