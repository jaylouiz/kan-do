import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildBoardStore, buildTasksStore, seedLocalBoard, seedNotionBoard } from './helpers/seed'
import { settleAnimations } from './helpers/settle'
import { emitDataStatus, installTauriStub, stubState, type DataStubOptions } from './helpers/tauriStub'
import { openAddSheet } from './helpers/addSheet'

/** #222: the desktop data folder against the stubbed IPC (see helpers/tauriStub.ts). */

const CURRENT = '/Users/test/Library/Application Support/io.github.jaylouiz.kan-do'
const ENVELOPE = (tasks: unknown[], schemaVersion = 2) => ({
  schemaVersion,
  writtenAt: '2026-01-02T10:00:00.000Z',
  writtenBy: 'other-device',
  appVersion: '0.1.0',
  stores: { 'tasks-store': { tasks } },
})

const notice = (page: Page) => page.getByTestId('data-storage-notice')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Datenordner ändern' })

/** A file whose board is configured, so /tasks renders instead of redirecting to the welcome page. */
const BOARD_ENVELOPE = () => ({
  ...ENVELOPE([]),
  stores: { 'board-store': buildBoardStore('local'), 'tasks-store': buildTasksStore() },
})

async function openDataPage(page: Page, data?: DataStubOptions) {
  await installTauriStub(page.context(), data ? { data } : {})
  await page.goto('/settings/data')
  await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
}

async function expectNoSeriousA11yViolations(page: Page) {
  // axe samples colours mid-fade otherwise (modal scale-in)
  await settleAnimations(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking.map(v => `${v.id}: ${v.nodes.map(n => `${n.target.join(' ')} (${n.any[0]?.message ?? ''})`).join(', ')}`)).toEqual([])
}

test.describe('Data folder (web)', () => {
  test('shows only the export/import section and offers no folder command or notice (#238)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/settings/data')
    await expect(page.getByTestId('data-transfer')).toBeVisible()
    await expect(page.getByTestId('data-folder-path')).toHaveCount(0)
    await expect(page.getByTestId('data-folder-change')).toHaveCount(0)
    await expect(notice(page)).toHaveCount(0)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(palette.getByText('Statistik öffnen')).toBeVisible()
    await expect(palette.getByText('Datenordner öffnen')).toHaveCount(0)
    await expect(palette.getByText('Daten exportieren/importieren')).toBeVisible()
  })

  test('keeps persisting in localStorage', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    expect(await page.evaluate(() => localStorage.getItem('tasks-store'))).toContain('seed-open-1')
  })
})

