import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { settleAnimations } from './helpers/settle'
import { appNav, goToPlace, openDayClose, openMore, openSettings } from './helpers/appNav'
import { expectContrast } from './helpers/contrast'
import { clippedBy, expectStageFits } from './helpers/recapStage'
import {
  MIXED_SEED_TASKS, atDaysAgo, dayKeyDaysAgo, newDayBackTasks, newDayTasks, seedAfterMidnight, seedDayRecapStore, seedMixedBoard, seedNewDayBoard,
  type SeedTask,
} from './helpers/seed'

/** Issue #385: "Tagesrückblick" on the first start of a new day. Local tasks unless a test says otherwise. */

const recap = (page: Page) => page.getByTestId('new-day-recap')
const summary = (page: Page) => page.getByTestId('recap-summary')
/** "Überspringen und Board anzeigen": leaves to the board and keeps it as it is (#428) */
const continueButton = (page: Page) => page.getByTestId('recap-continue')
/** "Neuen Tag planen" (#356, #428): the primary way out, leads to "Alle" */
const planButton = (page: Page) => page.getByTestId('recap-plan')
/** The foot of the one sheet (#707) that holds the two buttons. */
const panelOf = (page: Page) => page.getByTestId('recap-controls')
/** The one paper sheet (#707): the decks and the foot with the buttons. */
const sheetOf = (page: Page) => page.getByTestId('recap-sheet')
const switcher = (page: Page, kind: 'done' | 'undone') => page.getByTestId('recap-switcher').getByRole('tab').nth(kind === 'undone' ? 0 : 1)
const board = (page: Page) => page.locator('main[data-task-sheet-return]')
const doneColumn = (page: Page) => page.locator('#column-done')
const marker = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('day-recap-store') ?? 'null') as { lastShownDay: string } | null)
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
    headline: recap(page).getByRole('heading', { name: 'Tagesrückblick' }),
    summary: summary(page),
    headingUndone: page.getByTestId('recap-deck-label').first(),
    headingDone: page.getByTestId('recap-deck-label').last(),
    deckUndone: deck(page, 'undone'),
    deckDone: deck(page, 'done'),
    barUndone: deck(page, 'undone').locator('xpath=following-sibling::div[1]'),
    barDone: deck(page, 'done').locator('xpath=following-sibling::div[1]'),
    panel: panelOf(page),
  }
  const boxes: Record<string, unknown> = {}
  for (const [name, locator] of Object.entries(parts)) boxes[name] = await box(locator.first())
  const scroll = await recap(page).evaluate(el => ({ scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollTop: el.scrollTop }))
  return { boxes, scroll }
}

