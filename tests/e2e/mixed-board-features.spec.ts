import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import {
  carriedOverDays,
  seedLocalBoard,
  seedMixedBoard,
  DEFAULT_NOTION_SEED_CONFIG,
  MIXED_SEED_TASKS,
  type SeedTask,
} from './helpers/seed'
import { openDayClose, openMore } from './helpers/appNav'

/**
 * Existing features on a mixed board (#325, epic #264 section 8): delete, "Gesehen", day close, the command
 * palette, Jetzt and export/import all work on a board with Local and Notion tasks side by side. Each test is
 * a sequence (a Notion task, then a Local one), because the bug to catch is a path that follows the board's
 * default source instead of the task's own. The boards below default to Local on purpose: the Notion task must
 * still reach Notion. The undo window is 5 s of real time, so effects after it are awaited with `expect.poll`.
 */

const NOTION_TITLE = 'Fokusaufgabe vorbereiten' // page-1, Offen
const LOCAL_TITLE = 'Lokal: Einkauf planen' // local-open-1, Offen
const NOTION_ID = 'page-1'
const LOCAL_ID = 'local-open-1'
const WINDOW_MS = 15_000

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette' })
const undoButton = (page: Page) => page.getByRole('button', { name: 'Rückgängig', includeHidden: true }).last()

interface StoredTask {
  id: string
  source: string
  externalId: string | null
  status: number
  timeSpentSeconds: number
  title: string
}
interface StoredTasksStore {
  tasks?: StoredTask[]
  archivedTaskIds?: string[]
  pendingDeletes?: Record<string, { state: string; task: { source: string; externalId: string | null } }>
}
const storedStore = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as StoredTasksStore)
const storedTasks = async (page: Page) => (await storedStore(page)).tasks ?? []

/** Answered Notion calls of one kind; the body is kept so a call can be matched to its page. */
function notionCalls(page: Page, path: string) {
  const calls: string[] = []
  page.on('response', (response) => {
    const method = response.request().method()
    if ((method === 'POST' || method === 'PATCH') && response.url().includes(`/api/notion/${path}`) && response.ok()) {
      calls.push(response.request().postData() ?? '')
    }
  })
  return calls
}

const callsFor = (calls: string[], id: string) => calls.filter((body) => body.includes(`"${id}"`))

async function deleteViaCardMenu(page: Page, title: string, label: string) {
  await card(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

async function deleteViaSheet(page: Page, id: string, label: string) {
  await page.goto(`/tasks/${id}`)
  await page.getByTestId('task-delete').filter({ hasText: label }).click()
  await expect(page).toHaveURL(/\/tasks$/)
}

async function deleteViaTriage(page: Page, id: string, label: string) {
  await page.goto(`/tasks/${id}`)
  // The age box's "Nein, löschen" (#247) and the footer Delete run the same flow; the footer names the upstream consequence
  await expect(page.getByTestId('carry-over-delete')).toHaveText('Nein, löschen')
  const del = page.getByTestId('task-delete')
  await expect(del).toHaveText(label)
  await del.click()
  await expect(page).toHaveURL(/\/tasks$/)
}

/** Opens the palette on the card with keyboard focus and waits for it, so typing never goes to the card. */
async function openPaletteOn(page: Page, title: string) {
  await card(page, title).focus()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toBeVisible()
}

/** Types a query and waits for the filtered list to lead with `first`: Enter runs the highlighted entry, not the one meant (#402). */
async function runPaletteCommand(page: Page, query: string, first: RegExp) {
  await page.keyboard.type(query)
  await expect(palette(page).getByRole('option').first()).toHaveText(first)
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
}

async function deleteViaPalette(page: Page, title: string) {
  await openPaletteOn(page, title)
  await runPaletteCommand(page, 'löschen', /^Löschen/)
}

type Path = {
  name: string
  del: (page: Page, task: { id: string; title: string; triageLabel: string }) => Promise<void>
}

const PATHS: Path[] = [
  { name: 'card menu', del: (page, t) => deleteViaCardMenu(page, t.title, t.triageLabel) },
  { name: 'sheet menu', del: (page, t) => deleteViaSheet(page, t.id, t.triageLabel) },
  { name: 'carry-over triage', del: (page, t) => deleteViaTriage(page, t.id, t.triageLabel) },
  { name: 'command palette', del: (page, t) => deleteViaPalette(page, t.title) },
]

const NOTION = { id: NOTION_ID, title: NOTION_TITLE, triageLabel: 'Löschen, auch in Notion' }
const LOCAL = { id: LOCAL_ID, title: LOCAL_TITLE, triageLabel: 'Löschen' }
const CARRY_OVER = { [NOTION_ID]: carriedOverDays(5), [LOCAL_ID]: carriedOverDays(5) }

test.describe('delete follows the task\'s own source, on every path (#325)', () => {
  for (const path of PATHS) {
    test(`${path.name}: Notion task (undo, then delete), then Local task`, async ({ context, page }) => {
      // Local is the default source: a delete that read the board's setting would never reach Notion
      await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true, carryOverByTaskId: CARRY_OVER })
      const archives = notionCalls(page, 'archive-page')
      await page.goto('/tasks')
      await expect(card(page, NOTION_TITLE)).toBeVisible()

      // 1. Notion task: the pending delete is stamped with the task's source; Undo never reaches Notion
      await path.del(page, NOTION)
      await expect(card(page, NOTION_TITLE)).toHaveCount(0)
      await expect.poll(async () => (await storedStore(page)).pendingDeletes?.[NOTION_ID]?.task.source).toBe('notion')
      await undoButton(page).click()
      await expect(card(page, NOTION_TITLE)).toBeVisible()
      await expect.poll(async () => (await storedStore(page)).pendingDeletes?.[NOTION_ID]).toBeUndefined()
      expect(callsFor(archives, NOTION_ID)).toHaveLength(0)

      // 2. The same Notion task again, left alone: Notion archives the page by its id after the window
      await page.goto('/tasks')
      await path.del(page, NOTION)
      await expect.poll(() => callsFor(archives, NOTION_ID).length, { timeout: WINDOW_MS }).toBe(1)
      await expect.poll(async () => (await storedStore(page)).pendingDeletes?.[NOTION_ID]).toBeUndefined()

      // 3. Local task: stamped 'local', gone after the window, and nothing more reaches Notion
      await page.goto('/tasks')
      await path.del(page, LOCAL)
      await expect(card(page, LOCAL_TITLE)).toHaveCount(0)
      await expect.poll(async () => (await storedStore(page)).pendingDeletes?.[LOCAL_ID]?.task.source).toBe('local')
      await expect.poll(async () => (await storedStore(page)).pendingDeletes?.[LOCAL_ID], { timeout: WINDOW_MS }).toBeUndefined()
      expect(archives).toHaveLength(1)

      const left = (await storedTasks(page)).map((task) => task.id)
      expect(left).not.toContain(NOTION_ID)
      expect(left).not.toContain(LOCAL_ID)
      expect(left).toContain('local-waiting-1')
    })
  }
})

