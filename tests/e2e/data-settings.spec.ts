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
