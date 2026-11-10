import { test, expect, type Page } from '@playwright/test'
import { atDaysAgo, dayKeyDaysAgo, seedLocalBoard, type SeedTask } from './helpers/seed'
import { settleAnimations } from './helpers/settle'

/**
 * kd#131: a task marked done a day late gets its done day corrected in the task sheet; the board and the
 * statistics count it on that day, and the correction survives a reload.
 */
const TASKS: SeedTask[] = [
  {
    id: 'late-1', title: 'Angebot Gartenhaus verschickt', status: 3, priority: 3, timeSpentSeconds: 2400, timeBoxSeconds: 1800,
    custom: {}, createdAt: atDaysAgo(3, 9), completedAt: atDaysAgo(0, 0, 1),
  },
  { id: 'open-1', title: 'Rechnung schreiben', status: 0, priority: 3, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, createdAt: atDaysAgo(3, 9) },
]

const row = (page: Page) => page.locator('[data-done-day-row]')
const trigger = (page: Page) => row(page).getByTestId('date-picker-trigger')
const day = (page: Page, key: string) => page.locator(`[data-testid="date-picker-calendar"] [data-value="${key}"]:not([data-outside-view])`)
const longDate = (key: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(key))

async function openSheet(page: Page, baseURL: string | undefined, id: string) {
  await page.goto(`${baseURL}/tasks/${id}`)
  await expect(page.getByTestId('task-property-list')).toBeVisible()
  await settleAnimations(page)
}

/** Opens the calendar on the month that holds `key` (yesterday is in the previous month on the 1st). */
async function showDay(page: Page, key: string) {
  await trigger(page).click()
  await expect(page.getByTestId('date-picker-calendar')).toBeVisible()
  if (!(await day(page, key).isVisible())) await page.getByTestId('date-picker-calendar').getByRole('button').first().click()
  await expect(day(page, key)).toBeVisible()
}

const storedRecordDay = (page: Page) => page.evaluate(() => {
  const record = (JSON.parse(localStorage.getItem('taskStatistics') ?? '{}').completionRecords ?? [])
    .find((r: { taskId: string }) => r.taskId === 'late-1')
  if (!record) return null
  const at = new Date(record.completedAt)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
})

test.describe('Done day of a task marked done late (kd#131)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, TASKS, {}, undefined, { once: true })
  })

  test('only a done task has the row', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'open-1')
    await expect(row(page)).toHaveCount(0)

    await openSheet(page, baseURL, 'late-1')
    await expect(row(page)).toContainText('Erledigt am')
    await expect(trigger(page)).toHaveText(longDate(dayKeyDaysAgo(0)))
    // A Local task holds the day itself: no "only in Kan-Do" note
    await expect(page.getByTestId('done-day-local-only')).toHaveCount(0)
  })

  test('yesterday can be picked; the board, the statistics and a reload follow', async ({ page, baseURL }) => {
    const yesterday = dayKeyDaysAgo(1)
    await openSheet(page, baseURL, 'late-1')

    await showDay(page, yesterday)
    await expect(page.getByTestId('date-picker-clear')).toHaveCount(0)
    await day(page, yesterday).click()

    await expect(page.getByTestId('date-picker-calendar')).not.toBeVisible()
    await expect(trigger(page)).toHaveText(longDate(yesterday))
    await expect.poll(() => storedRecordDay(page)).toBe(yesterday)

    // The card left today's Erledigt list and sits in the "Gestern erledigt" note
    await expect(page.locator('#column-done .task[data-task-id="late-1"]')).toHaveCount(0)
    await expect(page.locator('#column-done .yesterday-note')).toContainText('Gestern erledigt')

    await page.reload()
    await expect(page.getByTestId('task-property-list')).toBeVisible()
    await expect(trigger(page)).toHaveText(longDate(yesterday))
    expect(await storedRecordDay(page)).toBe(yesterday)
  })

  test('a day before the task was created and a future day cannot be picked', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'late-1')
    await trigger(page).click()
    const calendar = page.getByTestId('date-picker-calendar')
    await expect(calendar).toBeVisible()

    // Whatever month is shown: every enabled day lies between the creation day and today
    const enabled = await calendar.locator('[data-value]:not([data-disabled]):not([data-outside-view])').evaluateAll(
      cells => cells.map(cell => cell.getAttribute('data-value') as string))
    expect(enabled.length).toBeGreaterThan(0)
    for (const key of enabled) {
      expect(key >= dayKeyDaysAgo(3), `${key} is not before the creation day`).toBe(true)
      expect(key <= dayKeyDaysAgo(0), `${key} is not in the future`).toBe(true)
    }
    expect(enabled).toContain(dayKeyDaysAgo(0))
  })
})
