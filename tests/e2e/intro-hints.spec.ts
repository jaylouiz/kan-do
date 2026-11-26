import { expect, test, type Page } from '@playwright/test'
import { fillerTasks, seedLocalBoard, seedNotionBoard, SEED_TASKS } from './helpers/seed'
import { callTasksStore, fullTask } from './helpers/store'
import { goToPlace, openDayClose } from './helpers/appNav'

/**
 * The intro hints' base (#800): the welcome setup starts them, one hint shows in the bottom overlay, doing the step
 * or "Schließen" ends it, and a user who did not come through the welcome setup sees none. #801 adds "Weiter", "Auswahl" and
 * "Abschluss" at the end of this file. The rules themselves
 * (order, three days, quiet day) are unit-tested (`tests/lib/introHints.test.ts`, `tests/composables/useIntroHints.test.ts`).
 */

const MOBILE = { width: 390, height: 844 }
/** A board with cards in Offen and nothing in Jetzt: the moment of "Start". */
const OPEN_ONLY = SEED_TASKS.filter((task) => task.status !== 1)

const hint = (page: Page) => page.getByTestId('intro-hint')
const record = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('settings-store') ?? '{}') as { introHints?: { quietDay: string | null, hints: Record<string, { answered: boolean, days: string[] }> } | null }).introHints ?? null)

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('#column-open')).toBeVisible()
}

test('the welcome setup starts the hints: "Start" shows with the first card in Offen and ends when a card is in Jetzt', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Jetzt starten' }).click()
  await page.getByRole('button', { name: 'Zum Board' }).click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect.poll(async () => (await record(page)) as unknown).toMatchObject({ on: true, quietDay: null, v: 2 })
  // The empty board (#853): its empty state with the add button, and the welcome note that says what the board is
  await expect(page.getByTestId('open-empty-hint')).toBeVisible()
  await expect(hint(page)).toHaveAttribute('data-hint', 'welcome')
  await expect(page.getByTestId('intro-note-title')).toHaveText('Willkommen bei deinem Kanban-Board')
  await page.getByTestId('intro-hint-close').click()
  await expect(hint(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.hints.welcome?.answered).toBe(true)
  // "Schließen" of the welcome keeps no quiet day: the step hints follow at their moments
  expect((await record(page))?.quietDay).toBeNull()

  await callTasksStore(page, { action: 'addTask', args: [fullTask({ id: 'first', title: 'Erste Aufgabe', status: 0 })] })
  await expect(hint(page)).toBeVisible()
  await expect(page.getByTestId('intro-hint-host')).toHaveAttribute('role', 'status')
  await expect(hint(page)).toContainText('Ziehe in „Jetzt“, woran du gerade arbeitest. Diese Spalte hat immer nur Platz für eine Aufgabe. \n\nFür schnelle Wechsel kannst du eine andere Aufgabe einfach darüber ablegen.')
  // On screen: today is stored for the hint
  await expect.poll(async () => (await record(page))?.hints.start?.days.length).toBe(1)

  await callTasksStore(page, { action: 'updateTask', args: ['first', { status: 1 }] })
  // "Start" is answered. The card did not get into Jetzt by the user's own move (a store write, like a card a connection
  // brings), so "Die Zeit läuft mit und wenn du dir eine Timebox gegeben hast, siehst du wieviel Zeit davon noch übrig ist." does not show (#853)
  await expect.poll(async () => (await record(page))?.hints.start?.answered).toBe(true)
  await expect(hint(page)).toHaveCount(0)
  await callTasksStore(page, { action: 'updateTask', args: ['first', { status: 0 }] })
  await expect(hint(page)).toHaveCount(0)

  // An ended hint never returns: Jetzt empty again, after a reload too
  await callTasksStore(page, { action: 'updateTask', args: ['first', { status: 0 }] })
  await page.reload()
  await expect(page.locator('#column-open')).toBeVisible()
  await expect(page.locator('.task-wrapper')).toHaveCount(1)
  await expect(hint(page)).toHaveCount(0)
})

