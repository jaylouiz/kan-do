import { readFile } from 'node:fs/promises'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildBoardStore, buildTasksStore, SEED_TASKS } from './helpers/seed'
import { settleAnimations } from './helpers/settle'

/** #238: JSON export/import on the web build, against localStorage. */

const section = (page: Page) => page.getByTestId('data-transfer')

function envelope(tasks: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    writtenAt: '2026-01-02T10:00:00.000Z',
    writtenBy: 'desktop-device',
    appVersion: '0.1.0',
    stores: { 'tasks-store': { tasks }, ...extra },
  })
}

async function pickFile(page: Page, name: string, content: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('data-import').click()
  await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content) })
}

test.describe('Web data export/import (#238)', () => {
  test.beforeEach(async ({ context, page }) => {
    // Seed once per tab: seedLocalBoard re-runs on every load and would overwrite the imported data after the reload.
    await context.addInitScript(({ board, tasks }) => {
      if (sessionStorage.getItem('e2e-seeded')) return
      sessionStorage.setItem('e2e-seeded', '1')
      board.boardConfig = { ...board.boardConfig, todoistApiToken: 'mine' }
      localStorage.setItem('board-store', JSON.stringify(board))
      localStorage.setItem('tasks-store', JSON.stringify(tasks))
    }, { board: buildBoardStore('local'), tasks: buildTasksStore() })
    await page.goto('/settings/data')
    await expect(section(page)).toBeVisible()
  })

  test('exports a dated file without tokens', async ({ page }) => {
    const download = page.waitForEvent('download')
    await page.getByTestId('data-export').click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^kan-do-export-\d{4}-\d{2}-\d{2}\.json$/)
    const text = await readFile(await file.path(), 'utf8')
    expect(text).toContain('seed-open-1')
    expect(text).not.toContain('mine')
    await expect(page.getByTestId('data-transfer-done')).toBeVisible()
  })

  test('shows inline errors for bad files and changes nothing', async ({ page }) => {
    await pickFile(page, 'x.json', 'not json')
    await expect(page.getByTestId('data-transfer-error')).toHaveText('Das ist keine gültige JSON-Datei.')
    await pickFile(page, 'x.json', '{"hello":1}')
    await expect(page.getByTestId('data-transfer-error')).toHaveText('Das ist keine Kan-Do-Exportdatei.')
    await pickFile(page, 'x.json', JSON.stringify({ schemaVersion: 999, writtenAt: '', writtenBy: '', appVersion: '', stores: { 'tasks-store': {} } }))
    await expect(page.getByTestId('data-transfer-error')).toContainText('neueren App-Version')
    expect(await page.evaluate(() => localStorage.getItem('tasks-store'))).toContain('seed-open-1')
  })

  test('cancel in the modal changes nothing', async ({ page }) => {
    await pickFile(page, 'board.json', envelope([]))
    const modal = page.getByTestId('data-restore-modal')
    await expect(modal).toBeVisible()
    await expect(page.getByTestId('data-restore-safety')).toBeChecked()
    await page.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(modal).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('tasks-store'))).toContain('seed-open-1')
  })

  test('imports a pre-change export (taskService, tasks without a source) and normalises it on load (#326)', async ({ page }) => {
    const { source: _source, externalId: _externalId, ...legacyTask } = { ...SEED_TASKS[0]!, id: 'legacy-1', title: 'Legacy task' }
    await pickFile(page, 'old.json', JSON.stringify({
      schemaVersion: 1,
      writtenAt: '2026-01-02T10:00:00.000Z',
      writtenBy: 'desktop-device',
      appVersion: '0.1.0',
      stores: {
        'tasks-store': { ...buildTasksStore([]), tasks: [legacyTask] },
        'board-store': { ...buildBoardStore('local', [legacyTask]), boardConfig: { taskService: 'local' } },
      },
    }))
    await page.getByTestId('data-restore-confirm').click()
    await page.waitForLoadState('load')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tasks-store') ?? '')).toContain('legacy-1')
    await page.goto('/tasks')
    await expect(page.getByText('Legacy task')).toBeVisible()
    const stored = await page.evaluate(() => ({
      board: JSON.parse(localStorage.getItem('board-store') ?? '{}'),
      tasks: JSON.parse(localStorage.getItem('tasks-store') ?? '{}'),
    }))
    expect(stored.board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
    expect(stored.board.boardConfig.taskService).toBeUndefined()
    expect(stored.tasks.tasks[0]).toMatchObject({ id: 'legacy-1', source: 'local', externalId: null })
  })

  test('import replaces the board, downloads a safety copy, keeps tokens and reloads', async ({ page }) => {
    const task = { ...SEED_TASKS[0]!, id: 'imported-1', title: 'Imported task' }
    await pickFile(page, 'board.json', JSON.stringify({
      schemaVersion: 1,
      writtenAt: '2026-01-02T10:00:00.000Z',
      writtenBy: 'desktop-device',
      appVersion: '0.1.0',
      stores: {
        'tasks-store': buildTasksStore([task]),
        'board-store': { ...buildBoardStore('local', [task]), boardConfig: { ...buildBoardStore('local', [task]).boardConfig, todoistApiToken: 'from-file' } },
      },
    }))
    const modal = page.getByTestId('data-restore-modal')
    await expect(page.getByTestId('data-restore-source')).toContainText('1')
    await expect(modal).toContainText('board.json')
    const download = page.waitForEvent('download')
    await page.getByTestId('data-restore-confirm').click()
    const safety = await download
    expect(safety.suggestedFilename()).toMatch(/^kan-do-backup-/)
    expect(await readFile(await safety.path(), 'utf8')).toContain('seed-open-1')
    await page.waitForLoadState('load')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('tasks-store') ?? '')).toContain('imported-1')
    const board = await page.evaluate(() => localStorage.getItem('board-store'))
    expect(board).toContain('"todoistApiToken":"mine"')
    expect(board).not.toContain('from-file')
    await page.goto('/tasks')
    await expect(page.getByText('Imported task')).toBeVisible()
  })

  test('has no serious a11y violations, page and modal', async ({ page }) => {
    const check = async () => {
      await settleAnimations(page)
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([])
    }
    await check()
    await pickFile(page, 'board.json', envelope([]))
    await expect(page.getByTestId('data-restore-modal')).toBeVisible()
    await check()
  })
})