test.describe('Data folder (desktop)', () => {
  test('first run imports localStorage into the data file and leaves localStorage untouched', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)

    const { data } = await stubState(page)
    expect(data.configured).toBe(true)
    const stores = (data.envelope as { stores: Record<string, unknown> }).stores
    expect(JSON.stringify(stores['tasks-store'])).toContain('seed-open-1')
    expect(Object.keys(stores)).toContain('board-store')
    expect(await page.evaluate(() => localStorage.getItem('tasks-store'))).toContain('seed-open-1')
    await expect(notice(page)).toHaveCount(0)
  })

  test('edits go to the data file, not to localStorage, and survive a reload', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)

    await openAddSheet(page)
    await page.locator('input[name="title"]').fill('Persisted in the file')
    await page.locator('input[name="title"]').press('Enter')
    await page.waitForURL(/\/tasks$/)
    await expect.poll(async () => JSON.stringify((await stubState(page)).data.envelope)).toContain('Persisted in the file')
    await page.goto('/tasks')
    await expect(page.getByText('Persisted in the file').first()).toBeVisible()
  })

  test('never writes a token into the data file', async ({ context, page }) => {
    await seedNotionBoard(context)
    await installTauriStub(context)
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
    const fileOf = async () => JSON.stringify((await stubState(page)).data.envelope)
    await expect.poll(fileOf).toContain('notionConfig')
    const file = await fileOf()
    expect(file).not.toContain('notion_test_stub')
  })

  test('the palette opens the page', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('dialog', { name: 'Befehlspalette' }).getByRole('option', { name: 'Datenordner öffnen' }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
  })

  test('the Notion settings header links to the page', async ({ context, page }) => {
    await seedNotionBoard(context)
    await installTauriStub(context)
    await page.goto('/settings/notion')
    await page.getByTestId('notion-data-link').click()
    await expect(page).toHaveURL(/\/settings\/data$/)
  })

  test.describe('page', () => {
    test('shows folder, last save and schema, and the two actions', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]), folder: CURRENT })
      await expect(page.getByTestId('data-folder-path')).toContainText('io.github.jaylouiz.kan-do')
      await expect(page.getByTestId('data-folder-saved')).toContainText('Zuletzt gespeichert')
      await expect(page.getByTestId('data-folder-saved')).toContainText('Schema 2')
      await expect(page.getByRole('button', { name: 'Ordner ändern…' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Im Finder zeigen' })).toBeVisible()
      await expect(notice(page)).toHaveCount(0)
      await expectNoSeriousA11yViolations(page)
      await page.getByRole('button', { name: 'Im Finder zeigen' }).click()
      await expect.poll(async () => (await stubState(page)).calls.map(c => c.cmd)).toContain('data_reveal')
    })

    test('truncates a long path in the middle and keeps the full path available', async ({ page }) => {
      const long = '/Users/test/Library/Mobile Documents/com~apple~CloudDocs/Projects/Example/kan-do-data'
      await openDataPage(page, { envelope: ENVELOPE([]), folder: long })
      const path = page.getByTestId('data-folder-path')
      await expect(path).toHaveAttribute('title', long)
      await expect(path).toContainText('…')
      await expect(path.locator('.sr-only')).toHaveText(long)
    })

    test('newer schema: read-only notice here and on the board', async ({ page }) => {
      await openDataPage(page, { status: 'read-only-newer-schema', envelope: { ...BOARD_ENVELOPE(), schemaVersion: 99 } })
      await expect(notice(page)).toContainText('neueren Version')
      await expect(notice(page).getByRole('link', { name: 'Details' })).toHaveCount(0)
      await expect(page.getByTestId('data-folder-problem')).toContainText('Aktualisiere die App')
      await expectNoSeriousA11yViolations(page)

      await page.goto('/tasks')
      await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
      await expect(notice(page)).toBeVisible()
      await expect(notice(page)).toHaveAttribute('role', 'status')
      await expectNoSeriousA11yViolations(page)
      await notice(page).getByRole('link', { name: 'Details' }).click()
      await expect(page).toHaveURL(/\/settings\/data$/)
    })

    test('corrupt file: only "Ordner wählen…" is offered', async ({ page }) => {
      await openDataPage(page, { status: 'read-only-corrupt', envelope: ENVELOPE([]) })
      await expect(notice(page)).toContainText('nicht lesbar')
      await expect(page.getByRole('button', { name: 'Ordner wählen…' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Hier neu beginnen' })).toHaveCount(0)
    })

    test('missing file: "Hier neu beginnen" recreates it and the notice goes away', async ({ page }) => {
      await openDataPage(page, { status: 'missing-file', envelope: ENVELOPE([]) })
      await expect(notice(page)).toContainText('fehlt')
      await expectNoSeriousA11yViolations(page)
      await page.getByRole('button', { name: 'Hier neu beginnen' }).click()
      await expect(notice(page)).toHaveCount(0)
      await expect(page.getByTestId('data-folder-problem')).toHaveCount(0)
      expect((await stubState(page)).calls.map(c => c.cmd)).toContain('data_init')
    })

    test('write failure shows an error notice and clears when the write succeeds again', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]) })
      await emitDataStatus(page, { status: 'write-failed', error: 'No space left on device' })
      await expect(notice(page)).toContainText('Speichern fehlgeschlagen')
      await expect(page.getByTestId('data-folder-problem')).toContainText('No space left on device')
      await expectNoSeriousA11yViolations(page)
      await emitDataStatus(page, { status: 'ok', error: null })
      await expect(notice(page)).toHaveCount(0)
    })
  })

  test.describe('changing the folder', () => {
    const TARGET = '/Users/test/Dropbox/kan-do'

    test('cancelling the picker changes nothing', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]), pick: null })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      await expect(dialog(page)).toHaveCount(0)
      expect((await stubState(page)).data.folder).toBe(CURRENT)
    })

    test('an empty folder gets a copy without a reload, the old file stays', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([{ id: 'a' }]), pick: TARGET, folders: { [TARGET]: {} } })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      await expect(dialog(page)).toBeVisible()
      await expect(dialog(page).getByTestId('data-folder-target')).toHaveText(TARGET)
      await expect(dialog(page)).toContainText('Meine Daten hierher kopieren')
      await expectNoSeriousA11yViolations(page)
      await dialog(page).getByRole('button', { name: 'Meine Daten hierher kopieren' }).click()
      await expect(dialog(page)).toHaveCount(0)
      await expect(page.getByTestId('data-folder-path')).toContainText('Dropbox')
      const { data, calls } = await stubState(page)
      expect(data.folder).toBe(TARGET)
      expect(JSON.stringify(data.folders[TARGET]?.envelope)).toContain('"id":"a"')
      expect(calls.filter(c => c.cmd === 'data_set_location').map(c => c.args.mode)).toEqual(['move'])
    })

    test('cancelling the modal changes nothing', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]), pick: TARGET, folders: { [TARGET]: {} } })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      await dialog(page).getByRole('button', { name: 'Abbrechen' }).click()
      await expect(dialog(page)).toHaveCount(0)
      expect((await stubState(page)).data.folder).toBe(CURRENT)
    })

    test('a folder that holds data: "use" switches and reloads the window', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]), pick: TARGET, folders: { [TARGET]: { envelope: ENVELOPE([{ id: 'theirs' }]) } } })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      const group = dialog(page).getByRole('radiogroup', { name: /vorhandenen Daten/ })
      await expect(group.getByRole('radio', { name: 'Vorhandene Daten verwenden' })).toBeChecked()
      await expectNoSeriousA11yViolations(page)
      const reloaded = page.waitForEvent('load')
      await dialog(page).getByRole('button', { name: 'Weiter' }).click()
      await reloaded
      await expect(page.getByTestId('data-folder-path')).toContainText('Dropbox')
      expect(JSON.stringify((await stubState(page)).data.envelope)).toContain('theirs')
    })

    test('"replace" needs an explicit confirm step', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([{ id: 'mine' }]), pick: TARGET, folders: { [TARGET]: { envelope: ENVELOPE([{ id: 'theirs' }]) } } })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      await dialog(page).getByRole('radio', { name: /ersetzen/ }).check()
      await dialog(page).getByRole('button', { name: 'Weiter' }).click()
      await expect(dialog(page).getByTestId('data-folder-confirm')).toContainText('überschrieben')
      expect((await stubState(page)).calls.some(c => c.cmd === 'data_set_location')).toBe(false)

      await dialog(page).getByRole('button', { name: 'Zurück' }).click()
      await expect(dialog(page).getByRole('radio', { name: /ersetzen/ })).toBeVisible()
      await dialog(page).getByRole('button', { name: 'Weiter' }).click()
      await dialog(page).getByRole('button', { name: 'Ersetzen' }).click()
      await expect(dialog(page)).toHaveCount(0)
      const { data, calls } = await stubState(page)
      expect(JSON.stringify(data.folders[TARGET]?.envelope)).toContain('mine')
      expect(calls.filter(c => c.cmd === 'data_set_location').map(c => c.args.mode)).toEqual(['replace'])
    })

    test('a folder that is not writable is refused inline', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]), pick: TARGET, folders: { [TARGET]: { writable: false } } })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      await expect(dialog(page).getByRole('alert')).toContainText('nicht geschrieben werden')
      await expect(dialog(page).getByTestId('data-folder-continue')).toBeDisabled()
    })

    test('an unreadable file in the target is refused inline', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]), pick: TARGET, folders: { [TARGET]: { corrupt: true } } })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      await expect(dialog(page).getByRole('alert')).toContainText('nicht lesbar')
      await expect(dialog(page).getByTestId('data-folder-continue')).toBeDisabled()
    })

    test('Escape closes the modal and returns focus to the page', async ({ page }) => {
      await openDataPage(page, { envelope: ENVELOPE([]), pick: TARGET, folders: { [TARGET]: {} } })
      await page.getByRole('button', { name: 'Ordner ändern…' }).click()
      await expect(dialog(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog(page)).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Ordner ändern…' })).toBeFocused()
    })
  })
})

