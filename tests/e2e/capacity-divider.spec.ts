import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard, seedWorkHistory, type SeedTask } from './helpers/seed'
import { pickUp, hover, dropSettled } from './helpers/dnd'
import { settleAnimations } from './helpers/settle'

/**
 * #132: the Kapazität divider in the Offen list. Planned time = remaining time box of Jetzt, Wartet and Offen (a card
 * without a box counts 30 min) against the day's capacity: 6 h until the app has 5 tracked days to learn from.
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
const hours = (h: number) => h * 3600
const open = (id: string, h: number | null): SeedTask =>
  task({ id, title: `Karte ${id}`, status: 0, timeBoxSeconds: h === null ? null : hours(h) })

const list = (page: Page) => page.locator('#column-open-list')
const divider = (page: Page) => page.getByTestId('capacity-divider')
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)

/** The task ids of the Offen list in DOM order with the divider as `|`: "a b | c". */
const layout = (page: Page) =>
  list(page).locator(':scope > .task-wrapper, :scope > .task-stack, :scope > [data-testid="capacity-divider"]')
    .evaluateAll(els => els.map(el => el.getAttribute('data-task-id') ?? '|').join(' '))

async function gotoBoard(page: Page, firstCard: string) {
  await page.goto('/tasks')
  await expect(card(page, firstCard)).toBeVisible()
  await settleAnimations(page)
}

// tall enough that the fourth card is on screen for the drag
test.use({ viewport: { width: 1280, height: 1100 } })

