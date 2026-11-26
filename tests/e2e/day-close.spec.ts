import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fillerTasks, seedLocalBoard, SEED_TASKS, type SeedCarryOver, type SeedTask } from './helpers/seed'
import { appNav, dayCloseCta, goToPlace, moreButton, openDayClose, openMore } from './helpers/appNav'
import { settleAnimations } from './helpers/settle'
import { expectStageFits } from './helpers/recapStage'

/** Issue #98, #237, #480: the day close ("Tag abschließen") is a full-size stage with one calm sheet. Local tasks, no integration. */

const dayKey = (offsetDays = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const carried = (days: number): SeedCarryOver => ({ firstOn: dayKey(-days), days, lastOn: dayKey(), keptAtDays: null })

const stage = (page: Page) => page.getByTestId('day-close-stage')
const doneButton = (page: Page) => page.getByTestId('day-close-done-button')
const cancelButton = (page: Page) => page.getByTestId('day-close-cancel')

/** Everything a close may change, read from the stored state. The running timer ticks, so time is a separate read. */
const readStored = (page: Page) => page.evaluate(() => {
  const tasks = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<Record<string, unknown>>, archivedTaskIds?: string[], deletedTaskIds?: string[] }
  const recap = JSON.parse(localStorage.getItem('day-recap-store') ?? '{}') as { lastNewDay?: string, sentBack?: { day: string, ids: string[], waiting?: string[] } }
  return {
    tasks: Object.fromEntries((tasks.tasks ?? []).map(task => [task.id as string, { status: task.status, notPlanned: task.notPlanned ?? false, timerId: task.timerId ?? null, timeSpentSeconds: task.timeSpentSeconds as number, notes: task.notes ?? null }])),
    archived: [...(tasks.archivedTaskIds ?? [])].sort(),
    deleted: tasks.deletedTaskIds ?? [],
    trash: localStorage.getItem('trash-store'),
    lastNewDay: recap.lastNewDay ?? null,
    sentBack: recap.sentBack ?? null,
  }
}).catch(() => null)

/** The stored state without anything that ticks, for "nothing changed" checks. */
const snapshot = (page: Page) => page.evaluate(() => {
  const stored = JSON.parse(localStorage.getItem('tasks-store') ?? '{}')
  const tasks = (stored.tasks as Record<string, unknown>[]).map(({ timeSpentSeconds: _t, timerId: _i, updatedAt: _u, ...rest }) => rest)
  return JSON.stringify({ tasks, archived: stored.archivedTaskIds, deleted: stored.deletedTaskIds, pending: stored.pendingDeletes, board: localStorage.getItem('board-store'), recap: localStorage.getItem('day-recap-store') })
})

/** Only the tasks and their archive: visiting another page writes the board's and the recap's baselines, which is no change by the stage. */
const tasksSnapshot = (page: Page) => page.evaluate(() => {
  const stored = JSON.parse(localStorage.getItem('tasks-store') ?? '{}')
  const tasks = (stored.tasks as Record<string, unknown>[]).map(({ timeSpentSeconds: _t, timerId: _i, updatedAt: _u, ...rest }) => rest)
  return JSON.stringify({ tasks, archived: stored.archivedTaskIds, deleted: stored.deletedTaskIds })
})

const doneToday = (id: string, title: string, extra: Partial<SeedTask> = {}): SeedTask => ({
  id, title, status: 3, priority: 3, activity: null, topic: null, topicColorCode: null, timeSpentSeconds: 0, timeBoxSeconds: null,
  custom: {}, completedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...extra,
})

