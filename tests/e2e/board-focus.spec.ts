import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover, dropSettled } from './helpers/dnd'

/**
 * #161: the topic focus. A muted funnel beside ⋯ opens the topic chips; picking one hides the cards of every
 * other topic in Offen, Wartet and Erledigt and shows the pill "Fokus: <topic> · n ausgeblendet". A card in
 * Jetzt is never hidden. The focus is kept across a reload (it ends with its day: unit tests). Drags use
 * page.mouse (docs/testing/e2e-dnd-patterns.md).
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

const TASKS = [
  task({ id: 'run', title: 'Garten planen', status: 1, topic: 'Garten' }),
  task({ id: 'a1', title: 'Angebot Müller', status: 0, topic: 'Baustelle' }),
  task({ id: 'b1', title: 'Rechnung Büro', status: 0, topic: 'Büro' }),
  task({ id: 'a2', title: 'Aufmaß prüfen', status: 0, topic: 'Baustelle' }),
  task({ id: 'b2', title: 'Post sortieren', status: 0, topic: 'Büro' }),
  task({ id: 'n1', title: 'Ohne Thema', status: 0 }),
  task({ id: 'w1', title: 'Material bestellen', status: 2, topic: 'Baustelle' }),
  task({ id: 'w2', title: 'Steuerberater anrufen', status: 2, topic: 'Büro' }),
  task({ id: 'd1', title: 'Skizze fertig', status: 3, topic: 'Büro', completedAt: NOW }),
]

const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const list = (page: Page, column: 'open' | 'progress' | 'waiting' | 'done') => page.locator(`#column-${column}-list`)
const ids = (page: Page, column: 'open' | 'progress' | 'waiting' | 'done') =>
  list(page, column).locator(':scope > .task-wrapper').evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))
const trigger = (page: Page) => page.getByTestId('focus-trigger')
const pillText = (page: Page) => page.getByTestId('focus-pill-text')

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(card(page, 'a1')).toBeVisible()
}

test.describe('topic focus (#161)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, TASKS, {}, undefined, { once: true })
  })

  test('rest, chips with counts, picking hides the other topics, Jetzt stays, the pill ends it', async ({ page }) => {
    await gotoBoard(page)
    // Resting: only the muted funnel, no row, no pill
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('focus-bar')).toHaveCount(0)

    await trigger(page).click()
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true')
    // Offen, Wartet and today's Erledigt count; Jetzt is left out ("Garten" has no chip)
    await expect(page.getByTestId('focus-chip')).toHaveText(['Büro4', 'Baustelle3'])

    await page.getByTestId('focus-chip').filter({ hasText: 'Baustelle' }).click()
    await expect(pillText(page)).toHaveText('Fokus: Baustelle · 5 ausgeblendet')
    await expect(trigger(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(trigger(page)).toHaveAccessibleName('Fokus beenden: Baustelle')
    expect(await ids(page, 'open')).toEqual(['a1', 'a2'])
    expect(await ids(page, 'waiting')).toEqual(['w1'])
    expect(await ids(page, 'done')).toEqual([])
    // The Jetzt card is never hidden and keeps its look
    expect(await ids(page, 'progress')).toEqual(['run'])

    await page.getByTestId('focus-end').click()
    await expect(page.getByTestId('focus-bar')).toHaveCount(0)
    expect((await ids(page, 'open')).length).toBe(5)
    expect(await ids(page, 'done')).toEqual(['d1'])
  })

  test('the funnel itself ends an active focus; a reload keeps it', async ({ page }) => {
    await gotoBoard(page)
    await trigger(page).click()
    await page.getByTestId('focus-chip').filter({ hasText: 'Büro' }).click()
    await expect(pillText(page)).toHaveText('Fokus: Büro · 4 ausgeblendet')

    await page.reload()
    await expect(pillText(page)).toHaveText('Fokus: Büro · 4 ausgeblendet')
    expect(await ids(page, 'open')).toEqual(['b1', 'b2'])

    await trigger(page).click()
    await expect(page.getByTestId('focus-bar')).toHaveCount(0)
    expect((await ids(page, 'open')).length).toBe(5)
  })

  test('keyboard: Tab to the funnel, Enter opens the chips, Esc closes them and keeps focus on the funnel', async ({ page }) => {
    await gotoBoard(page)
    await trigger(page).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('focus-chip').first()).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('focus-chip').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('focus-bar')).toHaveCount(0)
    await expect(trigger(page)).toBeFocused()
  })

  test('a drop on a filtered column lands at the previewed slot; hidden cards keep their order behind it', async ({ page }) => {
    await gotoBoard(page)
    await trigger(page).click()
    await page.getByTestId('focus-chip').filter({ hasText: 'Baustelle' }).click()
    await expect(pillText(page)).toBeVisible()

    await pickUp(page, card(page, 'a2'))
    await hover(page, card(page, 'a1'), { fromTop: 10 })
    await page.mouse.up()
    await dropSettled(page)
    expect(await ids(page, 'open')).toEqual(['a2', 'a1'])

    await page.getByTestId('focus-end').click()
    expect(await ids(page, 'open')).toEqual(['a2', 'a1', 'b1', 'b2', 'n1'])
  })

  test('a Jetzt card pulled out to a hidden topic is hidden at once and counted', async ({ page }) => {
    await gotoBoard(page)
    await trigger(page).click()
    await page.getByTestId('focus-chip').filter({ hasText: 'Baustelle' }).click()
    await expect(pillText(page)).toHaveText('Fokus: Baustelle · 5 ausgeblendet')

    await pickUp(page, card(page, 'run'))
    await hover(page, card(page, 'a1'))
    await page.mouse.up()
    await dropSettled(page)

    await expect(card(page, 'run')).toHaveCount(0)
    await expect(pillText(page)).toHaveText('Fokus: Baustelle · 6 ausgeblendet')
  })
})
