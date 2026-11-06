import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover } from './helpers/dnd'
import { COLUMN_ITEM_SELECTOR } from '../../utils/columnItemSelector'

/**
 * #379 (follow-up to #372): a collapsed stack dragged out of a column that holds only that stack. dnd-kit
 * moves the stack node into the other column, so the source list renders no item while the store still
 * holds the three tasks. The source's drop zone must then count the column as empty (ghost when hovered),
 * the target must show the stack's own placeholder (non-empty) or the ghost (empty), and no slot may be
 * left behind after the drop. Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
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

const STACK = ['s1', 's2', 's3'].map((id, i) => task({ id, title: `Konzept ${i + 1}`, status: 0, topic: 'Design' }))
const WARTET = task({ id: 'w1', title: 'Blocker klären', status: 2, topic: 'Wartung' })
const GROUP_BY_TOPIC = { enabled: true, key: 'topic' }

type Column = 'open' | 'progress' | 'waiting' | 'done'
const list = (page: Page, column: Column) => page.locator(`#column-${column}-list`)
const stackIn = (page: Page, column: Column) => list(page, column).locator('.task-stack[data-task-id="s1"]')
const zone = (page: Page, column: Column) => list(page, column).locator(':scope > .column-drop-zone')
const ghosts = (page: Page) => page.locator('.column-drop-zone__ghost')
const placeholders = (page: Page) => page.locator('.kando-dnd-dragged')
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(stackIn(page, 'open')).toBeVisible()
}

/** The stack's placeholder node (wherever dnd-kit left it) shows no grey slot: a drop zone ghost is the only one */
const expectSlotHidden = (page: Page) =>
  expect(page.locator('.task-stack.kando-dnd-dragged .stacked-task--top.task')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

test.use({ viewport: { width: 1280, height: 1100 } })

test.describe('Stack dragged out of a column that holds only that stack (#379)', () => {
  test('out over a card in Wartet: the stack previews there, the emptied Offen shows no ghost', async ({ context, page }) => {
    await seedLocalBoard(context, [...STACK, WARTET], {}, GROUP_BY_TOPIC)
    await gotoBoard(page)

    await pickUp(page, stackIn(page, 'open'))
    await hover(page, card(page, 'w1'), { fromTop: 10 })
    // Target: dnd-kit's placeholder is the slot, so no drop zone ghost anywhere
    await expect(list(page, 'waiting').locator('.task-stack.kando-dnd-dragged')).toHaveCount(1)
    await expect(ghosts(page)).toHaveCount(0)
    // Source: it renders no item while the node sits in Wartet, and shows nothing
    await expect(list(page, 'open').locator(`:scope > :is(${COLUMN_ITEM_SELECTOR})`)).toHaveCount(0)

    await page.mouse.up()
    await expect(stackIn(page, 'waiting')).toHaveAttribute('data-stack-size', '3')
    await expect(list(page, 'open').locator(`:scope > :is(${COLUMN_ITEM_SELECTOR})`)).toHaveCount(0)
    await expect(placeholders(page)).toHaveCount(0)
    await expect(ghosts(page)).toHaveCount(0)
  })

  test('out over empty Wartet: the ghost is the slot there, none in Offen; dropping moves the stack', async ({ context, page }) => {
    await seedLocalBoard(context, STACK, {}, GROUP_BY_TOPIC)
    await gotoBoard(page)

    await pickUp(page, stackIn(page, 'open'))
    await hover(page, zone(page, 'waiting'))
    await expect(zone(page, 'waiting').locator('.column-drop-zone__ghost')).toHaveCount(1)
    await expect(ghosts(page)).toHaveCount(1)
    await expectSlotHidden(page)

    await page.mouse.up()
    await expect(stackIn(page, 'waiting')).toHaveAttribute('data-stack-size', '3')
    await expect(stackIn(page, 'open')).toHaveCount(0)
    await expect(placeholders(page)).toHaveCount(0)
    await expect(ghosts(page)).toHaveCount(0)
  })

  test('out over Wartet and back over Offen: the ghost shows in Offen, none in Wartet; dropping keeps the stack', async ({ context, page }) => {
    await seedLocalBoard(context, [...STACK, WARTET], {}, GROUP_BY_TOPIC)
    await gotoBoard(page)

    await pickUp(page, stackIn(page, 'open'))
    await hover(page, card(page, 'w1'), { fromTop: 10 })
    await expect(list(page, 'waiting').locator('.task-stack.kando-dnd-dragged')).toHaveCount(1)

    await hover(page, zone(page, 'open'))
    // Offen's only item is the dragged stack and its node sits in Wartet: the zone must call it empty
    await expect(zone(page, 'open').locator('.column-drop-zone__ghost')).toHaveCount(1)
    await expect(ghosts(page)).toHaveCount(1)
    await expectSlotHidden(page)

    await page.mouse.up()
    await expect(stackIn(page, 'open')).toHaveAttribute('data-stack-size', '3')
    await expect(list(page, 'waiting').locator('.task-stack')).toHaveCount(0)
    await expect(card(page, 'w1')).toHaveCount(1)
    await expect(placeholders(page)).toHaveCount(0)
    await expect(ghosts(page)).toHaveCount(0)
  })
})