test.describe('Day close stage (#480)', () => {
  test.beforeEach(async ({ context }) => {
    // Once: the next-morning test reloads the page and must keep what the close wrote
    await seedLocalBoard(context, SEED_TASKS, {
      'seed-open-1': carried(5),
      'seed-waiting-1': carried(5),
      'seed-open-2': carried(2),
    }, undefined, { once: true })
  })

  test('opens from the Mehr panel as a stage, not a dialog; Esc and "Abbrechen" leave it, focus returns to ⋯, nothing changes', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    const before = await snapshot(page)

    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Tag abschließen' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('day-close-date')).toHaveText(new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()))
    // Focus starts on the safe exit, so a key still held from the trigger cannot close the day
    await expect(cancelButton(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(stage(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()

    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await cancelButton(page).click()
    await expect(stage(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()

    expect(await snapshot(page)).toBe(before)
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(1)
  })

  test('opens from the Erledigt CTA and focus returns to the CTA, never <body>', async ({ page }) => {
    await page.goto('/tasks')
    await expect(dayCloseCta(page)).toHaveText('Tag abschließen')
    await dayCloseCta(page).click()
    await expect(stage(page)).toBeVisible()
    // Esc is the stage's own keydown: it only fires once focus has moved into the stage. For a frame or two after the mount focus
    // sits on <body> (the board went inert), and under load a key pressed then is lost (#723). Wait for the safe exit first.
    await expect(cancelButton(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(stage(page)).toBeHidden()
    await expect(dayCloseCta(page)).toBeFocused()
  })

  test('the CTA is hidden while nothing is done today; the panel row stays', async ({ page, context }) => {
    await seedLocalBoard(context, SEED_TASKS.filter(task => task.status !== 3))
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper').first()).toBeVisible()
    await expect(dayCloseCta(page)).toHaveCount(0)
    const panel = await openMore(page)
    await expect(panel.getByTestId('more-day-close')).toBeVisible()
  })

  test('opens from the command palette: the palette closes first and focus lands on the stage', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(palette).toBeVisible()
    await page.keyboard.type('Tag abschl')
    // Wait for the filter to settle: Enter picks the highlighted row, so it must be the day-close command
    await expect(palette.getByRole('option').first()).toHaveText(/Tag abschließen/)
    await expect(palette.getByRole('option', { name: /Tag abschließen/ })).toHaveAttribute('data-highlighted', '')
    await page.keyboard.press('Enter')

    await expect(stage(page)).toBeVisible()
    await expect(palette).toHaveCount(0)
    await expect(cancelButton(page)).toBeFocused()
    // The Enter that chose the command did not close the day
    expect((await readStored(page))?.sentBack?.ids ?? []).toEqual([])

    await page.keyboard.press('Escape')
    await expect(stage(page)).toBeHidden()
    const focusIsOnBoard = await page.evaluate(() => {
      const active = document.activeElement
      return !!active && active !== document.body && !!active.closest('[data-task-sheet-return]')
    })
    expect(focusIsOnBoard).toBe(true)
  })

  test('shows the progress text, the Timebox chart and the consequence line; no list, no choice, no copy action, no total time', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(page.getByTestId('day-close-headline')).toHaveText('1 von 5 geplanten Aufgaben erledigt')
    await expect(page.getByTestId('day-close-timebox')).toBeVisible()
    await expect(page.getByTestId('day-close-timebox-within')).toHaveText(/1\s*Wie geplant/)
    await expect(page.getByTestId('day-close-timebox-under')).toHaveText(/0\s*Kürzer als geplant/)
    await expect(page.getByTestId('day-close-timebox-over')).toHaveText(/0\s*Länger als geplant/)
    await expect(page.getByTestId('day-close-timebox')).toContainText('Basis: 1 erledigte Aufgabe mit Timebox und erfasster Zeit.')
    // No done task has a topic: no Themen chart
    await expect(page.getByTestId('day-close-topics')).toHaveCount(0)
    await expect(page.getByTestId('day-close-consequence')).toHaveText('Deine unerledigten Aufgaben kannst du morgen erneut einplanen. Die erledigten Aufgaben werden archiviert.')
    await expect(stage(page).getByRole('checkbox')).toHaveCount(0)
    await expect(stage(page).getByText('Retrospektive nachbereiten')).toHaveCount(0)
    await expect(stage(page).getByRole('button', { name: /kopieren/ })).toHaveCount(0)
    await expect(stage(page).getByText('Gesamtzeit')).toHaveCount(0)
    // The date is the stage's subline only, not part of the sheet
    await expect(page.getByTestId('day-close-sheet').getByTestId('day-close-date')).toHaveCount(0)
  })

  test('charts: three Timebox groups with counts; topics by number of done tasks, the fifth topic on folded into "Sonstiges", no topic last', async ({ page, context }) => {
    const topics = ['Alpha', 'Alpha', 'Alpha', 'Beta', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']
    await seedLocalBoard(context, [
      ...SEED_TASKS.filter(task => task.status !== 3),
      ...topics.map((topic, i) => doneToday(`d-${i}`, `Erledigt ${i}`, { topic })),
      doneToday('d-none', 'Ohne Thema erledigt'),
      doneToday('d-under', 'Schneller', { timeBoxSeconds: 3600, timeSpentSeconds: 1200 }),
      doneToday('d-over', 'Länger', { timeBoxSeconds: 3600, timeSpentSeconds: 7200 }),
      doneToday('d-in-1', 'Genau', { timeBoxSeconds: 3600, timeSpentSeconds: 3700 }),
      doneToday('d-in-2', 'Fast genau', { timeBoxSeconds: 600, timeSpentSeconds: 880 }), // 5 min tolerance applies to a small box
      doneToday('d-nobox', 'Ohne Box', { timeSpentSeconds: 600 }),
    ])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(page.getByTestId('day-close-timebox-under')).toHaveText(/1\s*Kürzer als geplant/)
    await expect(page.getByTestId('day-close-timebox-within')).toHaveText(/2\s*Wie geplant/)
    await expect(page.getByTestId('day-close-timebox-over')).toHaveText(/1\s*Länger als geplant/)
    await expect(page.getByTestId('day-close-timebox')).toContainText('Basis: 4 erledigte Aufgaben')
    const rows = page.getByTestId('day-close-topic-row')
    await expect(rows).toHaveText([
      /Alpha\s*3 Aufgaben/, /Beta\s*2 Aufgaben/, /Delta\s*1 Aufgabe/, /Epsilon\s*1 Aufgabe/, /Sonstiges\s*2 Aufgaben/, /Ohne Thema\s*6 Aufgaben/,
    ])
  })

  test('"Tag abschließen" takes every unfinished task off the board into "Alle", archives the done ones, deletes nothing and keeps time and notes', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(1)
    await openDayClose(page)
    await doneButton(page).click()
    await expect(stage(page)).toBeHidden()

    // Heute is empty
    for (const column of ['open', 'progress', 'waiting', 'done']) await expect(page.locator(`#column-${column}-list .task-wrapper`)).toHaveCount(0)
    await expect(dayCloseCta(page)).toHaveCount(0)

    await expect.poll(async () => (await readStored(page))?.tasks['seed-progress-1']).toMatchObject({ status: 0, notPlanned: true, timerId: null })
    const stored = (await readStored(page))!
    for (const id of ['seed-open-1', 'seed-open-2']) expect(stored.tasks[id]).toMatchObject({ status: 0, notPlanned: true })
    // a waiting task keeps waiting (#794)
    expect(stored.tasks['seed-waiting-1']).toMatchObject({ status: 2, notPlanned: true })
    // Nothing deleted: every task is still there, time and notes untouched, the trash is empty
    expect(Object.keys(stored.tasks).sort()).toEqual(SEED_TASKS.map(task => task.id).sort())
    expect(stored.tasks['seed-progress-1']!.timeSpentSeconds).toBeGreaterThanOrEqual(1800)
    expect(stored.tasks['seed-waiting-1']!.notes).toBe('Warte auf Rückmeldung vom Team.')
    expect(stored.deleted).toEqual([])
    expect(stored.trash).toBeNull()
    // The stopped timer counts no further
    const time = stored.tasks['seed-progress-1']!.timeSpentSeconds
    await page.waitForTimeout(1500)
    expect((await readStored(page))!.tasks['seed-progress-1']!.timeSpentSeconds).toBe(time)
    // Today's done task is archived (the earlier unacknowledged one too), not deleted
    expect(stored.archived).toEqual(['seed-done-1', 'seed-done-2'])
    // Tomorrow is the started day, with the group of the Jetzt and Offen tasks (Jetzt first)
    expect(stored.lastNewDay).toBe(dayKey(1))
    expect(stored.sentBack).toEqual({ day: dayKey(1), ids: ['seed-progress-1', 'seed-open-1', 'seed-open-2'], waiting: ['seed-waiting-1'], from: dayKey(0) })
    // Focus is never lost to <body>
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)

    // They are in "Alle", under "Alle Aufgaben"
    await goToPlace(page, 'Alle')
    for (const title of ['Konzept ausarbeiten', 'Dokumentation lesen', 'Review schreiben', 'Blocker klären']) {
      await expect(page.locator('[data-not-planned-id]', { hasText: title })).toHaveCount(1)
    }
  })

  test('the next morning: the block "Von gestern" is there, no notice, no second fresh start, the recap still lists what was left', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await doneButton(page).click()
    await expect(stage(page)).toBeHidden()
    await expect.poll(async () => (await readStored(page))?.sentBack?.day).toBe(dayKey(1))

    // The app opens again the next morning
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(8, 30, 0, 0)
    await page.clock.install({ time: tomorrow })
    await page.reload()

    const recap = page.getByTestId('new-day-recap')
    await expect(recap).toBeVisible()
    await expect(recap.getByText('Review schreiben')).toBeVisible()
    await page.getByTestId('recap-plan').click()
    await expect(page).toHaveURL(/\/all/)
    await expect(page.getByTestId('new-day-note')).toHaveCount(0)

    // Jetzt, Offen and Wartet of the closed day: one block, named by that day (#469, #741)
    await expect(page.getByRole('heading', { level: 3, name: /^Von gestern \d+ Aufgaben?$/ })).toBeVisible()
    const group = page.locator('[data-not-planned-id]')
    for (const title of ['Konzept ausarbeiten', 'Dokumentation lesen', 'Review schreiben', 'Blocker klären']) {
      await expect(group.filter({ hasText: title })).toHaveCount(1)
    }
    // The marker is not overwritten by the morning's own checks
    const stored = (await readStored(page))!
    expect(stored.sentBack).toEqual({ day: dayKey(1), ids: ['seed-progress-1', 'seed-open-1', 'seed-open-2'], waiting: ['seed-waiting-1'], from: dayKey(0) })
    expect(stored.lastNewDay).toBe(dayKey(1))
  })

  test('a double click closes once', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await doneButton(page).dblclick()
    await expect(stage(page)).toBeHidden()
    await expect.poll(async () => (await readStored(page))?.sentBack?.ids).toEqual(['seed-progress-1', 'seed-open-1', 'seed-open-2'])
  })

  test('nothing left open: trophy headline, the second sentence only, and closing leaves an empty group', async ({ page, context }) => {
    await seedLocalBoard(context, SEED_TASKS.filter(task => task.status === 3))
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(page.getByTestId('day-close-headline')).toHaveText('Alle Aufgaben erledigt')
    await expect(page.getByTestId('day-close-trophy')).toBeVisible()
    await expect(page.getByTestId('day-close-consequence')).toHaveText('Die erledigten Aufgaben werden archiviert.')
    await doneButton(page).click()
    await expect(stage(page)).toBeHidden()
    await expect.poll(async () => (await readStored(page))?.sentBack).toEqual({ day: dayKey(1), ids: [] })
  })

  test('empty board: one quiet line, no charts, no consequence, and the button still closes', async ({ page, context }) => {
    await seedLocalBoard(context, [])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(page.getByTestId('day-close-headline')).toHaveText('Heute noch nichts erledigt.')
    await expect(page.getByTestId('day-close-timebox')).toHaveCount(0)
    await expect(page.getByTestId('day-close-topics')).toHaveCount(0)
    await expect(page.getByTestId('day-close-consequence')).toHaveCount(0)
    await expect(doneButton(page)).toBeEnabled()
    await doneButton(page).click()
    await expect(stage(page)).toBeHidden()
  })

  test('many open tasks: the sheet scrolls as one and the button is reachable', async ({ page, context }) => {
    await seedLocalBoard(context, [...SEED_TASKS, ...fillerTasks(30, 0)])
    await page.setViewportSize({ width: 1280, height: 500 })
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(page.getByTestId('day-close-headline')).toHaveText('1 von 35 geplanten Aufgaben erledigt')
    await doneButton(page).scrollIntoViewIfNeeded()
    await expect(doneButton(page)).toBeInViewport()
  })

  test('leaving the page while the stage is open dismisses it without a change', async ({ page }) => {
    await page.goto('/tasks')
    const before = await tasksSnapshot(page)
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await goToPlace(page, 'Statistik')
    await expect(stage(page)).toHaveCount(0)
    await goToPlace(page, 'Heute')
    await expect(stage(page)).toHaveCount(0)
    expect(await tasksSnapshot(page)).toBe(before)
  })

  test('English locale', async ({ page }) => {
    await page.goto('/tasks?lang=en')
    await openDayClose(page)
    await expect(page.getByRole('region', { name: 'Close the day' })).toBeVisible()
    await expect(page.getByTestId('day-close-headline')).toHaveText('1 of 5 planned tasks done')
    await expect(page.getByTestId('day-close-timebox')).toContainText('Based on 1 done task with a timebox and tracked time.')
    await expect(page.getByTestId('day-close-timebox-within')).toHaveText(/As planned/)
    await expect(page.getByTestId('day-close-consequence')).toHaveText('You can plan your unfinished tasks again tomorrow. Your done tasks are archived.')
    await expect(cancelButton(page)).toHaveText('Cancel')
    await expect(doneButton(page)).toHaveText('Close the day')
  })

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`hierarchy at ${viewport.width}px: "Tag abschließen" is the one primary; "Abbrechen" is a regular secondary button of the same height (#424)`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/tasks')
      await openDayClose(page)
      await expect(stage(page)).toBeVisible()
      const phone = viewport.width === 390
      const expected = phone ? 48 : 36
      const height = async (locator: Locator) => Math.round((await locator.boundingBox())!.height)
      await expect.poll(() => height(doneButton(page))).toBe(expected)
      expect(await height(cancelButton(page))).toBe(expected)
      await expect(doneButton(page)).toHaveCSS('background-color', /^(?!rgba\(0, 0, 0, 0\)|rgba\(.*, 0\))/)
      await expect(cancelButton(page)).not.toHaveCSS('background-color', await doneButton(page).evaluate(el => getComputedStyle(el).backgroundColor))
      if (phone) {
        // Stacked, the primary on top (#612: the recap's order)
        const cancel = (await cancelButton(page).boundingBox())!
        const done = (await doneButton(page).boundingBox())!
        expect(done.y).toBeLessThan(cancel.y)
        expect(done.width).toBeGreaterThan(300)
      }
      else {
        // A right-aligned row: the way out left of the main button, no arrow on it
        const cancel = (await cancelButton(page).boundingBox())!
        const done = (await doneButton(page).boundingBox())!
        expect(cancel.x + cancel.width).toBeLessThanOrEqual(done.x)
        expect(Math.abs(cancel.y - done.y)).toBeLessThan(2)
        await expect(doneButton(page).locator('svg')).toHaveCount(0)
      }
    })
  }

  test('one paper sheet under the title holds the summary, the charts and the buttons; a short window shrinks it and scrolls inside, the buttons stay in view (#707)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 })
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await settleAnimations(page)
    const sheet = page.getByTestId('day-close-sheet')
    await expect(sheet.getByTestId('day-close-controls')).toHaveCount(1)
    await expect(sheet.getByTestId('day-close-timebox')).toHaveCount(1)
    await expect(sheet.locator('[data-slot="title"]')).toHaveCount(0)
    // no second paper: the foot has no shadow of its own, a hairline sits above it
    await expect(page.getByTestId('day-close-controls')).toHaveCSS('box-shadow', 'none')
    await expect(page.getByTestId('day-close-controls')).toHaveCSS('border-top-width', '1px')
    const scroller = stage(page).locator('.recap-stage__scroll')
    expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBe(true)
    await expect(stage(page).locator('[data-slot="title"]')).toBeInViewport({ ratio: 1 })
    await expect(doneButton(page)).toBeInViewport({ ratio: 1 })
    await expect(cancelButton(page)).toBeInViewport({ ratio: 1 })
    const titleY = (await stage(page).locator('[data-slot="title"]').boundingBox())!.y
    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight })
    expect((await stage(page).locator('[data-slot="title"]').boundingBox())!.y).toBe(titleY)
    await expect(doneButton(page)).toBeInViewport({ ratio: 1 })
    expect(await stage(page).locator('.recap-stage__column').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
  })

  for (const viewport of [{ width: 844, height: 300 }, { width: 568, height: 320 }, { width: 1280, height: 360 }]) {
    test(`a window as short as ${viewport.width}x${viewport.height}: the content area keeps its height and both buttons can be reached whole, none cut off or under the tab bar (#707)`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/tasks')
      await openDayClose(page)
      await expect(stage(page)).toBeVisible()
      await settleAnimations(page)
      await expectStageFits(page, stage(page), [doneButton(page), cancelButton(page)])
    })
  }

  test.describe('390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('the sheet floats above the phone bar with rounded corners, the buttons stacked full width with "Tag abschließen" on top (#707)', async ({ page }) => {
      await page.goto('/tasks')
      await openDayClose(page)
      await expect(stage(page)).toBeVisible()
      await settleAnimations(page)
      const sheet = page.getByTestId('day-close-sheet')
      const sheetBox = (await sheet.boundingBox())!
      const navBox = (await appNav(page).boundingBox())!
      expect(sheetBox.y + sheetBox.height).toBeLessThan(navBox.y)
      await expect(sheet).toHaveCSS('border-bottom-left-radius', '16px')
      await expect(sheet).toHaveCSS('border-top-left-radius', '16px')
      const done = (await doneButton(page).boundingBox())!
      const cancel = (await cancelButton(page).boundingBox())!
      expect(done.y + done.height).toBeLessThanOrEqual(cancel.y)
      expect(done.width).toBeGreaterThan(390 - 2 * 40)
      expect(cancel.y + cancel.height).toBeLessThan(sheetBox.y + sheetBox.height)
      await expect(doneButton(page)).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
    })
  })

  test('enters with the photo coming down over the board, the content fading in as it lands; Escape mid-drop leaves cleanly (#580, #612)', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    const photo = page.getByTestId('day-close-stage').locator('.recap-stage__photo')
    const column = page.getByTestId('day-close-stage').locator('.recap-stage__column')
    const top = () => photo.evaluate(el => el.getBoundingClientRect().top)
    // early in the drop: the photo is above its place, the column not yet there
    await expect.poll(top, { timeout: 1000 }).toBeLessThan(0)
    expect(Number(await column.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(0.5)
    // at rest (1.3 s): the photo at the top, the column opaque
    await expect.poll(top, { timeout: 4000 }).toBe(0)
    await expect(column).toHaveCSS('opacity', '1', { timeout: 2000 })
    // a second open, left in the middle of the drop: no full photo flashes, the stage goes
    await cancelButton(page).click()
    await expect(stage(page)).toBeHidden()
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await page.waitForTimeout(250)
    await page.keyboard.press('Escape')
    await expect(stage(page)).toBeHidden({ timeout: 3000 })
  })

  test('axe: no serious or critical violations with the stage open (desktop)', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await page.waitForTimeout(1600) // the stage fades in over 1.4 s: contrast is read at rest
    const results = await new AxeBuilder({ page }).include('[data-testid="day-close-stage"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(blocking.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  test('390px: opens from the Mehr panel, the sheet scrolls and "Tag abschließen" is reachable above the app bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(stage(page)).toBeVisible()
    await page.waitForTimeout(1600)
    const results = await new AxeBuilder({ page }).include('[data-testid="day-close-stage"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([])
    await doneButton(page).scrollIntoViewIfNeeded()
    const dock = (await page.getByTestId('app-nav').boundingBox())!
    const button = (await doneButton(page).boundingBox())!
    expect(button.y + button.height).toBeLessThanOrEqual(dock.y)
    await doneButton(page).click()
    await expect(stage(page)).toBeHidden()
  })
})