test('"Schließen" ends the hint, focus lands on the board, and it stays away after a reload', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()

  const close = page.getByTestId('intro-hint-close')
  await close.focus()
  await page.keyboard.press('Enter')
  await expect(hint(page)).toHaveCount(0)
  await expect(page.locator('[data-task-sheet-return]')).toBeFocused()
  await expect.poll(async () => (await record(page))?.hints.start?.answered).toBe(true)
  expect((await record(page))?.quietDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await page.reload()
  await expect(page.locator('#column-open')).toBeVisible()
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})

test('a user who did not come through the welcome setup (an install from before the hints) sees none, and nothing is stored', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY)
  await gotoBoard(page)
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
  await expect(page.getByTestId('intro-hint-host')).toHaveCount(0)
  expect(await record(page)).toBeNull()
})

test('the hint shows on "Heute" only: it leaves on "Alle" and under a task sheet, and is back afterwards', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()

  await goToPlace(page, 'Alle')
  await expect(hint(page)).toHaveCount(0)
  await goToPlace(page, 'Heute')
  await expect(hint(page)).toBeVisible()

  await page.goto(`/tasks/${OPEN_ONLY[0]!.id}`)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})

test('390px: the phone text, centred above the app bar, clear of it; "Schließen" is a 44 px target', async ({ context, page }) => {
  await page.setViewportSize(MOBILE)
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()
  await expect(hint(page)).toContainText('Halte die Karte und ziehe sie an den rechten Rand, in „Jetzt“.')

  const box = (await hint(page).boundingBox())!
  const bar = (await page.locator('.app-nav-pill').boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y)
  expect(Math.abs(box.x + box.width / 2 - MOBILE.width / 2)).toBeLessThanOrEqual(1)
  const close = (await page.getByTestId('intro-hint-close').boundingBox())!
  expect(close.height).toBeGreaterThanOrEqual(44)
  expect(close.width).toBeGreaterThanOrEqual(44)
})

test('a hidden page does not use up a day: the day is stored when the page is visible again', async ({ context, page }) => {
  // A tab in the background (or a desktop window left behind) still runs the midnight timer; only a seen hint counts
  await context.addInitScript(() => {
    let state: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    ;(window as unknown as { __setVisibility: (value: DocumentVisibilityState) => void }).__setVisibility = (value) => {
      state = value
      document.dispatchEvent(new Event('visibilitychange'))
    }
  })
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()
  // Give a wrongly stored day time to show up
  await page.waitForTimeout(500)
  expect((await record(page))?.hints.start?.days ?? []).toHaveLength(0)

  await page.evaluate(() => (window as unknown as { __setVisibility: (value: string) => void }).__setVisibility('visible'))
  await expect.poll(async () => (await record(page))?.hints.start?.days.length).toBe(1)
})

test('desktop: the column buttons keep their place whether a note stands or not; the note overlaps them (#881)', async ({ context, page }) => {
  await seedLocalBoard(context, SEED_TASKS, {}, undefined, { hints: true })
  for (const size of [{ width: 1280, height: 720 }, { width: 800, height: 720 }]) {
    await page.setViewportSize(size)
    await gotoBoard(page)
    await expect(hint(page)).toBeVisible()
    const button = page.locator('#column-done .column-footer button').first()
    const withNote = (await button.boundingBox())!
    // Where the note reaches the column (narrow window) it lies over the button
    const sheet = (await hint(page).boundingBox())!
    if (size.width === 800) expect(sheet.x < withNote.x + withNote.width && sheet.x + sheet.width > withNote.x && sheet.y < withNote.y + withNote.height).toBe(true)
    // The note ends (the tour's skip), the button stays where it was
    await answerHints(page, 'start', 'weiter', 'auswahl', 'abschluss')
    await expect(hint(page)).toBeHidden()
    await expect.poll(async () => Math.round((await button.boundingBox())!.y)).toBe(Math.round(withNote.y))
  }
})

