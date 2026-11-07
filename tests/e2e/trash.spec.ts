import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { elapse, elapseWindow, installClock, pinnedNow, startOfDay } from './helpers/clock'
import { seedLocalBoard, seedMixedBoard, seedTrash, trashTask, SEED_TASKS, MIXED_SEED_TASKS } from './helpers/seed'
import { closeMore, goToPlace, openMore, openTrash } from './helpers/appNav'

/**
 * Trash and in-card delete confirmation (#422). Sequences, not single calls: delete -> undo -> delete, delete ->
 * window ends -> restore from the sheet and from the page, delete -> reload inside the window, restore -> reload.
 * The undo window is driven with the page clock (#543): `windowEnds` runs the timers past it, so no test waits 5 s of real time.
 */

const OPEN_TITLE = 'Konzept ausarbeiten' // seed-open-1, Offen, first card
const SECOND_TITLE = 'Dokumentation lesen' // seed-open-2, Offen
const JETZT_TITLE = 'Review schreiben' // seed-progress-1, Jetzt
const WAITING_TITLE = 'Blocker klären' // seed-waiting-1, Wartet

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()
const gap = (page: Page) => page.locator('.task-gap')
const trashPage = (page: Page) => page.getByTestId('trash-page')

/** Runs the page clock past every open undo window and the gaps' closing glide (#543). */
const windowEnds = elapseWindow

/** The deleted state wears the raspberry theme (#581): a red-tinted shape, red label, red undo pill and drain line. */
async function expectRedTheme(page: Page) {
  const tone = await gap(page).evaluate((el) => {
    const css = (node: Element | null, prop: string, pseudo?: string) => getComputedStyle(node!, pseudo)[prop as 'color']
    // rgb channels of any computed colour (oklab/oklch included), through a 1x1 canvas
    const channels = (color: string): [number, number, number] => {
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.canvas.width = ctx.canvas.height = 1
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return [r!, g!, b!]
    }
    const q = (sel: string) => el.querySelector(sel)
    return {
      shape: channels(css(q('.task-gap__box'), 'backgroundColor', '::before')),
      label: channels(css(q('.task-gap__label'), 'color')),
      pill: channels(css(q('[data-testid="gap-undo"]'), 'color')),
      drain: channels(css(q('.task-gap__drain'), 'backgroundColor')),
    }
  })
  // red-led: the red channel clearly leads green and blue (neutral ink and greys have r ~ g ~ b)
  for (const [name, [r, g, b]] of Object.entries(tone)) {
    expect(r - Math.max(g, b), `${name} is raspberry`).toBeGreaterThan(name === 'shape' ? 6 : 40)
  }
}

/** The Papierkorb row of the Mehr panel: "Papierkorb" while empty, "Papierkorb (n)" otherwise (#470). */
async function expectTrashRow(page: Page, text: string) {
  const row = (await openMore(page)).getByTestId('more-trash')
  await expect(row).toHaveText(text)
  await closeMore(page)
}

/** Restores one entry on the Papierkorb page, then goes back to the board. */
async function restoreOnPage(page: Page, title: string) {
  await page.getByRole('button', { name: `Wiederherstellen: ${title}` }).click()
  await expect(trashPage(page).getByTestId('trash-entry').filter({ hasText: title })).toHaveCount(0)
}

/** Delete through the card's context menu: acts at once, no confirmation. */
async function deleteCard(page: Page, title: string) {
  await card(page, title).locator('.task').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Löschen/ }).first().click()
}

const storedTrash = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}') as { entries: Array<{ taskId: string, fromStatus: number }> }).entries)

