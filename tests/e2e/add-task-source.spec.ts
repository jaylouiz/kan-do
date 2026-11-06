import { test, expect, type Page } from '@playwright/test'
import { seedMixedBoard, seedLocalBoard, DEFAULT_NOTION_SEED_CONFIG, MIXED_SEED_TASKS } from './helpers/seed'
import { moreButton, resync } from './helpers/appNav'
import { openAddSheet } from './helpers/addSheet'

/**
 * The add form on a mixed board (#321, epic #264): new tasks go to the default source, the footer's
 * "Speichern in" switch saves elsewhere, the form's fields follow the chosen source, and a create while the
 * default source needs attention is shown at once and reaches the source exactly once after the reconnect.
 */

const SWITCH = '[data-testid="add-target-switch"]'
const TRIGGER = 'button[aria-label^="Speichern in"]'
const CLOUD = '[data-testid="task-save-pending"]'
const CREATE_ROUTE = '**/api/notion/create-task'

/** Notion maps priority and topic besides the timebox, and one custom property */
const NOTION_WITH_FIELDS = {
  propertyMapping: {
    ...DEFAULT_NOTION_SEED_CONFIG.propertyMapping,
    priority: 'Prio',
    topic: 'Projekt',
    customProperties: [{ key: 'projekt-nr', name: 'Projekt-Nr', type: 'text' as const, enabled: true }],
  },
}

/** The Local tasks of the mixed seed; the stub's Notion pages are left out */
const LOCAL_ONLY = MIXED_SEED_TASKS.filter((task) => task.source === 'local')

/** Notion holds no tasks (so Jetzt stays free for the ad-hoc add) */
const notionHasNoTasks = (page: Page) =>
  page.route('**/api/notion/query-data-source', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], has_more: false, next_cursor: null }) }),
  )

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()
const sheet = (page: Page) => page.getByRole('dialog')
const switchTrigger = (page: Page) => sheet(page).locator(TRIGGER)

const storedTasks = (page: Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as {
    tasks?: Array<{ id: string; title: string; source: string; externalId: string | null; pendingSync?: { attempts: number; lastError: string | null } }>
  }
  return raw.tasks ?? []
})
const storedTask = async (page: Page, title: string) => (await storedTasks(page)).find((t) => t.title === title)

/** The sheet is the only place with the target switch (#321); since #649 the Offen button adds in the card, so the palette opens it */
async function openFormFromButton(page: Page) {
  await openAddSheet(page)
}

async function pickTarget(page: Page, name: string) {
  await switchTrigger(page).click()
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click()
  await expect(switchTrigger(page)).toHaveAttribute('aria-label', `Speichern in: ${name}`)
}

async function submit(page: Page) {
  await sheet(page).getByRole('button', { name: 'Aufgabe erstellen' }).click()
}

/** Collects the creates Notion answered (an aborted or refused request creates no page) */
function countCreates(page: Page) {
  const calls: string[] = []
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && response.url().includes('/api/notion/create-task') && response.ok()) calls.push(response.url())
  })
  return calls
}

/** The create count once it stops changing (unchanged across a short window), so a later duplicate fails the read */
const stableCreates = (page: Page, creates: string[]) => async () => {
  const before = creates.length
  await page.waitForTimeout(300)
  return creates.length === before ? before : -1
}

/** Notion status as stored in the health store */
const notionStatus = (page: Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('integration-health-store') ?? '{}') as { sources?: { notion?: { status: string } } }
  return raw.sources?.notion?.status
})

/** A stub token whose `create-task` alone answers with `status` (reads and updates stay healthy) */
const createFailToken = (status: number) => `notion_test_stub:create-fail=${status}:${crypto.randomUUID()}`

