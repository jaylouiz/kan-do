import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp } from './helpers/dnd'
import { callTasksStore, fullTask } from './helpers/store'
import { settleAnimations, settleStack, flushFrames } from './helpers/settle'

/**
 * Drag-and-drop with the cards of an expanded stack (#139, #147). Expanded members are ordinary
 * sortables: they drag within the group, out to other columns (Jetzt keeps its WIP limit), and the
 * source group shrinks cleanly. Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
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

// Rendered Offen: u1, [a1 a2 a3], b1
const OPEN = [
  task({ id: 'a1', title: 'Konzept ausarbeiten', status: 0, topic: 'Design' }),
  task({ id: 'u1', title: 'Dokumentation lesen', status: 0 }),
  task({ id: 'a2', title: 'Farben abstimmen', status: 0, topic: 'Design' }),
  task({ id: 'a3', title: 'Raster festlegen', status: 0, topic: 'Design' }),
  task({ id: 'b1', title: 'API prüfen', status: 0, topic: 'Backend' }),
]
const WAITING = [
  task({ id: 'w1', title: 'Blocker klären', status: 2, topic: 'W1' }),
  task({ id: 'w2', title: 'Freigabe abwarten', status: 2, topic: 'W2' }),
]
const GROUP_BY_TOPIC = { enabled: true, key: 'topic' }

const list = (page: Page, key: 'open' | 'progress' | 'waiting' | 'done') => page.locator(`#column-${key}-list`)
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const members = (page: Page) => page.locator('#column-open-list .task-wrapper[data-from-stack="Design"]')
const stack = (page: Page) => page.locator('#column-open-list .task-stack')

/** Ids of the list's items top to bottom (a collapsed stack counts once, by its front card). */
const order = (container: Locator) =>
  container
    .locator(':scope > .task-wrapper, :scope > .task-stack')
    .evaluateAll((els) => els.map((el) => `${el.classList.contains('task-stack') ? 'stack:' : ''}${el.getAttribute('data-task-id')}`))

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(card(page, 'u1')).toBeVisible()
}

async function expandDesign(page: Page) {
  await stack(page).click()
  await expect(members(page)).toHaveCount(3)
  await settleStack(page)
}

/** Same-column proof: where the `.kando-dnd-dragged` placeholder sits in `list` while the pointer hovers. */
interface PlaceholderAt {
  list: Locator
  order: string[]
}

/**
 * Positive signal that dnd-kit resolved the over-target. `.dragover` on the target's column proves it
 * across columns (`onDragOver` sets `hoverTargetStatus`, also while Jetzt refuses the drop), but the
 * source column already carries it right after pickUp. A same-column hover therefore passes
 * `placeholderAt`: the list order with the moved placeholder, which differs from the start order and
 * is only reached once the pointer is over the target. Without it a refusal or snap-back check would
 * pass before the hover was ever processed.
 */
async function expectHovered(page: Page, target: Locator, placeholderAt?: PlaceholderAt) {
  if (placeholderAt) {
    await expect.poll(() => order(placeholderAt.list)).toEqual(placeholderAt.order)
  } else {
    const column = target.locator('xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " column ")]')
    await expect(column).toHaveClass(/\bdragover\b/)
  }
  await flushFrames(page)
}

async function hoverEdge(page: Page, target: Locator, edge: 'top' | 'bottom', placeholderAt?: PlaceholderAt) {
  const box = await target.boundingBox()
  if (!box) throw new Error('Drop target not visible')
  const y = edge === 'top' ? box.y + 10 : box.y + box.height - 10
  await page.mouse.move(box.x + box.width / 2, y, { steps: 30 })
  await expectHovered(page, target, placeholderAt)
}

async function hoverCenter(page: Page, target: Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error('Drop target not visible')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 40 })
  await expectHovered(page, target)
}

test.use({ viewport: { width: 1280, height: 1100 } })