test.describe('delete is confirmed in the card slot (#422)', () => {
  test.beforeEach(async ({ context }) => {
    await installClock(context)
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { once: true })
  })

  test('the card turns into a gap in its own slot, nothing below moves, and there is no toast', async ({ page }) => {
    await page.goto('/tasks')
    const next = card(page, SECOND_TITLE)
    const before = await next.boundingBox()
    const slot = await card(page, OPEN_TITLE).boundingBox()

    await deleteCard(page, OPEN_TITLE)

    await expect(gap(page)).toHaveCount(1)
    await expect(gap(page)).toContainText('Im Papierkorb')
    await expect(gap(page).getByRole('button', { name: /Rückgängig/ })).toBeVisible()
    await expect(page.locator('.task-wrapper', { hasText: OPEN_TITLE })).toHaveCount(0)
    expect(await next.boundingBox()).toEqual(before)
    await expectRedTheme(page)
    const gapBox = await gap(page).boundingBox()
    expect(gapBox?.y).toBeCloseTo(slot!.y, 0)
    expect(gapBox?.height).toBeCloseTo(slot!.height, 0)
    await expect(page.locator('[data-sonner-toast], [role="status"]', { hasText: 'Rückgängig' })).toHaveCount(0)
    // a polite announcement for screen readers
    await expect(page.getByText('Aufgabe gelöscht: ' + OPEN_TITLE)).toBeAttached()
  })

  test('delete -> undo -> delete: the card is back unchanged, then a second delete reaches the trash', async ({ page }) => {
    await page.goto('/tasks')
    const order = () => column(page, 'open').locator('.task-wrapper').evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))
    await expect(card(page, SECOND_TITLE)).toBeVisible()
    const beforeOrder = await order()
    expect(beforeOrder).toEqual(['seed-open-1', 'seed-open-2'])

    await deleteCard(page, OPEN_TITLE)
    await gap(page).getByRole('button', { name: /Rückgängig/ }).click()
    await expect(gap(page)).toHaveCount(0)
    await expect(card(page, OPEN_TITLE)).toBeVisible()
    expect(await order()).toEqual(beforeOrder)
    await expectTrashRow(page, 'Papierkorb')

    await deleteCard(page, OPEN_TITLE)
    await windowEnds(page)
    await expect.poll(() => storedTrash(page)).toHaveLength(1)
    await expect(gap(page)).toHaveCount(0)
    await expectTrashRow(page, 'Papierkorb (1)')
  })

  test('hover inside the gap pauses the window and leaving resumes it', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, OPEN_TITLE)
    await gap(page).hover()
    await elapse(page, 6500) // longer than the whole window: only the hover keeps the gap
    await expect(gap(page)).toHaveCount(1)
    expect(await storedTrash(page)).toHaveLength(0)

    await page.mouse.move(900, 700)
    await windowEnds(page)
    await expect.poll(() => storedTrash(page)).toHaveLength(1)
    await expect(gap(page)).toHaveCount(0)
  })

  test('the gap closes in 280 ms glide and focus goes on to the next card instead of falling to the body', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, OPEN_TITLE)
    // after the context menu closed, focus has nowhere to be: it must not stay lost when the gap goes
    await page.mouse.move(900, 700)
    await windowEnds(page)
    await expect(gap(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('#column-open-list') !== null && document.activeElement !== document.body)).toBe(true)
    await expect(card(page, SECOND_TITLE)).toBeVisible()
  })

  test('a gap is not a card: no sortable, no drag, no sheet', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, OPEN_TITLE)
    await expect(gap(page)).toHaveCount(1)
    // not inside a sortable wrapper, no task id on it
    expect(await gap(page).evaluate(el => !!el.closest('.task-wrapper') || el.querySelector('[data-task-id]') !== null)).toBe(false)
    await gap(page).dblclick({ position: { x: 20, y: 20 } })
    await expect(page).toHaveURL(/\/tasks$/)
    const box = (await gap(page).boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 20)
    await page.mouse.down()
    await page.mouse.move(box.x + 400, box.y + 100, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    await expect(gap(page)).toHaveCount(1)
  })

  test('several deletes in a row give one gap each; undoing one leaves the other to expire', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, OPEN_TITLE)
    await deleteCard(page, SECOND_TITLE)
    await expect(gap(page)).toHaveCount(2)

    await gap(page).filter({ hasText: 'Im Papierkorb' }).first().getByRole('button', { name: /Rückgängig: Konzept/ }).click()
    // the pointer must not rest on the remaining gap: hover would pause its window
    await page.mouse.move(900, 700)
    await expect(card(page, OPEN_TITLE)).toBeVisible()
    await expect(gap(page)).toHaveCount(1)
    await windowEnds(page)
    await expect.poll(async () => (await storedTrash(page)).map(entry => entry.taskId)).toEqual(['seed-open-2'])
  })

  test('delete -> window ends -> restore from the Papierkorb page: the card is at the end of its column and stays after a reload', async ({ page }) => {
    await page.goto('/tasks')
    await expectTrashRow(page, 'Papierkorb')
    await deleteCard(page, WAITING_TITLE)
    await windowEnds(page)
    await expectTrashRow(page, 'Papierkorb (1)')

    await openTrash(page)
    await expect(trashPage(page).getByTestId('trash-entry')).toHaveCount(1)
    await expect(trashPage(page)).toContainText(WAITING_TITLE)
    await expect(trashPage(page)).toContainText('War in Wartet')
    await expect(trashPage(page)).toContainText(/Gelöscht vor|Gerade eben gelöscht/)

    await restoreOnPage(page, WAITING_TITLE)
    await expect(page.getByTestId('trash-empty-state')).toHaveText('Noch keine gelöschten Aufgaben.')
    await goToPlace(page, 'Heute')
    await expect(column(page, 'waiting').getByText(WAITING_TITLE)).toBeVisible()
    await expectTrashRow(page, 'Papierkorb')

    await page.reload()
    await expect(column(page, 'waiting').getByText(WAITING_TITLE)).toBeVisible()
    await expect(column(page, 'waiting').getByText(WAITING_TITLE)).toHaveCount(1)
    expect(await storedTrash(page)).toHaveLength(0)
  })

  test('Offen: a restored first card goes to the end of the column, not back to the top (F1, review)', async ({ page }) => {
    await page.goto('/tasks')
    const order = () => column(page, 'open').locator('.task-wrapper').evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))
    await expect(card(page, SECOND_TITLE)).toBeVisible()
    const before = await order()
    expect(before).toEqual(['seed-open-1', 'seed-open-2'])
    await deleteCard(page, OPEN_TITLE)
    await page.mouse.move(900, 700)
    await windowEnds(page)
    await expectTrashRow(page, 'Papierkorb (1)')

    await openTrash(page)
    await restoreOnPage(page, OPEN_TITLE)
    await goToPlace(page, 'Heute')

    await expect(card(page, OPEN_TITLE)).toBeVisible()
    await expect.poll(order).toEqual(['seed-open-2', 'seed-open-1'])
    await page.reload()
    await expect.poll(order).toEqual(['seed-open-2', 'seed-open-1'])
  })

  test('a task that was in Jetzt says so and lands in Offen, even though Jetzt is empty', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, JETZT_TITLE)
    await expect(gap(page)).toHaveCount(1)
    await windowEnds(page)
    await expect(column(page, 'progress')).not.toContainText(JETZT_TITLE)
    await expectTrashRow(page, 'Papierkorb (1)')

    await openTrash(page)
    await expect(trashPage(page)).toContainText('War in Jetzt, kommt zurück nach Offen')
    await restoreOnPage(page, JETZT_TITLE)
    await goToPlace(page, 'Heute')
    await expect(column(page, 'open').getByText(JETZT_TITLE)).toBeVisible()
    await expect(column(page, 'progress').getByText(JETZT_TITLE)).toHaveCount(0)
  })

  test('undo inside the window puts a Jetzt card back in Jetzt while it is free', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, JETZT_TITLE)
    await gap(page).getByRole('button', { name: /Rückgängig/ }).click()
    await expect(column(page, 'progress').getByText(JETZT_TITLE)).toBeVisible()
    await expect(gap(page)).toHaveCount(0)
  })

  test('a reload inside the window commits the delete: the task is in the trash afterwards', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, OPEN_TITLE)
    await expect(gap(page)).toHaveCount(1)
    await page.reload()
    await expect(page.locator('.task-wrapper').first()).toBeVisible()
    await expect(card(page, OPEN_TITLE)).toHaveCount(0)
    await expect(gap(page)).toHaveCount(0)
    await expect.poll(async () => (await storedTrash(page)).map(entry => entry.taskId)).toEqual(['seed-open-1'])
    await expectTrashRow(page, 'Papierkorb (1)')
  })

  test('390px: the gap fills the card slot and Papierkorb opens the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tasks')
    const slot = await card(page, OPEN_TITLE).boundingBox()
    await deleteCard(page, OPEN_TITLE)
    await expect(gap(page)).toContainText('Im Papierkorb')
    const gapBox = await gap(page).boundingBox()
    expect(gapBox?.height).toBeCloseTo(slot!.height, 0)
    await expect(gap(page).getByRole('button', { name: /Rückgängig/ })).toBeVisible()
    await windowEnds(page)
    await expectTrashRow(page, 'Papierkorb (1)')

    await openTrash(page)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await restoreOnPage(page, OPEN_TITLE)
    await goToPlace(page, 'Heute')
    await expect(card(page, OPEN_TITLE)).toBeVisible()
  })

  test('reduced motion: the gap and the window behave the same, only the motion is plain', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/tasks')
    await deleteCard(page, OPEN_TITLE)
    await expect(gap(page)).toContainText('Im Papierkorb')
    expect(await gap(page).locator('.task-gap__drain').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
    await windowEnds(page)
    await expect.poll(() => storedTrash(page)).toHaveLength(1)
    await expect(gap(page)).toHaveCount(0)
  })
})