test('every intro note has a permanent 2px outline in the ink of its title, and no glow (#858)', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true })
  await gotoBoard(page)
  const note = page.getByTestId('intro-note')
  await expect(note).toBeVisible()
  const style = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="intro-note"]') as HTMLElement
    const title = document.querySelector('[data-testid="intro-note-title"]') as HTMLElement
    const cs = getComputedStyle(el)
    return { width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor, ink: getComputedStyle(title).color }
  })
  expect(style.width).toBe('2px')
  expect(style.style).toBe('solid')
  expect(style.color).toBe(style.ink)
})

// --- #801: "Weiter", "Auswahl", "Abschluss" ----------------------------------------------------------------------

/** What the steps already ended, as if the user had done them: `answerIntroHint` of the settings store, in the running app. */
async function answerHints(page: Page, ...ids: string[]) {
  await page.evaluate((hintIds) => {
    const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, { answerIntroHint: (id: string) => void }> } } }).useNuxtApp()
    for (const id of hintIds) app.$pinia._s.get('settings')!.answerIntroHint(id)
  }, ids)
}
const groupingEnabled = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('board-store') ?? '{}') as { grouping?: { enabled?: boolean } }).grouping?.enabled ?? false)

/** Two in Offen, one in Jetzt: the moment of "Weiter" (a card in Jetzt answers "Start" at once). */
const WITH_JETZT = SEED_TASKS.filter((task) => task.status === 0 || task.status === 1)
/** Four in Offen, Jetzt empty: the moment of "Auswahl" once "Start" is answered. */
const MANY_OPEN = [...SEED_TASKS.filter((task) => task.status === 0), ...fillerTasks(4)].slice(0, 5)
/** Cards in Offen and one done today, Jetzt empty. */
const WITH_DONE = SEED_TASKS.filter((task) => task.status === 0 || task.id === 'seed-done-1')

