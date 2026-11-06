import { test, expect, type Page } from '@playwright/test'
import { buildBoardStore, buildTasksStore, SEED_TASKS, seedLocalBoard, seedNewDayBoard } from './helpers/seed'
import { emitTauriEvent, installTauriStub, stubState } from './helpers/tauriStub'

/** #614: the macOS menu bar (labels sent to `menu_install`, clicks arrive as `menu://action`) and the desktop shell marker. */

const MENU_EVENT = 'menu://action'
const installs = async (page: Page) =>
  (await stubState(page)).calls.filter(c => c.cmd === 'menu_install').map(c => c.args.labels as Record<string, string>)

test.describe('Native menu (desktop)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
  })

  test('installs the German menu once the app is up, English after ?lang=en', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(() => installs(page).then(l => l.length)).toBe(1)
    const [de] = await installs(page)
    expect(de).toMatchObject({ file: 'Ablage', edit: 'Bearbeiten', view: 'Darstellung', window: 'Fenster', help: 'Hilfe', settings: 'Einstellungen…' })

    await page.goto('/tasks?lang=en')
    await expect.poll(async () => (await installs(page)).at(-1)?.settings).toBe('Settings…')
    expect((await installs(page)).at(-1)).toMatchObject({ file: 'File', view: 'View', help: 'Help' })
  })

  test('a clicked item reaches its action', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(() => installs(page).then(l => l.length)).toBe(1)

    await emitTauriEvent(page, MENU_EVENT, 'app.settings')
    await expect(page).toHaveURL(/\/settings$/)
    await emitTauriEvent(page, MENU_EVENT, 'app.go-statistics')
    await expect(page).toHaveURL(/\/statistics$/)
    await emitTauriEvent(page, MENU_EVENT, 'app.go-trash')
    await expect(page).toHaveURL(/\/trash$/)
    await emitTauriEvent(page, MENU_EVENT, 'app.new-task')
    await expect(page).toHaveURL(/\/tasks\/add$/)
    await emitTauriEvent(page, MENU_EVENT, 'app.go-today')
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('Tag abschließen and Feedback open their dialog, from any page', async ({ page }) => {
    await page.goto('/statistics')
    await expect.poll(() => installs(page).then(l => l.length)).toBe(1)

    await emitTauriEvent(page, MENU_EVENT, 'app.day-close')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByRole('dialog', { name: 'Tag abschließen' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Tag abschließen' })).toBeHidden()

    await emitTauriEvent(page, MENU_EVENT, 'app.feedback')
    await expect(page.getByTestId('feedback-dialog')).toBeVisible()
  })

  test('a second dialog does not open on top of an open one; unknown ids are ignored', async ({ page }) => {
    await page.goto('/tasks')
    await expect.poll(() => installs(page).then(l => l.length)).toBe(1)
    await emitTauriEvent(page, MENU_EVENT, 'app.day-close')
    const dayClose = page.getByRole('dialog', { name: 'Tag abschließen' })
    await expect(dayClose).toBeVisible()

    await emitTauriEvent(page, MENU_EVENT, 'app.whats-new')
    await emitTauriEvent(page, MENU_EVENT, 'app.feedback')
    await emitTauriEvent(page, MENU_EVENT, 'app.unknown')
    // Cmd+N: the add sheet is a child route of the board, so it would stack on the dialog without the guard
    await emitTauriEvent(page, MENU_EVENT, 'app.new-task')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(dayClose).toBeVisible()
    await expect(page).toHaveURL(/\/tasks$/)
  })
})

test.describe('Desktop shell marker (#614)', () => {
  test('desktop: no rubber-band overscroll on the root or a nested scroller', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
    await page.goto('/tasks')
    await expect(page.locator('html')).toHaveAttribute('data-shell', 'desktop')
    const overscroll = (selector: string) =>
      page.locator(selector).first().evaluate(el => getComputedStyle(el).overscrollBehaviorY)
    expect(await overscroll('html')).toBe('none')
    expect(await overscroll('body')).toBe('none')
    expect(await overscroll('#column-open-list')).toBe('none')
  })

  test('web: the browser keeps its own scrolling', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper').first()).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-shell', /.+/)
    expect(await page.locator('html').evaluate(el => getComputedStyle(el).overscrollBehaviorY)).toBe('auto')
  })

  test('desktop: the window drag strip fills the app bar row and leaves the pills clickable', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
    await page.goto('/tasks')
    const strip = page.locator('.titlebar')
    await expect(strip).toHaveAttribute('data-tauri-drag-region', 'true')
    const [stripBox, barBox] = await Promise.all([strip.boundingBox(), page.getByTestId('app-nav').boundingBox()])
    expect(stripBox!.y).toBe(0)
    expect(stripBox!.height).toBe(barBox!.height)
    expect(await strip.evaluate(el => getComputedStyle(el).position)).toBe('fixed')
    // The pill sits above the strip: a real click reaches it (Playwright fails when another element takes the hit)
    await page.getByTestId('app-nav-place-statistics').click()
    await expect(page).toHaveURL(/\/statistics$/)
  })

  test('desktop: the strip does not cover the unreachable-folder notice on /welcome', async ({ page }) => {
    // Launch with an unreachable folder: stores hydrate empty and the app lands on /welcome (data-safety.spec.ts)
    const envelope = {
      schemaVersion: 2,
      writtenAt: '2026-10-24T09:12:00.000Z',
      writtenBy: 'other-device',
      appVersion: '0.1.0',
      stores: { 'board-store': buildBoardStore('local'), 'tasks-store': buildTasksStore(SEED_TASKS) },
    }
    await installTauriStub(page.context(), { data: { status: 'folder-unavailable', folder: '/Users/test/data', envelope } })
    await page.goto('/tasks')
    await expect(page).toHaveURL(/\/welcome$/)
    const notice = page.getByTestId('data-storage-notice')
    await expect(notice).toHaveCount(1) // the board's copy is gone once the page transition ended
    const [stripBox, noticeBox] = await Promise.all([page.locator('.titlebar').boundingBox(), notice.boundingBox()])
    expect(noticeBox!.y).toBeGreaterThanOrEqual(stripBox!.y + stripBox!.height)
    // A real click reaches the button (Playwright fails when another element takes the hit)
    await notice.getByRole('button', { name: 'Erneut versuchen' }).click()
    await expect.poll(async () => (await stubState(page)).calls.some(c => c.cmd === 'data_retry')).toBe(true)
  })

  test('desktop: a press on the overlay scrim in the bar row drags the window, one on the dialog does not', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
    await page.goto('/tasks/seed-open-1')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const drags = async () => (await stubState(page)).calls.filter(c => c.cmd === 'plugin:window|start_dragging').length

    // Inside the dialog, then below the bar row on the scrim: no drag
    const box = (await dialog.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 40)
    await page.mouse.down()
    await page.mouse.up()
    await page.mouse.move(2, 300)
    await page.mouse.down()
    await page.mouse.up()
    expect(await drags()).toBe(0)

    // In the bar row on the scrim: drag starts, and the dialog stays open
    await page.mouse.move(2, 10)
    await page.mouse.down()
    await page.mouse.up()
    await expect.poll(drags).toBe(1)
    await expect(dialog).toBeVisible()
  })

  test('desktop: the new-day recap, a custom full-screen layer, hands its bar row to the window drag too', async ({ context, page }) => {
    await seedNewDayBoard(context)
    await installTauriStub(context, {})
    await page.goto('/tasks')
    const recap = page.getByTestId('new-day-recap')
    await expect(recap).toBeVisible()
    const drags = async () => (await stubState(page)).calls.filter(c => c.cmd === 'plugin:window|start_dragging').length

    // Below the bar row: no drag
    await page.mouse.move(2, 300)
    await page.mouse.down()
    await page.mouse.up()
    expect(await drags()).toBe(0)

    // In the bar row, also in the middle where the recap's content wrapper sits: drag starts, recap stays
    for (const x of [2, 400]) {
      await page.mouse.move(x, 10)
      await page.mouse.down()
      await page.mouse.up()
    }
    await expect.poll(drags).toBe(2)
    await expect(recap).toBeVisible()
  })

  test('web: no drag region', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('.titlebar')).not.toHaveAttribute('data-tauri-drag-region', /.*/)
  })
})