/** Boxes that must not move on a phone while the shown deck advances. */
async function layoutSnapshot2(page: Page) {
  const box = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())
  return {
    deck: await box(deck(page, 'done')),
    panel: await box(panelOf(page)),
    drawer: await box(recap(page)),
    page: await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.scrollWidth]),
  }
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
    // A stage, not a dialog (#245): a named region on the welcome photo, the board is not visible behind it
    await expect(recap(page)).toHaveAttribute('role', 'region')
    await expect(page.getByRole('region', { name: 'Tagesrückblick' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('recap-photo')).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
    await expect(deck(page, 'done')).toHaveAccessibleName('4 erledigt, mit Pfeiltasten wechseln')
    await expect(deck(page, 'undone')).toHaveAccessibleName('2 noch offen, mit Pfeiltasten wechseln')
    // The board is mounted behind and inert (which also hides it from assistive tech; no aria-hidden besides)
    await expect(board(page)).toHaveAttribute('inert', '')
    await expect(board(page)).not.toHaveAttribute('aria-hidden')
    // Nothing moved by itself (#387): behind the stage the board holds yesterday's Offen and Wartet cards
    await expect(board(page).locator('[data-task-id="nd-waiting-1"]').first()).toBeAttached()
    await expect(board(page).locator('#column-open [data-task-id="nd-open-1"]').first()).toBeAttached()
    await expect(planButton(page)).toBeFocused()
  })

  test('the day close cannot open over the recap: the Mehr row is disabled and the recap stays the only stage (#480)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    const panel = await openMore(page)
    await expect(panel.getByTestId('more-day-close')).toBeDisabled()
    await expect(page.getByRole('region', { name: 'Tag abschließen' })).toHaveCount(0)
    await expect(recap(page)).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-recap-stage', '')
  })

  test('the board is never visible before the recap, on a fresh load and back from another page (#427)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    // Every frame of the page load: a column of the board that is painted while the recap is not (fully) there is the flash
    await context.addInitScript(() => {
      const w = window as unknown as { __flash: string[] }
      w.__flash = []
      const sample = () => {
        const column = document.querySelector('main[data-task-sheet-return] .board')
        if (column && getComputedStyle(column).visibility === 'visible') {
          const stage = document.querySelector('[data-testid="new-day-recap"]')
          if (!stage || getComputedStyle(stage).opacity !== '1') w.__flash.push(stage ? 'fading-in' : 'no-recap')
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    expect(await page.evaluate(() => (window as unknown as { __flash: string[] }).__flash)).toEqual([])

    // Settings and back: the recap is still open, and the page mounts with it
    await openSettings(page)
    await page.evaluate(() => { (window as unknown as { __flash: string[] }).__flash = [] })
    await goToPlace(page, 'Heute')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    expect(await page.evaluate(() => (window as unknown as { __flash: string[] }).__flash)).toEqual([])

    // Leaving shows the live board
    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expect(doneColumn(page)).toBeVisible()
  })

  test('opens on the first return of a new day without a click or navigation, not while the window stays focused (#242)', async ({ page, context }) => {
    // Done today, the marker is today: nothing is due. The page clock is then moved a day on, as after a night.
    await seedNewDayBoard(context, { daysAgo: 0, lastShownDay: dayKeyDaysAgo(0) })
    await context.addInitScript(() => {
      const RealDate = Date
      const w = window as unknown as { __shiftMs: number }
      w.__shiftMs = 0
      class ShiftedDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(RealDate.now() + w.__shiftMs)
          else super(...(args as [number]))
        }
        static now() { return RealDate.now() + w.__shiftMs }
      }
      window.Date = ShiftedDate as unknown as DateConstructor
    })
    await page.goto('/tasks')
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toBeHidden()

    // 09:00 of the next local day, whatever the hour the test runs at (a fixed 26h lands on D+2 after 22:00)
    await page.evaluate(() => {
      const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0)
      ;(window as unknown as { __shiftMs: number }).__shiftMs = next.getTime() - Date.now()
    })
    await page.waitForTimeout(300)
    await expect(recap(page)).toBeHidden() // still focused: the user is working, nothing opens by itself

    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(recap(page)).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
  })

  test('deck headings are centred and a Wartet card keeps the regular style (#242)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    for (const kind of ['done', 'undone'] as const) {
      const section = deck(page, kind).locator('xpath=ancestor::section[1]')
      const heading = section.getByTestId('recap-deck-label')
      expect(await heading.evaluate(el => getComputedStyle(el).textAlign)).toBe('center')
      const h = (await heading.boundingBox())!
      const d = (await deck(page, kind).boundingBox())!
      expect(Math.abs(h.x + h.width / 2 - (d.x + d.width / 2))).toBeLessThan(2)
    }
    // the Wartet card is the second undone card: the deck's second layer holds it
    await nextChevron(page, 'undone').click()
    await expect(counter(page, 'undone')).toHaveText('2 / 2')
    await settleAnimations(page)
    const waiting = deck(page, 'undone').locator('.task-waiting')
    await expect(waiting).toHaveCount(1)
    expect(await waiting.evaluate(el => getComputedStyle(el).filter)).toBe('none')
  })

  test('"Neuen Tag planen" archives the done tasks without a toast and the recap does not reopen', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    // No archive switch any more (#428)
    await expect(page.getByTestId('recap-archive-toggle')).toHaveCount(0)

    await planButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expect.poll(() => archived(page)).toHaveLength(4)
    await expectNoArchiveToast(page)
    await expect.poll(async () => (await marker(page))?.lastShownDay).toBe(dayKeyDaysAgo(0))
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('day-recap-store') ?? '{}'))).not.toHaveProperty('archiveDone')

    // Sequence: a reload the same day neither reopens the recap nor brings the tasks back
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect(board(page)).not.toHaveAttribute('inert', '')
    expect(await archived(page)).toHaveLength(4)
  })

  test('"Überspringen und Board anzeigen" archives nothing: the done tasks wait under the "Gestern erledigt" note, and "Gesehen" hides them in one click (#428)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')

    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expectNoArchiveToast(page)
    expect(await archived(page)).toEqual([])
    await expect(doneColumn(page).getByTestId('yesterday-ack')).toBeVisible()
    await expect.poll(async () => (await marker(page))?.lastShownDay).toBe(dayKeyDaysAgo(0))

    // Sequence: a reload the same day (no recap), the note is still there; one click archives all four
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await doneColumn(page).getByTestId('yesterday-ack').click()
    await expect.poll(() => archived(page)).toHaveLength(4)
    await expect(doneColumn(page).getByTestId('yesterday-ack')).toHaveCount(0)
  })

  test('Escape dismisses without archiving and focus goes to the board region, never <body>', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
    expect(await archived(page)).toEqual([])
    await expectNoArchiveToast(page)
    await expect(board(page)).toBeFocused()
  })

  test('the app bar follows the recap (#428): Rückblick and Statistik while it is open, Alle and Heute once it is left', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    const bar = appNav(page)
    await expect(bar.getByTestId('app-nav-place-recap')).toHaveText('Rückblick')
    await expect(bar.getByTestId('app-nav-place-recap')).toHaveAttribute('aria-current', 'page')
    await expect(bar.getByTestId('app-nav-place-all')).toHaveCount(0)
    await expect(bar.getByTestId('app-nav-place-board')).toHaveCount(0)
    await expect(bar.getByTestId('app-nav-continue')).toHaveCount(0)
    await expect(bar.getByTestId('app-nav-place-statistics')).toBeVisible()

    // Statistik is a place of its own: Statistik is current, Rückblick leads back to the same open recap
    await goToPlace(page, 'Statistik')
    await expect(bar.getByTestId('app-nav-place-statistics')).toHaveAttribute('aria-current', 'page')
    await expect(bar.getByTestId('app-nav-place-recap')).not.toHaveAttribute('aria-current', 'page')
    await expect(bar.getByTestId('app-nav-place-board')).toHaveCount(0)
    await bar.getByTestId('app-nav-place-recap').click()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(recap(page)).toBeVisible()
    await expect(bar.getByTestId('app-nav-place-recap')).toHaveAttribute('aria-current', 'page')

    // Leaving: Rückblick turns into Alle + Heute (Heute current, the skip stays on the board); the chip and the move settle
    await continueButton(page).click()
    await expect(recap(page)).toBeHidden()
    await expect(bar.getByTestId('app-nav-place-recap')).toHaveCount(0)
    await expect(bar.getByTestId('app-nav-place-all')).toBeVisible()
    await expect(bar.getByTestId('app-nav-place-board')).toHaveAttribute('aria-current', 'page')
    await expect(bar).not.toHaveAttribute('data-moving', 'true')
  })

  test('"Neuen Tag planen" turns Rückblick into Alle + Heute with Alle current, and the pill is not the "Weiter zum Board" link (#428)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await planButton(page).click()
    await expect(page).toHaveURL(/\/all$/)
    const bar = appNav(page)
    await expect(bar.getByTestId('app-nav-place-all')).toHaveAttribute('aria-current', 'page')
    await expect(bar.getByTestId('app-nav-place-board')).toBeVisible()
    await expect(bar.getByTestId('app-nav-place-recap')).toHaveCount(0)
    await expect(bar.getByTestId('app-nav-continue')).toHaveCount(0)
    await expect(bar).not.toHaveAttribute('data-moving', 'true')
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
    await settleAnimations(page) // the modal scales and fades in: axe samples contrast at rest
    expect(await violations()).toEqual([])
    await nextChevron(page, 'done').click()
    await expect(counter(page, 'done')).toHaveText('2 / 4')
    await settleAnimations(page)
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
    // headline and sentence above both, the controls (the sheet's foot) below both
    const head = (await summary(page).boundingBox())!
    const panel = (await panelOf(page).boundingBox())!
    expect(head.y + head.height).toBeLessThanOrEqual(hUndone.y)
    expect(panel.y).toBeGreaterThanOrEqual(Math.max(undone.y + undone.height, done.y + done.height))
  })

  test('the two buttons sit at the foot of the one sheet in a row: soft way out left of the solid "Neuen Tag planen", no arrow, a hairline above them (#428, #612, #707)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    const panel = panelOf(page)
    await expect(panel).toBeVisible()
    await settleAnimations(page) // the stage fades in: boxes are measured at rest
    const panelBox = (await panel.boundingBox())!
    const sheetBox = (await sheetOf(page).boundingBox())!
    const button = (await planButton(page).boundingBox())!
    const skip = (await continueButton(page).boundingBox())!
    // "Überspringen und Board anzeigen" left of "Neuen Tag planen" (#356), on one line, inside the sheet's foot, right-aligned
    expect(skip.x).toBeGreaterThanOrEqual(panelBox.x)
    expect(skip.x + skip.width).toBeLessThanOrEqual(button.x)
    expect(button.x + button.width).toBeLessThanOrEqual(panelBox.x + panelBox.width)
    expect(panelBox.x + panelBox.width - (button.x + button.width)).toBeLessThan(20)
    expect(Math.abs(skip.y + skip.height / 2 - (button.y + button.height / 2))).toBeLessThan(2)
    await expect(continueButton(page)).toHaveAccessibleName('Überspringen und Board anzeigen')
    await expect(planButton(page)).toHaveAccessibleName('Neuen Tag planen')
    // one paper sheet holds the decks and the foot (#707); the title and the summary lie above it on the photo
    await expect(sheetOf(page)).toBeVisible()
    await expect(sheetOf(page).locator('[data-slot="title"]')).toHaveCount(0)
    await expect(sheetOf(page).getByTestId('recap-controls')).toHaveCount(1)
    await expect(sheetOf(page).getByTestId('recap-deck-done')).toHaveCount(1)
    const titleBox = (await recap(page).locator('[data-slot="title"]').boundingBox())!
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(sheetBox.y)
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height)
    expect(button.x + button.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width)
    // no second surface: the foot and the head carry no shadow of their own, the sheet does, and a hairline sits above the buttons
    await expect(sheetOf(page)).not.toHaveCSS('box-shadow', 'none')
    await expect(panel).toHaveCSS('box-shadow', 'none')
    await expect(recap(page).locator('.recap-stage__head')).toHaveCSS('box-shadow', 'none')
    await expect(panel).toHaveCSS('border-top-width', '1px')
    // the way out is soft (a fill, not the ghost's none), the main button solid, no arrow
    const fill = (locator: ReturnType<Page['locator']>) => locator.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(await fill(continueButton(page))).not.toMatch(/^rgba\(.*, 0\)$|^transparent$/)
    expect(await fill(continueButton(page))).not.toBe(await fill(planButton(page)))
    await expect(planButton(page).locator('svg')).toHaveCount(0)
    // not docked (#707): the sheet ends above the stage's foot padding, whatever the content's height
    const stageBox = (await recap(page).boundingBox())!
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height - 8)
  })

  test('a short window keeps the title and the buttons in view: the sheet shrinks and its scroller scrolls, the page and the stage do not (#707)', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 480 })
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    const scroller = recap(page).locator('.recap-stage__scroll')
    const metrics = await scroller.evaluate(el => ({ scrolls: el.scrollHeight > el.clientHeight + 1, overflowY: getComputedStyle(el).overflowY }))
    expect(metrics).toEqual({ scrolls: true, overflowY: 'auto' })
    await expect(recap(page).locator('[data-slot="title"]')).toBeInViewport({ ratio: 1 })
    await expect(planButton(page)).toBeInViewport({ ratio: 1 })
    await expect(continueButton(page)).toBeInViewport({ ratio: 1 })
    // scrolling the sheet's scroller moves the decks, not the title or the buttons
    const titleY = (await recap(page).locator('[data-slot="title"]').boundingBox())!.y
    const planY = (await planButton(page).boundingBox())!.y
    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight })
    expect((await recap(page).locator('[data-slot="title"]').boundingBox())!.y).toBe(titleY)
    expect((await planButton(page).boundingBox())!.y).toBe(planY)
    expect(await recap(page).locator('.recap-stage__column').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
  })

  for (const viewport of [{ width: 844, height: 300 }, { width: 568, height: 320 }, { width: 1280, height: 360 }]) {
    test(`a window as short as ${viewport.width}x${viewport.height}: the content area keeps its height and both buttons can be reached whole, none cut off or under the tab bar (#707)`, async ({ page, context }) => {
      await page.setViewportSize(viewport)
      await seedNewDayBoard(context)
      await page.goto('/tasks')
      await expect(recap(page)).toBeVisible()
      await settleAnimations(page)
      await expectStageFits(page, recap(page), [planButton(page), continueButton(page)])
    })
  }

  test('a deck card that is dragged or flies off is not cut by the sheet and the scroller does not scroll sideways (#707)', async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(deck(page, 'done')).toBeVisible()
    await settleAnimations(page)
    const front = deck(page, 'done').locator('.recap-deck__card[style*="z-index: 10"]')
    const scroller = recap(page).locator('.recap-stage__scroll')
    const sideways = () => scroller.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
    const rest = await sideways()
    expect(rest.scrollWidth).toBe(rest.clientWidth)
    const box = (await deck(page, 'done').boundingBox())!
    await page.mouse.move(box.x + 100, box.y + 60)
    await page.mouse.down()
    await page.mouse.move(box.x + 240, box.y + 70, { steps: 4 }) // 140px right: past the sheet's inner edge
    expect(await clippedBy(front)).toEqual([])
    expect(await sideways()).toEqual(rest)
    await page.mouse.up() // past 80px: the card flies out and goes behind the stack
    expect(await clippedBy(deck(page, 'done').locator('.recap-deck__card').first())).toEqual([])
    expect(await clippedBy(front)).toEqual([])
    expect(await sideways()).toEqual(rest)
    await expect(counter(page, 'done')).toHaveText('2 / 4')
  })

  test('at rest no halo on the focused main button; the first key brings it (#612)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(planButton(page)).toBeFocused()
    await settleAnimations(page)
    await expect(recap(page)).toHaveAttribute('data-quiet-focus')
    await expect(planButton(page)).toHaveCSS('outline-color', /rgba\(0, 0, 0, 0\)|transparent/)
    await page.keyboard.press('Shift+Tab')
    await expect(recap(page)).not.toHaveAttribute('data-quiet-focus')
    await expect(continueButton(page)).toBeFocused()
    await expect(continueButton(page)).not.toHaveCSS('outline-color', /rgba\(0, 0, 0, 0\)|transparent/)
  })

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`one stage shell with the day close at ${viewport.width}px: the title at the same y, the sheet at the same x and width (#612, #707)`, async ({ page, context }) => {
      await page.setViewportSize(viewport)
      await seedNewDayBoard(context)
      await page.goto('/tasks')
      await expect(recap(page)).toBeVisible()
      await settleAnimations(page)
      const measure = async (stage: ReturnType<typeof recap>) => {
        const title = (await stage.locator('[data-slot="title"]').boundingBox())!
        const sheet = (await stage.locator('.recap-stage__sheet').boundingBox())!
        return { titleY: Math.round(title.y), sheetX: Math.round(sheet.x), sheetW: Math.round(sheet.width) }
      }
      const fromRecap = await measure(recap(page))
      // the column is 44 rem at most (704 px), a phone's is the window less the stage's padding
      expect(fromRecap.sheetW).toBe(viewport.width >= 768 ? 704 : viewport.width - 32)
      await continueButton(page).click()
      await expect(recap(page)).toBeHidden()
      await openDayClose(page)
      const dayClose = page.getByTestId('day-close-stage')
      await expect(dayClose).toBeVisible()
      await settleAnimations(page)
      await expect.poll(async () => measure(dayClose)).toEqual(fromRecap)
    })
  }

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
    await expect(page.getByRole('dialog')).toHaveCount(0)
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

  test('tab order: deck, previous, next per deck, then skip and the button; focus starts on the button, no trap (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(planButton(page)).toBeFocused()
    const order = ['recap-deck-undone', 'recap-prev-undone', 'recap-next-undone', 'recap-deck-done', 'recap-prev-done', 'recap-next-done', 'recap-continue', 'recap-plan']
    const active = () => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid'))
    // Backwards from the button through every stop in reverse
    for (const id of order.slice(0, -1).reverse()) {
      await page.keyboard.press('Shift+Tab')
      await expect.poll(active).toBe(id)
    }
    // Forwards again to the button
    for (const id of order.slice(1)) {
      await page.keyboard.press('Tab')
      await expect.poll(active).toBe(id)
    }
    // Not a trap: the next Tab leaves the stage (the app bar is reachable), and the stage stays
    await page.keyboard.press('Tab')
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="new-day-recap"]') === null)).toBe(true)
    await expect(recap(page)).toBeVisible()
    // Escape inside the stage still leaves
    await continueButton(page).focus()
    await page.keyboard.press('Escape')
    await expect(recap(page)).toBeHidden()
  })

  test('nothing moves: boxes and scroll size are the same at rest, mid-drag, mid-move and after advances and wraps', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), recapLongTask()] })
    await page.goto('/tasks')
    await expect(deck(page, 'done')).toBeVisible()
    await settleAnimations(page) // the modal scales in: boxes are measured at rest
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
    await expect(deck(page, 'done')).toBeVisible()
    await settleAnimations(page) // the modal scales in: boxes are measured at rest
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

  test('the command palette opens over the stage (the bar stays usable) and Escape there does not leave the recap', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(recap(page)).toBeVisible()
    expect(await archived(page)).toEqual([])
  })

  test('the app bar stays usable: settings and back shows the same recap again, nothing archived (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await expect(appNav(page)).toBeVisible()
    await openSettings(page)
    await expect(recap(page)).toHaveCount(0)
    await goToPlace(page, 'Heute')
    await expect(recap(page)).toBeVisible()
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 6 Aufgaben erledigt.')
    expect(await archived(page)).toEqual([])
    expect((await marker(page))?.lastShownDay).not.toBe(dayKeyDaysAgo(0))
  })

  test('the stage covers the board; the bar is above it (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    const top = await page.evaluate(() => {
      const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-testid="new-day-recap"], [data-testid="app-nav"]')?.getAttribute('data-testid') ?? null
      return { corner: at(8, innerHeight - 8) }
    })
    expect(top.corner).toBe('new-day-recap')
  })

  test('the photo runs behind the app bar: no paper band, no veil, the brand and labels stay readable (#262)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await expect(page.getByTestId('recap-photo')).toHaveCSS('opacity', '1')
    const hit = await page.evaluate(() => {
      const at = (x: number, y: number) => document.elementFromPoint(x, y)?.closest('[data-testid="new-day-recap"], [data-testid="app-nav"]')?.getAttribute('data-testid') ?? null
      const pill = document.querySelector('[data-testid="app-nav-place-recap"]')!.getBoundingClientRect()
      return { row: at(8, 8), pill: at(pill.x + pill.width / 2, pill.y + pill.height / 2) }
    })
    // The stage reaches the window's top edge (the row above the photo was the page paper); the pills stay above it
    expect(hit).toEqual({ row: 'new-day-recap', pill: 'app-nav' })
    // The bar's paper veil steps back, so it does not wash the photo
    await expect.poll(() => appNav(page).evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('0')
    // The brand has no pill: it is read straight on the photo
    await expectContrast(page, appNav(page).locator('.app-nav-brand-text'), 4.5)
    await expectContrast(page, page.getByTestId('app-nav-place-recap'), 4.5)
    await expectContrast(page, page.getByTestId('app-nav-place-statistics'), 4.5)
    // The headline, the summary and the deck labels lie on the photo, no sheet behind them (#428)
    await expectContrast(page, recap(page).getByRole('heading', { name: 'Tagesrückblick' }), 4.5)
    await expectContrast(page, summary(page), 4.5)
    await expectContrast(page, page.getByTestId('recap-deck-label').first(), 4.5)
    await expectContrast(page, page.getByTestId('recap-deck-label').last(), 4.5)
    // Back on the board the veil returns
    await continueButton(page).click()
    await expect(recap(page)).toHaveCount(0)
    await expect.poll(() => appNav(page).evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('1')
  })

  test('curtain: only the photo slides up, the board is live from the first moment, then the stage is gone and focus is on the board (#245)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    // Hold the curtain long enough to assert its mid-motion states on a loaded runner (#350): the component reads the duration from this variable (parsed as milliseconds)
    await page.addStyleTag({ content: '.recap-stage { --recap-curtain-duration: 4000ms; }' })
    await continueButton(page).click()
    await expect(board(page)).not.toHaveAttribute('inert', '')
    // while the curtain runs the stage no longer takes pointer input and only its photo layer carries the transform
    await expect(recap(page)).toHaveAttribute('data-closing', 'true')
    await expect(recap(page)).toHaveCSS('pointer-events', 'none')
    await expect(recap(page)).toBeHidden({ timeout: 15_000 })
    await expect(board(page)).toBeFocused()
  })

  test('reduced motion: no curtain, gone at once (#245)', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await continueButton(page).click()
    await expect(recap(page)).toHaveCount(0)
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
    // The new day's pass already ran today (#356) and this task was put into Jetzt after it; the recap is still unanswered
    await seedNewDayBoard(context, { tasks: [...newDayTasks(1), nowTask], focus: true, lastNewDay: dayKeyDaysAgo(0) })
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

    test('a stage without scroll bar: one deck at a time under a switcher, the panel pinned, the page never scrolls', async ({ page, context }) => {
      await seedNewDayBoard(context)
      await page.goto('/tasks')

      await expect(recap(page)).toBeVisible()
      await expect(recap(page)).toHaveAttribute('role', 'region')
      const noScroll = () => page.evaluate(() => {
        const body = document.querySelector('[data-testid="new-day-recap"] .recap-stage__scroll') as HTMLElement
        return { page: document.documentElement.scrollHeight <= innerHeight, pageX: document.documentElement.scrollWidth <= innerWidth, body: body.scrollHeight <= body.clientHeight }
      })
      expect(await noScroll()).toEqual({ page: true, pageX: true, body: true })

      // The switcher sits in the one sheet (#707; on the photo under #428): both labels hold AA over the paper
      await expectContrast(page, switcher(page, 'undone'), 4.5)
      await expectContrast(page, switcher(page, 'done'), 4.5)
      // One deck, "noch offen" first; the switcher says how many are in each
      await expect(switcher(page, 'undone')).toHaveText('2 noch offen')
      await expect(switcher(page, 'done')).toHaveText('4 erledigt')
      await expect(switcher(page, 'undone')).toHaveAttribute('aria-selected', 'true')
      await expect(deck(page, 'undone')).toBeVisible()
      await expect(deck(page, 'done')).toHaveCount(0)
      await expect(deck(page, 'undone')).toHaveAccessibleName('2 noch offen, mit Pfeiltasten wechseln')

      await switcher(page, 'done').tap()
      await expect(switcher(page, 'done')).toHaveAttribute('aria-selected', 'true')
      await expect(deck(page, 'done')).toBeVisible()
      await expect(deck(page, 'undone')).toHaveCount(0)
      expect(await noScroll()).toEqual({ page: true, pageX: true, body: true })

      // The controls stack in the thumb zone: "Neuen Tag planen" on top, full-width skip below, both in view
      const button = continueButton(page)
      await expect(button).toBeInViewport({ ratio: 1 })
      const planBox = (await planButton(page).boundingBox())!
      const box = (await button.boundingBox())!
      expect(planBox.y + planBox.height).toBeLessThanOrEqual(box.y)
      expect(box.width).toBeGreaterThan(390 - 2 * 40)
      // the stage sits above the phone bar, which stays usable
      expect(box.y + box.height).toBeLessThan(844 - 72)
      // the sheet floats above the phone bar with all four corners rounded, it does not dock like /welcome's (#707, D2)
      const sheetBox = (await sheetOf(page).boundingBox())!
      const navBox = (await appNav(page).boundingBox())!
      expect(sheetBox.y + sheetBox.height).toBeLessThan(navBox.y)
      await expect(sheetOf(page)).toHaveCSS('border-bottom-left-radius', '16px')
      await expect(sheetOf(page)).toHaveCSS('border-top-left-radius', '16px')

      // a tap and a mouse drag past 80px advance the deck without moving anything
      const before = await layoutSnapshot2(page)
      await deck(page, 'done').tap({ position: { x: 140, y: 60 } })
      await expect(counter(page, 'done')).toHaveText('2 / 4')
      expect(await layoutSnapshot2(page)).toEqual(before)

      await button.tap()
      await expect(recap(page)).toBeHidden()
    })

    test('a touch swipe on the deck advances it and never closes the recap', async ({ page, context }) => {
      await seedNewDayBoard(context)
      await page.goto('/tasks')
      await expect(recap(page)).toBeVisible()
      await switcher(page, 'done').tap()
      await expect(counter(page, 'done')).toHaveText('1 / 4')
      const box = (await deck(page, 'done').boundingBox())!
      const cdp = await context.newCDPSession(page)
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
      // a thumb swipe: mostly sideways, drifting down as it goes (vaul reads the vertical part as a drawer drag)
      const swipe = async (dx: number, dy: number) => {
        const x0 = box.x + box.width / 2 - dx / 2
        const y0 = box.y + 50
        await touch('touchStart', x0, y0)
        for (let i = 1; i <= 8; i++) await touch('touchMove', x0 + (dx * i) / 8, y0 + (dy * i) / 8)
        // the drawer must not follow the finger down, even before the release decides anything
        expect(await recap(page).evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBe(0)
        await touch('touchEnd', x0 + dx, y0 + dy)
      }
      await swipe(120, 40)
      await expect(counter(page, 'done')).toHaveText('2 / 4')
      await swipe(-160, 70)
      await expect(counter(page, 'done')).toHaveText('3 / 4')
      await page.waitForTimeout(500)
      await expect(recap(page)).toBeVisible()
      expect(await archived(page)).toEqual([])
    })

    test('with nothing open there is no switcher, only the done deck', async ({ page, context }) => {
      await seedNewDayBoard(context, { allDone: true })
      await page.goto('/tasks')
      await expect(deck(page, 'done')).toBeVisible()
      await expect(switcher(page, 'undone')).toHaveCount(0)
      await expect(switcher(page, 'done')).toHaveCount(0)
      await expect(deck(page, 'undone')).toHaveCount(0)
      await expect(continueButton(page)).toBeInViewport({ ratio: 1 })
    })
  })
})