test.describe('add form on a mixed board (#321)', () => {
  test('Offen button starts on the default (Notion), saves there and shows the Notion fields', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: NOTION_WITH_FIELDS })
    const creates = countCreates(page)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()

    await openFormFromButton(page)
    await expect(sheet(page).locator(SWITCH)).toBeVisible()
    await expect(switchTrigger(page)).toHaveAttribute('aria-label', 'Speichern in: Notion')
    await expect(sheet(page).getByTestId('add-task-priority-chip')).toBeVisible()
    await expect(sheet(page).getByText('Projekt-Nr')).toBeVisible()

    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Quartalsbericht')
    await submit(page)

    await expect(column(page, 'open').getByText('Quartalsbericht')).toBeVisible()
    await expect.poll(() => creates.length).toBe(1)
    await expect.poll(async () => (await storedTask(page, 'Quartalsbericht'))?.source).toBe('notion')
    await expect.poll(async () => {
      const saved = await storedTask(page, 'Quartalsbericht')
      return saved && saved.externalId === saved.id && saved.pendingSync === undefined // D1: the page id is the task id
    }).toBe(true)
    await expect(page.locator(CLOUD)).toHaveCount(0)
  })

  test('the command palette opens the same form, also starting on a Local default', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', notionConfig: NOTION_WITH_FIELDS })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('option', { name: 'Aufgabe hinzufügen' }).click()
    await expect(sheet(page).locator(SWITCH)).toBeVisible()
    await expect(switchTrigger(page)).toHaveAttribute('aria-label', 'Speichern in: Lokal')
    // The Local target shows the four standard fields and no Eigenschaften
    await expect(sheet(page).getByTestId('add-task-timebox')).toBeVisible()
    await expect(sheet(page).getByTestId('add-task-activity-select')).toBeVisible()
    await expect(sheet(page).getByText('Projekt-Nr')).toHaveCount(0)
  })

  test('switching back and forth keeps typed values and drops unsupported fields silently; the Local save makes no Notion request', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: NOTION_WITH_FIELDS })
    const creates = countCreates(page)
    await page.goto(`${baseURL}/tasks`)
    await openFormFromButton(page)
    const title = sheet(page).getByPlaceholder('Aufgabe benennen…')
    await title.fill('Rückruf')
    await sheet(page).getByRole('textbox', { name: /Projekt-Nr/ }).fill('P-7')

    await pickTarget(page, 'Lokal')
    await expect(sheet(page).getByText('Projekt-Nr')).toHaveCount(0) // no warning, the row is just gone
    await expect(sheet(page).getByTestId('add-task-activity-select')).toBeVisible()
    await expect(title).toHaveValue('Rückruf')

    await pickTarget(page, 'Notion')
    await expect(sheet(page).getByTestId('add-task-activity-select')).toHaveCount(0)
    await expect(sheet(page).getByRole('textbox', { name: /Projekt-Nr/ })).toHaveValue('P-7')
    await expect(title).toHaveValue('Rückruf')

    await pickTarget(page, 'Lokal')
    await submit(page)
    await expect(column(page, 'open').getByText('Rückruf')).toBeVisible()
    await expect.poll(async () => {
      const saved = await storedTask(page, 'Rückruf')
      return saved && saved.source === 'local' && saved.externalId === null && saved.id.startsWith('local_')
    }).toBe(true)
    await expect.poll(stableCreates(page, creates)).toBe(0)
  })

  test('the draft card and the focus stay put when the source changes', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: NOTION_WITH_FIELDS })
    await page.goto(`${baseURL}/tasks`)
    await openFormFromButton(page)
    const title = sheet(page).getByPlaceholder('Aufgabe benennen…')
    await title.fill('Entwurf bleibt')
    await expect(column(page, 'open').getByText('Entwurf bleibt')).toBeVisible()

    await pickTarget(page, 'Lokal')
    await expect(column(page, 'open').getByText('Entwurf bleibt')).toBeVisible()
    await expect(title).toHaveValue('Entwurf bleibt')
    await expect(column(page, 'progress').getByText('Entwurf bleibt')).toHaveCount(0)
  })

  test('the picker lists Lokal and Notion, marks the default, and locks while the save runs', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: NOTION_WITH_FIELDS })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route(CREATE_ROUTE, async (route) => {
      await gate
      await route.continue()
    })
    await page.goto(`${baseURL}/tasks`)
    await openFormFromButton(page)

    await switchTrigger(page).click()
    await expect(page.getByRole('option')).toHaveCount(2)
    await expect(page.getByRole('option', { name: /^Notion/ })).toContainText('Standard')
    await expect(page.getByRole('option', { name: /^Lokal/ })).not.toContainText('Standard')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
    await expect(sheet(page)).toBeVisible() // Escape closed the picker first, the sheet second
    await expect(switchTrigger(page)).toBeFocused()

    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Langsame Aufgabe')
    await submit(page)
    await expect(switchTrigger(page)).toBeVisible()
    await expect(switchTrigger(page)).toBeDisabled()
    release()
    await expect(column(page, 'open').getByText('Langsame Aufgabe')).toBeVisible()
  })

  test('a create Notion refuses as invalid (400, passed through by the server) keeps the form open with the chosen target and nothing queued', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { ...NOTION_WITH_FIELDS, token: createFailToken(400) } })
    const refused = page.waitForResponse((res) => res.url().includes('/api/notion/create-task') && res.status() === 400)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await openFormFromButton(page)
    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Wird abgelehnt')
    await submit(page)
    await refused

    await expect(page.getByText(/konnte nicht erstellt|nicht erstellt|Fehler/i).first()).toBeVisible()
    await expect(sheet(page).getByPlaceholder('Aufgabe benennen…')).toHaveValue('Wird abgelehnt')
    await expect(switchTrigger(page)).toBeEnabled()
    await expect(switchTrigger(page)).toHaveAttribute('aria-label', 'Speichern in: Notion')
    await expect(column(page, 'open').getByText('Wird abgelehnt')).toHaveCount(1) // the draft card only
    await expect(page.locator(CLOUD)).toHaveCount(0)
    await expect.poll(async () => await storedTask(page, 'Wird abgelehnt')).toBeUndefined()
    await expect.poll(() => notionStatus(page)).toBe('healthy')
  })

  test('reopening the form resets the target to the default', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: NOTION_WITH_FIELDS })
    await page.goto(`${baseURL}/tasks`)
    await openFormFromButton(page)
    await pickTarget(page, 'Lokal')
    await expect(switchTrigger(page)).toBeFocused()
    await page.keyboard.press('Escape') // the picker is closed, so this one closes the sheet
    await expect(sheet(page)).toHaveCount(0)

    await openFormFromButton(page)
    await expect(switchTrigger(page)).toHaveAttribute('aria-label', 'Speichern in: Notion')
  })

  test('ad-hoc add in Jetzt offers no switch and saves to the default source, with the timer running', async ({ context, page, baseURL }) => {
    // Jetzt is empty (the stub has no Notion tasks) so the ad-hoc slot exists; the default is Notion
    await seedMixedBoard(context, LOCAL_ONLY, { notionConfig: NOTION_WITH_FIELDS })
    await notionHasNoTasks(page)
    const creates = countCreates(page)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()

    await page.locator('#column-progress h2').hover()
    await page.locator('#column-progress .add-task-button').click()
    await page.waitForURL(/\/tasks\/add\?mode=adhoc/)
    await expect(sheet(page).getByPlaceholder('Aufgabe benennen…')).toBeVisible()
    await expect(sheet(page).locator(SWITCH)).toHaveCount(0)
    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Spontan')
    await sheet(page).getByRole('button', { name: 'Starten' }).click()

    await expect(column(page, 'progress').getByText('Spontan')).toBeVisible()
    await expect.poll(() => creates.length).toBe(1)
    await expect.poll(async () => (await storedTask(page, 'Spontan'))?.source).toBe('notion')
    await expect(column(page, 'progress').locator('.task-wrapper', { hasText: 'Spontan' }).locator('[data-current]')).toBeVisible()
  })

  test('ad-hoc add with a Local default stays Local, also next to a connected Notion', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, LOCAL_ONLY, { defaultSource: 'local', notionConfig: NOTION_WITH_FIELDS })
    await notionHasNoTasks(page)
    const creates = countCreates(page)
    await page.goto(`${baseURL}/tasks/add?mode=adhoc`)
    await expect(sheet(page).getByPlaceholder('Aufgabe benennen…')).toBeVisible()
    await expect(sheet(page).locator(SWITCH)).toHaveCount(0)
    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Spontan lokal')
    await sheet(page).getByRole('button', { name: 'Starten' }).click()

    await expect(column(page, 'progress').getByText('Spontan lokal')).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'Spontan lokal'))?.source).toBe('local')
    await expect.poll(stableCreates(page, creates)).toBe(0)
  })

  test('ad-hoc add while Jetzt is taken (a Notion task there) still lands in Offen, in the default source', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: NOTION_WITH_FIELDS })
    const creates = countCreates(page)
    await page.goto(`${baseURL}/tasks/add?mode=adhoc`)
    await expect(column(page, 'progress').getByText('Review Team Updates')).toBeVisible()
    await expect(sheet(page).locator(SWITCH)).toHaveCount(0)
    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Kein Platz in Jetzt')
    await sheet(page).getByRole('button', { name: 'Starten' }).click()

    await expect(column(page, 'open').getByText('Kein Platz in Jetzt')).toBeVisible()
    await expect(column(page, 'progress').getByText('Kein Platz in Jetzt')).toHaveCount(0)
    await expect.poll(() => creates.length).toBe(1)
    await expect.poll(async () => (await storedTask(page, 'Kein Platz in Jetzt'))?.source).toBe('notion')
  })

  test('one source (Local only): no switch, the form is as before', async ({ context, page, baseURL }) => {
    await seedLocalBoard(context)
    await page.goto(`${baseURL}/tasks`)
    await openFormFromButton(page)
    await expect(sheet(page).getByRole('button', { name: 'Aufgabe erstellen' })).toBeVisible()
    await expect(sheet(page).locator(SWITCH)).toHaveCount(0)
    await expect(sheet(page).getByTestId('add-task-timebox')).toBeVisible()
  })
})

