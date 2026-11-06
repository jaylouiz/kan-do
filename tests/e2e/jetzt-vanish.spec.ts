import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover } from './helpers/dnd'

/**
 * #424: the Jetzt card vanishes (store says Jetzt, no card rendered anywhere) until the app restarts.
 *
 * Root cause (see the issue): the sortable keeps the column it was last sorted into (`group`, `index`)
 * when a drag ends without remounting its wrapper, because `useColumnSortable` passes a constant group and
 * @dnd-kit/vue re-syncs the sortable only when that input changes. Two ways to end such a drag:
 *  - drop back over the origin (#372: out over another column, back over Jetzt, release): the card stays
 *    in Jetzt, its sortable now says "Offen";
 *  - cancel (Escape, `pointercancel`): dnd-kit reverts the node only relative to a sibling in the origin
 *    list, and Jetzt (WIP 1) has none, so the node stays in the other column and the sortable is stale as well.
 * The next drag then reads the stale group (`initialGroup`) as the origin column, `restoreDraggedElement`
 * judges the node by the wrong column's order and removes it.
 *
 * Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
 */

const NOW = new Date().toISOString()
const task = (o: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status'>): SeedTask => ({
  priority: 1,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  custom: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
})

// With a timebox, so a drop into Jetzt shows no timebox nudge over the card (it would take the next press)
const JETZT = task({ id: 'jetzt-1', title: 'Review schreiben', status: 1, timeBoxSeconds: 1800 })
const OFFEN = [
  task({ id: 'open-1', title: 'Konzept ausarbeiten', status: 0 }),
  task({ id: 'open-2', title: 'Dokumentation lesen', status: 0 }),
]
const WARTET = task({ id: 'wait-1', title: 'Blocker klären', status: 2 })
const TASKS = [...OFFEN, JETZT, WARTET]

type Column = 'open' | 'progress' | 'waiting' | 'done'
const STATUS: Record<Column, number> = { open: 0, progress: 1, waiting: 2, done: 3 }

const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const zone = (page: Page, column: Column) => page.locator(`#column-${column}-list > .column-drop-zone`)

/** Where a drag leaves the pointer before the drag ends: over a card of Offen, or the empty drop zone of Wartet. */
const OUT_TARGETS = [
  { name: 'a card in Offen', column: 'open' as const, over: (page: Page): Locator => card(page, 'open-1') },
  { name: 'the empty Wartet', column: 'waiting' as const, over: (page: Page): Locator => zone(page, 'waiting') },
]

/** The card's status in the persisted store, the card's DOM parents (every rendered node of it) */
const storedStatus = (page: Page, id: string) => page.evaluate((taskId) => {
  const stored = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; status: number }> }
  return stored.tasks?.find(t => t.id === taskId)?.status
}, id)
const renderedIn = (page: Page, id: string) => page.evaluate(
  taskId => [...document.querySelectorAll(`.task-wrapper[data-task-id="${taskId}"]`)]
    .map(el => el.parentElement?.id.replace(/^column-|-list$/g, '')),
  id,
)

/** The store and the DOM agree: the task is in `column` and rendered exactly once, there, with nothing left over from a drag. */
async function expectCardIn(page: Page, id: string, column: Column) {
  await expect.poll(() => storedStatus(page, id), { message: `store status of ${id}` }).toBe(STATUS[column])
  await expect.poll(() => renderedIn(page, id), { message: `${id} rendered in` }).toEqual([column])
  await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
  await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(0)
}

/**
 * dnd-kit keeps the drag operation busy until the dragged element's drop animation (up to 250 ms) has ended and
 * refuses a new `Space` before that; it marks the element `data-dnd-dragging` and, while the animation runs,
 * `data-dnd-dropping`. The card is already back in its column by then, so `expectCardIn` does not wait for it. A
 * production build gets from one step to the next faster than `nuxt dev` and used to press the second `Space` inside that
 * window (#540: the live region still read the cancel).
 */
async function expectDragSettled(page: Page) {
  await expect(page.locator('[data-dnd-dragging], [data-dnd-dropping]')).toHaveCount(0)
}

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(card(page, JETZT.id)).toBeVisible()
}

/** One drag from `source` to `over`, released there */
async function drag(page: Page, source: Locator, over: Locator) {
  await pickUp(page, source)
  await hover(page, over)
  await page.mouse.up()
}