test.describe('the trash page (#422)', () => {
  // The day groups need the entries on known calendar days, so the clock is pinned (#449): "now" can be 00:01, where
  // "5 minutes ago" is already yesterday. Today = up to 5 minutes ago but never before this midnight; the rest are whole days back.
  const NOW = pinnedNow().getTime()
  const MIDNIGHT = startOfDay(pinnedNow())
  const DAY_MS = 86_400_000
  const OLD = [
    { task: trashTask('tr-today', 'Heute gelöscht', 0), deletedAt: Math.max(NOW - 5 * 60_000, MIDNIGHT) },
    { task: trashTask('tr-yesterday', 'Gestern gelöscht', 2), deletedAt: MIDNIGHT - DAY_MS / 2 },
    { task: trashTask('tr-earlier-a', 'Früher gelöscht A', 3), deletedAt: MIDNIGHT - 5 * DAY_MS },
    { task: trashTask('tr-earlier-b', 'Früher gelöscht B', 1), deletedAt: MIDNIGHT - 6 * DAY_MS, fromStatus: 1 as const },
  ]

  test.beforeEach(async ({ context }) => {
    await installClock(context, { pinned: true })
    await seedLocalBoard(context, SEED_TASKS, {}, undefined, { once: true })
    await seedTrash(context, OLD, { once: true })
  })

  test('no visible page header: the bar names the page, the title stays as an sr-only h1 (#670)', async ({ page }) => {
    await page.goto('/trash')
    await expect(page.getByTestId('trash-page')).toBeVisible()
    await expect(page.locator('header.page-header')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Papierkorb' })).toHaveClass(/sr-only/)
    await expect(page.getByTestId('app-nav-third')).toHaveText('Papierkorb')
    await expect(page.getByText('Gelöschte Aufgaben kommen hier zurück.')).toHaveCount(0)
  })

  test('"Papierkorb leeren" sits next to the retention line, and a deleted card is no taller than the board\'s own (#683)', async ({ page }) => {
    await page.goto('/tasks')
    const boardCard = page.locator('.board .task').first()
    await expect(boardCard).toBeVisible()
    const boardHeight = (await boardCard.boundingBox())!.height
    await page.goto('/trash')
    await expect(page.getByTestId('trash-page')).toBeVisible()
    const retention = (await page.getByText('Nach 30 Tagen endgültig weg').boundingBox())!
    const empty = (await page.getByTestId('trash-empty').boundingBox())!
    expect(empty.x - (retention.x + retention.width)).toBeLessThan(48) // no dead strip between the line and the action
    const firstCard = (await page.getByTestId('trash-entry').first().locator('.task').boundingBox())!
    expect(firstCard.height).toBeLessThanOrEqual(boardHeight)
  })

  test('Papierkorb (4) in the panel leads to the page, which groups all entries by day', async ({ page }) => {
    await page.goto('/tasks')
    await expectTrashRow(page, 'Papierkorb (4)')
    await openTrash(page)

    await expect(page.getByTestId('trash-page').getByTestId('trash-entry')).toHaveCount(4)
    await expect(page.getByTestId('trash-group-today')).toContainText('Heute gelöscht')
    await expect(page.getByTestId('trash-group-yesterday')).toContainText('Gestern gelöscht')
    await expect(page.getByTestId('trash-group-earlier')).toContainText('Früher gelöscht A')
    await expect(page.getByTestId('trash-page')).toContainText('Nach 30 Tagen endgültig weg')
    await expect(page.getByRole('button', { name: 'Zurück' })).toHaveCount(0) // no back arrow (#470): the bar is the way out
    await expect(page.getByTestId('trash-entry').filter({ hasText: 'Früher gelöscht B' })).toContainText('War in Jetzt, kommt zurück nach Offen')
  })

  test('restore and remove-forever from the page, then "Papierkorb leeren" asks in place', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/trash')
    await expect(page.getByTestId('trash-entry')).toHaveCount(4)

    await page.getByRole('button', { name: 'Wiederherstellen: Gestern gelöscht' }).click()
    await expect(page.getByTestId('trash-entry')).toHaveCount(3)
    await page.getByRole('button', { name: 'Endgültig löschen: Früher gelöscht A' }).click()
    await expect(page.getByTestId('trash-entry')).toHaveCount(3) // asks first (#21)
    await expect(page.getByTestId('trash-remove-cancel')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('trash-remove-confirm')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Endgültig löschen: Früher gelöscht A' })).toBeFocused()
    await expect(page.getByTestId('trash-entry')).toHaveCount(3)
    await page.getByRole('button', { name: 'Endgültig löschen: Früher gelöscht A' }).click()
    await page.getByTestId('trash-remove-confirm').focus()
    await page.keyboard.press('Escape') // Esc works from the confirm button too
    await expect(page.getByRole('button', { name: 'Endgültig löschen: Früher gelöscht A' })).toBeFocused()
    await page.getByRole('button', { name: 'Endgültig löschen: Früher gelöscht A' }).click()
    await page.getByTestId('trash-remove-confirm').click()
    await expect(page.getByTestId('trash-entry')).toHaveCount(2)

    await page.getByTestId('trash-empty').click()
    await expect(page.getByRole('alert')).toContainText('2 Aufgaben endgültig löschen?')
    await expect(page.getByTestId('trash-empty-cancel')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('trash-empty')).toBeFocused()
    await page.getByTestId('trash-empty').click()
    await page.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByTestId('trash-entry')).toHaveCount(2)
    await page.getByTestId('trash-empty').click()
    await page.getByTestId('trash-empty-confirm').click()
    await expect(page.getByTestId('trash-empty-state')).toHaveText('Noch keine gelöschten Aufgaben.')
    expect(await storedTrash(page)).toHaveLength(0)

    // the restored task is on the board, the purged ones are gone for good
    await page.goto('/tasks')
    await expect(column(page, 'waiting').getByText('Gestern gelöscht')).toBeVisible()
    await expect(page.getByText('Früher gelöscht A')).toHaveCount(0)
    await expectTrashRow(page, 'Papierkorb')
  })

  test('reached with an empty trash the page says so', async ({ page, context }) => {
    await context.clearCookies()
    await page.goto('/tasks')
    await page.evaluate(() => localStorage.setItem('trash-store', JSON.stringify({ entries: [] })))
    await page.goto('/trash')
    await expect(page.getByTestId('trash-empty-state')).toHaveText('Noch keine gelöschten Aufgaben.')
  })

  test('entries older than 30 days are purged on load', async ({ page }) => {
    await page.goto('/tasks')
    await page.evaluate(() => {
      const entries = JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}').entries
      entries[0].deletedAt = Date.now() - 31 * 86_400_000
      localStorage.setItem('trash-store', JSON.stringify({ entries }))
    })
    // Reload on purpose (#512): the purge runs on load, the reload is the behaviour under test
    await page.reload()
    await expect.poll(async () => (await storedTrash(page)).length).toBe(3)
  })

  test('axe: the gap, the panel and the page have no serious or critical violations', async ({ page }) => {
    const blocking = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze())
      .violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)

    await page.goto('/tasks')
    await deleteCard(page, OPEN_TITLE)
    await expect(gap(page)).toHaveCount(1)
    await page.waitForTimeout(400)
    expect(await blocking()).toEqual([])

    await windowEnds(page)
    await expect(gap(page)).toHaveCount(0)
    await openMore(page)
    await page.waitForTimeout(500)
    expect(await blocking()).toEqual([])
    await closeMore(page)

    await openTrash(page)
    await expect(page.getByTestId('trash-entry').first()).toBeVisible()
    expect(await blocking()).toEqual([])

    // the in-place confirm: `error`/`soft` text meets AA on its tint (#594)
    await page.getByTestId('trash-empty').click()
    await expect(page.getByTestId('trash-empty-confirm')).toBeVisible()
    const confirm = await new AxeBuilder({ page }).include('[data-testid="trash-page"]').withRules(['color-contrast']).analyze()
    expect(confirm.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  test('a trash card cannot be opened or dragged', async ({ page }) => {
    await page.goto('/trash')
    const entry = page.getByTestId('trash-entry').first()
    await entry.locator('.task').dblclick()
    await expect(page).toHaveURL(/\/trash$/)
    expect(await entry.locator('[data-task-id]').count()).toBe(0)
  })
})