test('"Weiter": shows with a card in Jetzt, ends when the card goes to Wartet, and does not return', async ({ context, page }) => {
  await seedLocalBoard(context, WITH_JETZT, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()
  await expect(hint(page)).toHaveAttribute('data-hint', 'weiter')
  await expect(hint(page)).toContainText('Die Zeit läuft jetzt mitZiehe die Karte in „Erledigt“')
  await expect.poll(async () => (await record(page))?.hints.start?.answered).toBe(true)

  await callTasksStore(page, { action: 'updateTask', args: ['seed-progress-1', { status: 2 }] })
  await expect(hint(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.hints.weiter?.answered).toBe(true)
  await page.reload()
  await expect(page.locator('#column-open')).toBeVisible()
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})

test('"Weiter" ends unseen when the card goes to Erledigt while a notice hides the hint', async ({ context, page }) => {
  await seedLocalBoard(context, WITH_JETZT, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toHaveAttribute('data-hint', 'weiter')
  // Off the board the hint is not shown, and the step is still seen
  await goToPlace(page, 'Alle')
  await expect(hint(page)).toHaveCount(0)
  await callTasksStore(page, { action: 'updateTask', args: ['seed-progress-1', { status: 3, completedAt: new Date().toISOString() }] })
  await expect.poll(async () => (await record(page))?.hints.weiter?.answered).toBe(true)
})

test('"Auswahl": shows with four cards in Offen and Jetzt empty; "Karten stapeln" stacks them and ends the hint', async ({ context, page }) => {
  await seedLocalBoard(context, MANY_OPEN, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toHaveAttribute('data-hint', 'start')
  await answerHints(page, 'start')
  await expect(hint(page)).toHaveAttribute('data-hint', 'auswahl')
  await expect(hint(page)).toContainText('Viel offen?Gestapelt nach Thema oder Priorität wählst du leichter aus. Die Stapel findest du auch unter „Mehr“.')
  expect(await groupingEnabled(page)).toBe(false)

  await page.getByTestId('intro-hint-stack').click()
  await expect(hint(page)).toHaveCount(0)
  await expect.poll(() => groupingEnabled(page)).toBe(true)
  await expect.poll(async () => (await record(page))?.hints.auswahl?.answered).toBe(true)
  // The hint is ended for good, and stacking off again brings nothing back
  await expect(page.locator('[data-task-sheet-return]')).toBeFocused()
})

test('"Auswahl" is not there with three cards in Offen', async ({ context, page }) => {
  await seedLocalBoard(context, MANY_OPEN.slice(0, 3), {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await answerHints(page, 'start')
  await expect(hint(page)).toHaveCount(0)
})

test('"Abschluss": shows with something done today and Jetzt empty, and ends when "Tag abschließen" is opened', async ({ context, page }) => {
  await seedLocalBoard(context, WITH_DONE, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await answerHints(page, 'start')
  await expect(hint(page)).toHaveAttribute('data-hint', 'abschluss')
  await expect(hint(page)).toContainText('Genug für heute?„Tag abschließen“ zeigt dir, was du geschafft hast und was offen bleibt.')

  await openDayClose(page)
  await expect(page.getByTestId('day-close-stage')).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.hints.abschluss?.answered).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('day-close-stage')).toHaveCount(0)
  await expect(hint(page)).toHaveCount(0)
})

test('two hints are due: "Auswahl" first, and "Schließen" keeps "Abschluss" away for the rest of the day', async ({ context, page }) => {
  await seedLocalBoard(context, [...MANY_OPEN, ...WITH_DONE.filter((task) => task.status === 3)], {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await answerHints(page, 'start')
  await expect(hint(page)).toHaveAttribute('data-hint', 'auswahl')
  await page.getByTestId('intro-hint-close').click()
  await expect(hint(page)).toHaveCount(0)
  // Quiet for the rest of the day, "Abschluss" would be next
  await page.waitForTimeout(300)
  await expect(hint(page)).toHaveCount(0)
})

test('390px: "Karten stapeln" and "Schließen" are 44 px targets, clear of the app bar', async ({ context, page }) => {
  await page.setViewportSize(MOBILE)
  await seedLocalBoard(context, MANY_OPEN, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await answerHints(page, 'start')
  await expect(hint(page)).toHaveAttribute('data-hint', 'auswahl')
  const box = (await hint(page).boundingBox())!
  const bar = (await page.locator('.app-nav-pill').boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y)
  for (const id of ['intro-hint-stack', 'intro-hint-close']) {
    const target = (await page.getByTestId(id).boundingBox())!
    expect(target.height, id).toBeGreaterThanOrEqual(44)
    expect(target.width, id).toBeGreaterThanOrEqual(44)
  }
})

// --- #804: turning the hints off ---------------------------------------------------------------------------------

test('"Hinweise ausschalten" on a hint turns all hints off: a toast says where to read them, and nothing shows afterwards, not after a reload either', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()
  const off = page.getByTestId('intro-hint-off')
  await expect(off).toHaveText('Hinweise ausschalten')
  await off.focus()
  await page.keyboard.press('Enter')

  await expect(hint(page)).toHaveCount(0)
  await expect(page.getByTestId('intro-hint-host')).toHaveCount(0)
  await expect(page.getByText('Hinweise ausgeschaltet', { exact: true })).toBeVisible()
  await expect(page.getByText('Du kannst sie jederzeit unter Einstellungen, Board nachlesen.', { exact: true })).toBeVisible()
  await expect(page.locator('[data-task-sheet-return]')).toBeFocused()
  await expect.poll(async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('settings-store') ?? '{}').introHints?.on))).toBe(false)

  // A later moment shows nothing either
  await callTasksStore(page, { action: 'updateTask', args: [OPEN_ONLY[0]!.id, { status: 1 }] })
  await expect(hint(page)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('#column-open')).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})

test('"Erneut zeigen" in the settings brings the hints back: the welcome shows again on the board', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
  await gotoBoard(page)
  await page.getByTestId('intro-hint-off').click()
  await expect(hint(page)).toHaveCount(0)
  await page.goto('/settings')
  await page.getByTestId('intro-hints-toggle').click()
  await goToPlace(page, 'Heute')
  // All notes start again from the first: the welcome (#853), then "Start"
  await expect(hint(page)).toHaveAttribute('data-hint', 'welcome')
})

test('390px: the link "Hinweise ausschalten" is a 44 px target and the sheet stays clear of the app bar', async ({ context, page }) => {
  await page.setViewportSize(MOBILE)
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true })
  await gotoBoard(page)
  await expect(hint(page)).toBeVisible()
  const off = (await page.getByTestId('intro-hint-off').boundingBox())!
  expect(off.height).toBeGreaterThanOrEqual(44)
  const box = (await hint(page).boundingBox())!
  const bar = (await page.locator('.app-nav-pill').boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y)
})

/**
 * "Die Aufgaben des Tages planen" (#803): the planning note of "Alle" as a hint. Tasks wait under "Alle", "Heute" is empty: the note shows on the first
 * visit, by any way; it ends with "Schließen" (quiet for the day) or by going on to "Heute", not by a page off the board.
 * The rules are unit-tested; the old #711 note (a user without hints) is in `new-day-recap.spec.ts`.
 */
const PICK_ONLY = SEED_TASKS.slice(0, 2).map((task) => ({ ...task, status: 0 as const, notPlanned: true as const }))
const planNote = (page: Page) => page.getByTestId('plan-note')
const planRecord = (page: Page) =>
  page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('settings-store') ?? '{}') as { introHints?: { on: boolean, quietDay: string | null, hints: Record<string, { answered: boolean, days: string[] }> } | null }
    const recap = JSON.parse(localStorage.getItem('day-recap-store') ?? '{}') as { planNoteSeen?: boolean }
    return { record: settings.introHints ?? null, seen: recap.planNoteSeen === true }
  })

