import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover } from './helpers/dnd'
import { settleAnimations } from './helpers/settle'

/**
 * #393: a card (or collapsed stack) dragged out of its column over an empty column leaves no gap behind.
 * dnd-kit keeps the placeholder in the source list while the pointer is over the empty column's drop zone
 * (it moves the node only into a column with sortables); the placeholder is invisible then, but used to hold
 * its slot, so the remaining cards sat apart, or below an empty band under the column header.
 * Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
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

const column = (status: 0 | 2, ids: string[], topic: string | null = null) =>
  ids.map(id => task({ id, title: `Karte ${id}`, status, topic }))

type ColumnKey = 'open' | 'progress' | 'waiting' | 'done'
const list = (page: Page, key: ColumnKey) => page.locator(`#column-${key}-list`)
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const ghost = (page: Page) => page.locator('.column-drop-zone__ghost')
const idsIn = (container: Locator) =>
  container.locator(':scope > .task-wrapper, :scope > .task-stack')
    .evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))

async function gotoBoard(page: Page, firstCard: string) {
  await page.goto('/tasks')
  await expect(card(page, firstCard)).toBeVisible()
  await settleAnimations(page) // the first drag measures the droppables: start it on a board that stopped moving
}

/** Top offsets (relative to the list's top) and bottoms of the list's rendered items, the placeholder excluded. */
function renderedItems(container: Locator) {
  return container.evaluate((el) => {
    const top = el.getBoundingClientRect().top
    return [...el.querySelectorAll(':scope > .task-wrapper:not(.kando-dnd-dragged), :scope > .task-stack:not(.kando-dnd-dragged)')]
      .map((item) => {
        const r = item.getBoundingClientRect()
        return { id: item.getAttribute('data-task-id'), top: r.top - top, bottom: r.bottom - top }
      })
  })
}

/** The remaining items, top to bottom, with their distance to the list's top (first) or to the item above. */
async function spacing(container: Locator) {
  const gap = await container.evaluate(el => parseFloat(getComputedStyle(el).rowGap))
  const items = await renderedItems(container)
  return {
    ids: items.map(i => i.id),
    firstOffset: Math.round(items[0]?.top ?? NaN),
    // distance beyond the list's own gap, 0 when the cards follow each other
    extraGaps: items.slice(1).map((item, i) => Math.round(item.top - items[i]!.bottom - gap)),
  }
}

/** The first remaining item starts at the list's top and the cards follow each other at the list's gap. */
async function expectNoGap(container: Locator, remaining: string[]) {
  await expect.poll(() => spacing(container), { message: 'no gap left by the dragged card' }).toEqual({
    ids: remaining,
    firstOffset: 0,
    extraGaps: remaining.slice(1).map(() => 0),
  })
}

/**
 * Pointer over an empty column with the drag live. Under load (CI, many workers) the fast hover can end with the
 * column hovered while dnd-kit still holds the card in its source list (it re-evaluates on the next pointer move,
 * #155); a real pointer never stops dead on its way in, so the test keeps nudging it until the ghost shows.
 */
