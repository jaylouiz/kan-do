import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { elapseWindow, installClock } from './helpers/clock'
import { fillerTasks, seedLocalBoard, SEED_TASKS, type SeedCarryOver, type SeedTask } from './helpers/seed'
import { dayCloseCta, moreButton, morePanel, openDayClose, openMore } from './helpers/appNav'

/** Issue #98, #237: the optional closing sheet ("Tag abschließen"). Local tasks, no integration. */

const dayKey = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const carried = (days: number): SeedCarryOver => ({ firstOn: dayKey(-days), days, lastOn: dayKey(), keptAtDays: null })

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Tag abschließen' })
const openRows = (page: Page) => dialog(page).getByTestId('day-close-open-row')
const openList = async (page: Page) => {
  const details = dialog(page).getByTestId('day-close-open-details')
  if (!(await details.evaluate(el => (el as HTMLDetailsElement).open))) await details.locator('summary').click()
  await expect(openRows(page).first()).toBeVisible()
}
const checkboxOf = (page: Page, title: string) => openRows(page).filter({ hasText: title }).getByRole('checkbox')

test.describe('Day close dialog (#98)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, SEED_TASKS, {
      'seed-open-1': carried(5),
      'seed-waiting-1': carried(5),
      'seed-open-2': carried(2),
    })
  })

  test('opens from the Mehr panel; Fertig, Escape and overlay click close it and focus returns to ⋯', async ({ page }) => {
    await page.goto('/tasks')

    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByTestId('day-close-done-button').click()
    await expect(dialog(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()

    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()

    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await page.mouse.click(8, 8)
    await expect(dialog(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()
  })

  test('opens from the Erledigt CTA and focus returns to the CTA, never <body>', async ({ page }) => {
    await page.goto('/tasks')
    await expect(dayCloseCta(page)).toHaveText('Tag abschließen')

    await dayCloseCta(page).click()
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
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

  test('opens from the command palette: the palette closes first and focus lands on the board', async ({ page }) => {
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

    await expect(dialog(page)).toBeVisible()
    await expect(palette).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    const focusIsOnBoard = await page.evaluate(() => {
      const active = document.activeElement
      return !!active && active !== document.body && !!active.closest('[data-task-sheet-return]')
    })
    expect(focusIsOnBoard).toBe(true)
  })

  test('shows the summary, today\'s done tasks (not yesterday\'s) and the open tasks in "Für morgen"', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)

    await expect(dialog(page).getByTestId('day-close-date')).toHaveText(/\S/)
    await expect(dialog(page).getByTestId('day-close-headline')).toHaveText('1 von 5 geplanten Aufgaben erledigt')
    await expect(dialog(page).getByTestId('day-close-total')).toHaveText('Gesamtzeit: 1 h')
    await expect(dialog(page).getByTestId('day-close-trophy')).toHaveCount(0)
    const done = dialog(page).getByTestId('day-close-done-row')
    await expect(done).toHaveCount(1)
    await expect(done.first()).toContainText('Retrospektive nachbereiten')
    await expect(done.first().getByTestId('day-close-done-subline')).toHaveText('Erledigt · In der Timebox')
    await expect(done.first().getByTestId('day-close-done-time')).toHaveText('1 h')
    await expect(dialog(page)).not.toContainText('CI Pipeline optimieren')
    await expect(dialog(page).getByRole('list', { name: '1 heute erledigte Aufgabe' })).toBeVisible()

    // The one boxed task is in its box: one segment, no overrun, caption in the singular
    await expect(dialog(page).getByTestId('day-close-bar-segment')).toHaveCount(1)
    await expect(dialog(page).getByTestId('day-close-bar-overrun')).toHaveCount(0)
    await expect(dialog(page).getByTestId('day-close-bar-caption')).toHaveText('1 von 1 Timebox eingehalten')

    // "Für morgen": the sentence, the closed accordion, then one checkbox row per open task, all selected
    await expect(dialog(page).getByRole('heading', { name: 'Für morgen' })).toBeVisible()
    await expect(dialog(page).getByTestId('day-close-tomorrow')).toHaveText('4 Aufgaben bleiben auf dem Board. Du kannst sie einzeln abwählen.')
    await expect(openRows(page).first()).toBeHidden()
    await openList(page)
    await expect(openRows(page)).toHaveCount(4)
    await expect(openRows(page).getByRole('checkbox', { checked: true })).toHaveCount(4)
    const subline = (title: string) => openRows(page).filter({ hasText: title }).getByTestId('day-close-open-subline')
    await expect(subline('Konzept ausarbeiten')).toHaveText('Offen · Tag 6 auf dem Board')
    await expect(subline('Dokumentation lesen')).toHaveText('Offen')
    await expect(subline('Review schreiben')).toHaveText('Jetzt · Geht zurück nach Offen')
    await expect(subline('Blocker klären')).toHaveText('Wartet · Tag 6 auf dem Board')
    // Plain rows: not draggable, not links; the sheet has no triage buttons, no closing line, no recap line
    await expect(dialog(page).locator('[draggable="true"], a')).toHaveCount(0)
    await expect(dialog(page).getByTestId('carry-over-triage')).toHaveCount(0)
    await expect(dialog(page).getByTestId('day-close-closing-line')).toHaveCount(0)
  })

  test('the checkboxes change the sentence and the row says where a deselected task goes', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await openList(page)
    await checkboxOf(page, 'Dokumentation lesen').click()
    await expect(checkboxOf(page, 'Dokumentation lesen')).not.toBeChecked()
    await expect(dialog(page).getByTestId('day-close-tomorrow')).toHaveText('3 Aufgaben bleiben auf dem Board. Du kannst sie einzeln abwählen.')
    await expect(openRows(page).filter({ hasText: 'Dokumentation lesen' }).getByTestId('day-close-open-subline')).toHaveText('Offen · Kommt in den Papierkorb')
    await checkboxOf(page, 'Dokumentation lesen').press('Space')
    await expect(checkboxOf(page, 'Dokumentation lesen')).toBeChecked()
    await expect(dialog(page).getByTestId('day-close-tomorrow')).toHaveText('4 Aufgaben bleiben auf dem Board. Du kannst sie einzeln abwählen.')
    for (const title of ['Konzept ausarbeiten', 'Dokumentation lesen', 'Review schreiben']) await checkboxOf(page, title).click()
    await checkboxOf(page, 'Blocker klären').click()
    await expect(dialog(page).getByTestId('day-close-tomorrow')).toHaveText('Keine Aufgabe bleibt auf dem Board.')
    await checkboxOf(page, 'Blocker klären').click()
    await expect(dialog(page).getByTestId('day-close-tomorrow')).toHaveText('Eine Aufgabe bleibt auf dem Board. Du kannst sie abwählen.')
  })

  /**
   * The stored Jetzt task, or null while a navigation destroys the page's context. A dev-server reload (Vite
   * re-optimising a dependency) can hit any step of a long spec; a bare `page.evaluate` then throws "Execution
   * context was destroyed" (#432), so every read goes through `expect.poll`, which retries a null.
   */
  const readJetztTask = (page: Page) => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string, status: number, timeSpentSeconds: number, timerId: number | null }> }
    const task = stored.tasks?.find(t => t.id === 'seed-progress-1')
    return task ? { status: task.status, timeSpentSeconds: task.timeSpentSeconds, timerId: task.timerId } : null
  }).catch(() => null)

  test('Fertig stops the timer and moves the Jetzt task to Offen, keeping its time', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(1)
    await openDayClose(page)
    await openList(page)
    await expect(openRows(page).filter({ hasText: 'Review schreiben' }).getByTestId('day-close-open-subline')).toHaveText('Jetzt · Geht zurück nach Offen')
    await expect(dialog(page).getByRole('button', { name: /Timer anhalten/ })).toHaveCount(0)

    await dialog(page).getByTestId('day-close-done-button').click()
    await expect(dialog(page)).toBeHidden()

    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(0)
    await expect(page.locator('#column-open-list .task-wrapper', { hasText: 'Review schreiben' })).toHaveCount(1)
    await expect.poll(() => readJetztTask(page)).toMatchObject({ status: 0, timerId: null })
    const first = await readJetztTask(page)
    expect(first?.timeSpentSeconds).toBeGreaterThanOrEqual(1800)
    await page.waitForTimeout(1500)
    expect((await readJetztTask(page))?.timeSpentSeconds).toBe(first?.timeSpentSeconds)
  })

  test('Escape and overlay click leave the Jetzt task and its timer alone', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await page.mouse.click(8, 8)
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(1)
    // Still in Jetzt with a running timer: the stored handle appears once the driver has armed it, and the time keeps counting
    await expect.poll(() => readJetztTask(page)).toMatchObject({ status: 1, timerId: expect.any(Number) })
    const before = (await readJetztTask(page))?.timeSpentSeconds ?? 0
    await expect.poll(async () => (await readJetztTask(page))?.timeSpentSeconds ?? 0).toBeGreaterThan(before)
  })

  test('Zusammenfassung kopieren writes plain markdown (no notes) and confirms in the button, without a toast', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/tasks')
    await openDayClose(page)
    const copy = dialog(page).getByTestId('day-close-copy')
    await expect(copy).toHaveAccessibleName('Zusammenfassung kopieren')
    const icon = () => copy.locator('svg').filter({ visible: true }).innerHTML()
    const copyIcon = await icon()
    await copy.click()

    // The button says "Kopiert" with a check for 3 s, then returns to its label (#136)
    await expect(copy).toHaveAccessibleName('Kopiert')
    await expect.poll(icon).not.toBe(copyIcon)
    await expect(page.locator('[data-slot="viewport"] [data-slot="root"]')).toHaveCount(0)
    // The button state is visual only: the in-dialog live region carries the announcement
    await expect(dialog(page).getByRole('status')).toHaveText('Zusammenfassung kopiert')
    const markdown = await page.evaluate(() => navigator.clipboard.readText())
    expect(markdown).toMatch(/^# Tagesabschluss, /)
    expect(markdown).toContain('## Erledigt')
    expect(markdown).toContain('- Retrospektive nachbereiten (1 h)')
    expect(markdown).toContain('Gesamt: 1 h')
    expect(markdown).toContain('### Offen')
    expect(markdown).toContain('- Konzept ausarbeiten')
    expect(markdown).toContain('### Jetzt')
    expect(markdown).toContain('### Wartet')
    expect(markdown).not.toContain('CI Pipeline optimieren')
    expect(markdown).not.toContain('Entwurf bis Ende der Woche')
    // The dialog stays open; the button returns to its label
    await expect(dialog(page)).toBeVisible()
    await expect(copy).toHaveAccessibleName('Zusammenfassung kopieren', { timeout: 4000 })
    expect(await icon()).toBe(copyIcon)
    await expect(dialog(page).getByRole('status')).toHaveText('')
  })

  test('Fertig archives every Erledigt task: the column ends empty, the yesterday note and the CTA are gone, nothing is deleted (#292)', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.locator('#column-done-list .task-wrapper')).toHaveCount(1)
    await expect(page.locator('#column-done .yesterday-note')).toHaveCount(1)
    await openDayClose(page)
    await dialog(page).getByTestId('day-close-done-button').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('#column-done-list .task-wrapper')).toHaveCount(0)
    await expect(page.locator('#column-done .yesterday-note')).toHaveCount(0)
    await expect(dayCloseCta(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { archivedTaskIds?: string[]; tasks?: Array<{ id: string; status: number }> }
      return { archived: [...(stored.archivedTaskIds ?? [])].sort(), doneKept: (stored.tasks ?? []).filter(task => task.status === 3).length, trash: localStorage.getItem('trash-store') }
    })).toEqual({ archived: ['seed-done-1', 'seed-done-2'], doneKept: 2, trash: null })
    // Archived, not deleted: a second Fertig has nothing left to do and the focus is never lost to <body>
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(false)
  })

  test('opening, copying and dismissing with Escape leaves every task, archive and status untouched', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/tasks')
    const doneCards = page.locator('#column-done-list .task-wrapper')
    await expect(doneCards).toHaveCount(1)
    // The running timer ticks, so compare everything except time
    const snapshot = () => page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('tasks-store') ?? '{}')
      const tasks = (stored.tasks as Record<string, unknown>[]).map(({ timeSpentSeconds: _t, timerId: _i, updatedAt: _u, ...rest }) => rest)
      return JSON.stringify({ tasks, archived: stored.archivedTaskIds, deleted: stored.deletedTaskIds, pending: stored.pendingDeletes, board: localStorage.getItem('board-store') })
    })
    const before = await snapshot()
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByTestId('day-close-copy').click()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    expect(await snapshot()).toBe(before)
    await expect(doneCards).toHaveCount(1)
  })

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`hierarchy at ${viewport.width}px: Fertig is the one primary and the heaviest control (#551)`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/tasks')
      await openDayClose(page)
      await expect(dialog(page)).toBeVisible()

      // The button ladder (#552): Fertig is the `lg` CTA, its sibling `md`; the phone floor is the button theme's
      const phone = viewport.width === 390
      const floor = phone ? 44 : 32
      const doneFloor = phone ? 48 : 36
      const done = dialog(page).getByTestId('day-close-done-button')
      const copy = dialog(page).getByTestId('day-close-copy')
      // The drawer slides in on a transform: round away the sub-pixel noise of a box measured mid-settle
      const height = async (locator: Locator) => Math.round((await locator.boundingBox())!.height)
      await expect.poll(() => height(done)).toBeGreaterThanOrEqual(doneFloor)
      const doneHeight = await height(done)
      expect(await height(copy)).toBeGreaterThanOrEqual(floor)
      expect(await height(copy)).toBeLessThan(doneHeight) // Fertig is the heaviest control
    })
  }

  test('Fertig takes a deselected task off the board into the trash; the selected ones stay and the Jetzt task goes back to Offen', async ({ page, context }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await page.goto('/tasks')
    await openDayClose(page)
    await openList(page)
    await checkboxOf(page, 'Dokumentation lesen').click()
    await dialog(page).getByTestId('day-close-done-button').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('#column-open-list .task-wrapper', { hasText: 'Dokumentation lesen' })).toHaveCount(0)
    await expect(page.locator('#column-open-list .task-wrapper', { hasText: 'Konzept ausarbeiten' })).toHaveCount(1)
    await expect(page.locator('#column-open-list .task-wrapper', { hasText: 'Review schreiben' })).toHaveCount(1)
    await expect(page.locator('#column-waiting-list .task-wrapper', { hasText: 'Blocker klären' })).toHaveCount(1)
    await elapseWindow(page)
    await expect.poll(
      () => page.evaluate(() => (JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}') as { entries: Array<{ taskId: string }> }).entries.map(entry => entry.taskId)),
    ).toEqual(['seed-open-2'])
    await expect((await openMore(page)).getByTestId('more-trash')).toHaveText('Papierkorb (1)')
  })

  test('a deselected Jetzt task is deleted, not put back to Offen', async ({ page, context }) => {
    await installClock(context)
    await page.goto('/tasks')
    await openDayClose(page)
    await openList(page)
    await checkboxOf(page, 'Review schreiben').click()
    await expect(openRows(page).filter({ hasText: 'Review schreiben' }).getByTestId('day-close-open-subline')).toHaveText('Jetzt · Kommt in den Papierkorb')
    await dialog(page).getByTestId('day-close-done-button').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('.task-wrapper', { hasText: 'Review schreiben' })).toHaveCount(0)
    await elapseWindow(page)
    await expect.poll(
      () => page.evaluate(() => (JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}') as { entries: Array<{ taskId: string }> }).entries.map(entry => entry.taskId)),
    ).toEqual(['seed-progress-1'])
  })

  test('Escape after a deselection deletes nothing, and the next opening starts with everything selected', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await openList(page)
    await checkboxOf(page, 'Konzept ausarbeiten').click()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('#column-open-list .task-wrapper', { hasText: 'Konzept ausarbeiten' })).toHaveCount(1)
    expect(await page.evaluate(() => localStorage.getItem('trash-store'))).toBeNull()

    await openDayClose(page)
    await expect(dialog(page).getByTestId('day-close-tomorrow')).toHaveText('4 Aufgaben bleiben auf dem Board. Du kannst sie einzeln abwählen.')
    await openList(page)
    await expect(openRows(page).getByRole('checkbox', { checked: true })).toHaveCount(4)
  })

  test('a double click on Fertig deletes a deselected task once', async ({ page, context }) => {
    await installClock(context)
    await page.goto('/tasks')
    await openDayClose(page)
    await openList(page)
    await checkboxOf(page, 'Dokumentation lesen').click()
    await dialog(page).getByTestId('day-close-done-button').dblclick()
    await expect(dialog(page)).toBeHidden()
    await elapseWindow(page)
    await expect.poll(
      () => page.evaluate(() => (JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}') as { entries: Array<{ taskId: string }> }).entries.map(entry => entry.taskId)),
    ).toEqual(['seed-open-2'])
  })

  test('time-box bar: one segment per boxed task, the overrun as a tail, the caption counts tasks kept', async ({ page, context }) => {
    const doneNow = new Date().toISOString()
    const done = (id: string, title: string, spent: number, box: number | null): SeedTask => ({ id, title, status: 3, priority: 2, timeSpentSeconds: spent, timeBoxSeconds: box, completedAt: doneNow, custom: {} })
    await seedLocalBoard(context, [
      done('d-over', 'Über der Box', 4500, 3600),
      done('d-under', 'Unter der Box', 2700, 3600),
      done('d-within', 'In der Box', 3700, 3600),
      done('d-none', 'Ohne Box', 900, null),
      ...SEED_TASKS.filter(task => task.status === 0),
    ])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page).getByTestId('day-close-bar-segment')).toHaveCount(3)
    // The bar draws every second over the box as a tail (the 100 s of "In der Box" too); the caption and the sublines use the 5 minute rule
    await expect(dialog(page).getByTestId('day-close-bar-overrun')).toHaveCount(2)
    await expect(dialog(page).getByTestId('day-close-bar-caption')).toHaveText('2 von 3 Timeboxen eingehalten')
    const subline = (title: string) => dialog(page).getByTestId('day-close-done-row').filter({ hasText: title }).getByTestId('day-close-done-subline')
    await expect(subline('Über der Box')).toHaveText('Erledigt · 15 Min über der Timebox')
    await expect(subline('Unter der Box')).toHaveText('Erledigt · 15 Min unter der Timebox')
    await expect(subline('In der Box')).toHaveText('Erledigt · In der Timebox')
    await expect(subline('Ohne Box')).toHaveText('Erledigt')
  })

  test('nothing left open: trophy headline, no "Für morgen" section', async ({ page, context }) => {
    await seedLocalBoard(context, SEED_TASKS.filter(task => task.status === 3))
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page).getByTestId('day-close-headline')).toHaveText('Alle Aufgaben erledigt')
    await expect(dialog(page).getByTestId('day-close-trophy')).toBeVisible()
    await expect(dialog(page).getByRole('heading', { name: 'Für morgen' })).toHaveCount(0)
    await expect(dialog(page).getByTestId('day-close-nothing-open')).toHaveText('Nichts mehr offen.')
    await expect(dialog(page).getByTestId('day-close-copy')).toBeEnabled()
  })

  test('many open tasks: the sentence and the closed accordion only; the sheet scrolls as one', async ({ page, context }) => {
    await seedLocalBoard(context, [...SEED_TASKS, ...fillerTasks(30, 0)])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page).getByTestId('day-close-headline')).toHaveText('1 von 35 geplanten Aufgaben erledigt')
    await expect(dialog(page).getByTestId('day-close-tomorrow')).toHaveText('34 Aufgaben bleiben auf dem Board. Du kannst sie einzeln abwählen.')
    await expect(openRows(page).first()).toBeHidden()
    await openList(page)
    await expect(openRows(page)).toHaveCount(34)
    // The footer stays reachable: Fertig is visible without scrolling the list away
    await expect(dialog(page).getByTestId('day-close-done-button')).toBeInViewport()
  })

  test('empty board: one quiet line, no bar and no section, copy disabled', async ({ page, context }) => {
    await context.clearCookies()
    await page.addInitScript(() => {
      const board = JSON.parse(localStorage.getItem('board-store') ?? '{}')
      board.columns.forEach((c: { taskOrder: string[] }) => { c.taskOrder = [] })
      localStorage.setItem('board-store', JSON.stringify(board))
      const tasks = JSON.parse(localStorage.getItem('tasks-store') ?? '{}')
      tasks.tasks = []
      localStorage.setItem('tasks-store', JSON.stringify(tasks))
    })
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page).getByTestId('day-close-headline')).toHaveText('Heute noch nichts erledigt.')
    await expect(dialog(page).getByTestId('day-close-bar')).toHaveCount(0)
    await expect(dialog(page).getByRole('heading', { name: 'Für morgen' })).toHaveCount(0)
    await expect(dialog(page).getByTestId('day-close-copy')).toBeDisabled()
    await expect(dialog(page).getByTestId('day-close-done-button')).toBeEnabled()
  })

  test('English locale', async ({ page }) => {
    await page.goto('/tasks?lang=en')
    await openDayClose(page)
    await expect(page.getByRole('dialog', { name: 'Close the day' })).toBeVisible()
    await expect(page.getByTestId('day-close-headline')).toHaveText('1 of 5 planned tasks done')
    await expect(page.getByTestId('day-close-done-subline')).toHaveText('Done · Within the timebox')
    await expect(page.getByTestId('day-close-bar-caption')).toHaveText('1 of 1 timebox kept')
    await expect(page.getByTestId('day-close-tomorrow')).toHaveText('4 tasks stay on the board. You can deselect them one by one.')
    await expect(page.getByRole('heading', { name: 'For tomorrow' })).toBeVisible()
  })

  test('axe: no serious or critical violations with the dialog open (desktop)', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await openList(page)
    await checkboxOf(page, 'Dokumentation lesen').click()
    await page.waitForTimeout(400)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(blocking.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  test('390px (#566): the drawer takes focus on open and Tab stays inside', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    const insideDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))
    // vaul cancels reka's auto-focus: ResponsiveOverlay moves focus in itself. Poll: it holds, not one frame.
    await expect.poll(insideDialog).toBe(true)
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect(await insideDialog()).toBe(true)
    }
  })

  test('390px (#566): Escape right after open closes the drawer and focus returns to ⋯', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()
  })

  test('390px: opens as a drawer from the Mehr panel, scrolls inside and closes with Fertig', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/tasks')
    const box = (await moreButton(page).boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
    await page.waitForTimeout(500)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([])
    await dialog(page).getByTestId('day-close-done-button').click()
    await expect(dialog(page)).toBeHidden()
    await expect(moreButton(page)).toBeFocused()
    await expect(morePanel(page)).toBeHidden()
  })
})
