import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  MIXED_SEED_TASKS, atDaysAgo, dayKeyDaysAgo, newDayTasks, seedDayRecapStore, seedMixedBoard, seedNewDayBoard,
  type SeedTask,
} from './helpers/seed'

/** Issue #385: "Kurzer Rückblick" on the first start of a new day. Local tasks unless a test says otherwise. */

const recap = (page: Page) => page.getByTestId('new-day-recap')
const summary = (page: Page) => page.getByTestId('recap-summary')
const continueButton = (page: Page) => page.getByTestId('recap-continue')
const archiveSwitch = (page: Page) => page.getByTestId('recap-archive-toggle')
const board = (page: Page) => page.locator('main[data-task-sheet-return]')
const doneColumn = (page: Page) => page.locator('#column-done')
const marker = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('day-recap-store') ?? 'null') as { lastShownDay: string, archiveDone: boolean } | null)
const archived = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { archivedTaskIds?: string[] }).archivedTaskIds ?? [])

/** The former "Schön gemacht" / "{n} erledigte Aufgaben abgelegt" toast with "Rückgängig" is gone (#463). */
async function expectNoArchiveToast(page: Page) {
  await expect(page.getByText('Schön gemacht')).toHaveCount(0)
  await expect(page.getByText(/erledigte Aufgaben? abgelegt/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0)
}

const deck = (page: Page, kind: 'done' | 'undone') => page.getByTestId(`recap-deck-${kind}`)
const counter = (page: Page, kind: 'done' | 'undone') => deck(page, kind).locator('xpath=ancestor::section[1]').getByTestId('recap-deck-counter')
const nextChevron = (page: Page, kind: 'done' | 'undone') => page.getByTestId(`recap-next-${kind}`)
const prevChevron = (page: Page, kind: 'done' | 'undone') => page.getByTestId(`recap-prev-${kind}`)
/** Title of the front card of a deck (the one on top of the layers). */
const frontTitle = (page: Page, kind: 'done' | 'undone') => deck(page, kind).locator('.recap-deck__card[style*="z-index: 10"] .task-title-text')

/** Everything that must not move while a deck is looked at (#451): boxes of the page parts and the overlay's scroll size. */
async function layoutSnapshot(page: Page) {
  const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())
  const parts = {
    headline: recap(page).locator('h1'),
    summary: summary(page),
    headingUndone: page.getByTestId('recap-deck-label').first(),
    headingDone: page.getByTestId('recap-deck-label').last(),
    deckUndone: deck(page, 'undone'),
    deckDone: deck(page, 'done'),
    barUndone: deck(page, 'undone').locator('xpath=following-sibling::div[1]'),
    barDone: deck(page, 'done').locator('xpath=following-sibling::div[1]'),
    panel: archiveSwitch(page).locator('xpath=ancestor::div[contains(@class,"ring")][1]'),
  }
  const boxes: Record<string, unknown> = {}
  for (const [name, locator] of Object.entries(parts)) boxes[name] = await box(locator.first())
  const scroll = await recap(page).evaluate(el => ({ scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollTop: el.scrollTop }))
  return { boxes, scroll }
}

/** A done task with a long title, notes and topic: the deck height must not depend on it (#451). */
const recapLongTask = (): SeedTask => ({
  id: 'nd-long', title: 'Sehr langer Aufgabentitel, der sauber umbrechen muss, ohne die Zeile zu sprengen und ohne die Höhe des Stapels zu ändern',
  status: 3, priority: 3, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, notes: 'Lange Notizen '.repeat(30), completedAt: atDaysAgo(1, 8),
})