async function hoverEmptyColumn(page: Page, key: ColumnKey) {
  await hover(page, list(page, key))
  const box = await list(page, key).boundingBox()
  if (!box) throw new Error('Drop target not visible')
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await expect(async () => {
    await page.mouse.move(x + 4, y + 4, { steps: 3 })
    await page.mouse.move(x, y, { steps: 3 })
    await expect(ghost(page)).toHaveCount(1, { timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

const OFFEN = ['a', 'b', 'c', 'd']

test.describe('Offen card dragged over empty Jetzt (#393)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, column(0, OFFEN))
    await gotoBoard(page, 'a')
  })

  for (const [where, id] of [['top', 'a'], ['middle', 'c'], ['bottom', 'd']] as const) {
    test(`leaves no gap when the ${where} card leaves`, async ({ page }) => {
      await pickUp(page, card(page, id))
      await hoverEmptyColumn(page, 'progress')
      await expectNoGap(list(page, 'open'), OFFEN.filter(k => k !== id))
    })
  }

  test('back over Offen the slot returns, and the drop lands there (A -> B -> A)', async ({ page }) => {
    await pickUp(page, card(page, 'a'))
    await hover(page, list(page, 'progress'))
    await expectNoGap(list(page, 'open'), ['b', 'c', 'd'])

    await hover(page, card(page, 'c'))
    await expect(ghost(page)).toHaveCount(0)
    await expect.poll(async () => (await page.locator('.kando-dnd-dragged').boundingBox())?.height ?? 0).toBeGreaterThan(50)
    // The slot sits before the hovered card, and the drop lands exactly there
    await expect.poll(() => idsIn(list(page, 'open'))).toEqual(['b', 'a', 'c', 'd'])

    await page.mouse.up()
    await expect(page.locator('.board.dragging')).toHaveCount(0)
    await expect.poll(() => idsIn(list(page, 'open'))).toEqual(['b', 'a', 'c', 'd'])
    await expect(list(page, 'progress').locator(':scope > .task-wrapper')).toHaveCount(0)
  })

  test('a keyboard drag over empty Jetzt keeps the focus on the card', async ({ page }) => {
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-task-id') ?? document.activeElement?.tagName)
    await card(page, 'a').focus()
    await page.keyboard.press('Space')
    await expect(page.locator('.board.dragging')).toHaveCount(1)
    await page.keyboard.press('ArrowRight')
    await expect(ghost(page)).toHaveCount(1)
    // the placeholder left the layout, and with it must not have taken the focus along
    await expectNoGap(list(page, 'open'), ['b', 'c', 'd'])
    expect(await focused()).toBe('a')
    await page.keyboard.press('Escape')
    await expect(page.locator('.board.dragging')).toHaveCount(0)
    expect(await focused()).toBe('a')
  })

  test('dropping on Jetzt lands the card there and the rest stays collapsed', async ({ page }) => {
    await pickUp(page, card(page, 'a'))
    await hover(page, list(page, 'progress'))
    await expectNoGap(list(page, 'open'), ['b', 'c', 'd'])
    await page.mouse.up()
    await expect.poll(() => idsIn(list(page, 'progress'))).toEqual(['a'])
    await expectNoGap(list(page, 'open'), ['b', 'c', 'd'])
  })
})

test.describe('Wartet card dragged over empty Erledigt (#393)', () => {
  const WARTET = ['w1', 'w2', 'w3']

  for (const [where, id] of [['top', 'w1'], ['middle', 'w2'], ['bottom', 'w3']] as const) {
    test(`leaves no gap when the ${where} card leaves`, async ({ context, page }) => {
      await seedLocalBoard(context, column(2, WARTET))
      await gotoBoard(page, 'w1')
      // The app bar pushes the Wartet column down: the bottom card's centre can sit below the 720px viewport
      await card(page, id).scrollIntoViewIfNeeded()
      await pickUp(page, card(page, id))
      await hover(page, list(page, 'done'))
      await expect(ghost(page)).toHaveCount(1)
      await expectNoGap(list(page, 'waiting'), WARTET.filter(k => k !== id))
    })
  }
})

test.describe('Collapsed stack dragged over an empty column (#393)', () => {
  test('leaves no gap in Offen', async ({ context, page }) => {
    const tasks = [
      ...column(0, ['a1', 'a2', 'a3'], 'Design'),
      ...column(0, ['u1', 'u2']),
      ...column(0, ['b1', 'b2'], 'Backend'),
    ]
    await seedLocalBoard(context, tasks, {}, { enabled: true, key: 'topic' })
    await gotoBoard(page, 'u1')
    // Rendered Offen: u1, u2, [a1 a2 a3], [b1 b2]: the dragged stack sits between the cards and a stack
    const stack = list(page, 'open').locator('.task-stack')
    await expect(stack).toHaveCount(2)
    await pickUp(page, stack.first())
    await hover(page, list(page, 'waiting'))
    await expect(ghost(page)).toHaveCount(1)
    await expectNoGap(list(page, 'open'), ['u1', 'u2', 'b1'])
    // dnd-kit sorts the dragged stack to the list's end: its slot must not hold space there either
    await expect(page.locator('.task-stack.kando-dnd-dragged')).toBeHidden()
  })
})