/** kd#227: "App zurücksetzen" in Daten & Speicher and in the command palette (web: localStorage, desktop: the stubbed IPC). */
const resetPanel = (page: Page) => page.getByTestId('reset-panel')
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette' })
const ALL_ENTRIES = { 'notion-token': 'n', 'todoist-token': 't', 'github-updates': 'u', 'github-feedback': 'f' }

test.describe('App reset (web)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, undefined, undefined, undefined, { once: true })
    await context.addInitScript(() => {
      if (sessionStorage.getItem('e2e-reset-seeded')) return
      sessionStorage.setItem('e2e-reset-seeded', '1')
      localStorage.setItem('statistics-backfill-state', '{"done":true}')
      localStorage.setItem('kando-locale', 'de')
    })
  })

  test('the section asks in place, names the consequences, focus starts on Abbrechen; Enter and Esc cancel', async ({ page }) => {
    await page.goto('/settings/data')
    await page.getByTestId('data-reset-open').click()
    await expect(resetPanel(page)).toBeVisible()
    await expect(page.getByTestId('reset-erased')).toContainText('Gelöscht werden')
    await expect(page.getByTestId('reset-note')).toContainText('Änderungen, die noch nicht synchronisiert sind')
    await expect(page.getByTestId('reset-note')).toContainText('lässt sich nicht rückgängig machen')
    await expect(page.getByRole('dialog')).toHaveCount(0) // never a modal (DESIGN.md: irreversible actions confirm in place)
    await expect(page.getByTestId('reset-cancel')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(resetPanel(page)).toBeHidden()
    await expect(page.getByTestId('data-reset-open')).toBeFocused()
    await page.getByTestId('data-reset-open').click()
    await expect(page.getByTestId('reset-cancel')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(resetPanel(page)).toBeHidden()
    await expect(page.getByTestId('data-reset-open')).toBeFocused()
    expect(await page.evaluate(() => localStorage.getItem('tasks-store'))).toContain('seed-open-1')
  })

  test('confirming erases the data, tokens and backfill marker, keeps the language and lands on the welcome page', async ({ page }) => {
    await page.goto('/settings/data')
    await page.evaluate(() => {
      const board = JSON.parse(localStorage.getItem('board-store') as string)
      board.boardConfig = { ...board.boardConfig, todoistApiToken: 'secret-token' }
      localStorage.setItem('board-store', JSON.stringify(board))
    })
    await page.getByTestId('data-reset-open').click()
    await page.getByTestId('reset-confirm').click()
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(page.getByTestId('welcome-photo')).toBeAttached()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tasks-store') ?? '')).not.toContain('seed-open-1')
    expect(await page.evaluate(() => localStorage.getItem('board-store') ?? '')).not.toContain('secret-token')
    expect(await page.evaluate(() => localStorage.getItem('statistics-backfill-state'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('kando-locale'))).toBe('de')
  })

  test('from the palette on another page: goes to Daten & Speicher with the question open; Enter changes nothing', async ({ page }) => {
    await page.goto('/statistics')
    await expect(page.getByTestId('app-nav')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeVisible()
    await page.keyboard.type('zurücksetzen')
    await expect(palette(page).locator('[role="option"][data-highlighted]')).toHaveText(/App zurücksetzen/)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/settings\/data$/)
    await expect(resetPanel(page)).toBeVisible()
    await expect(page.getByTestId('reset-cancel')).toBeFocused()
    await page.keyboard.press('Enter') // a repeated Enter from the palette must not confirm
    await expect(resetPanel(page)).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('tasks-store'))).toContain('seed-open-1')
  })
})

