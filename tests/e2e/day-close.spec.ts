import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { elapseWindow, installClock } from './helpers/clock'
import { seedLocalBoard, SEED_TASKS, type SeedCarryOver } from './helpers/seed'
import { dayCloseCta, moreButton, morePanel, openDayClose, openMore } from './helpers/appNav'

/** Issue #98: the optional closing step ("Tag abschließen"). Local tasks, no integration. */

const dayKey = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const carried = (days: number): SeedCarryOver => ({ firstOn: dayKey(-days), days, lastOn: dayKey(), keptAtDays: null })

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Tag abschließen' })
const rows = (page: Page) => dialog(page).getByTestId('day-close-in-flight-row')

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

  test('shows the recap, today\'s done tasks (not yesterday\'s) and every open task with its column', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)

    await expect(dialog(page).getByTestId('day-close-recap')).toHaveText('1 erledigt · zusammen 1 h')
    const done = dialog(page).getByTestId('day-close-done-row')
    await expect(done).toHaveCount(1)
    await expect(done.first()).toContainText('Retrospektive nachbereiten')
    await expect(done.first()).toContainText('1 h')
    await expect(dialog(page)).not.toContainText('CI Pipeline optimieren')

    await expect(rows(page)).toHaveCount(4)
    await expect(rows(page).filter({ hasText: 'Konzept ausarbeiten' }).getByTestId('day-close-column')).toHaveText('Offen')
    await expect(rows(page).filter({ hasText: 'Review schreiben' }).getByTestId('day-close-column')).toHaveText('Jetzt')
    await expect(rows(page).filter({ hasText: 'Blocker klären' }).getByTestId('day-close-column')).toHaveText('Wartet')
    // Plain rows: not draggable, not links
    await expect(dialog(page).locator('[draggable="true"], a')).toHaveCount(0)

    await expect(dialog(page).getByTestId('day-close-closing-line')).toHaveText(/\S/)
    await expect(dialog(page).getByRole('heading', { name: 'Heute erledigt' })).toBeVisible()
    await expect(dialog(page).getByRole('heading', { name: 'Noch nicht erledigt' })).toBeVisible()
    await expect(dialog(page).getByRole('list', { name: '4 Aufgaben noch nicht erledigt' })).toBeVisible()
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
    await expect(dialog(page).getByTestId('day-close-put-back-hint')).toHaveText('Fertig legt „Review schreiben“ zurück nach Offen.')
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
    test(`hierarchy at ${viewport.width}px: Fertig is the one primary and no triage action is outlined or taller (#551)`, async ({ page }) => {
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

      const actions = dialog(page).getByTestId('carry-over-triage').getByRole('button')
      const count = await actions.count()
      expect(count).toBeGreaterThanOrEqual(3)
      for (let i = 0; i < count; i++) {
        const action = actions.nth(i)
        expect(await height(action)).toBeLessThanOrEqual(doneHeight)
        // outline = a ring and a surface fill; ghost has neither
        await expect(action).toHaveCSS('box-shadow', 'none')
        await expect(action).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      }
    })
  }

  test('triage block: Offen/Jetzt past the threshold only, Keep silences it', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)

    const triage = (title: string) => rows(page).filter({ hasText: title }).getByTestId('carry-over-triage')
    await expect(triage('Konzept ausarbeiten')).toBeVisible()
    await expect(triage('Konzept ausarbeiten').getByTestId('carry-over-keep')).toBeVisible()
    await expect(triage('Blocker klären')).toHaveCount(0) // Wartet never
    await expect(triage('Dokumentation lesen')).toHaveCount(0) // 2 days, below the threshold
    await expect(rows(page).filter({ hasText: 'Blocker klären' }).getByTestId('carry-over-dots')).toHaveAttribute('data-day', '6')

    await triage('Konzept ausarbeiten').getByTestId('carry-over-keep').click()
    await expect(triage('Konzept ausarbeiten')).toHaveCount(0)
    await expect(rows(page)).toHaveCount(4)
  })

  test('Delete in the dialog removes the row and answers in its place with an undo', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await rows(page).filter({ hasText: 'Konzept ausarbeiten' }).getByTestId('carry-over-delete').click()
    await expect(rows(page).filter({ hasText: 'Konzept ausarbeiten' })).toHaveCount(0)
    const answer = page.getByTestId('day-close-deleted-row')
    await expect(answer).toContainText('Im Papierkorb')
    await answer.getByRole('button', { name: /Rückgängig/ }).click({ timeout: 5000 })
    await expect(answer).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'Konzept ausarbeiten' })).toHaveCount(1)
  })

  test('Escape with focus on "Rückgängig" closes the dialog and the paused window still ends: the entry reaches the trash (F2, review)', async ({ page, context }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await page.goto('/tasks')
    await openDayClose(page)
    await rows(page).filter({ hasText: 'Konzept ausarbeiten' }).getByTestId('carry-over-delete').click()
    const answer = page.getByTestId('day-close-deleted-row')
    await answer.getByRole('button', { name: /Rückgängig/ }).focus()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await page.mouse.move(900, 700)
    await elapseWindow(page)
    await expect.poll(
      () => page.evaluate(() => (JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}') as { entries: Array<{ taskId: string }> }).entries.map(entry => entry.taskId)),
    ).toEqual(['seed-open-1'])
    await expect(page.locator('.task-gap')).toHaveCount(0)
    await expect((await openMore(page)).getByTestId('more-trash')).toHaveText('Papierkorb (1)')
  })

  test('Make smaller closes the dialog and opens the task sheet with the title in edit mode', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await rows(page).filter({ hasText: 'Konzept ausarbeiten' }).getByTestId('carry-over-smaller').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page).toHaveURL(/\/tasks\/seed-open-1/)
    const titleInput = page.locator('[data-testid="task-detail-header"] input')
    await expect(titleInput).toBeFocused()
    await expect(page.getByTestId('carry-over-smaller-hint')).toHaveText('Was ist der erste kleine Schritt?')
  })

  test('empty board: one sentence per section, copy disabled', async ({ page, context }) => {
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
    await expect(dialog(page).getByTestId('day-close-recap')).toHaveText('Heute noch nichts erledigt.')
    await expect(dialog(page).getByText('Nichts mehr offen.')).toBeVisible()
    await expect(dialog(page).getByTestId('day-close-closing-line')).toHaveText(/\S/)
    await expect(dialog(page).getByTestId('day-close-copy')).toBeDisabled()
    await expect(dialog(page).getByTestId('day-close-done-button')).toBeEnabled()
  })

  test('English locale', async ({ page }) => {
    await page.goto('/tasks?lang=en')
    await openDayClose(page)
    await expect(page.getByRole('dialog', { name: 'Close the day' })).toBeVisible()
    await expect(page.getByTestId('day-close-recap')).toHaveText('1 done · 1 h together')
    await expect(page.getByRole('heading', { name: 'Not done yet' })).toBeVisible()
  })

  test('axe: no serious or critical violations with the dialog open (desktop)', async ({ page }) => {
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(dialog(page)).toBeVisible()
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