/**
 * #387 (it replaces the automatic pass of #356, epic #334): a new day starts fresh only on the user's click. "Tag
 * planen" in the recap, or the same button of the notice on the board, takes what was planned and not finished
 * (Jetzt, Offen, Wartet) off the board, onto "Alle Aufgaben"; "Direkt zum Board" and a day without a recap keep
 * yesterday's board and show the notice. `seedNewDayBoard` stores the last fresh start on the day of the recap's
 * marker, so today is a day the user has not planned yet; without done tasks no recap is due.
 */
test.describe('A new day starts fresh on the user\'s click (#387)', () => {
  const side = (page: Page) => page.getByTestId('not-planned')
  /** The cards of the block of the last planned day (#741: one block, Jetzt and Offen first, then what came out of Wartet) or of the list below it */
  const groupIds = (page: Page, group: 'panel' | 'others') =>
    page.getByTestId(group === 'panel' ? 'not-planned-list-panel' : 'not-planned-list-others').locator('[data-not-planned-id]').evaluateAll(els => els.map(el => el.getAttribute('data-not-planned-id')))
  /** A column's own cards; the Jetzt and Wartet cards "Heute" lists behind Offen's on "Alle" (#797) are not Offen's */
  const columnIds = (page: Page, column: 'open' | 'progress' | 'waiting') =>
    page.locator(`#column-${column}-list > .task-wrapper:not([data-today-extra])`).evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))
  const openIds = (page: Page) => columnIds(page, 'open')
  const sentence = (page: Page) => page.getByTestId('open-yesterday-note')
  const note = (page: Page) => page.getByTestId('new-day-note')
  const startButton = (page: Page) => page.getByTestId('new-day-note-start')
  const storedTask = (page: Page, id: string) =>
    page.evaluate(taskId => (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<Record<string, unknown>> }).tasks?.find(task => task.id === taskId) ?? null, id)
  const storedRecap = (page: Page) =>
    page.evaluate(() => JSON.parse(localStorage.getItem('day-recap-store') ?? '{}') as { lastNewDay?: string, noticeClosedDay?: string, sentBack?: { day: string, ids: string[], from?: string } })
  /** The block of the last planned day on top of "Alle Aufgaben" (#741) */
  const block = (page: Page) => page.getByTestId('not-planned-panel')
  /** Its title names the day the tasks are from: the seeds store the last fresh start two days back, so it is that weekday */
  const BLOCK_TITLE = new RegExp(`^Von ${new Intl.DateTimeFormat('de', { weekday: 'long' }).format(new Date(Date.now() - 2 * 86_400_000))}`)
  const settled = async (page: Page) => {
    await expect(recap(page)).toBeHidden({ timeout: 5000 })
    await settleAnimations(page)
  }
  /** Yesterday's board without its done tasks: no recap is due, the board shows as it was left */
  const boardOnly = () => newDayBackTasks().filter(task => task.status !== 3)
  /** Yesterday's board is where it was: Jetzt, both Offen cards and the Wartet card */
  const expectBoardUntouched = async (page: Page) => {
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])
    await expect.poll(() => columnIds(page, 'progress')).toEqual(['nd-now-1'])
    await expect.poll(() => columnIds(page, 'waiting')).toEqual(['nd-waiting-1'])
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 1 })
    expect(await storedTask(page, 'nd-now-1')).not.toHaveProperty('notPlanned')
    expect(await storedTask(page, 'nd-waiting-1')).toMatchObject({ status: 2 })
  }

  test('"Neuen Tag planen" is the fresh start: nothing moved before the click; then Jetzt, Offen and Wartet are one panel on top, and the board is empty', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    // the recap looks at yesterday's board: Jetzt, both Offen cards and the Wartet card are "noch offen"
    await expect(summary(page)).toHaveText('Du hast gestern 4 von 8 Aufgaben erledigt.')
    await expect(planButton(page)).toBeFocused()
    await expect(planButton(page)).toHaveText('Neuen Tag planen')
    await expect(continueButton(page)).toHaveText('Überspringen und Board anzeigen')
    // the app did nothing by itself: behind the recap the board is as it was left
    await expectBoardUntouched(page)
    expect((await storedRecap(page)).lastNewDay).toBe(dayKeyDaysAgo(2))

    await planButton(page).click()
    await expect(page).toHaveURL(/\/all$/)
    await settled(page)
    // #428: coming from the recap the pill is the normal one, Rückblick has turned into Alle + Heute and Alle is current
    await expect(appNav(page).locator('.app-nav-place')).toHaveText(['Alle', 'Heute', 'Statistik'])
    await expect(page.getByTestId('app-nav-continue')).toHaveCount(0)
    // one block (#741), named by the day the tasks are from (the board was last planned two days ago), with its count
    await expect(page.getByRole('heading', { level: 3, name: BLOCK_TITLE })).toHaveText(/4 Aufgaben$/)
    await expect(page.getByRole('group', { name: BLOCK_TITLE })).toBeVisible()
    // the list below it is labelled only while the block stands above it
    await expect(page.getByRole('heading', { level: 3, name: 'Weitere Aufgaben' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(2)
    // the block: board order, Jetzt first, then what came out of Wartet (#469); what was held before follows under "Weitere Aufgaben"
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
    expect(await openIds(page)).toEqual([])
    // desktop (#469): the two card columns are one card gap apart (12 px, the gap cards have below them), the headings start on the
    // left edge of the first card, the panel reaches 16 px beyond the cards; over the whole desktop range
    for (const width of [1024, 1100, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const box = async (id: string) => (await side(page).locator(`[data-not-planned-id="${id}"] .not-planned__card`).boundingBox())!
      const panel = block(page)
      await expect.poll(async () => {
        const [left, right, below] = [await box('nd-now-1'), await box('nd-open-2'), await box('nd-open-1')]
        return [Math.round(right.x - (left.x + left.width)), Math.round(below.y - (left.y + left.height))]
      }, { message: `the columns are one card gap apart at ${width}px` }).toEqual([12, 12])
      await expect.poll(async () => Math.abs((await page.getByRole('heading', { level: 3, name: BLOCK_TITLE }).boundingBox())!.x - (await box('nd-now-1')).x), { message: `the title sits over the first card at ${width}px` }).toBeLessThanOrEqual(1)
      // #741 (the user's direction): the title is as far from the block's edge as from the first card, and the quiet button
      // stands in the title row with room to the title and to the edge
      await expect.poll(() => panel.evaluate((el) => {
        const [edge, title, card, heading, button] = [el, el.querySelector('h3 > span')!, el.querySelector('.task')!, el.querySelector('h3')!, el.querySelector('[data-testid="nps-group-plan-all"]')!].map(node => node.getBoundingClientRect())
        const surface = Number.parseFloat(getComputedStyle(el, '::before').right)
        return {
          even: Math.abs((title!.top - edge!.top) - (card!.top - title!.bottom)) <= 1,
          air: title!.top - edge!.top >= 12,
          inRow: button!.top < title!.bottom && button!.bottom > title!.top,
          toTitle: button!.left - heading!.right >= 8,
          toEdge: (edge!.right - surface) - button!.right >= 8,
        }
      }), { message: `the title row is evenly padded at ${width}px` }).toEqual({ even: true, air: true, inRow: true, toTitle: true, toEdge: true })
      // the surface is a layer of the group (::before): it reaches 16 px past the pair on both sides
      await expect.poll(() => panel.evaluate((el) => {
        const surface = getComputedStyle(el, '::before')
        return [surface.left, surface.right, surface.backgroundColor === 'rgba(0, 0, 0, 0)']
      }), { message: `the panel reaches beyond the cards at ${width}px` }).toEqual(['-16px', '-16px', false])
    }
    // the day is started: no notice
    await expect(note(page)).toHaveCount(0)
    expect(await storedRecap(page)).toMatchObject({ lastNewDay: dayKeyDaysAgo(0), sentBack: { day: dayKeyDaysAgo(0), ids: ['nd-now-1', 'nd-open-2', 'nd-open-1'], from: dayKeyDaysAgo(2) } })

    // the board: nothing unfinished on it; the Jetzt task is an Offen task that is not planned, with its time; the Wartet task stays Wartet and is not planned (#794)
    await goToPlace(page, 'Heute')
    await expect(page.locator('#column-waiting .task-wrapper')).toHaveCount(0)
    await expect(page.locator('#column-progress .task-wrapper')).toHaveCount(0)
    // the sentence counts the panel's cards: Jetzt, both Offen cards and the Wartet card (#515)
    await expect(sentence(page)).toHaveText('4 Aufgaben von gestern liegen unter Alle.')
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true, timeSpentSeconds: 1800 })
    expect(await storedTask(page, 'nd-waiting-1')).toMatchObject({ status: 2, notPlanned: true })

    // once per day: a reload and a return to the app move nothing again and bring no recap and no notice
    // #416: "Alle" opened by hand keeps the normal pill
    await appNav(page).getByTestId('app-nav-place-all').click()
    await expect(page).toHaveURL(/\/all$/)
    await expect(page.getByTestId('app-nav-continue')).toHaveCount(0)
    await side(page).locator('[data-not-planned-id="nd-open-2"]').getByTestId('not-planned-pick').click()
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2'])
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect(note(page)).toHaveCount(0)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2'])
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-1', 'nd-waiting-1'])
  })

  test('planning the cards of the block counts it down and takes it away: the rest is one plain list without a label (#469, #741)', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    await planButton(page).click()
    await settled(page)
    await expect(page.getByRole('heading', { level: 3, name: BLOCK_TITLE })).toBeVisible()
    await expect(page.getByTestId('nps-group-count')).toHaveText('4')
    await side(page).locator('[data-not-planned-id="nd-open-2"]').getByTestId('not-planned-pick').click()
    await expect(page.getByTestId('nps-group-count')).toHaveText('3')
    for (const id of ['nd-now-1', 'nd-open-1', 'nd-waiting-1']) await side(page).locator(`[data-not-planned-id="${id}"]`).getByTestId('not-planned-pick').click()
    await expect(block(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
  })

  test('"Alle für heute einplanen" is one quiet button that plans every task of the block, a waiting task lands back in Wartet; the toast undoes exactly those (#702, #741, #794)', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    await planButton(page).click()
    await settled(page)
    // nothing moved by itself: the block holds its tasks until the click
    await expect(block(page)).toBeVisible()
    expect(await openIds(page)).toEqual([])
    const button = block(page).getByTestId('nps-group-plan-all')
    await expect(page.getByTestId('nps-group-plan-all')).toHaveCount(1)
    await expect(button).toHaveText('Alle für heute einplanen')
    // a quiet secondary button: no fill at rest (the soft primary of #702 is gone)
    await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    // the waiting task stands in the block as waiting, with its badge (#794, #797)
    await expect(side(page).locator('[data-not-planned-id="nd-waiting-1"]').getByTestId('task-status-badge')).toHaveText('Wartet')
    await button.click()
    await expect.poll(async () => (await openIds(page)).sort()).toEqual(['nd-now-1', 'nd-open-1', 'nd-open-2'])
    await expect(block(page)).toHaveCount(0)
    // planned again it is Wartet, not Offen (#794): "Heute" on "Alle" lists it behind the Offen cards with its badge (#797)
    await expect.poll(async () => (await storedTask(page, 'nd-waiting-1'))?.status).toBe(2)
    expect(await storedTask(page, 'nd-waiting-1')).not.toHaveProperty('notPlanned')
    await expect(page.locator('#column-open .task-wrapper[data-today-extra][data-task-id="nd-waiting-1"]').getByTestId('task-status-badge')).toHaveText('Wartet')
    await expect(page.getByRole('region', { name: /Benachrichtigungen/ }).getByText('4 Aufgaben sind für heute geplant.', { exact: true })).toBeVisible()
    await expect(page.locator('.toast, [data-slot="title"]').filter({ hasText: 'Aufgaben sind für heute geplant' })).toHaveCount(1)
    // the screen-reader line says the same sentence once for the block (the last task's title would drop the others)
    await expect(page.getByTestId('plan-announcement')).toHaveText('4 Aufgaben sind für heute geplant.')
    await page.getByRole('button', { name: 'Rückgängig' }).click()
    await expect.poll(() => openIds(page)).toEqual([])
    await expect.poll(async () => (await groupIds(page, 'panel')).sort()).toEqual(['nd-now-1', 'nd-open-1', 'nd-open-2', 'nd-waiting-1'])
    expect(await storedTask(page, 'nd-waiting-1')).toMatchObject({ status: 2, notPlanned: true })
  })

  test('keyboard focus follows "Alle für heute einplanen": to the list below, never to <body> (review of #702)', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    await planButton(page).click()
    await settled(page)
    await block(page).getByTestId('nps-group-plan-all').focus()
    await page.keyboard.press('Enter')
    await expect(block(page)).toHaveCount(0)
    await expect(side(page).locator('[data-not-planned-id="nd-held-1"]').getByTestId('not-planned-pick')).toBeFocused()
    // a single announcement for the whole block, not the last task's title
    await expect(page.getByTestId('plan-announcement')).toHaveText('4 Aufgaben sind für heute geplant.')
  })

  test('at 390 px the quiet button stays in the title row with the short text, and the title row is evenly padded (#741)', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tasks')
    await planButton(page).click()
    await settled(page)
    await goToPlace(page, 'Alle')
    const panel = block(page)
    const button = panel.getByTestId('nps-group-plan-all')
    await expect(button).toHaveText('Alle einplanen')
    await expect(button).toHaveAccessibleName(/^Alle Aufgaben aus „Von .+“ für heute einplanen$/)
    await expect.poll(() => panel.evaluate((el) => {
      const [edge, title, card, heading, action] = [el, el.querySelector('h3 > span')!, el.querySelector('.task')!, el.querySelector('h3')!, el.querySelector('[data-testid="nps-group-plan-all"]')!].map(node => node.getBoundingClientRect())
      return {
        even: Math.abs((title!.top - edge!.top) - (card!.top - title!.bottom)) <= 1,
        inRow: action!.top < title!.bottom && action!.bottom > title!.top,
        toTitle: action!.left - heading!.right >= 8,
        insideCards: action!.right <= card!.right + 1,
      }
    })).toEqual({ even: true, inRow: true, toTitle: true, insideCards: true })
  })

  test('a task from Wartet that is picked again comes back as Wartet and leaves its category (#794)', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    await planButton(page).click()
    await settled(page)
    await side(page).locator('[data-not-planned-id="nd-waiting-1"]').getByTestId('not-planned-pick').click()
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1'])
    expect(await openIds(page)).toEqual([])
    expect(await storedTask(page, 'nd-waiting-1')).toMatchObject({ status: 2 })
    expect(await storedTask(page, 'nd-waiting-1')).not.toHaveProperty('notPlanned')
    // "Nicht für heute planen" later puts it back as a task that came from Offen: not into the category
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1'])
  })

  test('"Direkt zum Board" keeps yesterday\'s board, the Jetzt task included; the notice offers the fresh start and its button does it and leads to "Alle"', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    // while the recap asks, the notice waits
    await expect(recap(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
    await continueButton(page).click()
    await settled(page)
    await expect(page).toHaveURL(/\/tasks$/)
    await expectBoardUntouched(page)
    await expect(sentence(page)).toHaveCount(0)
    await expect(note(page)).toBeVisible()
    await expect(note(page)).toHaveAttribute('role', 'status')
    await expect(note(page)).toContainText('Auf dem Board liegt noch der Plan von gestern.')
    await expect(note(page)).toContainText('„Neuen Tag planen“ legt alles, was nicht erledigt ist, zurück nach „Alle Aufgaben“.')
    await expect(startButton(page)).toHaveText('Neuen Tag planen')

    // a reload keeps the board and the notice; no recap again
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect(note(page)).toBeVisible()
    await expectBoardUntouched(page)
    // skipping the recap archived nothing: yesterday's done tasks wait in Erledigt
    expect(await archived(page)).toEqual([])

    await startButton(page).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect(note(page)).toHaveCount(0)
    // #462: the notice's "Neuen Tag planen" archives yesterday's done tasks like the recap's button of that name
    await expect.poll(async () => (await archived(page)).length).toBeGreaterThan(0)
    await expect(page.getByTestId('app-nav-continue')).toHaveCount(0)
    await expect(page.getByTestId('app-nav-place-all')).toHaveAttribute('aria-current', 'page')
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
    await expect(page.getByTestId('plan-announcement')).toHaveText('4 Aufgaben liegen jetzt unter „Alle Aufgaben“.')
    // the notice left with its answer: focus is on the page, never on <body>
    await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true)
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true })
  })

  // The update from v0.16.0: the stored state has the recap's marker but none of a fresh start. Leaving the recap
  // moves the recap's marker to today, which must not make today look started.
  test.describe('data stored before the fresh start existed (no `lastNewDay`)', () => {
    test('"Neuen Tag planen" in the recap takes yesterday\'s cards off the board, once', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks(), lastNewDay: null })
      await page.goto('/tasks')
      await expect(planButton(page)).toBeFocused()
      await expectBoardUntouched(page)
      // the day check gave the old data its baseline: the day the board was last seen, not today
      await expect.poll(async () => (await storedRecap(page)).lastNewDay).toBe(dayKeyDaysAgo(2))

      await planButton(page).click()
      await expect(page).toHaveURL(/\/all$/)
      await settled(page)
      await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
      await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
      expect(await openIds(page)).toEqual([])
      await expect(note(page)).toHaveCount(0)
      expect(await storedRecap(page)).toMatchObject({ lastNewDay: dayKeyDaysAgo(0), sentBack: { day: dayKeyDaysAgo(0), ids: ['nd-now-1', 'nd-open-2', 'nd-open-1'] } })
      expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true, timeSpentSeconds: 1800 })

      // a reload brings no recap, no notice and no second move
      await page.reload()
      await expect(board(page)).toBeVisible()
      await expect(recap(page)).toHaveCount(0)
      await expect(note(page)).toHaveCount(0)
      await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
    })

    test('"Direkt zum Board" keeps the board and the notice offers the fresh start, also after a reload; its button does it', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks(), lastNewDay: null })
      await page.goto('/tasks')
      await continueButton(page).click()
      await settled(page)
      await expectBoardUntouched(page)
      await expect(note(page)).toBeVisible()

      await page.reload()
      await expect(board(page)).toBeVisible()
      await expect(recap(page)).toHaveCount(0)
      await expect(note(page)).toBeVisible()
      await expectBoardUntouched(page)

      await startButton(page).click()
      await expect(page).toHaveURL(/\/all$/)
      await expect(note(page)).toHaveCount(0)
      await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
      expect((await storedRecap(page)).lastNewDay).toBe(dayKeyDaysAgo(0))
    })

    test('no recap due: the notice shows and its button starts the day fresh', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: boardOnly(), lastNewDay: null })
      await page.goto('/tasks')
      await expect(board(page)).toBeVisible()
      await expect(recap(page)).toHaveCount(0)
      await expect(note(page)).toBeVisible()
      await expectBoardUntouched(page)
      await startButton(page).click()
      await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
    })
  })

  test('no recap due: the board is unchanged and the notice shows, on "Alle" too; a visit there moves nothing, the button there keeps the place', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: boardOnly() })
    await page.goto('/tasks')
    await expect(board(page)).toBeVisible()
    await expect(recap(page)).toHaveCount(0)
    await expect(note(page)).toBeVisible()
    await expectBoardUntouched(page)

    await goToPlace(page, 'Alle')
    await settleAnimations(page)
    await expect(note(page)).toBeVisible()
    // the visit alone moves nothing: Heute holds its cards, the side only what was held before
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
    await expect(block(page)).toBeHidden()
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 1 })

    await startButton(page).click()
    await expect(note(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
    await expect.poll(() => openIds(page)).toEqual([])
  })

  test('"Schließen" hides the notice for the day, also after a reload, and leaves the board as it is', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: boardOnly() })
    await page.goto('/tasks')
    await page.getByTestId('new-day-note-close').click()
    await expect(note(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true)
    await expectBoardUntouched(page)
    await expect.poll(async () => (await storedRecap(page)).noticeClosedDay).toBe(dayKeyDaysAgo(0))
    // the day is still not started fresh: only the notice is closed
    expect((await storedRecap(page)).lastNewDay).toBe(dayKeyDaysAgo(2))
    await page.reload()
    await expect(board(page)).toBeVisible()
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])
    await expect(note(page)).toHaveCount(0)
    await goToPlace(page, 'Alle')
    await expect(note(page)).toHaveCount(0)
  })

  test('a notice closed yesterday is back this morning', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: boardOnly() })
    await context.addInitScript((day) => {
      const raw = localStorage.getItem('day-recap-store')
      if (raw) localStorage.setItem('day-recap-store', JSON.stringify({ ...JSON.parse(raw), noticeClosedDay: day }))
    }, dayKeyDaysAgo(1))
    await page.goto('/tasks')
    await expect(note(page)).toBeVisible()
  })

  test('the sentence in an empty Offen counts the Offen and the Wartet task of yesterday as the panel does (#515)', async ({ page, context }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await planButton(page).click()
    await settled(page)
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveText('2 Aufgaben von gestern liegen unter Alle.')
    await sentence(page).getByRole('link', { name: 'Alle' }).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => groupIds(page, 'panel')).toHaveLength(2)
  })

  test('one task of yesterday: the sentence in an empty Offen is singular', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayTasks().filter(task => task.id !== 'nd-waiting-1') })
    await page.goto('/tasks')
    await planButton(page).click()
    await settled(page)
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveText('Eine Aufgabe von gestern liegt unter Alle.')
  })

  test('the sentence in an empty Offen counts what the topic focus leaves of the group, as "Alle" shows it', async ({ page, context }) => {
    const topics: Record<string, string> = { 'nd-now-1': 'Keller', 'nd-open-2': 'Keller', 'nd-open-1': 'Büro', 'nd-held-1': 'Garten' }
    const tasks = boardOnly().map(task => ({ ...task, topic: topics[task.id] ?? null }))
    await seedNewDayBoard(context, { tasks })
    await page.goto('/tasks')
    await startButton(page).click()
    await expect(page).toHaveURL(/\/all$/)
    // the funnel has cards to filter only under "Alle" (Heute's Offen is empty): the focus is set there
    const focusOn = async (topic: string) => {
      await page.getByTestId('focus-trigger').click()
      await page.getByTestId('focus-chip').filter({ hasText: topic }).click()
    }
    await expect.poll(() => groupIds(page, 'panel')).toHaveLength(4)
    // the focus leaves one task of the group: the sentence says one, and "Alle" shows exactly that one
    await focusOn('Büro')
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveText('Eine Aufgabe von gestern liegt unter Alle.')
    await sentence(page).getByRole('link', { name: 'Alle' }).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-open-1'])
    // the focus leaves none of the group (a task that was held before matches): no sentence, no link to nothing
    await page.getByTestId('focus-trigger').click() // the funnel ends the focus that is on
    await focusOn('Garten')
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveCount(0)
  })

  test('the sentence in an empty Offen counts a Wartet task of the group as "Alle" shows it (#515)', async ({ page, context }) => {
    const topics: Record<string, string> = { 'nd-now-1': 'Keller', 'nd-open-2': 'Keller', 'nd-open-1': 'Büro', 'nd-waiting-1': 'Garten' }
    const tasks = boardOnly().map(task => ({ ...task, topic: topics[task.id] ?? null }))
    await seedNewDayBoard(context, { tasks })
    await page.goto('/tasks')
    await startButton(page).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => groupIds(page, 'panel')).toHaveLength(4)
    // the focus leaves only the former Wartet task: the sentence says one and "Alle" shows exactly that card
    await page.getByTestId('focus-trigger').click()
    await page.getByTestId('focus-chip').filter({ hasText: 'Garten' }).click()
    await goToPlace(page, 'Heute')
    await expect(sentence(page)).toHaveText('Eine Aufgabe von gestern liegt unter Alle.')
    await sentence(page).getByRole('link', { name: 'Alle' }).click()
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-waiting-1'])
  })

  /** The page clock runs on (`__shiftMs` moves it): a night passes without a reload. */
  const installShiftedClock = (context: BrowserContext) => context.addInitScript(() => {
    const RealDate = Date
    const w = window as unknown as { __shiftMs: number }
    w.__shiftMs = 0
    class ShiftedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(RealDate.now() + w.__shiftMs)
        else super(...(args as [number]))
      }
      static now() { return RealDate.now() + w.__shiftMs }
    }
    window.Date = ShiftedDate as unknown as DateConstructor
  })
  const nextMorning = (page: Page) => page.evaluate(() => {
    const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0)
    ;(window as unknown as { __shiftMs: number }).__shiftMs = next.getTime() - Date.now()
  })
  /** A real absence (the grace is 60 s: the page clock jumps past it), then the return */
  const leaveAndReturn = async (page: Page) => {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => { (window as unknown as { __shiftMs: number }).__shiftMs += 120_000 })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  }

  test('app left open over midnight: nothing appears or moves while the user works in the window; the return after an absence brings the notice, never a move', async ({ page, context }) => {
    // The marker is today: nothing is due. The page clock is then moved a day on, as after a night.
    await seedNewDayBoard(context, { daysAgo: 0, lastShownDay: dayKeyDaysAgo(0), tasks: newDayBackTasks(0).filter(task => task.status !== 3) })
    await installShiftedClock(context)
    await page.goto('/tasks')
    await expectBoardUntouched(page)
    await expect(note(page)).toHaveCount(0)

    await nextMorning(page)
    await page.waitForTimeout(300)
    await expect(note(page)).toHaveCount(0) // still focused: nothing shifts under the user's hands

    // a glance at another window is not leaving: its return starts nothing
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(300)
    await expect(note(page)).toHaveCount(0)

    await leaveAndReturn(page)
    await expect(note(page)).toBeVisible()
    // the new day has begun, and still no card moved and the Jetzt timer was not stopped
    await expectBoardUntouched(page)
    await expect(sentence(page)).toHaveCount(0)
    expect((await storedTask(page, 'nd-now-1'))!.timeSpentSeconds).toBeGreaterThanOrEqual(1800)
  })

  test('a route change after midnight (a sheet opens and closes while the user works) opens no recap and shows no notice; the next return after an absence does, and still moves nothing', async ({ page, context }) => {
    await seedNewDayBoard(context, { daysAgo: 0, lastShownDay: dayKeyDaysAgo(0), tasks: newDayBackTasks(0) })
    await installShiftedClock(context)
    await page.goto('/tasks')
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])

    await nextMorning(page)
    await page.locator('#column-open-list [data-task-id="nd-open-1"]').first().click()
    await expect(page).toHaveURL(/\/tasks\/nd-open-1$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/tasks$/)
    await settleAnimations(page)
    await page.waitForTimeout(300)
    await expectBoardUntouched(page)
    await expect(recap(page)).toHaveCount(0)
    await expect(note(page)).toHaveCount(0)

    // the next return after an absence is the new day: the recap opens, over a board nobody touched
    await leaveAndReturn(page)
    await expect(recap(page)).toBeVisible()
    await expectBoardUntouched(page)
  })

  test('the block follows the topic focus: it lists and counts only matching tasks and is gone without a match (#702, #741)', async ({ page, context }) => {
    const tasks = boardOnly().map(task => ({ ...task, topic: task.id === 'nd-held-1' ? 'Keller' : task.id === 'nd-waiting-1' ? 'Garten' : 'Büro' }))
    await seedNewDayBoard(context, { tasks })
    await page.goto('/all')
    await startButton(page).click()
    await expect.poll(() => groupIds(page, 'panel')).toHaveLength(4)
    await page.getByTestId('focus-trigger').click()
    await page.getByTestId('focus-chip').filter({ hasText: 'Keller' }).click()
    await expect(block(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)
    await expect.poll(() => groupIds(page, 'others')).toEqual(['nd-held-1'])
    // only what was waiting matches: it is the block's one card
    await page.getByTestId('focus-trigger').click()
    await page.getByTestId('focus-trigger').click()
    await page.getByTestId('focus-chip').filter({ hasText: 'Garten' }).click()
    await expect(block(page)).toBeVisible()
    await expect(page.getByTestId('nps-group-count')).toHaveText('1')
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-waiting-1'])
  })

  test('Escape on the recap dismisses without a move and without a fresh start: on "Alle" the place stays "Alle", the board stays as it is', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/all')
    await expect(recap(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await settled(page)
    await expect(page).toHaveURL(/\/all$/)
    await expect.poll(() => openIds(page)).toEqual(['nd-open-2', 'nd-open-1'])
    await expect.poll(() => groupIds(page, 'panel')).toEqual([])
    expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 1 })
    await expect(note(page)).toBeVisible()
  })

  test('#567: the add card stands above the panel; the saved task is listed in the plain list, not in a panel', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: boardOnly() })
    await page.goto('/all')
    await startButton(page).click()
    await expect.poll(() => groupIds(page, 'panel')).toHaveLength(4)
    await page.getByTestId('not-planned-add').click()
    const flow = side(page).getByTestId('new-card-flow')
    await expect(flow).toBeVisible()
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await settled(page)
    expect((await flow.boundingBox())!.y).toBeLessThan((await block(page).boundingBox())!.y)
    await page.getByTestId('new-card-title').fill('Fenster ausmessen')
    await page.keyboard.press('Enter')
    for (let i = 0; i < 8 && await flow.count() > 0; i++) {
      await expect(page.locator('.ncf-fwd-enter-active, .ncf-fwd-leave-active')).toHaveCount(0)
      await page.keyboard.press('Enter')
    }
    await expect(flow).toHaveCount(0)
    await expect.poll(() => groupIds(page, 'panel')).toHaveLength(4)
    await expect.poll(async () => (await groupIds(page, 'others')).length).toBe(2)
    await expect(side(page).locator('[data-testid="not-planned-list-others"] .task-title-text').first()).toHaveText('Fenster ausmessen')
  })

  test('the pick moves keyboard focus on across the panels and the plain list', async ({ page, context }) => {
    await seedNewDayBoard(context, { tasks: boardOnly().filter(task => task.id !== 'nd-open-2' && task.id !== 'nd-now-1') })
    await page.goto('/all')
    await startButton(page).click()
    await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-open-1', 'nd-waiting-1'])
    const pick = (id: string) => side(page).locator(`[data-not-planned-id="${id}"]`).getByTestId('not-planned-pick')
    await pick('nd-open-1').focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => openIds(page)).toEqual(['nd-open-1'])
    // the last card of the first group hands on to the first card below it, and so on
    await expect(pick('nd-waiting-1')).toBeFocused()
    await page.keyboard.press('Enter')
    // the waiting task comes back as Wartet (#794): the Offen column stays as it is
    await expect.poll(async () => { const task = await storedTask(page, 'nd-waiting-1'); return task?.status === 2 && task.notPlanned === undefined }).toBe(true)
    expect(await openIds(page)).toEqual(['nd-open-1'])
    await expect(pick('nd-held-1')).toBeFocused()
  })

  /**
   * #711, #741: the one-time note of "Alle" after "Neuen Tag planen": what the step is for and when to go to "Heute". On desktop
   * it is plain text in the empty "Heute" column and gives way to the first planned card; a phone shows one line with a close
   * control under the headline "Alle Aufgaben". Seen when closed (phone) or when the user goes on to "Heute"; a persisted flag,
   * so it never returns.
   */
  test.describe('the one-time note on "Alle" (#711)', () => {
    const planNote = (page: Page) => page.getByTestId('plan-note')
    const storedSeen = (page: Page) =>
      page.evaluate(() => (JSON.parse(localStorage.getItem('day-recap-store') ?? '{}') as { planNoteSeen?: unknown }).planNoteSeen === true)
    const seedSeen = (context: Parameters<typeof seedNewDayBoard>[0]) => context.addInitScript(() => {
      const raw = localStorage.getItem('day-recap-store')
      if (raw && !sessionStorage.getItem('e2e-seen-seeded')) {
        sessionStorage.setItem('e2e-seen-seeded', '1')
        localStorage.setItem('day-recap-store', JSON.stringify({ ...JSON.parse(raw), planNoteSeen: true }))
      }
    })

    test('through the recap\'s "Neuen Tag planen": the note is plain text in the empty "Heute" column, gives way to the first planned card and returns when that card leaves; no button', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks() })
      await page.goto('/tasks')
      await planButton(page).click()
      await expect(page).toHaveURL(/\/all$/)
      await settled(page)
      await expect(planNote(page)).toHaveCount(1)
      await expect(planNote(page)).toBeVisible()
      await expect(planNote(page)).toHaveAttribute('role', 'status')
      await expect(planNote(page)).toContainText('Wähle aus, was heute dran ist')
      await expect(planNote(page)).toContainText('Schiebe sie in die heutige Auswahl oder drücke den Pfeil-Button. Sobald du loslegen willst, wechsle in der Navigation zu „Heute“.')
      // it stands where the picked tasks land, not above the block, and it is no box and has no button
      await expect(page.locator('#column-open').getByTestId('plan-note')).toBeVisible()
      await expect(side(page).getByTestId('plan-note')).toHaveCount(0)
      await expect(planNote(page).getByRole('button')).toHaveCount(0)
      await expect(planNote(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.getByTestId('app-nav-continue')).toHaveCount(0)
      expect(await storedSeen(page)).toBe(false)

      // the first planned card takes its place; nothing is stored by that, and without the card the note is back
      await side(page).locator('[data-not-planned-id="nd-open-2"]').getByTestId('not-planned-pick').click()
      await expect.poll(() => openIds(page)).toEqual(['nd-open-2'])
      await expect(planNote(page)).toHaveCount(0)
      expect(await storedSeen(page)).toBe(false)
      await page.locator('#column-open .task-wrapper[data-task-id="nd-open-2"]').hover()
      await page.locator('#column-open .task-wrapper[data-task-id="nd-open-2"]').getByTestId('not-today-arrow').click()
      await expect.poll(() => openIds(page)).toEqual([])
      await expect(planNote(page)).toBeVisible()
      // the block and the board are as they were: the note moved no task
      await expect.poll(async () => (await groupIds(page, 'panel')).sort()).toEqual(['nd-now-1', 'nd-open-1', 'nd-open-2', 'nd-waiting-1'])

      // going on to "Heute" is the answer, for good
      await goToPlace(page, 'Heute')
      await expect.poll(() => storedSeen(page)).toBe(true)
      await page.reload()
      await expect(board(page)).toBeVisible()
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toHaveCount(0)
    })

    test('through the notice\'s "Neuen Tag planen": the note shows; going on to "Heute" is the answer, it does not come back on "Alle" or after a reload', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: boardOnly() })
      await page.goto('/tasks')
      await startButton(page).click()
      await expect(page).toHaveURL(/\/all$/)
      await expect(planNote(page)).toBeVisible()
      // a task sheet under /all/:id is not a way to "Heute": the note stays
      await page.getByTestId('not-planned-list-others').locator('[data-not-planned-id]').first().locator('.not-planned__card').click()
      await expect(page).toHaveURL(/\/all\/[^/]+$/)
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(/\/all$/)
      await expect(planNote(page)).toBeVisible()
      expect(await storedSeen(page)).toBe(false)

      await goToPlace(page, 'Heute')
      await expect.poll(() => storedSeen(page)).toBe(true)
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toHaveCount(0)
      await page.reload()
      await expect(board(page)).toBeVisible()
      await expect(planNote(page)).toHaveCount(0)
      await goToPlace(page, 'Heute')
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toHaveCount(0)
    })

    test('leaving "Alle" for Statistik is not an answer: the note is there again on the way back; going on to "Heute" is', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks() })
      await page.goto('/tasks')
      await planButton(page).click()
      await expect(page).toHaveURL(/\/all$/)
      await settled(page)
      await expect(planNote(page)).toBeVisible()

      await goToPlace(page, 'Statistik')
      await expect(page).toHaveURL(/\/statistics/)
      expect(await storedSeen(page)).toBe(false)
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toBeVisible()
      expect(await storedSeen(page)).toBe(false)

      await goToPlace(page, 'Heute')
      await expect.poll(() => storedSeen(page)).toBe(true)
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toHaveCount(0)
    })

    test('"Alle" opened any other way shows none: the pill, a deep link, and "Überspringen und Board anzeigen"', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks() })
      await page.goto('/tasks')
      await continueButton(page).click()
      await settled(page)
      await expect(planNote(page)).toHaveCount(0)
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toHaveCount(0)
      await goToPlace(page, 'Heute')
      await page.goto('/all')
      await expect(page.getByTestId('not-planned')).toBeVisible()
      await expect(planNote(page)).toHaveCount(0)
      expect(await storedSeen(page)).toBe(false)
    })

    test('a reload between the choice and the answer shows nothing and stores nothing: it belongs to the step the user is in', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: boardOnly() })
      await page.goto('/tasks')
      await startButton(page).click()
      await expect(planNote(page)).toBeVisible()
      await page.reload()
      await expect(page.getByTestId('not-planned')).toBeVisible()
      await expect(planNote(page)).toHaveCount(0)
      expect(await storedSeen(page)).toBe(false)
    })

    test('a user who has seen it once gets none on a later day\'s "Neuen Tag planen"', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: boardOnly() })
      await seedSeen(context)
      await page.goto('/tasks')
      await startButton(page).click()
      await expect(page).toHaveURL(/\/all$/)
      await expect(page.getByTestId('not-planned-group-others')).toBeVisible()
      await expect(planNote(page)).toHaveCount(0)
    })

    test('data stored before the flag existed loads and shows the note (no stored flag, nothing written at load)', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: boardOnly() })
      await page.goto('/tasks')
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('day-recap-store') ?? '{}'))).not.toHaveProperty('planNoteSeen')
      await startButton(page).click()
      await expect(planNote(page)).toBeVisible()
    })

    test('at 390 px the note is one line above the block with a close control, and it is gone for good after "Schließen"', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks() })
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/tasks')
      await planButton(page).click()
      await settled(page)
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toHaveCount(1)
      await expect(planNote(page)).toHaveText('Wähle aus, was heute dran ist. Sobald du loslegen willst, wechsle in der Navigation zu „Heute“.')
      const close = page.getByTestId('plan-note-close')
      await expect(close).toHaveAccessibleName('Schließen')
      const [noteBox, button, panelBox] = [await planNote(page).boundingBox(), await close.boundingBox(), await block(page).boundingBox()]
      expect(noteBox!.x).toBeGreaterThanOrEqual(0)
      expect(noteBox!.x + noteBox!.width).toBeLessThanOrEqual(390)
      expect(noteBox!.y + noteBox!.height).toBeLessThanOrEqual(panelBox!.y + 1)
      expect(button!.height).toBeGreaterThanOrEqual(44)
      expect(button!.width).toBeGreaterThanOrEqual(44)
      expect(await storedSeen(page)).toBe(false)
      await close.click()
      await expect(planNote(page)).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body)).toBe(true)
      await expect.poll(() => storedSeen(page)).toBe(true)
      await page.reload()
      await expect(board(page)).toBeVisible()
      await goToPlace(page, 'Alle')
      await expect(planNote(page)).toHaveCount(0)
    })
  })

  /**
   * The user's decision of 2026-11-16: nothing is removed silently. A timer that ran on after midnight while the
   * user was away leaves a question, not a removal ("Präsentation vorbereiten" has 30 min recorded; 10 or 75 of
   * them were counted after midnight). Since #387 the question comes with the app's start, with or without a fresh
   * start: on a skipped day the task stays in Jetzt and its timer runs on, so its stored time may grow by the
   * seconds of the test itself.
   */
  test.describe('the question about time after midnight', () => {
    const timeNote = (page: Page) => page.getByTestId('new-day-time-note')
    const takeOff = (page: Page) => page.getByTestId('new-day-time-note-take-off')
    const keep = (page: Page) => page.getByTestId('new-day-time-note-keep')
    const storedSeconds = async (page: Page) => (await storedTask(page, 'nd-now-1'))!.timeSpentSeconds as number

    async function openBoard(page: Page, context: Parameters<typeof seedNewDayBoard>[0], seconds: number, way: 'skip' | 'plan' = 'skip') {
      await seedNewDayBoard(context, { tasks: newDayBackTasks() })
      await seedAfterMidnight(context, { taskId: 'nd-now-1', seconds })
      await page.goto('/tasks')
      await (way === 'plan' ? planButton(page) : continueButton(page)).click()
      await settled(page)
    }

    test('a skipped day: it names the stretch and the task, removes nothing, the task stays in Jetzt; it survives a reload and "Zeit behalten" ends it', async ({ page, context }) => {
      await openBoard(page, context, 4500)
      await expect(timeNote(page)).toBeVisible()
      await expect(timeNote(page)).toHaveAttribute('role', 'status')
      await expect(timeNote(page)).toContainText('Timer lief nach Mitternacht 1 h 15 min weiter')
      await expect(page.getByTestId('new-day-time-note-task')).toHaveText('Präsentation vorbereiten')
      await expect(page.getByTestId('new-day-time-note-task')).toHaveAttribute('data-private', '')
      // nothing moved and nothing was taken off: the task is still in Jetzt with all its time
      await expect.poll(() => columnIds(page, 'progress')).toEqual(['nd-now-1'])
      expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 1 })
      expect(await storedSeconds(page)).toBeGreaterThanOrEqual(1800)
      // a "Alle" visit and a reload keep the question; the board stays usable
      await goToPlace(page, 'Alle')
      await expect(timeNote(page)).toBeVisible()
      await page.reload()
      await expect(board(page)).toBeVisible()
      await expect(timeNote(page)).toBeVisible()
      expect(await storedSeconds(page)).toBeGreaterThanOrEqual(1800)

      await keep(page).click()
      await expect(timeNote(page)).toHaveCount(0)
      await expect(page.getByTestId('plan-announcement')).toHaveText('Die Zeit bleibt an der Aufgabe.')
      expect(await storedSeconds(page)).toBeGreaterThanOrEqual(1800)
      await page.reload()
      await expect(board(page)).toBeVisible()
      await expect(timeNote(page)).toHaveCount(0)
    })

    test('a skipped day: "Zeit abziehen" takes that time off the task in Jetzt, once, and its timer runs on', async ({ page, context }) => {
      await openBoard(page, context, 600)
      await expect(timeNote(page)).toContainText('Timer lief nach Mitternacht 10 min weiter')
      await takeOff(page).click()
      await expect(timeNote(page)).toHaveCount(0)
      await expect(page.getByTestId('plan-announcement')).toHaveText('10 min von der Aufgabe abgezogen.')
      // 30 min minus 10, plus the seconds the running timer counted during the test
      await expect.poll(() => storedSeconds(page)).toBeGreaterThanOrEqual(1200)
      expect(await storedSeconds(page)).toBeLessThan(1200 + 120)
      expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 1 })
      await page.reload()
      await expect(board(page)).toBeVisible()
      await expect(timeNote(page)).toHaveCount(0)
      expect(await storedSeconds(page)).toBeLessThan(1200 + 120)
    })

    test('with "Neuen Tag planen": the cards go off the board, the time is whole, and "Zeit abziehen" takes exactly that time off the card', async ({ page, context }) => {
      await openBoard(page, context, 600, 'plan')
      await expect(timeNote(page)).toContainText('Timer lief nach Mitternacht 10 min weiter')
      expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true, timeSpentSeconds: 1800 })
      await takeOff(page).click()
      await expect(timeNote(page)).toHaveCount(0)
      expect(await storedTask(page, 'nd-now-1')).toMatchObject({ status: 0, notPlanned: true, timeSpentSeconds: 1200 })
      await page.reload()
      await expect(board(page)).toBeVisible()
      await expect(timeNote(page)).toHaveCount(0)
      expect(await storedTask(page, 'nd-now-1')).toMatchObject({ timeSpentSeconds: 1200 })
    })

    test('a stretch under a minute is not asked about', async ({ page, context }) => {
      await openBoard(page, context, 40, 'plan')
      await expect(side(page)).toBeVisible()
      await expect(timeNote(page)).toHaveCount(0)
      expect(await storedTask(page, 'nd-now-1')).toMatchObject({ timeSpentSeconds: 1800 })
    })

    test('on a skipped day it is its own note below the notice; each is answered on its own', async ({ page, context }) => {
      await openBoard(page, context, 600)
      await expect(note(page)).toBeVisible()
      await expect(timeNote(page)).toBeVisible()
      const one = (await note(page).boundingBox())!
      const two = (await timeNote(page).boundingBox())!
      expect(two.y).toBeGreaterThanOrEqual(one.y + one.height)
      // the time question is answered: the notice stays, and the task is still in Jetzt
      await keep(page).click()
      await expect(timeNote(page)).toHaveCount(0)
      await expect(note(page)).toBeVisible()
      await expect.poll(() => columnIds(page, 'progress')).toEqual(['nd-now-1'])
      await page.getByTestId('new-day-note-close').click()
      await expect(note(page)).toHaveCount(0)
    })

    test.describe('390px', () => {
      test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

      test('the actions sit below the text, 44 px high, and nothing scrolls sideways', async ({ page, context }) => {
        await openBoard(page, context, 4500, 'plan')
        const text = (await timeNote(page).getByText('Timer lief nach Mitternacht 1 h 15 min weiter').boundingBox())!
        const action = (await takeOff(page).boundingBox())!
        expect(action.y).toBeGreaterThan(text.y + text.height)
        expect(action.height).toBeGreaterThanOrEqual(44)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    })
  })

  test.describe('390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

    test('the buttons of the recap stack with "Neuen Tag planen" on top; the notice stacks its actions below the text, 44 px high, and its button starts the day fresh', async ({ page, context }) => {
      await seedNewDayBoard(context, { tasks: newDayBackTasks() })
      await page.goto('/tasks')
      const plan = (await planButton(page).boundingBox())!
      const skip = (await continueButton(page).boundingBox())!
      expect(plan.y + plan.height).toBeLessThanOrEqual(skip.y)
      await continueButton(page).click()
      await settled(page)
      const text = (await note(page).getByText('Auf dem Board liegt noch der Plan von gestern.').boundingBox())!
      const action = (await startButton(page).boundingBox())!
      expect(action.y).toBeGreaterThan(text.y + text.height)
      expect(action.height).toBeGreaterThanOrEqual(44)
      // no sideways scroll
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await startButton(page).tap()
      await expect(page).toHaveURL(/\/all$/)
      await expect(note(page)).toHaveCount(0)
      await expect.poll(() => groupIds(page, 'panel')).toEqual(['nd-now-1', 'nd-open-2', 'nd-open-1', 'nd-waiting-1'])
    })
  })
})

