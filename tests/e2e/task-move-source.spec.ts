import { test, expect, type Page, type Locator } from '@playwright/test'
import { elapse, elapseWindow, installClock, settleRequests } from './helpers/clock'
import { seedMixedBoard, MIXED_SEED_TASKS } from './helpers/seed'

/**
 * Move a task between sources (#322, epic #264). The Notion stub keeps page state per session token, so
 * a create shows up in later queries and an archive removes the page from them. Stub calls are counted by
 * their answered requests, never by position.
 *
 * The undo window runs on the page clock (#543): tests that let it elapse call `elapseWindow`, then wait for the
 * network-bound effect (the stub's answer) with `expect.poll`.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette' })
const CLOUD = '[data-testid="task-save-pending"]'
const TITLE = 'Lokal: Einkauf planen' // local-open-1, Offen
const NOTION_TITLE = 'Fokusaufgabe vorbereiten' // page-1, Offen

interface StoredTask {
  id: string
  title: string
  source: string
  externalId: string | null
  status: number
  timeSpentSeconds: number
  createdAt?: string
  completedAt?: string | null
  pendingSync?: { attempts: number; lastError: string | null }
  pendingMove?: { fromSource: string; fromExternalId: string | null; toSource: string }
}
const storedTasks = (page: Page) => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: StoredTask[] }
  return raw.tasks ?? []
})
const storedTask = async (page: Page, id: string) => (await storedTasks(page)).find((t) => t.id === id)

/** Collects the answered Notion calls of a kind (`create-task`, `archive-page`, `update-task`) */
function countCalls(page: Page, path: string) {
  const calls: string[] = []
  page.on('response', (response) => {
    if (response.request().method() !== 'POST' && response.request().method() !== 'PATCH') return
    if (response.url().includes(`/api/notion/${path}`) && response.ok()) calls.push(response.url())
  })
  return calls
}

/** A stub token whose `create-task` alone answers with `status` (reads and updates stay healthy) */
const createFailToken = (status: number) => `notion_test_stub:create-fail=${status}:${crypto.randomUUID()}`

/** The board without the stub's Jetzt page, so Jetzt is free for a Local task */
const withoutJetztPage = (page: Page) =>
  page.route('**/api/notion/query-data-source', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as { results: Array<{ id: string }> }
    await route.fulfill({ response, json: { ...body, results: body.results.filter((result) => result.id !== 'page-2') } })
  })
const SEED_WITHOUT_JETZT = MIXED_SEED_TASKS.filter((task) => task.id !== 'page-2')

