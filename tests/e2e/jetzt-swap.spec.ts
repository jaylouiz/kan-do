import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { pickUp, hover, dropSettled, showColumnPage } from './helpers/dnd'
import { elapse, installClock } from './helpers/clock'

/**
 * #162: a single card from Offen or Wartet dropped on the running Jetzt card swaps them. While it
 * hovers there the running card shows the swap state (`task--swap-target`, dashed ring), the drop moves the
 * running task to Wartet and starts the dropped one, one toast offers the undo. The keyboard drag and the
 * task sheet's status field swap the same way. Drags use page.mouse (docs/testing/e2e-dnd-patterns.md).
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

const RUNNING = task({ id: 'run-1', title: 'Review schreiben', status: 1, timeSpentSeconds: 100 })
const OFFEN = [
  task({ id: 'open-1', title: 'Konzept ausarbeiten', status: 0 }),
  task({ id: 'open-2', title: 'Dokumentation lesen', status: 0 }),
]
const WARTET = [
  task({ id: 'wait-1', title: 'Blocker klären', status: 2 }),
  task({ id: 'wait-2', title: 'Rückmeldung abwarten', status: 2 }),
]
const DONE = task({ id: 'done-1', title: 'Rechnung schreiben', status: 3, completedAt: NOW })

const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const list = (page: Page, column: 'open' | 'progress' | 'waiting' | 'done') => page.locator(`#column-${column}-list`)
const ids = (page: Page, column: 'open' | 'progress' | 'waiting' | 'done') =>
  list(page, column).locator(':scope > .task-wrapper').evaluateAll(els => els.map(el => el.getAttribute('data-task-id')))
const swapTarget = (page: Page) => page.locator('.task.task--swap-target')
/** The toast card (includeHidden buttons: an open sheet aria-hides everything outside it, as in completion-undo.spec.ts) */
const toast = (page: Page) =>
  page.getByText('Aufgabe gewechselt', { exact: true }).locator('xpath=ancestor::*[.//button[normalize-space()="Rückgängig"]][1]').last()
const undoButton = (page: Page) => toast(page).getByRole('button', { name: 'Rückgängig', includeHidden: true })

async function gotoBoard(page: Page, tasks: SeedTask[] = [RUNNING, ...OFFEN, ...WARTET, DONE]) {
  await page.goto('/tasks')
  await expect(card(page, tasks[0]!.id)).toBeVisible()
}

async function drop(page: Page) {
  await page.mouse.up()
  await dropSettled(page)
}

test.describe('swap on drop (#162)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [RUNNING, ...OFFEN, ...WARTET, DONE])
  })

  test('hovering the running card marks it, leaving removes the mark at once, dropping swaps and the toast undoes it', async ({ page }) => {
    await gotoBoard(page)
    await pickUp(page, card(page, 'open-1'))
    await hover(page, card(page, RUNNING.id))

    await expect(swapTarget(page)).toHaveCount(1)
    await expect(swapTarget(page)).toHaveAttribute('data-task-id', RUNNING.id)
    // Not by colour alone: a dashed ring and the content at half strength
    await expect(swapTarget(page)).toHaveCSS('outline-style', 'dashed')
    await expect(swapTarget(page).locator(':scope > *').first()).toHaveCSS('opacity', '0.5')
    expect(await ids(page, 'progress')).toEqual([RUNNING.id]) // the card does not move into Jetzt while hovering

    await hover(page, card(page, 'wait-1'))
    await expect(swapTarget(page)).toHaveCount(0)

    await hover(page, card(page, RUNNING.id))
    await expect(swapTarget(page)).toHaveCount(1)
    await drop(page)

    await expect(swapTarget(page)).toHaveCount(0)
    expect(await ids(page, 'progress')).toEqual(['open-1'])
    expect(await ids(page, 'waiting')).toContain(RUNNING.id)
    expect(await ids(page, 'open')).toEqual(['open-2'])
    await expect(toast(page)).toContainText('„Konzept ausarbeiten“ läuft · „Review schreiben“ wartet')

    await undoButton(page).click()
    expect(await ids(page, 'progress')).toEqual([RUNNING.id])
    expect(await ids(page, 'open')).toEqual(['open-1', 'open-2'])
    expect(await ids(page, 'waiting')).not.toContain(RUNNING.id)
  })

  test('a card from Wartet swaps too', async ({ page }) => {
    await gotoBoard(page)
    await pickUp(page, card(page, 'wait-2'))
    await hover(page, card(page, RUNNING.id))
    await expect(swapTarget(page)).toHaveCount(1)
    await drop(page)

    expect(await ids(page, 'progress')).toEqual(['wait-2'])
    expect(await ids(page, 'waiting')).toContain(RUNNING.id)
    expect(await ids(page, 'waiting')).not.toContain('wait-2')
    await expect(toast(page)).toBeVisible()
  })

  test('a card from Erledigt is refused: no swap state, nothing moves', async ({ page }) => {
    await gotoBoard(page)
    await pickUp(page, card(page, DONE.id))
    await hover(page, card(page, RUNNING.id))
    await expect(swapTarget(page)).toHaveCount(0)
    await drop(page)

    expect(await ids(page, 'progress')).toEqual([RUNNING.id])
    expect(await ids(page, 'done')).toContain(DONE.id)
    await expect(toast(page)).toHaveCount(0)
  })

  test('the running card dragged itself only reorders: no swap state', async ({ page }) => {
    await gotoBoard(page)
    await pickUp(page, card(page, RUNNING.id))
    await expect(swapTarget(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await dropSettled(page)
    expect(await ids(page, 'progress')).toEqual([RUNNING.id])
  })
})

