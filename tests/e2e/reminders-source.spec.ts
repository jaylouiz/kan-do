import { test, expect, type Page } from '@playwright/test'
import { seedRemindersBoard, SEED_TASKS, dayKeyDaysAhead } from './helpers/seed'
import { persistedStores, setRemindersStatus, setReminderCompleted, stubState, type TauriStubState } from './helpers/tauriStub'
import { taskMenu } from './helpers/taskMenu'

/**
 * Apple Reminders as a task source (#551, epic #481 slice 2). The connect UI is slice 3, so the seed connects the source
 * and the Tauri stub plays macOS: three lists (Thema, a list stored as the legacy Aktivität which reads as Thema, Aus) and five reminders, one of them recurring. What the
 * board shows, done both ways, the recurring occurrence, a revoked permission and the read-only menus.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()

/** The tasks the app persisted (the desktop stub's data file); the write is debounced, so callers poll. */
const storedTasks = async (page: Page) => ((await persistedStores(page))['tasks-store']?.tasks ?? []) as Array<Record<string, unknown>>
const stubReminder = async (page: Page, id: string) => (await stubState(page)).reminders.reminders.find(r => r.id === id)
const remindersCalls = async (page: Page, cmd: string): Promise<TauriStubState['calls']> => (await stubState(page)).calls.filter(call => call.cmd === cmd)

async function moveTo(page: Page, title: string, target: string) {
  await card(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: target, exact: true }).click()
}