async function openCardMenu(page: Page, title: string) {
  await card(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Verschieben nach …' }).click()
}

async function moveViaContextMenu(page: Page, title: string, target: string) {
  await openCardMenu(page, title)
  await page.getByRole('menuitem', { name: new RegExp(`^${target}`) }).click()
}

const toastText = (page: Page, text: string): Locator => page.getByText(text, { exact: true })

test.describe('Move a task between sources (#322)', () => {
  test('Local -> Notion -> undo -> Notion -> back to Local: one card at every step, the stub sees no call for the undone move', async ({ context, page, baseURL }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    const creates = countCalls(page, 'create-task')
    const archives = countCalls(page, 'archive-page')
    await page.goto(`${baseURL}/tasks`)
    await expect(card(page, TITLE)).toBeVisible()
    const openTitles = () => column(page, 'open').locator('.task-wrapper').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
    const orderBefore = await openTitles()
    const before = await storedTask(page, 'local-open-1')

    // 1. Move and undo inside the window
    await moveViaContextMenu(page, TITLE, 'Notion')
    await expect(toastText(page, 'Nach Notion verschoben')).toBeVisible()
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(1)
    await expect.poll(openTitles).toEqual(orderBefore)
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.source).toBe('notion')
    await page.getByRole('button', { name: 'Rückgängig' }).click()
    await expect(toastText(page, 'Nach Notion verschoben')).toHaveCount(0)
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.source).toBe('local')
    expect(await storedTask(page, 'local-open-1')).toMatchObject({ externalId: null })
    expect((await storedTask(page, 'local-open-1'))?.pendingMove).toBeUndefined()
    await elapseWindow(page) // past the window it would have had: still nothing upstream
    await settleRequests(page)
    expect(creates).toHaveLength(0)

    // 2. Move again and let the window close: exactly one page, the origin is Local (nothing to remove)
    await moveViaContextMenu(page, TITLE, 'Notion')
    await elapseWindow(page)
    await expect.poll(() => creates.length).toBe(1)
    await expect.poll(async () => {
      const moved = await storedTask(page, 'local-open-1')
      return moved?.source === 'notion' && !!moved.externalId?.startsWith('stub-page-') && moved.pendingMove === undefined && moved.pendingSync === undefined
    }).toBe(true)
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(1)
    await expect.poll(openTitles).toEqual(orderBefore)
    expect((await storedTask(page, 'local-open-1'))?.createdAt).toBe(before?.createdAt)
    await expect(page.locator(CLOUD)).toHaveCount(0)

    // A reload fetches Notion: the page is matched, not added a second time, and the created date stays
    await page.reload()
    await expect(card(page, TITLE)).toBeVisible()
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(1)
    expect((await storedTasks(page)).filter((t) => t.title === TITLE)).toHaveLength(1)
    expect((await storedTask(page, 'local-open-1'))?.createdAt).toBe(before?.createdAt)

    // 3. Back to Local: the Notion page is archived, the card stays
    await moveViaContextMenu(page, TITLE, 'Lokal')
    await elapseWindow(page)
    await expect.poll(() => archives.length).toBe(1)
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.pendingMove).toBeUndefined()
    await page.reload()
    await expect(card(page, TITLE)).toBeVisible()
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(1)
    expect(await storedTask(page, 'local-open-1')).toMatchObject({ source: 'local', externalId: null })
  })

  test('the entry names the fields a target cannot hold, and is not offered with a single source', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, [{ ...MIXED_SEED_TASKS.find((task) => task.id === 'local-open-1')!, priority: 3, topic: 'Büro' }, ...MIXED_SEED_TASKS.filter((task) => task.source === 'notion')], { defaultSource: 'local' })
    await page.goto(`${baseURL}/tasks`)
    await openCardMenu(page, TITLE)
    // The seed's Notion mapping holds neither priority nor topic
    const notion = page.getByRole('menuitem', { name: /^Notion/ })
    await expect(notion).toContainText('2 Felder gehen verloren')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // A Notion task has Local as its only target; Local holds everything
    await card(page, NOTION_TITLE).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Verschieben nach …' }).click()
    const items = page.getByRole('menuitem', { name: /^Lokal/ })
    await expect(items).toBeVisible()
    await expect(items).not.toContainText('verloren')
    await expect(page.getByRole('menuitem', { name: /^Notion/ })).toHaveCount(0)
  })

  test('Local only: no entry in the card menu, the detail menu or the palette', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks?seed=local`)
    const first = page.locator('#column-open-list .task-wrapper').first()
    await expect(first).toBeVisible()
    await first.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Timebox setzen' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Verschieben nach …' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await first.focus()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeVisible()
    await expect(palette(page).getByText('Verschieben nach Erledigt')).toBeVisible()
    await expect(palette(page).getByText(/Verschieben nach (Notion|Lokal|Todoist)/)).toHaveCount(0)
  })

  test('detail sheet button moves the task; the card keeps its place', async ({ context, page, baseURL }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    const creates = countCalls(page, 'create-task')
    await page.goto(`${baseURL}/tasks/local-open-1`)
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByTestId('task-move-source').click()
    await page.getByRole('menuitem', { name: /^Notion/ }).click()

    await expect(toastText(page, 'Nach Notion verschoben')).toBeVisible()
    await elapseWindow(page)
    await expect.poll(() => creates.length).toBe(1)
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.source).toBe('notion')
    await page.getByTestId('task-move-source').click()
    await expect(page.getByRole('menuitem', { name: /^Lokal/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Notion/ })).toHaveCount(0)
  })

  test('keyboard only: the palette moves the focused card and returns focus to it', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    await page.goto(`${baseURL}/tasks`)
    const target = page.locator('.task-wrapper[data-task-id="local-open-1"]')
    await target.focus()
    // Ctrl+K reads the focused card the instant it fires: wait until the focus has really landed
    await expect(target).toBeFocused()

    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeVisible()
    // Typed keys go to whatever holds focus: wait for the modal to hand it to the search field
    await expect(palette(page).getByPlaceholder('Befehl suchen…')).toBeFocused()
    await expect(palette(page).getByText('Verbindung', { exact: true })).toBeVisible()
    await expect(palette(page).getByRole('option', { name: /Verschieben nach Lokal/ })).toHaveCount(0)
    await page.keyboard.type('Verschieben nach Notion')
    // Enter runs the highlighted row: wait until the filter has settled on the Notion move
    await expect(palette(page).getByRole('option', { name: /Verschieben nach Notion/ })).toHaveAttribute('data-highlighted', '')
    await page.keyboard.press('Enter')

    await expect(palette(page)).toBeHidden()
    await expect(target).toBeFocused()
    await expect(toastText(page, 'Nach Notion verschoben')).toBeVisible()
    // Phase 1 of the move is local and immediate. The upstream create waits for the 5 s undo window; the specs above
    // and below cover it.
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.source).toBe('notion')
    expect((await storedTask(page, 'local-open-1'))?.pendingMove).toMatchObject({ fromSource: 'local', toSource: 'notion' })
  })

  test('a Done task keeps its column, completed date and statistics entry', async ({ context, page, baseURL }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    const creates = countCalls(page, 'create-task')
    const updates = countCalls(page, 'update-task')
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'done').getByText('Lokal: Wäsche erledigt')).toBeVisible()
    const before = await storedTask(page, 'local-done-1')

    await moveViaContextMenu(page, 'Lokal: Wäsche erledigt', 'Notion')
    await elapseWindow(page)
    await expect.poll(() => creates.length).toBe(1)
    // The create does not carry the completed date: one more write does
    await expect.poll(() => updates.length).toBeGreaterThanOrEqual(1)

    await expect(column(page, 'done').getByText('Lokal: Wäsche erledigt')).toHaveCount(1)
    const after = await storedTask(page, 'local-done-1')
    expect(after).toMatchObject({ source: 'notion', status: 3, completedAt: before?.completedAt })
    await expect.poll(async () => (await storedTask(page, 'local-done-1'))?.pendingSync).toBeUndefined()
  })

  test('a task in Jetzt stays there and its timer keeps running through the move', async ({ context, page, baseURL }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedMixedBoard(context, SEED_WITHOUT_JETZT, { defaultSource: 'local', once: true })
    await withoutJetztPage(page)
    const creates = countCalls(page, 'create-task')
    await page.goto(`${baseURL}/tasks`)
    await expect(card(page, TITLE)).toBeVisible()

    await card(page, TITLE).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Status ändern' }).click()
    await page.getByRole('menuitem', { name: 'Jetzt', exact: true }).click()
    await expect(column(page, 'progress').getByText(TITLE)).toBeVisible()
    await elapse(page, 2000) // two ticks of the Jetzt timer
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.timeSpentSeconds ?? 0).toBeGreaterThan(0)

    await moveViaContextMenu(page, TITLE, 'Notion')
    await elapseWindow(page)
    await expect.poll(() => creates.length).toBe(1)
    const atCreate = (await storedTask(page, 'local-open-1'))?.timeSpentSeconds ?? 0
    // Still in Jetzt and still counting after the move has finished
    await expect(column(page, 'progress').getByText(TITLE)).toHaveCount(1)
    await elapse(page, 3000)
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.timeSpentSeconds ?? 0).toBeGreaterThan(atCreate + 1)
    expect(await storedTask(page, 'local-open-1')).toMatchObject({ source: 'notion', status: 1 })
  })

  test('a create refused for good: the task is back in Lokal, nothing deleted, "Erneut versuchen" repeats the move', async ({ context, page, baseURL }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true, notionConfig: { token: createFailToken(400) } })
    const archives = countCalls(page, 'archive-page')
    await page.goto(`${baseURL}/tasks`)
    await expect(card(page, TITLE)).toBeVisible()

    await moveViaContextMenu(page, TITLE, 'Notion')
    await elapseWindow(page)
    await expect(toastText(page, 'Verschieben fehlgeschlagen')).toBeVisible()
    await expect(page.getByText('„Lokal: Einkauf planen“ bleibt in Lokal.', { exact: true })).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.source).toBe('local')
    expect(await storedTask(page, 'local-open-1')).toMatchObject({ externalId: null })
    expect((await storedTask(page, 'local-open-1'))?.pendingMove).toBeUndefined()
    await expect(column(page, 'open').getByText(TITLE)).toHaveCount(1)
    expect(archives).toHaveLength(0)

    await page.getByRole('button', { name: 'Erneut versuchen' }).click()
    await expect(toastText(page, 'Nach Notion verschoben')).toBeVisible()
  })

  test('a refused page (5xx): no failure toast, the card is in Notion with the cloud, nothing deleted', async ({ context, page, baseURL }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true, notionConfig: { token: createFailToken(503) } })
    const archives = countCalls(page, 'archive-page')
    await page.goto(`${baseURL}/tasks`)
    await expect(card(page, TITLE)).toBeVisible()

    await moveViaContextMenu(page, TITLE, 'Notion')
    await elapseWindow(page)
    await expect.poll(async () => (await storedTask(page, 'local-open-1'))?.pendingSync?.attempts).toBeGreaterThanOrEqual(1)

    await expect(card(page, TITLE).locator(CLOUD)).toBeVisible()
    await expect(page.getByText('Verschieben fehlgeschlagen')).toHaveCount(0)
    expect(await storedTask(page, 'local-open-1')).toMatchObject({ source: 'notion', externalId: null, pendingMove: { fromSource: 'local' } })
    // While the move is unfinished the entry is disabled with its reason
    await card(page, TITLE).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Verschieben nach …' }).click()
    const entry = page.getByRole('menuitem', { name: /^Lokal/ })
    await expect(entry).toHaveAttribute('aria-disabled', 'true')
    await expect(entry).toContainText('Wird gespeichert')
    expect(archives).toHaveLength(0)
  })

  test('closing the app inside the undo window is not an undo: the next start commits the move, once', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    const archives = countCalls(page, 'archive-page')
    await page.goto(`${baseURL}/tasks`)
    await expect(card(page, NOTION_TITLE)).toBeVisible()

    await moveViaContextMenu(page, NOTION_TITLE, 'Lokal')
    await expect(toastText(page, 'Nach Lokal verschoben')).toBeVisible()
    await expect.poll(async () => (await storedTask(page, 'page-1'))?.pendingMove?.fromExternalId).toBe('page-1')
    await page.reload()

    await expect.poll(() => archives.length).toBe(1)
    await expect(column(page, 'open').getByText(NOTION_TITLE)).toHaveCount(1)
    await expect.poll(async () => (await storedTask(page, 'page-1'))?.pendingMove).toBeUndefined()
    expect(await storedTask(page, 'page-1')).toMatchObject({ source: 'local', externalId: null })
    await page.reload()
    await expect(column(page, 'open').getByText(NOTION_TITLE)).toHaveCount(1)
    expect((await storedTasks(page)).filter((t) => t.title === NOTION_TITLE)).toHaveLength(1)
  })

  test('deleting a task while its move is outstanding also removes the origin page', async ({ context, page, baseURL }) => {
    await installClock(context) // the undo window runs on the page clock (#543)
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    const archives = countCalls(page, 'archive-page')
    await page.goto(`${baseURL}/tasks`)
    await expect(card(page, NOTION_TITLE)).toBeVisible()

    await moveViaContextMenu(page, NOTION_TITLE, 'Lokal')
    await card(page, NOTION_TITLE).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Löschen' }).click()
    await expect(page.locator('.task-gap')).toContainText('Im Papierkorb')

    await elapseWindow(page)
    await expect.poll(() => archives.length).toBe(1)
    await page.reload()
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()
    await expect(page.getByText(NOTION_TITLE)).toHaveCount(0)
  })
})
