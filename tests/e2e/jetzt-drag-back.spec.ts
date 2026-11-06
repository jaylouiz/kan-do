import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover, edgeDwell, showColumnPage } from './helpers/dnd'

/**
 * #372: a Jetzt card dragged out over another column and back over Jetzt (pointer still down) shows
 * its landing slot in Jetzt again and leaves no placeholder behind in the other column. While the
 * card is out, Jetzt renders no card (dnd-kit moved the node to the other column) but still holds the
 * task in the store: the drop zone must judge the column by what it renders, and the WIP check must
 * judge the card by the column the drag started in, not the one it was last sorted into.
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

const JETZT = task({ id: 'jetzt-1', title: 'Review schreiben', status: 1 })
const OFFEN = [
  task({ id: 'open-1', title: 'Konzept ausarbeiten', status: 0 }),
  task({ id: 'open-2', title: 'Dokumentation lesen', status: 0 }),
]
const WARTET = task({ id: 'wait-1', title: 'Blocker klären', status: 2 })

const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const list = (page: Page, column: 'open' | 'progress' | 'waiting' | 'done') => page.locator(`#column-${column}-list`)
const zone = (page: Page, column: 'open' | 'progress' | 'waiting') =>
  list(page, column).locator(':scope > .column-drop-zone')
const ghosts = (page: Page) => page.locator('.column-drop-zone__ghost')
const placeholders = (page: Page) => page.locator('.kando-dnd-dragged')
const ids = (page: Page, column: 'open' | 'progress' | 'waiting' | 'done') =>
  list(page, column).locator(':scope > .task-wrapper').evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(card(page, JETZT.id)).toBeVisible()
}

/** The placeholder node (wherever dnd-kit left it) shows no grey slot: the drop zone ghost is the only one */
async function expectSlotHidden(page: Page) {
  await expect(page.locator('.kando-dnd-dragged .task')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
}

for (const target of [
  { name: 'a non-empty column (Offen)', column: 'open' as const, tasks: [...OFFEN, JETZT, WARTET], over: () => 'open-1' },
  { name: 'an empty column (Wartet)', column: 'waiting' as const, tasks: [...OFFEN, JETZT], over: () => null },
]) {
  test.describe(`Jetzt card out over ${target.name} and back (#372)`, () => {
    test.beforeEach(async ({ context, page }) => {
      await seedLocalBoard(context, target.tasks)
      await gotoBoard(page)
    })

    const hoverTarget = (page: Page) => {
      const overId = target.over()
      return overId ? card(page, overId) : zone(page, target.column)
    }

    test('shows the slot in Jetzt again, none left in the other column; dropping keeps the task in Jetzt', async ({ page }) => {
      await pickUp(page, card(page, JETZT.id))
      await hover(page, hoverTarget(page))
      if (target.column === 'waiting') {
        // Out over an empty column: its ghost is the slot, the node stays at its origin, hidden
        await expect(zone(page, 'waiting').locator('.column-drop-zone__ghost')).toHaveCount(1)
        await expectSlotHidden(page)
      } else {
        // Out over a card: the node moved there, Jetzt renders no card and shows nothing
        await expect(list(page, 'open').locator('.kando-dnd-dragged')).toHaveCount(1)
        await expect(ghosts(page)).toHaveCount(0)
      }

      await hover(page, target.column === 'waiting' ? card(page, JETZT.id) : zone(page, 'progress'))
      // Back: Jetzt shows the slot again (its own placeholder or the ghost), the other column none
      await expect(ghosts(page)).toHaveCount(target.column === 'waiting' ? 0 : 1)
      if (target.column === 'waiting') {
        await expect(list(page, 'progress').locator('.kando-dnd-dragged')).toHaveCount(1)
      } else {
        await expect(zone(page, 'progress').locator('.column-drop-zone__ghost')).toHaveCount(1)
        // The dragged node may still sit in Offen, but only as an invisible slot
        await expectSlotHidden(page)
      }

      await page.mouse.up()
      await expect.poll(() => ids(page, 'progress')).toEqual([JETZT.id])
      expect(await ids(page, 'open')).toEqual(target.tasks.filter(t => t.status === 0).map(t => t.id))
      expect(await ids(page, 'waiting')).toEqual(target.tasks.filter(t => t.status === 2).map(t => t.id))
      await expect(placeholders(page)).toHaveCount(0)
      await expect(ghosts(page)).toHaveCount(0)
    })

    test('out -> back -> out again: dropping in the other column still moves the card there', async ({ page }) => {
      await pickUp(page, card(page, JETZT.id))
      await hover(page, hoverTarget(page))
      await hover(page, target.column === 'waiting' ? card(page, JETZT.id) : zone(page, 'progress'))
      await expect(list(page, 'progress').locator('.kando-dnd-dragged')).toHaveCount(target.column === 'waiting' ? 1 : 0)
      await expect(ghosts(page)).toHaveCount(target.column === 'waiting' ? 0 : 1)
      await hover(page, hoverTarget(page))
      await page.mouse.up()

      await expect.poll(() => ids(page, 'progress')).toEqual([])
      await expect(card(page, JETZT.id)).toHaveCount(1)
      expect(await ids(page, target.column)).toContain(JETZT.id)
      await expect(placeholders(page)).toHaveCount(0)
      await expect(ghosts(page)).toHaveCount(0)
    })
  })
}

test.describe('WIP limit on Jetzt (#372)', () => {
  test('a different card still cannot be dropped into an occupied Jetzt', async ({ context, page }) => {
    await seedLocalBoard(context, [...OFFEN, JETZT, WARTET])
    await gotoBoard(page)

    await pickUp(page, card(page, 'open-1'))
    await hover(page, card(page, JETZT.id))
    await expect(ghosts(page)).toHaveCount(0)
    await hover(page, zone(page, 'progress'))
    await expect(ghosts(page)).toHaveCount(0)
    await page.mouse.up()

    await expect.poll(() => ids(page, 'open')).toEqual(['open-1', 'open-2'])
    expect(await ids(page, 'progress')).toEqual([JETZT.id])
    await expect(placeholders(page)).toHaveCount(0)
  })
})

test.describe('Jetzt card out and back at 390px with edge-scroll (#372)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('dwell to Offen, over a card, dwell back: the slot shows in Jetzt again and the drop keeps it there', async ({ context, page }) => {
    await seedLocalBoard(context, [...OFFEN, JETZT, WARTET])
    await gotoBoard(page)
    await showColumnPage(page, 1)
    // The page slide must be over before the press: poll the card into the 390px viewport
    await expect.poll(async () => (await card(page, JETZT.id).boundingBox())?.x).toBeCloseTo(16, 0)

    await pickUp(page, card(page, JETZT.id))
    await edgeDwell(page, 'left')
    await hover(page, card(page, 'open-1'))
    await expect(list(page, 'open').locator('.kando-dnd-dragged')).toHaveCount(1)

    await edgeDwell(page, 'right')
    await hover(page, zone(page, 'progress'))
    await expect(zone(page, 'progress').locator('.column-drop-zone__ghost')).toHaveCount(1)
    await expect(ghosts(page)).toHaveCount(1)
    await expectSlotHidden(page)

    await page.mouse.up()
    await expect.poll(() => ids(page, 'progress')).toEqual([JETZT.id])
    expect(await ids(page, 'open')).toEqual(['open-1', 'open-2'])
    await expect(placeholders(page)).toHaveCount(0)
    await expect(ghosts(page)).toHaveCount(0)
  })
})