test.describe('trash on a mixed board (#422)', () => {
  const notionCalls = (page: Page, path: string) => {
    const calls: string[] = []
    page.on('response', (response) => {
      if (response.request().method() === 'POST' && response.url().includes(`/api/notion/${path}`) && response.ok()) {
        calls.push(response.request().postData() ?? '')
      }
    })
    return calls
  }

  test.beforeEach(async ({ context }) => {
    await installClock(context)
    await seedMixedBoard(context, MIXED_SEED_TASKS, { defaultSource: 'local', once: true })
  })

  test('a Notion task and a Local task: each restores through its own source, the page returns to Notion once', async ({ page }) => {
    const archived = notionCalls(page, 'archive-page')
    const unarchived = notionCalls(page, 'unarchive-page')
    await page.goto('/tasks')
    await expect(card(page, 'Fokusaufgabe vorbereiten')).toBeVisible()

    await deleteCard(page, 'Fokusaufgabe vorbereiten')
    await deleteCard(page, 'Lokal: Einkauf planen')
    await windowEnds(page)
    await expect.poll(() => archived.length).toBe(1)
    expect(archived[0]).toContain('page-1')
    await expect.poll(async () => (await storedTrash(page)).length).toBe(2)

    await openTrash(page)
    await expect(trashPage(page).getByTestId('task-source-icon')).toHaveCount(2)
    await restoreOnPage(page, 'Fokusaufgabe vorbereiten')
    await expect.poll(() => unarchived.length).toBe(1)
    expect(unarchived[0]).toContain('page-1')

    await restoreOnPage(page, 'Lokal: Einkauf planen')
    await goToPlace(page, 'Heute')
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()
    expect(unarchived).toHaveLength(1)

    // a following fetch (manual refresh) neither duplicates nor drops the restored page
    await page.reload()
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toHaveCount(1)
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toHaveCount(1)
  })

  test('a failing restore keeps the entry in the trash and shows an error, nothing half-restored', async ({ page }) => {
    await page.goto('/tasks')
    await deleteCard(page, 'Fokusaufgabe vorbereiten')
    await windowEnds(page)
    await expect.poll(async () => (await storedTrash(page)).length).toBe(1)

    await page.route('**/api/notion/unarchive-page', route => route.fulfill({ status: 502, contentType: 'application/json', body: '{"statusCode":502}' }))
    await openTrash(page)
    await page.getByRole('button', { name: 'Wiederherstellen: Fokusaufgabe vorbereiten' }).click()
    await expect(page.getByText('konnte nicht wiederhergestellt werden').first()).toBeVisible({ timeout: 20_000 })
    await expect(trashPage(page).getByTestId('trash-entry')).toHaveCount(1)
    expect(await storedTrash(page)).toHaveLength(1)

    // a retry once the source answers works
    await page.unroute('**/api/notion/unarchive-page')
    await restoreOnPage(page, 'Fokusaufgabe vorbereiten')
    await goToPlace(page, 'Heute')
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
  })
})