test('"Die Aufgaben des Tages planen": the first visit to "Alle" shows the note, a page off the board is no answer, "Heute" ends it for good', async ({ context, page }) => {
  await seedLocalBoard(context, PICK_ONLY, {}, undefined, { hints: true, once: true })
  await page.goto('/all')
  await expect(page.locator('#column-open').getByTestId('plan-note')).toBeVisible()
  await expect(planNote(page)).toContainText('Wähle aus, was heute dran ist')
  await expect.poll(async () => (await planRecord(page)).record?.hints.planen?.days.length).toBe(1)

  // Statistik is not "Heute": the note is there again on the way back
  await goToPlace(page, 'Statistik')
  await goToPlace(page, 'Alle')
  await expect(planNote(page)).toBeVisible()
  expect((await planRecord(page)).seen).toBe(false)

  await goToPlace(page, 'Heute')
  await expect.poll(async () => (await planRecord(page)).seen).toBe(true)
  expect((await planRecord(page)).record?.hints.planen?.answered).toBe(true)
  await goToPlace(page, 'Alle')
  await expect(planNote(page)).toHaveCount(0)
})

test('"Die Aufgaben des Tages planen": "Schließen" ends it, keeps the day quiet and stays away after a reload', async ({ context, page }) => {
  await seedLocalBoard(context, PICK_ONLY, {}, undefined, { hints: true, once: true })
  await page.goto('/all')
  await expect(planNote(page)).toBeVisible()
  await page.getByTestId('plan-note-close').click()
  await expect(planNote(page)).toHaveCount(0)
  await expect(page.locator('[data-task-sheet-return]')).toBeFocused()
  await expect.poll(async () => (await planRecord(page)).seen).toBe(true)
  const { record } = await planRecord(page)
  expect(record?.quietDay).not.toBeNull()
  expect(record?.hints.planen?.answered).toBe(true)
  await page.reload()
  await expect(page.getByTestId('not-planned')).toBeVisible()
  await expect(planNote(page)).toHaveCount(0)
})