test.describe('New-day recap (#385)', () => {
  test('opens over a board that mounted behind it, with headline, sentence and two decks', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')

    await expect(recap(page)).toBeVisible()
    await expect(recap(page)).toHaveAttribute('role', 'dialog')
    await expect(recap(page)).toHaveAttribute('aria-modal', 'true')
    await expect(page.getByRole('dialog', { name: 'Kurzer Rückblick' })).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
    await expect(deck(page, 'done')).toHaveAccessibleName('4 erledigt, mit Pfeiltasten wechseln')
    await expect(deck(page, 'undone')).toHaveAccessibleName('2 noch offen, mit Pfeiltasten wechseln')
    // The board is mounted behind, inert and hidden from assistive tech
    await expect(board(page)).toHaveAttribute('inert', '')
    await expect(board(page)).toHaveAttribute('aria-hidden', 'true')
    await expect(board(page).locator('[data-task-id="nd-open-1"]').first()).toBeAttached()
    await expect(continueButton(page)).toBeFocused()
  })

  test('switch on: "Weiter zum Board" archives without a toast and does not reopen', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(archiveSwitch(page)).toBeChecked()

    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expect.poll(() => archived(page)).toHaveLength(4)
    await expectNoArchiveToast(page)
    await expect(doneColumn(page).getByTestId('yesterday-ack')).toHaveCount(0)
    await expect.poll(async () => (await marker(page))?.lastShownDay).toBe(dayKeyDaysAgo(0))

    // Sequence: a reload the same day neither reopens the recap nor brings the tasks back
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect(board(page)).not.toHaveAttribute('inert', '')
    expect(await archived(page)).toHaveLength(4)
  })

  test('switch off: the board stays as it is, no toast; the choice survives a reload and the next recap', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')

    await archiveSwitch(page).uncheck()
    await expect.poll(async () => (await marker(page))?.archiveDone).toBe(false)
    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expectNoArchiveToast(page)
    expect(await archived(page)).toEqual([])
    await expect(doneColumn(page).getByTestId('yesterday-ack')).toBeVisible()

    // Sequence: reload the same day (no recap), then a later day (recap again, switch still off)
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)

    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem('day-recap-store') as string)
      localStorage.setItem('day-recap-store', JSON.stringify({ ...state, lastShownDay: key }))
    }, dayKeyDaysAgo(1))
    // Reload on purpose (#512): a later day is a persisted marker change, the recap must open on the next load
    await page.reload()
    await expect(recap(page)).toBeVisible()
    await expect(archiveSwitch(page)).not.toBeChecked()
  })

  test('Escape follows the switch: archives when on, does nothing when off', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
    await expect.poll(() => archived(page)).toHaveLength(4)
    await expectNoArchiveToast(page)
    // Focus goes to the board region, never <body>
    await expect(board(page)).toBeFocused()
  })

  test('Escape with the switch off leaves the board unchanged', async ({ page, context }) => {
    await seedNewDayBoard(context, { archiveDone: false })
    await page.goto('/tasks')
    await expect(archiveSwitch(page)).not.toBeChecked()
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
    expect(await archived(page)).toEqual([])
    await expectNoArchiveToast(page)
  })

  test('a reload the same day does not open it again', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    // Reload on purpose (#512): the reload itself is the behaviour under test (the recap must not reopen the same day)
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
  })

  test('everything done: "alle Aufgaben" and only the Erledigt deck', async ({ page, context }) => {
    await seedNewDayBoard(context, { allDone: true })
    await page.goto('/tasks')
    await expect(summary(page)).toHaveText('Du hast gestern alle Aufgaben erledigt.')
    await expect(deck(page, 'done')).toHaveAccessibleName('4 erledigt, mit Pfeiltasten wechseln')
    await expect(deck(page, 'undone')).toHaveCount(0)
    // alone, the Erledigt deck is centred
    const alone = (await deck(page, 'done').boundingBox())!
    const viewport = page.viewportSize()!
    expect(Math.abs(alone.x + alone.width / 2 - viewport.width / 2)).toBeLessThan(2)
  })

  test('the seed URL opens it too: ?seed=newday', async ({ page }) => {
    await page.goto('/tasks?seed=newday')
    await expect(recap(page)).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
  })

  test('a task title on a card carries data-private', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(deck(page, 'done').locator('.task-title-text[data-private]')).toHaveCount(4)
    await expect(deck(page, 'undone').locator('.task-title-text[data-private]')).toHaveCount(2)
  })

  test('the recap has no accessibility violations at rest and after one advance', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const violations = async () => (await new AxeBuilder({ page }).include('[data-testid="new-day-recap"]').analyze())
      .violations.map(v => `${v.id}: ${v.help} ${JSON.stringify(v.nodes.map(n => n.html.slice(0, 200)))}`)
    await expect(deck(page, 'done')).toBeVisible()
    expect(await violations()).toEqual([])
    await nextChevron(page, 'done').click()
    await expect(counter(page, 'done')).toHaveText('2 / 4')
    expect(await violations()).toEqual([])
  })

  test('Offen sits left of Erledigt with each heading above its cards, on one baseline', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const [undone, done] = [(await deck(page, 'undone').boundingBox())!, (await deck(page, 'done').boundingBox())!]
    expect(undone.x + undone.width).toBeLessThanOrEqual(done.x)
    expect(Math.abs(undone.y - done.y)).toBeLessThan(1)
    const headings = page.getByTestId('recap-deck-label')
    await expect(headings).toHaveText(['2 noch offen', '4 erledigt'])
    const [hUndone, hDone] = [(await headings.first().boundingBox())!, (await headings.last().boundingBox())!]
    expect(hUndone.y + hUndone.height).toBeLessThanOrEqual(undone.y)
    expect(hDone.y + hDone.height).toBeLessThanOrEqual(done.y)
    expect(Math.abs(hUndone.y - hDone.y)).toBeLessThan(1)
    // headline and sentence above both, the submit panel below both
    const head = (await summary(page).boundingBox())!
    const panel = (await archiveSwitch(page).boundingBox())!
    expect(head.y + head.height).toBeLessThanOrEqual(hUndone.y)
    expect(panel.y).toBeGreaterThanOrEqual(Math.max(undone.y + undone.height, done.y + done.height))
  })

  test('the submit panel groups switch and button: side by side when wide, the arrow icon after the label', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const panel = archiveSwitch(page).locator('xpath=ancestor::div[contains(@class,"ring")][1]')
    const panelBox = (await panel.boundingBox())!
    const toggle = (await archiveSwitch(page).boundingBox())!
    const button = (await continueButton(page).boundingBox())!
    expect(toggle.x + toggle.width).toBeLessThan(button.x)
    // one row, both vertically centred in the panel
    expect(Math.abs(toggle.y + toggle.height / 2 - (button.y + button.height / 2))).toBeLessThan(6)
    expect(Math.abs(panelBox.y + panelBox.height / 2 - (button.y + button.height / 2))).toBeLessThan(2)
    await expect(continueButton(page)).toHaveAccessibleName('Weiter zum Board')
    // trailing: the icon is the last child of the button, after the label, and decorative
    const icon = continueButton(page).locator('svg[data-slot="trailingIcon"]')
    await expect(icon).toHaveAttribute('aria-hidden', 'true')
    const iconBox = (await icon.boundingBox())!
    const buttonBox = (await continueButton(page).boundingBox())!
    expect(iconBox.x + iconBox.width).toBeGreaterThan(buttonBox.x + buttonBox.width / 2)
  })

  test('a drag past 80px advances, 60px snaps back; the next card is the new front and the counter wraps', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const front = frontTitle(page, 'done')
    await expect(front).toHaveText('Retrospektive nachbereiten')
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    const box = (await deck(page, 'done').boundingBox())!
    const y = box.y + 60
    const drag = async (from: number, to: number) => {
      await page.mouse.move(box.x + from, y)
      await page.mouse.down()
      await page.mouse.move(box.x + (from + to) / 2, y, { steps: 3 })
      await page.mouse.move(box.x + to, y, { steps: 3 })
      await page.mouse.up()
    }
    await drag(140, 80) // 60px left: snaps back
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    await expect(front).toHaveText('Retrospektive nachbereiten')

    await drag(100, 200) // 100px right: advances
    await expect(counter(page, 'done')).toHaveText('2 / 4')
    await expect(front).toHaveText('Steuerunterlagen sortieren')
    await drag(200, 100) // either direction
    await expect(counter(page, 'done')).toHaveText('3 / 4')
    await page.mouse.click(box.x + 140, y) // a tap goes next too
    await expect(counter(page, 'done')).toHaveText('4 / 4')
    await page.mouse.click(box.x + 140, y)
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    await expect(front).toHaveText('Retrospektive nachbereiten')
    // cards are view-only: no task sheet, URL unchanged
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog')).toHaveCount(1)
  })

  test('keyboard and chevrons: ArrowRight x5 advances five, then back with ArrowLeft, only while the deck has focus', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const done = deck(page, 'done')
    await done.focus()
    await expect(done).toBeFocused()
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await expect(counter(page, 'done')).toHaveText('2 / 4') // 5 nexts on 4 cards wrap to the second
    await expect(counter(page, 'undone')).toHaveText('1 / 2')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await expect(counter(page, 'done')).toHaveText('2 / 4') // quick right then left ends where it started
    await page.keyboard.press('ArrowLeft')
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    // a modifier keeps browser shortcuts
    await page.keyboard.press('Alt+ArrowRight')
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 4')

    // the chevron has focus: arrow keys do nothing
    await nextChevron(page, 'done').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 4')
    await nextChevron(page, 'done').click()
    await expect(counter(page, 'done')).toHaveText('2 / 4')
    await prevChevron(page, 'done').click()
    await prevChevron(page, 'done').click()
    await expect(counter(page, 'done')).toHaveText('4 / 4') // 1 / 4 wraps to 4 / 4
    await expect(counter(page, 'undone')).toHaveText('1 / 2')
  })

  test('the chevrons are disabled with a single card, which reads "1 / 1" and never moves', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: [newDayTasks(1)[0]!, newDayTasks(1)[4]!] })
    await page.goto('/tasks')
    await expect(counter(page, 'done')).toHaveText('1 / 1')
    await expect(nextChevron(page, 'done')).toBeDisabled()
    await expect(prevChevron(page, 'done')).toBeDisabled()
    const box = (await deck(page, 'done').boundingBox())!
    await page.mouse.move(box.x + 100, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 220, box.y + 60, { steps: 4 })
    await page.mouse.up()
    await deck(page, 'done').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(450)
    await expect(counter(page, 'done')).toHaveText('1 / 1')
    await expect(frontTitle(page, 'done')).toHaveText('Angebot an Kunden schicken')
  })

  test('the live region announces the new front card after an advance', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const live = deck(page, 'done').locator('xpath=ancestor::section[1]').getByTestId('recap-deck-live')
    await expect(live).toHaveAttribute('aria-live', 'polite')
    await expect(live).toHaveText('')
    await nextChevron(page, 'done').click()
    await expect.poll(() => live.textContent()).toBe('2 von 4: Steuerunterlagen sortieren')
  })

  test('tab order: deck, previous, next per deck, then the switch and the button; focus starts on the button', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(continueButton(page)).toBeFocused()
    const order = ['recap-deck-undone', 'recap-prev-undone', 'recap-next-undone', 'recap-deck-done', 'recap-prev-done', 'recap-next-done', 'recap-archive-toggle', 'recap-continue']
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid'))
    // Tab wraps from the last stop to the first
    await page.keyboard.press('Tab')
    await expect.poll(active).toBe(order[0])
    for (const id of order.slice(1)) {
      await page.keyboard.press('Tab')
      await expect.poll(active).toBe(id)
    }
    await page.keyboard.press('Tab')
    await expect.poll(active).toBe(order[0])
    await page.keyboard.press('Shift+Tab')
    await expect.poll(active).toBe(order.at(-1))
    // Escape still leaves
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
  })

  test('nothing moves: boxes and scroll size are the same at rest, mid-drag, mid-move and after advances and wraps', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), recapLongTask()] })
    await page.goto('/tasks')
    await expect(deck(page, 'done')).toBeVisible()
    const rest = await layoutSnapshot(page)
    expect(rest.scroll.scrollWidth).toBe(rest.scroll.clientWidth)

    const box = (await deck(page, 'done').boundingBox())!
    await page.mouse.move(box.x + 100, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 240, box.y + 70, { steps: 4 })
    expect(await layoutSnapshot(page)).toEqual(rest) // mid-drag
    await page.mouse.up()
    expect(await layoutSnapshot(page)).toEqual(rest) // mid-move (the card is still flying)
    await expect(counter(page, 'done')).toHaveText('2 / 5')

    for (let i = 0; i < 5; i++) {
      await nextChevron(page, 'done').click()
      await nextChevron(page, 'undone').click()
      expect(await layoutSnapshot(page)).toEqual(rest) // mid-move of both decks
    }
    await expect(counter(page, 'done')).toHaveText('2 / 5') // 1 + 1 + 5 wraps once
    await page.waitForTimeout(500)
    expect(await layoutSnapshot(page)).toEqual(rest)
  })

  test('with prefers-reduced-motion the card swaps at once, no slide', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(frontTitle(page, 'done')).toHaveText('Retrospektive nachbereiten')
    await nextChevron(page, 'done').click()
    // within one animation frame the card is swapped, and nothing is flying or fading
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))))
    await expect(frontTitle(page, 'done')).toHaveText('Steuerunterlagen sortieren')
    await expect.poll(() => deck(page, 'done').locator('.recap-deck__card').evaluateAll(els => els.map(el => getComputedStyle(el).transitionDuration))).toEqual(['0s', '0s', '0s', '0s'])
    await page.keyboard.press('Tab')
    await deck(page, 'done').focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(counter(page, 'done')).toHaveText('4 / 4')
  })

  test('a long title, notes and topic do not change the deck or card height', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), recapLongTask()] })
    await page.goto('/tasks')
    const heights = new Set<number>()
    for (let i = 0; i < 5; i++) {
      heights.add(Math.round((await deck(page, 'done').boundingBox())!.height))
      await nextChevron(page, 'done').click()
      await page.waitForTimeout(450)
    }
    expect([...heights]).toHaveLength(1)
    const cardHeights = await deck(page, 'done').locator('.recap-deck__card .task').evaluateAll(els => els.map(el => (el as HTMLElement).offsetHeight))
    expect(new Set(cardHeights).size).toBe(1)
  })

  test('the command palette shortcut does not act behind the page', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(recap(page)).toBeVisible()
  })

  test.describe('Notion stub (mixed board)', () => {
    test('the board fetch has started while the recap is open; Local and Notion tasks are listed source-blind', async ({ page, context }) => {
      const localDone: SeedTask = {
        id: 'local-done-old', title: 'Lokal: erledigt', status: 3, priority: 2, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {},
        completedAt: atDaysAgo(1, 10), source: 'local', externalId: null,
      }
      await seedMixedBoard(context, [...MIXED_SEED_TASKS.filter(t => t.status !== 3), localDone], { once: true })
      await seedDayRecapStore(context, { lastShownDay: dayKeyDaysAgo(2), once: true })

      const fetched = page.waitForRequest('**/api/notion/query-data-source')
      await page.goto('/tasks')
      await expect(recap(page)).toBeVisible()
      await fetched
      await expect(recap(page)).toBeVisible()
      await expect(summary(page)).toContainText('erledigt')
      await expect(deck(page, 'done')).toHaveAccessibleName('1 erledigt')
      await expect(deck(page, 'done')).not.toHaveAttribute('tabindex')
    })
  })

  test('with the focus setting on and a task in Jetzt, no overlay shows while the recap is open, and it behaves as normal after "Weiter zum Board"', async ({ page, context }) => {
    const nowTask: SeedTask = { id: 'nd-now-1', title: 'Gerade in Arbeit', status: 1, priority: 3, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {} }
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), nowTask], focus: true })
    await page.goto('/tasks')

    await expect(recap(page)).toBeVisible()
    await expect(page.locator('#column-progress .task[data-current]')).toBeAttached()
    // Neither mounted under the recap nor fading in while it is up (the overlay needs ~1 s of rest to appear)
    await expect(page.getByTestId('focus-overlay')).toHaveCount(0)
    await expect(page.locator('.board')).not.toHaveAttribute('data-focus', '')
    await page.waitForTimeout(1500)
    await expect(page.getByTestId('focus-overlay')).toHaveCount(0)

    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    // Back on the board the overlay comes on after the usual rest
    await expect(page.locator('.board')).toHaveAttribute('data-focus', '')
    await expect.poll(async () => (await page.getByTestId('focus-overlay').getAttribute('class').catch(() => null))?.includes('is-on') ?? false, { timeout: 8000 }).toBe(true)
  })

  test.describe('390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('decks sit under each other, Offen first, and the submit panel stays pinned with the page scrolled', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: [...newDayTasks(1), ...Array.from({ length: 6 }, (_, i): SeedTask => ({
        id: `nd-extra-${i}`, title: `Weitere erledigte Aufgabe ${i + 1}`, status: 3, priority: 3, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, completedAt: atDaysAgo(1, 9, i),
      }))] })
      await page.goto('/tasks')

      const undone = (await deck(page, 'undone').boundingBox())!
      const done = (await deck(page, 'done').boundingBox())!
      expect(done.y).toBeGreaterThan(undone.y + undone.height - 1)
      await expect(counter(page, 'done')).toHaveText('1 / 10')

      // The panel stacks: switch above, full-width button below, pinned in the viewport at every scroll position
      const button = continueButton(page)
      await expect(button).toBeInViewport({ ratio: 1 })
      await expect(archiveSwitch(page)).toBeInViewport()
      const toggleBox = (await archiveSwitch(page).boundingBox())!
      const box = (await button.boundingBox())!
      expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(box.y)
      expect(box.width).toBeGreaterThan(390 - 2 * 40)
      await recap(page).evaluate(el => { el.scrollTop = el.scrollHeight })
      await expect(button).toBeInViewport({ ratio: 1 })
      await recap(page).evaluate(el => { el.scrollTop = 0 })
      await expect(button).toBeInViewport({ ratio: 1 })

      // a tap and a mouse drag past 80px advance; the page never overflows horizontally, nor does it move
      const rest = await layoutSnapshot(page)
      expect(rest.scroll.scrollWidth).toBe(rest.scroll.clientWidth)
      await deck(page, 'done').scrollIntoViewIfNeeded()
      const before = await layoutSnapshot(page)
      await deck(page, 'done').tap({ position: { x: 140, y: 60 } })
      await expect(counter(page, 'done')).toHaveText('2 / 10')
      const mid = await layoutSnapshot(page)
      expect(mid.scroll).toEqual(before.scroll)
      expect(mid.boxes).toEqual(before.boxes)
      const target = (await deck(page, 'done').boundingBox())!
      await page.mouse.move(target.x + 60, target.y + 60)
      await page.mouse.down()
      await page.mouse.move(target.x + 220, target.y + 60, { steps: 5 })
      expect((await layoutSnapshot(page)).scroll.scrollWidth).toBe(rest.scroll.clientWidth)
      await page.mouse.up()
      expect((await layoutSnapshot(page)).scroll.scrollWidth).toBe(rest.scroll.clientWidth) // fly-off
      await expect(counter(page, 'done')).toHaveText('3 / 10')

      await button.tap()
      await expect(recap(page)).toBeHidden()
    })
  })
})