test.describe('Jetzt card, drags that end where they started (#424)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context, TASKS)
    await gotoBoard(page)
  })

  for (const out of OUT_TARGETS) {
    test(`out over ${out.name}, back over Jetzt in one drag, drop; the next drag out still moves the card`, async ({ page }) => {
      await pickUp(page, card(page, JETZT.id))
      await hover(page, out.over(page))
      await hover(page, zone(page, 'progress'))
      await page.mouse.up()
      await expectCardIn(page, JETZT.id, 'progress')

      // The card must be an ordinary Jetzt card again: drag it out, drop it
      await drag(page, card(page, JETZT.id), out.over(page))
      await expectCardIn(page, JETZT.id, out.column)

      // ...and in again
      await drag(page, card(page, JETZT.id), zone(page, 'progress'))
      await expectCardIn(page, JETZT.id, 'progress')
    })
  }

  test('out over Offen, back over Jetzt, drop, then out and in again, twice: never vanishes (the reported sequence)', async ({ page }) => {
    for (let round = 0; round < 2; round++) {
      await pickUp(page, card(page, JETZT.id))
      await hover(page, card(page, 'open-1'))
      await hover(page, zone(page, 'progress'))
      await page.mouse.up()
      await expectCardIn(page, JETZT.id, 'progress')

      await drag(page, card(page, JETZT.id), card(page, 'open-1'))
      await expectCardIn(page, JETZT.id, 'open')
      await drag(page, card(page, JETZT.id), zone(page, 'progress'))
      await expectCardIn(page, JETZT.id, 'progress')
    }
  })

  for (const out of [...OUT_TARGETS, { name: 'Offen, then back over Jetzt', column: 'open' as const, over: (page: Page): Locator => card(page, 'open-1'), back: true }]) {
    test(`Escape while over ${out.name}: the card is back in Jetzt and drags on`, async ({ page }) => {
      await pickUp(page, card(page, JETZT.id))
      await hover(page, out.over(page))
      if ('back' in out) await hover(page, zone(page, 'progress'))
      await page.keyboard.press('Escape')
      await page.mouse.up() // the button is still down: the next press must be a fresh one
      await expectCardIn(page, JETZT.id, 'progress')

      await drag(page, card(page, JETZT.id), out.over(page))
      await expectCardIn(page, JETZT.id, out.column)
    })
  }

  test('the only card of another column (Wartet) canceled over Offen is back in Wartet and drags on', async ({ page }) => {
    await pickUp(page, card(page, WARTET.id))
    await hover(page, card(page, 'open-1'))
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expectCardIn(page, WARTET.id, 'waiting')

    await drag(page, card(page, WARTET.id), card(page, 'open-1'))
    await expectCardIn(page, WARTET.id, 'open')
  })

  test('a canceled drag of a card in a column with other cards returns it to its index', async ({ page }) => {
    const order = () => page.evaluate(
      () => [...document.querySelectorAll('#column-open-list > .task-wrapper')].map(el => el.getAttribute('data-task-id')),
    )
    await expect.poll(order).toEqual(['open-1', 'open-2'])

    for (const id of ['open-1', 'open-2']) {
      await pickUp(page, card(page, id))
      await hover(page, zone(page, 'waiting'))
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await expectCardIn(page, id, 'open')
      await expect.poll(order).toEqual(['open-1', 'open-2'])
    }

    // ...and the card still drags on from where it was
    await drag(page, card(page, 'open-2'), zone(page, 'waiting'))
    await expectCardIn(page, 'open-2', 'waiting')
  })

  test('keyboard: Space, ArrowLeft, Escape puts the sole Jetzt card back and it drags on', async ({ page }) => {
    const live = page.locator('body > [aria-live]')
    await card(page, JETZT.id).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowLeft')
    await expect(live).toContainText('Spalte Offen', { timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(live).toContainText('abgebrochen')
    await expectCardIn(page, JETZT.id, 'progress')
    await expectDragSettled(page)

    // A second keyboard drag ends in the other column, with the right origin
    await card(page, JETZT.id).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowLeft')
    await expect(live).toContainText('Spalte Offen', { timeout: 5000 })
    await page.keyboard.press('Space')
    await expectCardIn(page, JETZT.id, 'open')
  })

  test('control: out and in as separate drags, repeated, never vanishes', async ({ page }) => {
    for (let round = 0; round < 3; round++) {
      await drag(page, card(page, JETZT.id), card(page, 'open-1'))
      await expectCardIn(page, JETZT.id, 'open')
      await drag(page, card(page, JETZT.id), zone(page, 'progress'))
      await expectCardIn(page, JETZT.id, 'progress')
    }
  })
})