test('"Die Aufgaben des Tages planen" at 390: one line with the two links, "Hinweise ausschalten" takes it away with a toast', async ({ context, page }) => {
  await page.setViewportSize(MOBILE)
  await seedLocalBoard(context, PICK_ONLY, {}, undefined, { hints: true, once: true })
  await page.goto('/tasks')
  await goToPlace(page, 'Alle')
  await expect(planNote(page)).toContainText('Wähle aus, was heute dran istSobald du loslegen willst, wechsle in der Navigation zu „Heute“.')
  for (const id of ['plan-note-off', 'plan-note-close']) {
    const box = (await page.getByTestId(id).boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  await page.getByTestId('plan-note-off').click()
  await expect(planNote(page)).toHaveCount(0)
  await expect(page.getByText('Hinweise ausgeschaltet', { exact: true })).toBeVisible()
  await expect.poll(async () => (await planRecord(page)).record?.on).toBe(false)
})

test('"Die Aufgaben des Tages planen" stays silent with a card already planned for today or with nothing to pick', async ({ context, page }) => {
  await seedLocalBoard(context, [...PICK_ONLY, { ...SEED_TASKS[2]!, status: 0 }], {}, undefined, { hints: true })
  await page.goto('/all')
  await expect(page.getByTestId('not-planned')).toBeVisible()
  await expect(planNote(page)).toHaveCount(0)
  // the card in Offen answered the hint: it does not come back when the card leaves
  await expect.poll(async () => (await planRecord(page)).record?.hints.planen?.answered).toBe(true)
})

// --- #853: the welcome ------------------------------------------------------

/** Two cards in Offen and nothing else: after the tour no step hint is due ("Start" was said, "Auswahl" needs four, nothing is done). */
const TOUR_BOARD = SEED_TASKS.filter((task) => task.status === 0).slice(0, 2)
/** As after the welcome setup today: the welcome ahead. */
const WELCOME = { hints: 'welcome' as const, once: true }

test('cards on "Heute": the welcome is a tour of three notes; focus stays on "Weiter", "Loslegen" ends it for good and "Start" is not said again', async ({ context, page }) => {
  await seedLocalBoard(context, TOUR_BOARD, {}, undefined, WELCOME)
  await gotoBoard(page)
  await expect(hint(page)).toHaveAttribute('data-hint', 'welcome')
  await expect(hint(page)).toHaveAttribute('data-step', '1')
  const title = page.getByTestId('intro-note-title')
  await expect(title).toHaveText('Das ist dein Tag')
  await expect(page.getByTestId('intro-hint-host')).toContainText('Schritt 1 von 3')
  await expect(page.getByTestId('intro-hint-skip')).toHaveText('Überspringen')

  const next = page.getByTestId('intro-hint-next')
  await expect(next).toHaveText('Weiter')
  await next.focus()
  await page.keyboard.press('Enter')
  await expect(title).toHaveText('Eine Aufgabe zur Zeit')
  await expect(hint(page)).toContainText('Ziehe in „Jetzt“, woran du gerade arbeitest.')
  await expect(next).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(title).toHaveText('Erledigt oder Wartet')
  await expect(next).toHaveText('Loslegen')
  await expect(next).toBeFocused()
  await expect(page.getByTestId('intro-hint-skip')).toHaveCount(0)
  await page.keyboard.press('Enter')

  // Ended: focus on the board, and the cards in Offen do not bring "Womit fängst du an?" (the tour said it)
  await expect(hint(page)).toHaveCount(0)
  await expect(page.locator('[data-task-sheet-return]')).toBeFocused()
  await expect.poll(async () => (await record(page))?.hints.welcome?.answered).toBe(true)
  expect((await record(page))?.hints.start?.answered).toBe(true)

  await page.reload()
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(hint(page)).toHaveCount(0)
})

test('a started tour keeps its step across a task sheet (#853)', async ({ context, page }) => {
  await seedLocalBoard(context, TOUR_BOARD, {}, undefined, WELCOME)
  await gotoBoard(page)
  const title = page.getByTestId('intro-note-title')
  await page.getByTestId('intro-hint-next').click()
  await expect(title).toHaveText('Eine Aufgabe zur Zeit')
  await page.locator('.task-wrapper').first().click()
  await expect(page).toHaveURL(/\/tasks\/.+/)
  await expect(hint(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(title).toHaveText('Eine Aufgabe zur Zeit')
  await expect(hint(page)).toHaveAttribute('data-step', '2')
})

test('"Überspringen" ends the tour for good; "Hinweise ausschalten" on the welcome ends it too', async ({ context, page }) => {
  await seedLocalBoard(context, TOUR_BOARD, {}, undefined, WELCOME)
  await gotoBoard(page)
  await page.getByTestId('intro-hint-skip').click()
  await expect(hint(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.hints.welcome?.answered).toBe(true)
  await page.reload()
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(hint(page)).toHaveCount(0)

  // "Erneut zeigen" brings the welcome back, in the shape that fits the board now; turning the hints off ends it
  await page.goto('/settings')
  const toggle = page.getByTestId('intro-hints-toggle')
  await toggle.click()
  await expect(toggle).toHaveText('Erneut zeigen')
  await toggle.click()
  await expect(toggle).toHaveText('Ausschalten')
  await gotoBoard(page)
  await expect(hint(page)).toHaveAttribute('data-hint', 'welcome')
  await page.getByTestId('intro-hint-off').click()
  await expect(page.getByTestId('intro-hint-host')).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.hints.welcome?.answered).toBe(true)
})

test('tasks only under "Alle": one note whose button "Aufgaben auswählen" opens "Alle", where the planning note follows', async ({ context, page }) => {
  await seedLocalBoard(context, PICK_ONLY, {}, undefined, WELCOME)
  await gotoBoard(page)
  await expect(page.getByTestId('intro-note-title')).toHaveText('Deine Aufgaben sind da')
  // The empty state names "Alle" while tasks wait there
  await expect(page.getByTestId('open-empty-all-link')).toBeVisible()
  const toAll = page.getByTestId('intro-hint-all')
  await expect(toAll).toHaveText('Aufgaben auswählen')
  await toAll.click()
  await expect(page).toHaveURL(/\/all$/)
  await expect(hint(page)).toHaveCount(0)
  await expect(page.locator('#column-open').getByTestId('plan-note')).toBeVisible()
})

test('the first open on "Alle": one note there, the planning note does not follow it, and "Heute" shows no welcome afterwards', async ({ context, page }) => {
  await seedLocalBoard(context, [...PICK_ONLY, { ...SEED_TASKS[2]!, status: 0 }], {}, undefined, WELCOME)
  await page.goto('/all')
  await expect(hint(page)).toHaveAttribute('data-hint', 'welcome')
  await expect(page.getByTestId('intro-note-title')).toHaveText('Deine Aufgaben sind da')
  await expect(hint(page)).toContainText('Fahre über eine Karte: Der Pfeil plant sie für heute ein.')
  await expect(page.getByTestId('intro-hint-steps')).toHaveCount(0)
  await page.getByTestId('intro-hint-close').click()
  await expect(hint(page)).toHaveCount(0)
  await expect.poll(async () => (await record(page))?.hints.planen?.answered).toBe(true)
  await goToPlace(page, 'Heute')
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  // No tour after the note on "Alle" (one welcome); the step hint of the board follows
  await expect(hint(page)).toHaveAttribute('data-hint', 'start')
})

test('a card the board starts with in Jetzt: the tour explains it, the board is not dimmed while it stands, and no timer hint follows', async ({ context, page }) => {
  await seedLocalBoard(context, WITH_JETZT, {}, undefined, { ...WELCOME, focus: true })
  await gotoBoard(page)
  await expect(hint(page)).toHaveAttribute('data-hint', 'welcome')
  // The Jetzt focus overlay waits for the welcome (D1)
  await expect(page.locator('.board')).not.toHaveAttribute('data-focus')
  await page.getByTestId('intro-hint-next').click()
  await expect(hint(page)).toContainText('In „Jetzt“ liegt immer nur eine Aufgabe: die, an der du gerade arbeitest.')
  await page.getByTestId('intro-hint-next').click()
  await page.getByTestId('intro-hint-next').click()
  // "Die Zeit läuft mit und wenn du dir eine Timebox gegeben hast, siehst du wieviel Zeit davon noch übrig ist." only after the user's own card in Jetzt
  await expect(hint(page)).toHaveCount(0)
  await expect(page.locator('.board')).toHaveAttribute('data-focus', '')
})

test('the dashed Jetzt placeholder shows only beside a card in Offen and never again once a card was in Jetzt, also after a reload', async ({ context, page }) => {
  await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { once: true })
  await gotoBoard(page)
  const placeholder = page.getByTestId('jetzt-placeholder')
  await expect(placeholder).toBeVisible()
  await callTasksStore(page, { action: 'updateTask', args: [OPEN_ONLY[0]!.id, { status: 1 }] })
  await expect(placeholder).toHaveCount(0)
  await callTasksStore(page, { action: 'updateTask', args: [OPEN_ONLY[0]!.id, { status: 0 }] })
  await expect(page.locator('#column-progress .task-wrapper')).toHaveCount(0)
  await expect(placeholder).toHaveCount(0)
  // Jetzt stays a drop target without it
  await expect(page.locator('#column-progress .column-drop-zone')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.task-wrapper').first()).toBeVisible()
  await expect(placeholder).toHaveCount(0)
})

test('an empty board: no dashed placeholder beside the empty Offen, the green button adds the first task and the round add button returns with it', async ({ context, page }) => {
  await seedLocalBoard(context, [])
  await gotoBoard(page)
  await expect(page.getByTestId('open-empty-hint')).toBeVisible()
  await expect(page.getByTestId('jetzt-placeholder')).toHaveCount(0)
  await expect(page.locator('#column-open [data-testid="add-task-header-button"]')).toHaveCount(0)
  await page.getByTestId('board-empty-add').click()
  await expect(page.getByTestId('open-empty-hint')).toHaveCount(0)
  await expect(page.locator('#column-open').getByRole('textbox').first()).toBeFocused()
})

test('a board with a connection: no welcome and no empty state while its first fetch still runs; both read the board once it has ended', async ({ context, page }) => {
  await seedNotionBoard(context, [])
  // The record the welcome setup writes (the Notion seed has no hints option)
  await context.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem('settings-store') ?? '{}') as { introHints?: unknown }
    if (!settings.introHints) localStorage.setItem('settings-store', JSON.stringify({ ...settings, introHints: { on: true, quietDay: null, hints: {}, v: 2 } }))
  })
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/notion/query-data-source', async (route) => {
    await held
    await route.continue()
  })
  await gotoBoard(page)
  // Give a note or an empty state that wrongly shows time to appear
  await page.waitForTimeout(500)
  await expect(hint(page)).toHaveCount(0)
  await expect(page.getByTestId('open-empty-hint')).toHaveCount(0)

  release()
  await expect(hint(page)).toHaveAttribute('data-hint', 'welcome')
})