test.describe('Cards of an expanded stack are draggable (#139)', () => {
  const pageErrors: string[] = []
  test.beforeEach(async ({ context, page }) => {
    pageErrors.length = 0
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await seedLocalBoard(context, [...OPEN, ...WAITING], {}, GROUP_BY_TOPIC)
  })
  test.afterEach(() => {
    expect(pageErrors).toEqual([])
  })

  test('a member dragged to Wartet lands where the placeholder showed; the group shrinks 3 to 2 and stays open', async ({ page }) => {
    await gotoBoard(page)
    await expandDesign(page)

    await pickUp(page, card(page, 'a2'))
    await hoverEdge(page, card(page, 'w2'), 'top')
    // The clone feedback moves the dragged node into the destination list
    await expect(list(page, 'waiting').locator('.kando-dnd-dragged')).toHaveCount(1)
    await page.mouse.up()

    await expect.poll(() => order(list(page, 'waiting'))).toEqual(['w1', 'a2', 'w2'])
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a1', 'a3', 'b1'])
    await expect(members(page)).toHaveCount(2)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('two members leaving turn the last one into a plain card', async ({ page }) => {
    await gotoBoard(page)
    await expandDesign(page)

    await pickUp(page, card(page, 'a1'))
    await hoverEdge(page, card(page, 'w1'), 'bottom')
    await page.mouse.up()
    await expect.poll(() => order(list(page, 'waiting'))).toContain('a1')
    await expect(members(page)).toHaveCount(2)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)

    await pickUp(page, card(page, 'a2'))
    await hoverEdge(page, card(page, 'w2'), 'bottom')
    await page.mouse.up()

    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a3', 'b1'])
    await expect(page.locator('#column-open-list [data-from-stack]')).toHaveCount(0)
    await expect(card(page, 'a3')).toBeVisible()
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('a member dragged to Erledigt completes', async ({ page }) => {
    await gotoBoard(page)
    await expandDesign(page)

    await pickUp(page, card(page, 'a3'))
    await hoverCenter(page, page.locator('#column-done .column-drop-zone'))
    await page.mouse.up()

    await expect(list(page, 'done').locator('.task-wrapper[data-task-id="a3"]')).toBeVisible()
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a1', 'a2', 'b1'])
  })

  test('a member dragged into an empty Jetzt moves there', async ({ page }) => {
    await gotoBoard(page)
    await expandDesign(page)

    await pickUp(page, card(page, 'a1'))
    await hoverCenter(page, page.locator('#column-progress .column-drop-zone'))
    await page.mouse.up()

    await expect(list(page, 'progress').locator('.task-wrapper[data-task-id="a1"]')).toBeVisible()
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a2', 'a3', 'b1'])
  })

  test('a member within its group reorders by pointer, and a member outside it snaps back', async ({ page }) => {
    await gotoBoard(page)
    await expandDesign(page)

    // Outside its group, below the last card of the column: the order stays, the card is back, no ghost
    await pickUp(page, card(page, 'a1'))
    await hoverEdge(page, card(page, 'b1'), 'bottom', { list: list(page, 'open'), order: ['u1', 'a2', 'a3', 'b1', 'a1'] })
    await page.mouse.up()
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    await expect(card(page, 'a1')).toHaveCount(1)

    // Within the group: a1 below a2
    await pickUp(page, card(page, 'a1'))
    await hoverEdge(page, card(page, 'a2'), 'bottom')
    await page.mouse.up()
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a2', 'a1', 'a3', 'b1'])
    await expect(members(page)).toHaveCount(3)
  })

  test('a member can be moved by keyboard (Space, arrows, Space)', async ({ page }) => {
    await gotoBoard(page)
    await expandDesign(page)

    await card(page, 'a1').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    // the placeholder has moved behind a2 before Space drops it
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a2', 'a1', 'a3', 'b1'])
    await page.keyboard.press('Space')

    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a2', 'a1', 'a3', 'b1'])
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('the right-click menu and the command palette work on a member', async ({ page }) => {
    await gotoBoard(page)
    await expandDesign(page)

    await card(page, 'a2').locator('.task').click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')

    // Card commands apply when the member has focus
    await card(page, 'a2').focus()
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(palette).toBeVisible()
    await palette.getByText('Verschieben nach Erledigt').click()
    await expect(list(page, 'done').locator('.task-wrapper[data-task-id="a2"]')).toBeVisible()
  })
})

test.describe('A sync while a stack is expanded or a member is dragged (#146, #147)', () => {
  const pageErrors: string[] = []
  test.beforeEach(async ({ context, page }) => {
    pageErrors.length = 0
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await seedLocalBoard(context, [...OPEN, ...WAITING], {}, GROUP_BY_TOPIC)
    await gotoBoard(page)
    await expandDesign(page)
  })
  test.afterEach(() => {
    expect(pageErrors).toEqual([])
  })

  test('adding, re-grouping, re-statusing and removing members leaves no orphan and no missing card', async ({ page }) => {
    await callTasksStore(page, { action: 'addTask', args: [fullTask({ id: 'a4', title: 'Neu im Stapel', status: 0, topic: 'Design' })] })
    await expect(members(page)).toHaveCount(4)

    await callTasksStore(page, { action: 'updateTask', args: ['a2', { topic: 'Backend' }] })
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a1', 'a3', 'a4', 'stack:a2'])

    await callTasksStore(page, { action: 'updateTask', args: ['a4', { status: 2 }] })
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a1', 'a3', 'stack:a2'])
    await expect(card(page, 'a4')).toHaveCount(1) // now in Wartet

    await callTasksStore(page, { action: 'removeTask', args: ['a3'] })
    // Design shrank to one card: a plain card, no longer marked as a stack member
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a1', 'stack:a2'])
    await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(0)
  })

  test('removing a member and adding another while a member is dragged: the drop leaves nothing behind', async ({ page }) => {
    await pickUp(page, card(page, 'a2'))
    await hoverEdge(page, card(page, 'a3'), 'bottom')

    await callTasksStore(page, { action: 'removeTask', args: ['a3'] })
    await callTasksStore(page, { action: 'addTask', args: [fullTask({ id: 'a4', title: 'Neu im Stapel', status: 0, topic: 'Design' })] })
    await flushFrames(page)
    await page.mouse.up()

    await expect.poll(async () => (await order(list(page, 'open'))).filter((id) => id !== 'u1' && id !== 'b1').sort()).toEqual(['a1', 'a2', 'a4'])
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    for (const id of ['a1', 'a2', 'a4']) await expect(card(page, id)).toHaveCount(1)
  })

  test('the dragged member changing group mid-drag leaves no ghost (#146)', async ({ page }) => {
    await pickUp(page, card(page, 'a2'))
    await hoverEdge(page, card(page, 'b1'), 'top', { list: list(page, 'open'), order: ['u1', 'a1', 'a3', 'b1', 'a2'] })

    // a2 joins Backend: a stack of b1 + a2 forms while a2 is in the air
    await callTasksStore(page, { action: 'updateTask', args: ['a2', { topic: 'Backend' }] })
    await flushFrames(page)
    await page.mouse.up()

    await expect(card(page, 'a2')).toHaveCount(0) // inside the collapsed Backend stack, not a card of its own
    await expect(page.locator('#column-open-list .task-stack')).toHaveCount(1)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })
})

test('a reorder inside an expanded group persists after a reload', async ({ page, context }) => {
  // Seeded once, so the reload restores the saved order
  await seedLocalBoard(context, [...OPEN, ...WAITING], {}, GROUP_BY_TOPIC, { once: true })
  await gotoBoard(page)
  await expandDesign(page)

  await pickUp(page, card(page, 'a1'))
  await hoverEdge(page, card(page, 'a3'), 'bottom')
  await page.mouse.up()
  await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a2', 'a3', 'a1', 'b1'])

  await page.reload()
  await expect(card(page, 'u1')).toBeVisible()
  // Expansion is not persisted: the stack is collapsed again, its front card is the new first task
  await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'stack:a2', 'b1'])
  await stack(page).click()
  await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a2', 'a3', 'a1', 'b1'])
})

test('a member cannot be dropped into an occupied Jetzt', async ({ context, page }) => {
  await seedLocalBoard(context, [...OPEN, ...WAITING, task({ id: 'p1', title: 'Review schreiben', status: 1 })], {}, GROUP_BY_TOPIC)
  await gotoBoard(page)
  await expandDesign(page)

  await pickUp(page, card(page, 'a1'))
  await hoverCenter(page, card(page, 'p1'))
  await page.mouse.up()

  await expect(list(page, 'progress').locator('.task-wrapper')).toHaveCount(1)
  await expect(list(page, 'progress').locator('.task-wrapper[data-task-id="p1"]')).toBeVisible()
  await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'a1', 'a2', 'a3', 'b1'])
  await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
})

// ---------------------------------------------------------------------------------------------
// A whole collapsed stack (#150): one sortable, a drop moves every member as one block
// ---------------------------------------------------------------------------------------------

const toasts = (page: Page) => page.locator('[data-slot="viewport"] [data-slot="root"]')
const stackOf = (page: Page, key: 'open' | 'progress' | 'waiting' | 'done', id: string) =>
  list(page, key).locator(`.task-stack[data-task-id="${id}"]`)

test.describe('A whole collapsed stack is draggable (#150)', () => {
  // Offen: u1, stack Design (a1 a2 a3), b1. Wartet: stack Wartung (w1 w2), x1 alone.
  const OPEN_H = OPEN
  const WAITING_H = [
    task({ id: 'w1', title: 'Blocker klären', status: 2, topic: 'Wartung' }),
    task({ id: 'x1', title: 'Freigabe abwarten', status: 2, topic: 'Extern' }),
    task({ id: 'w2', title: 'Rückmeldung abwarten', status: 2, topic: 'Wartung' }),
  ]
  const pageErrors: string[] = []

  test.beforeEach(async ({ context, page }) => {
    pageErrors.length = 0
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await seedLocalBoard(context, [...OPEN_H, ...WAITING_H], {}, GROUP_BY_TOPIC)
    await gotoBoard(page)
  })
  test.afterEach(() => {
    expect(pageErrors).toEqual([])
  })

  test('the preview is the collapsed face, the source keeps one grey slot of the stack footprint', async ({ page }) => {
    const before = (await stack(page).boundingBox())!
    await pickUp(page, stack(page))

    await expect(stack(page)).toHaveClass(/kando-dnd-dragged/)
    const preview = page.locator('.kando-dnd-preview.task-stack')
    await expect(preview).toHaveCount(1)
    await expect(preview.locator('.task-stack__caption')).toHaveText('Design3')
    await expect(preview.locator('.stacked-task--top')).toBeVisible()

    // The placeholder keeps the footprint (no layout jump): same box, caption and layers invisible
    const after = (await stack(page).boundingBox())!
    expect(Math.abs(after.height - before.height)).toBeLessThan(2)
    await expect(stack(page).locator('.task-stack__caption')).toHaveCSS('visibility', 'hidden')
    await expect(stack(page).locator('.stacked-task--overflow').first()).toHaveCSS('visibility', 'hidden')
    await expect(stack(page).locator('.stacked-task--top')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    await page.mouse.up()
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    // a drag never expands the stack
    await expect(stack(page)).toHaveCount(1)
  })

  test('a tap right after a drop expands a stack: the click that ends a drag is the only one ignored (#154)', async ({ page }) => {
    await pickUp(page, stack(page))
    await hoverEdge(page, card(page, 'b1'), 'bottom')
    await page.mouse.up()
    // no waiting: the next press is a new gesture
    await stack(page).click()

    await expect(members(page)).toHaveCount(3)
    await expect(stack(page)).toHaveCount(0)
  })

  test('dropped in Wartet: every member moves, the source group is gone, no ghost remains', async ({ page }) => {
    await pickUp(page, stack(page))
    await hoverEdge(page, card(page, 'x1'), 'top')
    await expect(list(page, 'waiting').locator('.kando-dnd-dragged')).toHaveCount(1)
    await page.mouse.up()

    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'b1'])
    // Wartung (w1 w2), the moved Design stack in the slot the placeholder showed, then x1
    await expect.poll(() => order(list(page, 'waiting'))).toEqual(['stack:w1', 'stack:a1', 'x1'])
    for (const id of ['a1', 'a2', 'a3']) {
      await expect(page.locator(`#column-waiting-list .task[data-task-id="${id}"]`)).toHaveCount(1)
      await expect(page.locator(`#column-open-list .task[data-task-id="${id}"]`)).toHaveCount(0)
    }
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    await expect(page.locator('#column-open-list .task-stack')).toHaveCount(0)
    await expect(stackOf(page, 'waiting', 'a1')).toHaveAttribute('data-stack-size', '3')
  })

  test('dropped in Offen from Wartet moves all of Wartung', async ({ page }) => {
    await pickUp(page, stackOf(page, 'waiting', 'w1'))
    await hoverEdge(page, card(page, 'b1'), 'bottom')
    await page.mouse.up()

    await expect(stackOf(page, 'open', 'w1')).toHaveAttribute('data-stack-size', '2')
    await expect(list(page, 'waiting').locator('.task-stack')).toHaveCount(0)
    await expect.poll(() => order(list(page, 'waiting'))).toEqual(['x1'])
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('Jetzt is refused, empty or occupied: no placeholder in Jetzt, no toast, nothing moves', async ({ page }) => {
    // empty Jetzt
    await pickUp(page, stack(page))
    await hoverCenter(page, page.locator('#column-progress .column-drop-zone'))
    await expect(list(page, 'progress').locator('.kando-dnd-dragged')).toHaveCount(0)
    await expect(page.locator('#column-progress .column-drop-zone__ghost')).toHaveCount(0)
    await page.mouse.up()
    await expect(list(page, 'progress').locator('.task-wrapper, .task-stack')).toHaveCount(0)
    await expect(stack(page)).toHaveCount(1)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    await expect(toasts(page)).toHaveCount(0)
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'stack:a1', 'b1'])

    // occupied Jetzt
    await callTasksStore(page, { action: 'updateTask', args: ['u1', { status: 1 }] })
    await expect(card(page, 'u1')).toBeVisible()
    await pickUp(page, stack(page))
    await hoverCenter(page, card(page, 'u1'))
    await expect(list(page, 'progress').locator('.kando-dnd-dragged')).toHaveCount(0)
    await page.mouse.up()
    await expect(list(page, 'progress').locator('.task-wrapper')).toHaveCount(1)
    await expect(stack(page)).toHaveCount(1)
    await expect(toasts(page)).toHaveCount(0)
  })

  const retopicDesign = async (page: Page) => {
    for (const id of ['a1', 'a2', 'a3']) {
      await callTasksStore(page, { action: 'updateTask', args: [id, { topic: 'Wartung' }] })
    }
    await expect(stackOf(page, 'open', 'a1')).toHaveAttribute('data-stack-size', '3')
    await settleAnimations(page)
  }

  test('merge: dropped before the Wartet group of the same key, the first moved task is the front card', async ({ page }) => {
    await retopicDesign(page)
    await pickUp(page, stackOf(page, 'open', 'a1'))
    await hoverEdge(page, stackOf(page, 'waiting', 'w1'), 'top')
    await page.mouse.up()

    await expect(stackOf(page, 'waiting', 'a1')).toHaveAttribute('data-stack-size', '5')
    await expect(page.locator('#column-open-list .task-stack')).toHaveCount(0)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('merge: dropped after the group of the same key, the existing front card stays', async ({ page }) => {
    await retopicDesign(page)
    await pickUp(page, stackOf(page, 'open', 'a1'))
    // the slot behind the Wartung stack is the one in front of x1
    await hoverEdge(page, card(page, 'x1'), 'top')
    await page.mouse.up()

    await expect(stackOf(page, 'waiting', 'w1')).toHaveAttribute('data-stack-size', '5')
    await expect(list(page, 'waiting').locator('.task-stack')).toHaveCount(1)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('same column: the group reorders among the groups, above ungrouped tasks it snaps back', async ({ page }) => {
    await pickUp(page, stack(page))
    await hoverEdge(page, card(page, 'b1'), 'bottom')
    await page.mouse.up()
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'b1', 'stack:a1'])

    await pickUp(page, stack(page))
    await hoverEdge(page, card(page, 'u1'), 'top', { list: list(page, 'open'), order: ['stack:a1', 'u1', 'b1'] })
    await page.mouse.up()
    // above the ungrouped task it snaps back and saves nothing (grouping decides)
    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'b1', 'stack:a1'])
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  })

  test('Space picks the stack up, arrows move it, Space drops it; a click still expands it', async ({ page }) => {
    await stack(page).locator('.task-stack__control').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    // the placeholder has moved into the destination list before Space drops it
    await expect(page.locator('#column-open-list .kando-dnd-dragged')).toHaveCount(0)
    await expect(page.locator('#column-waiting-list .kando-dnd-dragged')).toHaveCount(1)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(1)
    await page.keyboard.press('Space')

    await expect.poll(() => order(list(page, 'open'))).toEqual(['u1', 'b1'])
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    for (const id of ['a1', 'a2', 'a3']) {
      await expect(page.locator(`#column-open-list .task[data-task-id="${id}"]`)).toHaveCount(0)
    }
  })

  test('a click on the stack still expands it', async ({ page }) => {
    await stack(page).click()
    await expect(members(page)).toHaveCount(3)
  })

  test('a sync mid-drag that removes a member and adds one leaves no ghost', async ({ page }) => {
    await pickUp(page, stack(page))
    await hoverEdge(page, card(page, 'x1'), 'top')
    await callTasksStore(page, { action: 'removeTask', args: ['a2'] })
    await callTasksStore(page, { action: 'addTask', args: [fullTask({ id: 'a4', title: 'Neu', status: 0, topic: 'Design' })] })
    await flushFrames(page)
    await page.mouse.up()

    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    for (const id of ['a1', 'a3']) await expect(page.locator(`.task[data-task-id="${id}"]`)).toHaveCount(1)
    await expect(page.locator('#column-waiting-list .task[data-task-id="a4"]')).toHaveCount(0)
  })
})