/**
 * #490: "Neuen Tag planen" lands on Alle: the curtain lifts onto the planning view, the board never shows Heute or travels
 * there beneath it. A frame sampler runs from the click until the curtain is gone and records the board's place, its move
 * flag, the pace on <html> and where the Offen column stands.
 */
type Frame = { place: string | null, moving: boolean, pace: string | null, path: string, openLeft: number, stage: boolean, closing: boolean }

test.describe('Recap to Alle (#490)', () => {
  const film = async (page: Page, button: 'plan' | 'skip'): Promise<Frame[]> => {
    await page.evaluate(() => {
      const frames: Frame[] = []
      const w = window as unknown as { __film: Frame[], __filmOn: boolean }
      w.__film = frames
      w.__filmOn = true
      // only the frames after the click count: the board rests on Heute before it
      let clicked = false
      document.addEventListener('click', () => { clicked = true }, { capture: true, once: true })
      const sample = () => {
        if (clicked) frames.push(read())
        if (w.__filmOn) requestAnimationFrame(sample)
      }
      const read = (): Frame => {
        const el = document.querySelector('.board')
        return {
          place: el?.getAttribute('data-place') ?? null,
          moving: el?.hasAttribute('data-place-moving') ?? false,
          pace: document.documentElement.getAttribute('data-place-pace'),
          path: location.pathname,
          openLeft: Math.round(document.querySelector('#column-open')?.getBoundingClientRect().left ?? -1),
          stage: !!document.querySelector('[data-testid="new-day-recap"]'),
          closing: document.querySelector('[data-testid="new-day-recap"]')?.hasAttribute('data-closing') ?? false,
        }
      }
      requestAnimationFrame(sample)
    })
    await (button === 'plan' ? planButton(page) : continueButton(page)).click()
    await expect(recap(page)).toHaveCount(0, { timeout: 5000 })
    await settleAnimations(page)
    return page.evaluate(() => {
      const w = window as unknown as { __film: Frame[], __filmOn: boolean }
      w.__filmOn = false
      return w.__film
    })
  }

  for (const [name, use] of [['desktop', {}], ['390px', { viewport: { width: 390, height: 844 }, hasTouch: true }]] as const) {
    test.describe(`#490 ${name}`, () => {
      test.use(use)

      test('"Neuen Tag planen": the curtain lifts onto Alle, the board never shows Heute or travels beneath it', async ({ page, context }) => {
        await seedNewDayBoard(context, { tasks: newDayBackTasks() })
        await page.goto('/tasks')
        await expect(recap(page)).toBeVisible()
        await expect(board(page).locator('.board')).toHaveAttribute('data-place', 'today')

        const frames = await film(page, 'plan')
        // The curtain starts only once the board stands on Alle: from its first frame on there is no Heute and no move
        const lifting = frames.filter(frame => frame.closing)
        expect(lifting.length).toBeGreaterThan(30) // the curtain runs 1.4 s
        expect(lifting.every(frame => frame.place === 'all' && frame.path === '/all')).toBe(true)
        expect(frames.some(frame => frame.moving)).toBe(false)
        expect(new Set(frames.filter(frame => frame.place === 'all').map(frame => frame.openLeft)).size).toBe(1)
        // the lift pace is still on <html> for the bar's chip; it clears afterwards
        expect(lifting.some(frame => frame.pace === 'lift')).toBe(true)
        await expect(page).toHaveURL(/\/all$/)
        await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-place-pace'))).toBeNull()
        await expect(appNav(page).locator('.app-nav-place')).toHaveText(['Alle', 'Heute', 'Statistik'])
      })

      test('"Überspringen" lands on Heute, as before', async ({ page, context }) => {
        await seedNewDayBoard(context, { tasks: newDayBackTasks() })
        await page.goto('/tasks')
        await expect(recap(page)).toBeVisible()

        const frames = await film(page, 'skip')
        expect(frames.every(frame => frame.place === 'today' && frame.path === '/tasks')).toBe(true)
        expect(frames.some(frame => frame.moving)).toBe(false)
        await expect(page).toHaveURL(/\/tasks$/)
      })
    })
  }

  test('reduced motion: "Neuen Tag planen" lands on Alle at once, no pace set', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedNewDayBoard(context, { tasks: newDayBackTasks() })
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    const frames = await film(page, 'plan')
    // no curtain, no pace, no move: the stage is gone at once and the board stands on Alle
    expect(frames.some(frame => frame.closing || frame.moving || frame.pace !== null)).toBe(false)
    expect(frames.at(-1)).toMatchObject({ place: 'all', stage: false })
  })
})