test.describe('Apple Reminders source (#551)', () => {
  test('the open reminders and those completed today of every list that is not Off arrive: the list is always the Thema, also one an older version stored as Aktivität (#575)', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')

    await expect(column(page, 'open').getByText('Milch kaufen')).toBeVisible()
    await expect(column(page, 'open').getByText('Quartalsbericht schreiben')).toBeVisible()
    await expect(column(page, 'open').getByText('Pflanzen gießen')).toBeVisible()
    await expect(column(page, 'done').getByText('Müll rausgebracht')).toBeVisible()
    // The list set to Off is never fetched
    await expect(page.getByText('Geschenk verstecken')).toHaveCount(0)
    await expect.poll(async () => (await remindersCalls(page, 'reminders_fetch')).at(-1)?.args).toMatchObject({ listIds: ['list-home', 'list-work'] })

    await expect.poll(async () => (await storedTasks(page)).length).toBeGreaterThanOrEqual(4)
    const tasks = await storedTasks(page)
    const by = (title: string) => tasks.find(task => task.title === title)
    expect(by('Milch kaufen')).toMatchObject({ source: 'reminders', externalId: 'rem-milk', topic: 'Zuhause', activity: null, notes: 'Hafermilch', status: 0 })
    expect(by('Quartalsbericht schreiben')).toMatchObject({ topic: 'Arbeit', activity: null, reminders: { due: { date: dayKeyDaysAhead(0), time: '09:30' }, listId: 'list-work' } })
    // A recurring reminder is one task per occurrence: its externalId carries the date
    expect(by('Pflanzen gießen')).toMatchObject({ externalId: `rem-plants@${dayKeyDaysAhead(0)}`, reminders: { recurrence: 'FREQ=WEEKLY' } })
    // Dated today: the date is the plan (#553), so each starts Offen on the board, nothing written
    expect(tasks.filter(task => task.status === 0 && task.source === 'reminders').every(task => task.notPlanned === undefined)).toBe(true)
  })

  test('done in kan-do is ticked in Reminders, reopening unticks it, and a tick made in Reminders follows at the next sync', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText('Milch kaufen')).toBeVisible()

    await moveTo(page, 'Milch kaufen', 'Erledigt')
    await expect(column(page, 'done').getByText('Milch kaufen')).toBeVisible()
    await expect.poll(async () => (await stubReminder(page, 'rem-milk'))?.completed).toBe(true)
    const tick = (await remindersCalls(page, 'reminders_set_completed')).at(-1)?.args
    expect(tick).toMatchObject({ id: 'rem-milk', completed: true, occurrenceDate: dayKeyDaysAhead(0), allowedListIds: ['list-home'] })

    await moveTo(page, 'Milch kaufen', 'Offen')
    await expect(column(page, 'open').getByText('Milch kaufen')).toBeVisible()
    await expect.poll(async () => (await stubReminder(page, 'rem-milk'))?.completed).toBeFalsy()

    // Done in Reminders itself: the next sync brings the card to Erledigt
    await setReminderCompleted(page, 'rem-report', true)
    await page.reload()
    await expect(column(page, 'done').getByText('Quartalsbericht schreiben')).toBeVisible()
    // And reopened there: back to Offen
    await setReminderCompleted(page, 'rem-report', false)
    await page.reload()
    await expect(column(page, 'open').getByText('Quartalsbericht schreiben')).toBeVisible()
  })

  test('a recurring reminder is one card per occurrence: the ticked one stays in Erledigt, the next date arrives as its own card', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText('Pflanzen gießen')).toBeVisible()

    await moveTo(page, 'Pflanzen gießen', 'Erledigt')
    await expect(column(page, 'done').getByText('Pflanzen gießen')).toBeVisible()
    // Reminders now shows the next date and the reminder is open again: the write carried the date of the occurrence
    await expect.poll(async () => (await stubReminder(page, 'rem-plants'))?.due?.date).toBe(dayKeyDaysAhead(7))
    expect((await remindersCalls(page, 'reminders_set_completed')).at(-1)?.args).toMatchObject({ id: 'rem-plants', occurrenceDate: dayKeyDaysAhead(0) })

    await page.reload()
    await expect(column(page, 'done').getByText('Pflanzen gießen')).toHaveCount(1)
    // The next occurrence is dated a week ahead: the date is the plan (#553), so it waits in "Alle Aufgaben", not in Offen
    await expect(column(page, 'open').getByText('Pflanzen gießen')).toHaveCount(0)
    await expect.poll(async () => (await storedTasks(page)).filter(task => task.title === 'Pflanzen gießen')).toHaveLength(2)
    const plants = (await storedTasks(page)).filter(task => task.title === 'Pflanzen gießen')
    expect(plants.find(task => task.externalId === `rem-plants@${dayKeyDaysAhead(7)}`)?.notPlanned).toBe(true)
    expect(plants.map(task => [task.externalId, task.status]).sort()).toEqual([
      [`rem-plants@${dayKeyDaysAhead(0)}`, 3],
      [`rem-plants@${dayKeyDaysAhead(7)}`, 0],
    ])
  })

  test('a list that disappeared or was switched off ends its tasks at the next sync', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText('Quartalsbericht schreiben')).toBeVisible()

    // The user answers Aus for the list of the report (slice 3 offers the UI): it is not fetched any more
    await page.evaluate(() => {
      const stub = (window as unknown as { __tauriStub: { data: { envelope: { stores: Record<string, { lists?: Record<string, { role: string }> }> } } } }).__tauriStub
      const envelope = JSON.parse(JSON.stringify(stub.data.envelope)) as typeof stub.data.envelope
      envelope.stores.remindersConfig!.lists!['list-work']!.role = 'off'
      // Assigned through the proxy so the change reaches sessionStorage
      stub.data = { ...stub.data, envelope }
    })
    await page.reload()
    await expect(page.getByText('Milch kaufen')).toBeVisible()
    await expect(page.getByText('Quartalsbericht schreiben')).toHaveCount(0)
  })

  test('access revoked in macOS: the source needs attention, nothing is written, no dialog opens by itself', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText('Milch kaufen')).toBeVisible()

    const fetchesBefore = (await remindersCalls(page, 'reminders_fetch')).length
    await setRemindersStatus(page, 'denied')
    await page.reload()
    // The cached board stays as it was
    await expect(column(page, 'open').getByText('Milch kaufen')).toBeVisible()
    await expect.poll(async () => ((await persistedStores(page))['integration-health-store']?.sources as Record<string, { status?: string }> | undefined)?.reminders?.status).toBe('broken')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await remindersCalls(page, 'reminders_set_completed')).toHaveLength(0)
    // The bridge refused at the status check: no list is read
    expect(await remindersCalls(page, 'reminders_fetch')).toHaveLength(fetchesBefore)
  })

  test('read-only: no "Löschen" and no "Verschieben zu …" in the card menu, title and notes are text in the sheet, "Speichern in" does not offer it', async ({ context, page }) => {
    await seedRemindersBoard(context)
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText('Milch kaufen')).toBeVisible()

    await card(page, 'Milch kaufen').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Status ändern' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Löschen/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Verschieben zu …' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Duplizieren' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.goto('/tasks/rem-milk')
    const header = page.getByTestId('task-detail-header')
    await expect(header.getByText('Milch kaufen')).toBeVisible()
    await expect(header.getByTestId('inline-readonly')).toBeVisible()
    await expect(header.getByRole('button', { name: /Titel/ })).toHaveCount(0)
    // The list is the Thema: a plain value, no picker; a Reminders card has no Aktivität row
    await expect(page.getByTestId('task-topic-readonly')).toContainText('Zuhause')
    await expect(page.getByTestId('task-topic-readonly').getByRole('button')).toHaveCount(0)
    await expect(page.getByTestId('task-activity-readonly')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Aktivität/ })).toHaveCount(0)
    // #870: the note is the tab "Notiz" (shown because there is one; nothing to edit)
    await page.getByRole('tab', { name: /^Notiz/ }).click()
    await expect(page.getByTestId('task-notes').getByText('Hafermilch')).toBeVisible()
    await expect(page.getByTestId('task-notes').getByRole('button')).toHaveCount(0)
    // No link to open, nowhere to move, nothing to delete: the task menu (#846: it always renders, it holds the task's own entries) offers only the ad-hoc mark and "ID kopieren"
    await taskMenu(page).click()
    await expect(page.getByRole('menuitemcheckbox')).toHaveText(['Ad-hoc/Ungeplant'])
    await expect(page.getByRole('menuitem')).toHaveText(['ID kopieren'])
    await expect(page.getByRole('menuitem', { name: /^Löschen/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /öffnen/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /Verschieben|Speichern in/ })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.goto('/tasks/add')
    await expect(page.getByTestId('add-target-switch')).toHaveCount(0)
  })

  test('a mixed board shows the Reminders source icon, 16px, bundled', async ({ context, page }) => {
    await seedRemindersBoard(context, { tasks: SEED_TASKS.slice(0, 2) })
    await page.goto('/tasks')
    await expect(column(page, 'open').getByText('Milch kaufen')).toBeVisible()

    const icon = card(page, 'Milch kaufen').getByTestId('task-source-icon')
    await expect(icon).toHaveAttribute('data-source', 'reminders')
    await expect(icon).toHaveAttribute('aria-label', 'Apple Erinnerungen')
    const box = await icon.boundingBox()
    expect(Math.round(box!.width)).toBe(16)
    expect(Math.round(box!.height)).toBe(16)
  })
})