test.describe('App reset (desktop)', () => {
  const openReset = async (page: Page) => {
    await page.getByTestId('data-reset-open').click()
    await expect(resetPanel(page)).toBeVisible()
  }

  test('keeps a pre-restore backup, empties the data file, deletes every Keychain entry and lands on the welcome page', async ({ context, page }) => {
    await installTauriStub(context, { data: { envelope: BOARD_ENVELOPE() }, entries: ALL_ENTRIES })
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
    await openReset(page)
    await expect(page.getByTestId('reset-kept')).toContainText('legt die App eine Sicherung an')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByTestId('reset-confirm').click()
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(page.getByTestId('welcome-photo')).toBeAttached()
    const state = await stubState(page)
    expect(JSON.stringify(state.data.envelope)).not.toContain('tasks-store')
    expect(JSON.stringify(state.data.backups)).toContain('pre-restore')
    expect(state.entries).toEqual({})
  })

  test('a failed backup erases nothing and says so', async ({ context, page }) => {
    await installTauriStub(context, { data: { envelope: BOARD_ENVELOPE(), failBackup: true }, entries: ALL_ENTRIES })
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
    await openReset(page)
    await page.getByTestId('reset-confirm').click()
    await expect(page.getByTestId('reset-failure')).toContainText('Es wurde nichts gelöscht')
    await expect(page).toHaveURL(/\/settings\/data$/)
    const state = await stubState(page)
    expect(JSON.stringify(state.data.envelope)).toContain('tasks-store')
    expect(Object.keys(state.entries)).toHaveLength(4)
    await expect(page.getByTestId('reset-confirm')).toBeEnabled()
  })

  test('a refused Keychain keeps the dialog open, names the tokens and the retry finishes', async ({ context, page }) => {
    await installTauriStub(context, { data: { envelope: BOARD_ENVELOPE() }, entries: ALL_ENTRIES, keychainError: true })
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
    await openReset(page)
    await page.getByTestId('reset-confirm').click()
    await expect(page.getByTestId('reset-failure')).toContainText('Notion, Todoist, GitHub')
    await expect(page).toHaveURL(/\/settings\/data$/)
    expect(JSON.stringify((await stubState(page)).data.envelope)).not.toContain('tasks-store') // the data is already gone
    await expect(page.getByTestId('reset-confirm')).toHaveText('Erneut versuchen')

    await page.evaluate(() => { (window as unknown as { __tauriStub: { keychainError: boolean } }).__tauriStub.keychainError = false })
    await page.getByTestId('reset-confirm').click()
    await expect(page).toHaveURL(/\/welcome$/)
    expect((await stubState(page)).entries).toEqual({})
  })

  test('is off, with the reason, while the data folder is unavailable', async ({ context, page }) => {
    await installTauriStub(context, { data: { status: 'folder-unavailable', envelope: BOARD_ENVELOPE() } })
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
    await expect(page.getByTestId('data-reset-open')).toBeDisabled()
    await expect(page.getByTestId('data-reset-blocked')).toContainText('Datenordner ist nicht erreichbar')
  })

  test('has no serious a11y violations on the section and its open question', async ({ context, page }) => {
    await installTauriStub(context, { data: { envelope: BOARD_ENVELOPE() } })
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
    await expectNoSeriousA11yViolations(page)
    await openReset(page)
    await expectNoSeriousA11yViolations(page)
  })
})