test('with Jetzt empty a drop just starts the task: no swap state, no toast', async ({ context, page }) => {
  await seedLocalBoard(context, [...OFFEN, ...WARTET])
  await page.goto('/tasks')
  await expect(card(page, 'open-1')).toBeVisible()
  await pickUp(page, card(page, 'open-1'))
  await hover(page, list(page, 'progress').locator(':scope > .column-drop-zone'))
  await expect(swapTarget(page)).toHaveCount(0)
  await drop(page)

  expect(await ids(page, 'progress')).toEqual(['open-1'])
  await expect(toast(page)).toHaveCount(0)
})

test.describe('swap by keyboard and the task sheet (#162)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [RUNNING, ...OFFEN, ...WARTET, DONE])
  })

  test('a keyboard drag onto Jetzt announces the swap and drops it; Escape swaps nothing', async ({ page }) => {
    await gotoBoard(page)
    const live = page.locator('body > [aria-live]')

    // Escape on the swap target: announced as before, nothing moves
    await card(page, 'open-1').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await expect(live).toContainText('Beim Ablegen wechseln beide', { timeout: 5000 })
    await expect(live).toContainText('„Review schreiben“ geht nach Wartet')
    await page.keyboard.press('Escape')
    await expect(live).toContainText('abgebrochen')
    expect(await ids(page, 'progress')).toEqual([RUNNING.id])

    // Space drops it: the swap, announced with both names
    await dropSettled(page)
    await card(page, 'open-1').focus()
    await expect(card(page, 'open-1')).toBeFocused()
    await page.keyboard.press('Space')
    await expect(live).toContainText('aufgenommen')
    await page.keyboard.press('ArrowRight')
    await expect(live).toContainText('Beim Ablegen wechseln beide', { timeout: 5000 })
    await page.keyboard.press('Space')
    await expect(live).toContainText('in Jetzt abgelegt')
    await expect(live).toContainText('„Review schreiben“ ist nach Wartet verschoben')
    expect(await ids(page, 'progress')).toEqual(['open-1'])
    expect(await ids(page, 'waiting')).toContain(RUNNING.id)
    await expect(toast(page)).toBeVisible()
  })

  test('the task sheet status field swaps instead of the refusal toast, and the sheet stays open', async ({ baseURL, page }) => {
    await page.goto(`${baseURL}/tasks/open-2`)
    await page.getByTestId('task-status-select').click()
    await page.getByRole('option', { name: 'Jetzt', exact: true }).click()

    await expect(toast(page)).toContainText('„Dokumentation lesen“ läuft · „Review schreiben“ wartet')
    await expect(page.getByText('Verschieben nicht möglich')).toHaveCount(0)
    await expect(page.getByTestId('task-status-select')).toContainText('Jetzt')
    await expect(page).toHaveURL(/\/tasks\/open-2/)
  })

  test('a task from Erledigt still gets the refusal toast in the sheet', async ({ baseURL, page }) => {
    await page.goto(`${baseURL}/tasks/${DONE.id}`)
    await page.getByTestId('task-status-select').click()
    await page.getByRole('option', { name: 'Jetzt', exact: true }).click()
    await expect(page.getByText('Verschieben nicht möglich').first()).toBeVisible()
    await expect(toast(page)).toHaveCount(0)
  })
})

test.describe('timers across a swap (#162)', () => {
  test('exactly the running task counts, before and after the swap and after the undo', async ({ context, page }) => {
    await installClock(context)
    await seedLocalBoard(context, [RUNNING, ...OFFEN, ...WARTET, DONE])
    await page.goto('/tasks')
    await expect(card(page, RUNNING.id)).toBeVisible()

    const spent = (id: string) => page.evaluate((taskId) => {
      const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; timeSpentSeconds: number }> }
      return raw.tasks?.find(t => t.id === taskId)?.timeSpentSeconds ?? -1
    }, id)
    await pickUp(page, card(page, 'open-1'))
    await hover(page, card(page, RUNNING.id))
    await drop(page)
    await expect(toast(page)).toBeVisible()

    // One window of page-clock time (the toast lives 6 s): only the incoming task counts, the history stays
    const [incoming, outgoing] = [await spent('open-1'), await spent(RUNNING.id)]
    await elapse(page, 3000)
    await expect.poll(async () => (await spent('open-1')) - incoming).toBeGreaterThanOrEqual(2)
    expect(await spent(RUNNING.id)).toBe(outgoing)
    expect(outgoing).toBeGreaterThanOrEqual(100)

    await undoButton(page).click()
    const [afterUndoIncoming, afterUndoOutgoing] = [await spent('open-1'), await spent(RUNNING.id)]
    await elapse(page, 3000)
    await expect.poll(async () => (await spent(RUNNING.id)) - afterUndoOutgoing).toBeGreaterThanOrEqual(2)
    expect(await spent('open-1')).toBe(afterUndoIncoming)
  })
})

test.describe('swap at 390px', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('a Wartet card dropped on the running card on the same page swaps', async ({ context, page }) => {
    await seedLocalBoard(context, [RUNNING, ...OFFEN, ...WARTET, DONE])
    await page.goto('/tasks')
    await showColumnPage(page, 1)
    await expect(card(page, RUNNING.id)).toBeVisible()
    await pickUp(page, card(page, 'wait-1'))
    await hover(page, card(page, RUNNING.id))
    await expect(swapTarget(page)).toHaveCount(1)
    await drop(page)

    expect(await ids(page, 'progress')).toEqual(['wait-1'])
    expect(await ids(page, 'waiting')).toContain(RUNNING.id)
    await expect(toast(page)).toBeVisible()
  })
})
