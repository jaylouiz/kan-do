import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { seedMixedBoard, fillerTasks, buildBoardStore, buildTasksStore, DEFAULT_NOTION_SEED_CONFIG, notionStubSessionToken, SEED_TASKS } from './helpers/seed'
import { goToPlace, openSettings } from './helpers/appNav'

/**
 * Connect and disconnect task sources (#320, epic #264 section 1) on the Notion stub. Disconnect is the "Trennen"
 * button of the "Verbindungen" page (#324, its UI spec is `sources-settings.spec.ts`); connect is driven here
 * through the composable the page calls, so the board sequences stay independent of the setup wizard.
 *
 * The mixed seed holds four Notion tasks (the stub's pages, `page-2` in Jetzt) and three Local ones, Notion is
 * the default. "Queued changes" are made by the stub refusing a write with 403 (the page's problem, the
 * source stays healthy) or by aborting the Notion API at the network ("unreachable").
 */

const NOTION_TASKS = ['Fokusaufgabe vorbereiten', 'Review Team Updates', 'Blocker klären', 'Retrospektive nachbereiten']
const LOCAL_TASKS = ['Lokal: Einkauf planen', 'Lokal: Antwort abwarten', 'Lokal: Wäsche erledigt']
const MOVED = 'Fokusaufgabe vorbereiten' // page-1, Offen

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()
const dialog = (page: Page) => page.getByTestId('disconnect-dialog')

const stored = <T>(page: Page, key: string, pick: (raw: Record<string, unknown>) => T) =>
  page.evaluate(({ key: k, pickSrc }) => {
    const raw = JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, unknown>
    return (new Function('raw', `return (${pickSrc})(raw)`))(raw) as unknown
  }, { key, pickSrc: pick.toString() }) as Promise<T>

const storedSources = (page: Page) => stored(page, 'board-store', (raw) => (raw.boardConfig as { sources: unknown }).sources)
const storedTaskIds = (page: Page) => stored(page, 'tasks-store', (raw) => ((raw.tasks as Array<{ id: string }> | undefined) ?? []).map((t) => t.id))
const notionConfigStored = (page: Page) => stored(page, 'notionConfig', (raw) => raw.config ?? null)

/**
 * Connects Notion through the composable the Verbindungen page calls. A spec cannot import it from the Vite dev
 * server's source URL: that exists only under `nuxt dev`, not in a production build (#540). The e2e-seed plugin hands
 * it out as `window.__kandoE2E` (stub builds only).
 */
const connectNotion = (page: Page) =>
  page.evaluate(() => (window as unknown as { __kandoE2E: { connectSource: (id: 'notion') => Promise<unknown> } }).__kandoE2E.connectSource('notion'))

async function moveToWaiting(page: Page, title: string) {
  await card(page, title).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: 'Warten', exact: true }).click()
}

/**
 * Parks the stub's Jetzt task (`page-2`, timed) in Wartet so its time is no second unsynced change, and waits until
 * Notion holds that write. The app pushes a status change a moment after the column updates, so a route or a dialog
 * set up right after the local move can still catch the push (#421: it was refused by the 403 route, "2 Änderungen").
 */
async function parkJetzt(page: Page) {
  const title = 'Review Team Updates'
  await moveToWaiting(page, title)
  await expect(column(page, 'waiting').getByText(title)).toBeVisible()
  await expect.poll(async () => stored(page, 'tasks-store', (raw) => ((raw.tasks as Array<{ id: string; pendingSync?: unknown }>) ?? []).find((t) => t.id === 'page-2')?.pendingSync === undefined)).toBe(true)
}

/** From the board to the Verbindungen page by the gear (client-side, so a running timer keeps ticking). */
async function openDisconnectDialog(page: Page) {
  await openSettings(page, 'sources')
  await page.getByTestId('source-disconnect-notion').click()
  await expect(dialog(page)).toBeVisible()
}

/** The disconnect leaves the user on the Verbindungen page; the board is one back link away. */
async function backToBoard(page: Page) {
  await expect(page).toHaveURL(/\/settings(\?tab=sources)?$/)
  await goToPlace(page, 'Heute')
  await expect(page).toHaveURL(/\/tasks$/)
}

/** A board where `page-1` has a change Notion refuses (403): queued, and the source stays healthy. */
async function boardWithQueuedChange(context: BrowserContext, page: Page, baseURL: string | undefined) {
  await seedMixedBoard(context, undefined, { once: true })
  await page.goto(`${baseURL}/tasks`)
  await expect(column(page, 'open').getByText(MOVED)).toBeVisible()
  // The stub's Jetzt task would be timed too (a second unsynced change): park it in Wartet first
  await parkJetzt(page)
  await page.route('**/api/notion/update-task', (route) => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ statusMessage: 'forbidden' }) }))
  await moveToWaiting(page, MOVED)
  await expect(card(page, MOVED).locator('[data-testid="task-save-pending"]')).toBeVisible() // the page's own push was refused
  await expect.poll(async () => stored(page, 'tasks-store', (raw) => ((raw.tasks as Array<{ id: string; pendingSync?: unknown }>) ?? []).find((t) => t.id === 'page-1')?.pendingSync !== undefined)).toBe(true)
}