test.describe('Capacity divider in Offen (#132)', () => {
  test('sits right after the card that exactly fills the 6 h day, the rest follows below it', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 3), open('b', 2), open('c', 1), open('d', 1)])
    await gotoBoard(page, 'a')
    await expect(divider(page)).toBeVisible()
    await expect.poll(() => layout(page)).toBe('a b c | d')
    await expect(divider(page).getByRole('separator', { name: 'Kapazität' })).toBeVisible()
    await expect(divider(page)).toContainText('wichtigsten Aufgaben über dieser Linie')
  })

  test('is not there when everything fits', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 2), open('b', 1), open('c', null)])
    await gotoBoard(page, 'a')
    await expect(divider(page)).toHaveCount(0)
    await expect.poll(() => layout(page)).toBe('a b c')
  })

  test('is not there when Offen is empty, however full the day already is', async ({ context, page }) => {
    await seedLocalBoard(context, [task({ id: 'w1', title: 'Wartet', status: 2, timeBoxSeconds: hours(9) })])
    await page.goto('/tasks')
    await expect(page.locator('.task-wrapper[data-task-id="w1"]')).toBeVisible()
    await expect(divider(page)).toHaveCount(0)
  })

  test('counts Jetzt and Wartet first and a card without a box as 30 minutes', async ({ context, page }) => {
    await seedLocalBoard(context, [
      task({ id: 'now', title: 'Jetzt', status: 1, timeBoxSeconds: hours(2), timeSpentSeconds: 0 }),
      task({ id: 'wait', title: 'Wartet', status: 2, timeBoxSeconds: hours(2) }),
      open('a', 1), open('b', null), open('c', null), open('d', 1),
    ])
    await gotoBoard(page, 'a')
    // 2 h + 2 h + 1 h + 0.5 h + 0.5 h = 6 h: full after c
    await expect.poll(() => layout(page)).toBe('a b c | d')
  })

  test('learns the length of the day: five tracked 3 h days make 3 h the capacity', async ({ context, page }) => {
    await seedWorkHistory(context, 5, 3)
    await seedLocalBoard(context, [open('a', 1), open('b', 1), open('c', 1), open('d', 1)])
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b c | d')
  })

  test('reads malformed stored history as no history (6 h day)', async ({ context, page }) => {
    await context.addInitScript(() => {
      localStorage.setItem('taskStatistics', JSON.stringify({ workSessions: [null, { start: 'x' }, 'y', { start: 5, end: 1 }] }))
    })
    await seedLocalBoard(context, [open('a', 3), open('b', 3), open('c', 1)])
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b | c')
  })

  test('the info button is keyboard reachable and opens the popover that says the estimate learns', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 6), open('b', 1)])
    await gotoBoard(page, 'a')
    const info = page.getByTestId('capacity-info')
    await info.focus()
    await expect(info).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('capacity-info-text')).toContainText('lernt mit')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('capacity-info-text')).toHaveCount(0)
  })

  test('a working day set in Einstellungen replaces the learned one, survives a reload and ends with Automatisch (#306)', async ({ context, page }) => {
    await seedWorkHistory(context, 5, 5) // learned: 5 h, so 4 cards of 1 h fit
    await seedLocalBoard(context, [open('a', 1), open('b', 1), open('c', 1), open('d', 1)], {}, undefined, { once: true })
    await gotoBoard(page, 'a')
    await expect(divider(page)).toHaveCount(0)

    await page.goto('/settings')
    const select = page.getByTestId('working-hours-select')
    await expect(select).toContainText('Automatisch')
    await select.click()
    await page.getByRole('option', { name: '3 h', exact: true }).click()
    await expect(select).toContainText('3 h')
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-store') ?? '{}').workingHoursMinutes)).toBe(180)

    await page.goto('/tasks')
    await expect(card(page, 'a')).toBeVisible()
    await expect.poll(() => layout(page)).toBe('a b c | d')
    await page.getByTestId('capacity-info').click()
    await expect(page.getByTestId('capacity-info-text')).toContainText('Arbeitszeit')
    await page.keyboard.press('Escape')

    await page.reload() // A -> B -> reload: still B
    await expect.poll(() => layout(page)).toBe('a b c | d')

    await page.goto('/settings')
    await select.click()
    await page.getByRole('option', { name: 'Automatisch' }).click()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-store') ?? '{}').workingHoursMinutes)).toBeNull()
    await page.goto('/tasks')
    await expect(card(page, 'a')).toBeVisible()
    await expect(divider(page)).toHaveCount(0)
  })

  test('a set working day is not held to the 2-10 h clamp of the learned one (12 h)', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 8), open('b', 3), open('c', 2), open('d', 1)])
    await context.addInitScript(() => localStorage.setItem('settings-store', JSON.stringify({ focusEnabled: false, workingHoursMinutes: 720 })))
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b c | d') // 8 + 3 + 2 = 13 h reaches 12 h at c; the learned clamp (10 h) would end the day after b
  })

  test('a malformed stored working day reads as Automatisch (6 h day) and shows as such in Einstellungen', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 3), open('b', 3), open('c', 1)])
    await context.addInitScript(() => localStorage.setItem('settings-store', JSON.stringify({ focusEnabled: false, workingHoursMinutes: 100 })))
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b | c')
    await page.goto('/settings')
    await expect(page.getByTestId('working-hours-select')).toContainText('Automatisch')
  })

  test('moves when a card is dragged above it (A -> B -> A) and is no drag target itself', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 4), open('b', 1), open('c', 1), open('d', 1)])
    await gotoBoard(page, 'a')
    await expect.poll(() => layout(page)).toBe('a b c | d')

    // d above a: d a b c, 1 + 4 = 5 h, b fills the day
    await pickUp(page, card(page, 'd'))
    await hover(page, card(page, 'a'), { fromTop: 10 })
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => layout(page)).toBe('d a b | c')

    // and back: a before d. a d b c: 4 + 1 = 5, b is at 6
    await pickUp(page, card(page, 'a'))
    await hover(page, card(page, 'd'), { fromTop: 10 })
    await page.mouse.up()
    await dropSettled(page)
    await expect.poll(() => layout(page)).toBe('a d b | c')
    await expect(divider(page)).toHaveCount(1)
  })

  test('stays out of the other columns', async ({ context, page }) => {
    await seedLocalBoard(context, [open('a', 6), open('b', 1),
      task({ id: 'w1', title: 'W', status: 2, timeBoxSeconds: hours(8) })])
    await gotoBoard(page, 'a')
    const count = (sel: Locator) => sel.getByTestId('capacity-divider').count()
    expect(await count(page.locator('#column-waiting-list'))).toBe(0)
    expect(await count(page.locator('#column-progress-list'))).toBe(0)
    expect(await count(page.locator('#column-done-list'))).toBe(0)
  })
})