test.describe('creating while the default source needs attention (#321)', () => {
  test('a create with Notion unreachable shows at once with the cloud and reaches Notion exactly once after the reconnect', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: NOTION_WITH_FIELDS })
    const creates = countCreates(page)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()

    await page.route('**/api/notion/**', (route) => route.abort('connectionrefused'))
    await openFormFromButton(page)
    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Später speichern')
    await submit(page)

    // Shown at once in Offen with the cloud; the task keeps its local id
    await expect(column(page, 'open').getByText('Später speichern')).toBeVisible()
    await expect(card(page, 'Später speichern').locator(CLOUD)).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'Später speichern'))?.pendingSync?.attempts ?? 0).toBeGreaterThan(0)
    const pending = (await storedTask(page, 'Später speichern'))!
    expect(pending.externalId).toBeNull()
    expect(pending.id).toMatch(/^local_/)

    // The connection is back: the retry from the Mehr panel creates the page
    await page.unroute('**/api/notion/**')
    await resync(page)

    await expect(page.locator(CLOUD)).toHaveCount(0)
    await expect.poll(async () => (await storedTask(page, 'Später speichern'))?.externalId ?? null).not.toBeNull()
    await expect.poll(async () => (await storedTask(page, 'Später speichern'))?.pendingSync).toBeUndefined()
    // The id never changes and exactly one upstream page exists, also after the refresh that follows the retry
    await expect.poll(async () => (await storedTask(page, 'Später speichern'))?.id).toBe(pending.id)
    await expect.poll(async () => (await storedTasks(page)).filter((t) => t.title === 'Später speichern').length).toBe(1)
    await expect(column(page, 'open').getByText('Später speichern')).toHaveCount(1)
    await expect.poll(stableCreates(page, creates)).toBe(1)
  })

  test('a rejected Notion token: the picker carries the heads-up, the create still succeeds locally and shows the cloud', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, {
      notionConfig: { ...NOTION_WITH_FIELDS, token: `notion_test_stub:fail=401:${crypto.randomUUID()}` },
    })
    const rejected = page.waitForResponse((res) => res.url().includes('/api/notion/') && res.status() === 401)
    await page.goto(`${baseURL}/tasks`)
    await rejected

    await openFormFromButton(page)
    await switchTrigger(page).click()
    const notionOption = page.getByRole('option', { name: /^Notion/ })
    await expect(notionOption).toContainText('Standard')
    await expect(notionOption).toContainText('Verbindung prüfen · wird später gespeichert')
    await notionOption.click() // still selectable
    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Trotzdem gespeichert')
    await submit(page)

    await expect(column(page, 'open').getByText('Trotzdem gespeichert')).toBeVisible()
    await expect(card(page, 'Trotzdem gespeichert').locator(CLOUD)).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'Trotzdem gespeichert'))?.pendingSync).toBeDefined()
  })

  test('a create the database refuses (403): saved with the task marker, the source stays healthy (no repair prompt)', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { ...NOTION_WITH_FIELDS, token: createFailToken(403) } })
    const refused = page.waitForResponse((res) => res.url().includes('/api/notion/create-task') && res.status() === 403)
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await openFormFromButton(page)
    await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Datenbank nicht geteilt')
    await submit(page)
    await refused

    await expect(column(page, 'open').getByText('Datenbank nicht geteilt')).toBeVisible()
    await expect(card(page, 'Datenbank nicht geteilt').locator(CLOUD)).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'Datenbank nicht geteilt'))?.pendingSync?.attempts ?? 0).toBeGreaterThan(0)
    expect((await storedTask(page, 'Datenbank nicht geteilt'))?.externalId).toBeNull()
    await expect.poll(() => notionStatus(page)).toBe('healthy')
    await expect(moreButton(page)).toHaveAccessibleName('Mehr') // the panel offers a repair only for a source with a problem
  })
})