test.describe('disconnect Notion (#320)', () => {
  test('without queued changes: states the count and the default fallback, then takes only the Notion tasks off the board', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(MOVED)).toBeVisible()
    // The stub's Jetzt task would be timed (and its time unsynced): park it in Wartet first
    await parkJetzt(page)
    await openDisconnectDialog(page)

    await expect(dialog(page)).toContainText('4 Aufgaben verlassen das Board. Sie bleiben in Notion.')
    await expect(page.getByTestId('disconnect-default-note')).toHaveText('Neue Aufgaben werden danach lokal gespeichert.')
    await expect(page.getByTestId('disconnect-unsynced')).toHaveCount(0)
    await expect(page.getByTestId('disconnect-sync-first')).toHaveCount(0)

    // Button ladder (#552): the footer row aligns items-center, so the md "Abbrechen" stays 32 px next to the 36 px lg "Trennen"
    // (polled: the dialog scales in, so a first read is a few percent short)
    const height = (id: string) => async () => Math.round((await page.getByTestId(id).boundingBox())?.height ?? 0)
    await expect.poll(height('disconnect-cancel')).toBe(32)
    await expect.poll(height('disconnect-anyway')).toBe(36)

    await page.getByTestId('disconnect-anyway').click() // "Trennen"
    await backToBoard(page)
    for (const title of NOTION_TASKS) await expect(page.locator('.task-wrapper', { hasText: title })).toHaveCount(0)
    for (const title of LOCAL_TASKS) await expect(page.locator('.task-wrapper', { hasText: title }).first()).toBeVisible()
    await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })
    await expect.poll(() => notionConfigStored(page)).toBeNull()
    await expect.poll(async () => (await storedTaskIds(page)).sort()).toEqual(['local-done-1', 'local-open-1', 'local-waiting-1'])

    // The reload keeps it: nothing writes the Notion tasks back
    await page.reload()
    await expect(column(page, 'open').getByText('Lokal: Einkauf planen')).toBeVisible()
    await expect(page.locator('.task-wrapper', { hasText: MOVED })).toHaveCount(0)
  })

  test('"Abbrechen" changes nothing', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/tasks`)
    await openDisconnectDialog(page)
    await page.getByTestId('disconnect-cancel').click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByTestId('source-disconnect-notion')).toBeFocused() // focus returns to the trigger
    await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'notion' })
  })

  test('with a queued change, "Erst synchronisieren, dann trennen" pushes it before the tasks leave', async ({ context, page, baseURL }) => {
    await boardWithQueuedChange(context, page, baseURL)
    await openDisconnectDialog(page)
    await expect(page.getByTestId('disconnect-unsynced')).toContainText('1 Änderung ist noch nicht in Notion gespeichert')
    await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible()
    await expect(page.getByTestId('disconnect-anyway')).toHaveText('Trotzdem trennen')

    await page.unroute('**/api/notion/update-task') // Notion takes the write now
    const pushed = page.waitForResponse((res) => res.url().includes('/api/notion/update-task') && res.ok())
    await page.getByTestId('disconnect-sync-first').click()
    await pushed
    await backToBoard(page)
    await expect(page.locator('.task-wrapper', { hasText: MOVED })).toHaveCount(0)
    await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })
  })

  test('"Erst synchronisieren" that Notion refuses keeps the source and its tasks; "Trotzdem trennen" then discards without a write', async ({ context, page, baseURL }) => {
    await boardWithQueuedChange(context, page, baseURL)
    await openDisconnectDialog(page)

    await page.getByTestId('disconnect-sync-first').click()
    await expect(page.getByTestId('disconnect-failure')).toContainText('Nicht alles wurde synchronisiert')
    await expect(dialog(page)).toBeVisible()
    await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'notion' })
    await expect.poll(() => storedTaskIds(page)).toContain('page-1')

    let writes = 0
    await page.unroute('**/api/notion/update-task')
    await page.route('**/api/notion/update-task', (route) => { writes += 1; return route.abort() })
    await page.getByTestId('disconnect-anyway').click()
    await backToBoard(page)
    await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })
    await expect.poll(() => storedTaskIds(page)).not.toContain('page-1')
    await expect.poll(() => writes).toBe(0)
  })

  test('unreachable: only "Trotzdem trennen" or "Abbrechen"; the tasks stay usable until the user decides', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText(MOVED)).toBeVisible()
    await page.route('**/api/notion/**', (route) => route.abort('connectionrefused'))
    await moveToWaiting(page, MOVED)
    await expect(column(page, 'waiting').getByText(MOVED)).toBeVisible() // the move works locally and is queued
    await expect(card(page, MOVED).locator('[data-testid="task-save-pending"]')).toBeVisible()
    await openDisconnectDialog(page)

    await expect(page.getByTestId('disconnect-unsynced')).toContainText('Notion ist gerade nicht erreichbar')
    await expect(page.getByTestId('disconnect-sync-first')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible()
    await page.getByTestId('disconnect-cancel').click()
    await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'notion' }) // never removed on its own

    await page.getByTestId('source-disconnect-notion').click()
    await page.getByTestId('disconnect-anyway').click()
    await backToBoard(page)
    await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })
    for (const title of NOTION_TASKS) await expect(page.locator('.task-wrapper', { hasText: title })).toHaveCount(0)
  })

  test('a running timer in Jetzt stops with the disconnect, its time is pushed first, the task leaves Jetzt with its source', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'progress').getByText('Review Team Updates')).toBeVisible()
    await page.waitForTimeout(2500) // the card's timer ticks and queues time while the board is open
    await openDisconnectDialog(page)

    await expect(page.getByTestId('disconnect-timer-note')).toContainText('Die laufende Zeiterfassung von „Review Team Updates“ wird angehalten.')
    await expect(page.getByTestId('disconnect-unsynced')).toBeVisible()
    const pushed = page.waitForResponse((res) => res.url().includes('/api/notion/update-task') && res.ok())
    await page.getByTestId('disconnect-sync-first').click()
    const body = (await (await pushed).request().postDataJSON()) as { properties?: Record<string, unknown> }
    expect(JSON.stringify(body)).toContain('Aufwand') // the tracked time went upstream
    await backToBoard(page)
    await expect(column(page, 'progress').locator('.task-wrapper')).toHaveCount(0)
    await expect.poll(() => storedTaskIds(page)).not.toContain('page-2')
  })
})

test.describe('connect Notion (#320)', () => {
  test('on a Local board full of tasks: they stay in place, the Notion tasks join their columns, no prompt, the default stays Local', async ({ context, page, baseURL }) => {
    const locals = [...SEED_TASKS.map((t) => ({ ...t, id: `l-${t.id}`, title: `L ${t.title}` })), ...fillerTasks(25, 0)]
    const board = buildBoardStore('local', locals)
    const tasks = buildTasksStore(locals)
    await context.addInitScript(({ b, t, notion }) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('board-store', JSON.stringify(b))
      localStorage.setItem('tasks-store', JSON.stringify(t))
      localStorage.setItem('notionConfig', JSON.stringify({ config: notion })) // set up earlier, not connected yet
    }, { b: board, t: tasks, notion: { ...DEFAULT_NOTION_SEED_CONFIG, token: notionStubSessionToken() } })
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').getByText('Filler 24')).toBeAttached()
    const openBefore = await column(page, 'open').locator('.task-wrapper').allInnerTexts()

    const connected = page.waitForResponse((res) => res.url().includes('/api/notion/query-data-source'))
    const result = await connectNotion(page)
    await connected
    expect(result).toEqual({ ok: true, fetched: true })

    await expect(column(page, 'open').getByText('Fokusaufgabe vorbereiten', { exact: true })).toBeVisible()
    await expect(column(page, 'progress').getByText('Review Team Updates', { exact: true })).toBeVisible()
    await expect(column(page, 'waiting').getByText('Blocker klären', { exact: true })).toBeVisible()
    await expect(page.getByText('Sync-Warnung')).toHaveCount(0)
    // The existing cards keep their order; the new ones sit behind them
    const openAfter = await column(page, 'open').locator('.task-wrapper').allInnerTexts()
    expect(openAfter.slice(0, openBefore.length)).toEqual(openBefore)
    await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'local' })
    await expect.poll(() => stored(page, 'board-store', (raw) => (raw.boardConfig as { pendingSourceSwitch?: boolean }).pendingSourceSwitch ?? false)).toBe(false)
    await expect.poll(async () => (await storedTaskIds(page)).filter((id) => id.startsWith('l-') || id.startsWith('filler-')).length).toBe(locals.length)
  })

  test('disconnect, then reconnect the same database: the tasks come back once', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/tasks`)
    await openDisconnectDialog(page)
    await page.getByTestId('disconnect-anyway').click()
    await backToBoard(page)
    await expect(page.locator('.task-wrapper', { hasText: MOVED })).toHaveCount(0)

    // The setup saves the token and database again, then the page connects
    await page.evaluate(async (notion) => {
      const app = (window as unknown as { useNuxtApp: () => { $pinia: { _s: Map<string, { setConfig: (c: unknown) => void }> }; runWithContext: <T>(fn: () => T) => T } }).useNuxtApp()
      app.$pinia._s.get('notionConfig')?.setConfig(notion)
    }, { ...DEFAULT_NOTION_SEED_CONFIG, token: notionStubSessionToken() })
    const result = await connectNotion(page)
    expect(result).toEqual({ ok: true, fetched: true })
    for (const title of NOTION_TASKS) await expect(page.locator('.task-wrapper', { hasText: title })).toHaveCount(1)
    for (const title of LOCAL_TASKS) await expect(page.locator('.task-wrapper', { hasText: title })).toHaveCount(1)
    await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'local' })
  })
})