test.describe('delete label names the task\'s own source (#325)', () => {
  for (const task of [NOTION, LOCAL]) {
    test(`${task.id}: card menu and sheet say "${task.triageLabel}"`, async ({ context, page }) => {
      await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
      await page.goto('/tasks')
      await card(page, task.title).click({ button: 'right' })
      await expect(page.getByRole('menuitem', { name: task.triageLabel, exact: true })).toBeVisible()
      await page.keyboard.press('Escape')

      await page.goto(`/tasks/${task.id}`)
      await expect(page.getByTestId('task-delete')).toHaveText(task.triageLabel)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------------
// "Gesehen"
// ---------------------------------------------------------------------------------------------------------------

const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString()
const TODAY = new Date().toISOString()
const mixedTask = (task: Partial<SeedTask> & Pick<SeedTask, 'id' | 'title' | 'status' | 'source'>): SeedTask => ({
  priority: 1,
  timeSpentSeconds: 600,
  timeBoxSeconds: null,
  topic: null,
  custom: {},
  externalId: task.source === 'local' ? null : task.id,
  createdAt: YESTERDAY,
  updatedAt: YESTERDAY,
  ...task,
})

/** Yesterday's wins from both sources, one win today, and an open Notion page the stub keeps. */
const ARCHIVE_TASKS: SeedTask[] = [
  mixedTask({ id: 'page-1', title: NOTION_TITLE, status: 0, source: 'notion' }),
  mixedTask({ id: 'page-4', title: 'Retrospektive nachbereiten', status: 3, source: 'notion', completedAt: YESTERDAY }),
  mixedTask({ id: 'local-done-old', title: 'Lokal: Wäsche gestern', status: 3, source: 'local', completedAt: YESTERDAY }),
  mixedTask({ id: 'local-done-today', title: 'Lokal: Heute geschafft', status: 3, source: 'local', completedAt: TODAY }),
]
const ARCHIVE_CONFIG = {
  statusMapping: { ...DEFAULT_NOTION_SEED_CONFIG.statusMapping, archive: 'Archiviert' },
  propertyMapping: { ...DEFAULT_NOTION_SEED_CONFIG.propertyMapping, completedDate: 'Erledigt am' },
}

/** The stub's Done page carries a completion date (a mapped date property), or Notion would stamp it "now". */
const notionDonePageFinishedYesterday = (page: Page) =>
  page.route('**/api/notion/query-data-source', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as { results: Array<{ id: string; properties: Record<string, unknown> }> }
    for (const result of body.results) {
      if (result.id === 'page-4') result.properties['Erledigt am'] = { date: { start: YESTERDAY } }
    }
    await route.fulfill({ response, json: body })
  })

test.describe('"Gesehen" works across sources (#325)', () => {
  test('archives Notion and Local wins together; only the Notion task is written to Notion; no toast, no undo (#463)', async ({ context, page }) => {
    await seedMixedBoard(context, ARCHIVE_TASKS, { defaultSource: 'local', once: true, notionConfig: ARCHIVE_CONFIG })
    await notionDonePageFinishedYesterday(page)
    const updates = notionCalls(page, 'update-task')
    await page.goto('/tasks')
    const note = page.locator('#column-done .yesterday-note')
    await expect(note).toBeVisible()
    await expect(note.getByRole('heading', { name: /Gestern erledigt.*2/ })).toBeVisible()
    await note.getByTestId('yesterday-toggle').click() // titles are on demand (#605)
    await expect(note.getByText('Retrospektive nachbereiten')).toBeVisible()
    await expect(note.getByText('Lokal: Wäsche gestern')).toBeVisible()

    await note.getByRole('button', { name: /^Gesehen/ }).click()
    await expect(note).toHaveCount(0)
    await expect.poll(async () => (await storedStore(page)).archivedTaskIds).toEqual(expect.arrayContaining(['page-4', 'local-done-old']))
    // Notion gets its archive status, the Local task is archived only here
    await expect.poll(() => callsFor(updates, 'page-4').length).toBeGreaterThan(0)
    expect(callsFor(updates, 'page-4').join()).toContain('Archiviert')
    expect(callsFor(updates, 'local-done-old')).toHaveLength(0)
    // Today's win stays in Erledigt, for both sources alike
    await expect(column(page, 'done').getByText('Lokal: Heute geschafft')).toBeVisible()

    // Archiving is silent (#463): no toast, no undo
    await expect(page.getByText('Schön gemacht')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rückgängig' })).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Day close, statistics
// ---------------------------------------------------------------------------------------------------------------

test.describe('day close and statistics ignore sources (#325)', () => {
  test('the day-close sheet lists Notion and Local tasks together without source icons; the board still shows them', async ({ context, page }) => {
    await seedMixedBoard(context, ARCHIVE_TASKS.map((t) => (t.id === 'page-4' ? { ...t, completedAt: TODAY } : t)).concat([
      mixedTask({ id: 'local-open-x', title: 'Lokal: Noch offen', status: 0, source: 'local' }),
    ]), { once: true })
    await page.goto('/tasks')
    await expect(page.getByTestId('task-source-icon').first()).toBeVisible() // the board does show them

    await openDayClose(page)
    const dialog = page.getByRole('dialog', { name: 'Tag abschließen' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Retrospektive nachbereiten')).toBeVisible() // Notion win
    await expect(dialog.getByText('Lokal: Heute geschafft')).toBeVisible() // Local win
    await dialog.getByTestId('day-close-open-details').locator('summary').click() // the open tasks sit in the "Für morgen" list
    await expect(dialog.getByText(NOTION_TITLE)).toBeVisible() // Notion in flight
    await expect(dialog.getByText('Lokal: Noch offen')).toBeVisible() // Local in flight
    await expect(dialog.getByTestId('task-source-icon')).toHaveCount(0)
  })

  test('statistics show no source split, filter or icon', async ({ context, page }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto('/statistics')
    await expect(page.getByTestId('task-source-icon')).toHaveCount(0)
    await expect(page.getByText(/Verbindung/)).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Command palette and Jetzt
// ---------------------------------------------------------------------------------------------------------------

test.describe('the command palette and Jetzt are source-blind (#325)', () => {
  test('palette commands run on a focused Notion task and a focused Local task alike; Jetzt holds one task across sources', async ({ context, page }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    const updates = notionCalls(page, 'update-task')
    await page.goto('/tasks')
    await expect(column(page, 'progress').locator('.task-wrapper')).toHaveCount(1)
    await expect(column(page, 'progress').getByText('Review Team Updates')).toBeVisible() // Notion in Jetzt

    // 1. A Local task takes Jetzt over from the running Notion task by swap (#241); Notion is told, Jetzt holds one task
    await openPaletteOn(page, LOCAL_TITLE)
    const jetzt = palette(page).getByRole('option', { name: /Verschieben nach Jetzt/ })
    await expect(jetzt).not.toContainText('Jetzt belegt')
    await expect(jetzt).not.toHaveAttribute('data-disabled')
    await runPaletteCommand(page, 'Jetzt', /Verschieben nach Jetzt/)
    await expect(column(page, 'progress').getByText(LOCAL_TITLE)).toBeVisible()
    await expect(column(page, 'progress').locator('.task-wrapper')).toHaveCount(1)
    await expect(column(page, 'waiting').getByText('Review Team Updates')).toBeVisible()
    await expect.poll(() => callsFor(updates, 'page-2').length).toBeGreaterThan(0)

    // 2. The other way round: a Notion task takes it back from the Local one (Local goes to Wartet), still one task in Jetzt
    await openPaletteOn(page, NOTION_TITLE)
    await runPaletteCommand(page, 'Jetzt', /Verschieben nach Jetzt/)
    await expect(column(page, 'progress').locator('.task-wrapper')).toHaveCount(1)
    await expect(column(page, 'progress').getByText(NOTION_TITLE)).toBeVisible()
    await expect(column(page, 'waiting').getByText(LOCAL_TITLE)).toBeVisible()
    await expect.poll(() => callsFor(updates, 'page-1').length).toBeGreaterThan(0)

    // 3. Local takes it again, so step 4 reads a Local task in Jetzt
    await openPaletteOn(page, LOCAL_TITLE)
    await runPaletteCommand(page, 'Jetzt', /Verschieben nach Jetzt/)
    await expect(column(page, 'progress').getByText(LOCAL_TITLE)).toBeVisible()
    await expect(column(page, 'progress').locator('.task-wrapper')).toHaveCount(1)

    // 4. The Local task in Jetzt runs a timer like any other: time is counted
    await expect.poll(async () => (await storedTasks(page)).find((t) => t.id === LOCAL_ID)?.timeSpentSeconds, { timeout: WINDOW_MS }).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------------------------------------------

test.describe('export and import carry the mixed board (#325)', () => {
  test.setTimeout(60_000)
  test('export keeps each task\'s source and no token; import into a fresh browser needs Notion attention until reconnected', async ({ browser, baseURL, context, page }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    await page.goto('/settings/data')
    const download = page.waitForEvent('download')
    await page.getByTestId('data-export').click()
    const file = await download
    const text = await readFile(await file.path(), 'utf8')

    const envelope = JSON.parse(text) as { stores: { 'tasks-store': StoredTasksStore; 'board-store': { boardConfig: { sources: unknown } } } }
    const exported = envelope.stores['tasks-store'].tasks ?? []
    expect(exported.map((t) => [t.id, t.source, t.externalId]).sort()).toEqual(
      MIXED_SEED_TASKS.map((t) => [t.id, t.source, t.externalId]).sort(),
    )
    expect(envelope.stores['board-store'].boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
    expect(text).not.toContain('notion_test_stub') // the token the seeded board runs on

    // A browser that never saw this board and holds no Notion token
    const fresh = await browser.newContext({ locale: 'de-DE', baseURL })
    try {
      await seedLocalBoard(fresh, [], {}, undefined, { once: true })
      const target = await fresh.newPage()
      await target.goto('/settings/data')
      const chooser = target.waitForEvent('filechooser')
      await target.getByTestId('data-import').click()
      await (await chooser).setFiles({ name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(text) })
      await target.getByTestId('data-restore-confirm').click()
      await target.waitForLoadState('load')
      await expect.poll(async () => (await storedTasks(target)).length, { timeout: WINDOW_MS }).toBe(MIXED_SEED_TASKS.length)

      const tasks = await storedTasks(target)
      expect(tasks.find((t) => t.id === 'page-1')).toMatchObject({ source: 'notion', externalId: 'page-1' })
      expect(tasks.find((t) => t.id === 'local-open-1')).toMatchObject({ source: 'local', externalId: null })
      const board = await target.evaluate(() => JSON.parse(localStorage.getItem('board-store') ?? '{}') as { boardConfig: { sources: unknown } })
      expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'local' })
      const notionConfig = await target.evaluate(() => localStorage.getItem('notionConfig') ?? '')
      expect(notionConfig).not.toContain('notion_test_stub')

      // Integrations need attention until reconnected: the board keeps every task, Notion is marked, Local is not
      await target.goto('/tasks')
      await expect(target.locator('.task-wrapper', { hasText: 'Lokal: Einkauf planen' }).first()).toBeVisible()
      await expect(target.locator('.task-wrapper', { hasText: NOTION_TITLE }).first()).toBeVisible()
      await expect.poll(() => target.evaluate(() => JSON.parse(localStorage.getItem('integration-health-store') ?? '{}').sources?.notion?.status)).toBe('broken')
      const panel = await openMore(target)
      await expect(panel.getByTestId('sync-problem-notion')).toBeVisible()
      await expect(panel.getByTestId('sync-repair-notion')).toBeVisible()
      await expect(panel.getByTestId('sync-problem-todoist')).toHaveCount(0)
    } finally {
      await fresh.close()
    }
  })
})
