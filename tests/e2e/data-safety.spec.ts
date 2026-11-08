import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildBoardStore, buildTasksStore, SEED_TASKS } from './helpers/seed'
import { settleAnimations } from './helpers/settle'
import { emitDataStatus, installTauriStub, stubState, type BackupStub, type CloudSyncStub, type DataStubOptions } from './helpers/tauriStub'
import { openAddSheet } from './helpers/addSheet'

/** #224: backups, restore, cloud-sync conflicts, the unavailable folder and export/import (stubbed IPC). */

const CURRENT = '/Users/test/Library/Application Support/io.github.jaylouiz.kan-do'

const envelope = (tasks: unknown[], extra: Record<string, unknown> = {}, schemaVersion = 2) => ({
  schemaVersion,
  writtenAt: '2026-10-24T09:12:00.000Z',
  writtenBy: 'other-device',
  appVersion: '0.1.0',
  stores: { 'tasks-store': { tasks }, ...extra },
})

const tasks = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `t${index}` }))

/** A file whose board is configured, so /tasks renders instead of redirecting to the welcome page. */
const boardEnvelope = (taskList = SEED_TASKS) => ({
  ...envelope([]),
  stores: { 'board-store': buildBoardStore('local'), 'tasks-store': buildTasksStore(taskList) },
})

const backup = (patch: Partial<BackupStub> & Pick<BackupStub, 'name' | 'kind' | 'ts'>): BackupStub => ({
  device6: 'e2e000',
  ownDevice: true,
  taskCount: 23,
  schemaVersion: 1,
  readable: true,
  envelope: envelope(tasks(patch.taskCount ?? 23)),
  ...patch,
})

const notice = (page: Page) => page.getByTestId('data-storage-notice')
const conflictDialog = (page: Page) => page.getByRole('dialog', { name: 'Daten wurden anderswo geändert' })
const rows = (page: Page) => page.getByTestId('data-backup-row')

async function openDataPage(page: Page, data: DataStubOptions = {}) {
  await installTauriStub(page.context(), { data: { folder: CURRENT, envelope: envelope(tasks(25)), ...data } })
  await page.goto('/settings/data')
  await expect(page.getByRole('heading', { name: 'Datenordner', level: 2 })).toBeVisible()
}

async function expectNoSeriousA11yViolations(page: Page) {
  await settleAnimations(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking.map(v => `${v.id}: ${v.nodes.map(n => `${n.target.join(' ')} (${n.any[0]?.message ?? ''})`).join(', ')}`)).toEqual([])
}

const calls = async (page: Page) => (await stubState(page)).calls.map(call => call.cmd)

/**
 * `stubState` for a read right after a restore or import. Both end in `window.location.reload()`, and the rows the specs wait
 * for are already on screen before that navigation commits, so a bare `page.evaluate` can land in it and throw "Execution
 * context was destroyed" (#442; measured: about 1 read in 100 during the reload). The stub state lives in `sessionStorage`
 * and survives the reload, so retrying until a read succeeds returns the same answer.
 */
async function stubStateAcrossReload(page: Page): Promise<Awaited<ReturnType<typeof stubState>>> {
  let state: Awaited<ReturnType<typeof stubState>> | null = null
  await expect.poll(async () => {
    state = await stubState(page).catch(() => null)
    return state !== null
  }).toBe(true)
  return state!
}

test.describe('Backups', () => {
  test('first start: an empty list says so and the section is accessible', async ({ page }) => {
    await openDataPage(page)
    await expect(page.getByRole('heading', { name: 'Sicherungen', level: 2 })).toBeVisible()
    await expect(page.getByTestId('data-backups-empty')).toContainText('Noch keine Sicherungen')
    await expect(page.getByTestId('data-backups-last')).toHaveText('Noch keine Sicherung')
    await expect(rows(page)).toHaveCount(0)
    await expect(page.getByTestId('data-copies')).toHaveCount(0)
    await expectNoSeriousA11yViolations(page)
  })

  test('lists newest first with kind, origin and task count; unreadable and newer-schema rows get no restore', async ({ page }) => {
    await openDataPage(page, {
      backups: [
        backup({ name: 'a.json', kind: 'daily', ts: '2026-10-24T09:12:00.000Z', taskCount: 25 }),
        backup({ name: 'b.json', kind: 'pre-migration', ts: '2026-10-23T18:40:00.000Z', taskCount: 24 }),
        backup({ name: 'c.json', kind: 'conflict', ts: '2026-10-22T11:30:00.000Z', taskCount: 22, ownDevice: false }),
        backup({ name: 'd.json', kind: 'manual', ts: '2026-10-21T11:30:00.000Z', readable: false, taskCount: null }),
        backup({ name: 'e.json', kind: 'daily', ts: '2026-10-20T11:30:00.000Z', schemaVersion: 99 }),
      ],
    })
    await expect(rows(page)).toHaveCount(5)
    await expect(rows(page).nth(0)).toContainText('Täglich')
    await expect(rows(page).nth(0)).toContainText('25 Aufgaben')
    await expect(rows(page).nth(1)).toContainText('Vor Migration')
    await expect(rows(page).nth(2)).toContainText('Andere Version (Konflikt)')
    await expect(rows(page).nth(2)).toContainText('anderes Gerät')
    await expect(rows(page).nth(3).getByTestId('data-backup-unreadable')).toHaveText('nicht lesbar')
    await expect(rows(page).nth(3).getByRole('button')).toHaveCount(0)
    await expect(rows(page).nth(4).getByRole('button', { name: 'App aktualisieren' })).toBeDisabled()
    await expect(rows(page).nth(0).getByRole('button', { name: 'Wiederherstellen' })).toBeVisible()
    await expect(page.getByTestId('data-backups-last')).toContainText('Letzte Sicherung')
    await expectNoSeriousA11yViolations(page)
  })

  test('shows the newest 8 and the rest on demand', async ({ page }) => {
    const many = Array.from({ length: 11 }, (_, index) =>
      backup({ name: `m${index}.json`, kind: 'daily', ts: `2026-10-${String(10 + index).padStart(2, '0')}T09:00:00.000Z` }))
    await openDataPage(page, { backups: many })
    await expect(rows(page)).toHaveCount(8)
    await page.getByTestId('data-backups-toggle').click()
    await expect(rows(page)).toHaveCount(11)
    await expect(page.getByTestId('data-backups-toggle')).toHaveText('Weniger anzeigen')
    await page.getByTestId('data-backups-toggle').click()
    await expect(rows(page)).toHaveCount(8)
  })

  test('"Jetzt sichern" adds a manual backup to the list', async ({ page }) => {
    await openDataPage(page)
    await page.getByTestId('data-backup-now').click()
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('Manuell')
    await expect(page.getByTestId('data-backups-last')).toContainText('Letzte Sicherung:')
    expect(await calls(page)).toContain('data_backup')
  })

  test('a failing backup shows an orange line and does not touch saving', async ({ page }) => {
    await openDataPage(page, { failBackup: true })
    await page.getByTestId('data-backup-now').click()
    await expect(page.getByTestId('data-backup-error')).toContainText('Sicherung nicht möglich. Details: disk full')
    await expect(notice(page)).toHaveCount(0)
    await expectNoSeriousA11yViolations(page)
  })

  test('a backup error reported by Rust shows the same line', async ({ page }) => {
    await openDataPage(page)
    await emitDataStatus(page, { backupError: 'No space left on device' })
    await expect(page.getByTestId('data-backup-error')).toContainText('No space left on device')
    await emitDataStatus(page, { backupError: null })
    await expect(page.getByTestId('data-backup-error')).toHaveCount(0)
  })
})

test.describe('Restore', () => {
  const OLD = backup({ name: 'old.json', kind: 'daily', ts: '2026-10-23T08:05:00.000Z', taskCount: 23 })

  test('the modal compares the backup with now; Cancel changes nothing and returns focus', async ({ page }) => {
    await openDataPage(page, { backups: [OLD] })
    await page.evaluate(() => {
      const w = window as unknown as { __importFocusCalls: number }
      w.__importFocusCalls = 0
      const focus = HTMLElement.prototype.focus
      HTMLElement.prototype.focus = function (this: HTMLElement, ...args) {
        if (this.dataset.testid === 'data-import') w.__importFocusCalls++
        return focus.apply(this, args)
      }
    })
    const opener = rows(page).first().getByRole('button', { name: 'Wiederherstellen' })
    await opener.click()
    const dialog = page.getByRole('dialog', { name: /Stand vom .* wiederherstellen/ })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('data-restore-source')).toHaveText('23 Aufgaben')
    await expect(dialog.getByTestId('data-restore-current')).toContainText('Aufgaben')
    await expect(dialog).toContainText('Der aktuelle Stand wird vorher gesichert.')
    await expectNoSeriousA11yViolations(page)
    await dialog.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
    // The web-import focus return (#238) must not run for a desktop restore, whatever the timing against the modal's own focus return.
    expect(await page.evaluate(() => (window as unknown as { __importFocusCalls: number }).__importFocusCalls)).toBe(0)
    expect(await calls(page)).not.toContain('data_restore')
  })

  test('confirming replaces the file, reloads, and the pre-restore backup is in the list', async ({ page }) => {
    await openDataPage(page, { backups: [OLD] })
    await rows(page).first().getByRole('button', { name: 'Wiederherstellen' }).click()
    await page.getByTestId('data-restore-confirm').click()
    await expect(rows(page)).toHaveCount(2)
    await expect(rows(page).filter({ hasText: 'Vor Wiederherstellung' })).toHaveCount(1)
    const state = await stubStateAcrossReload(page)
    const order = state.calls.map(call => call.cmd)
    expect(order.indexOf('data_flush')).toBeLessThan(order.lastIndexOf('data_restore'))
    expect(state.data.generation).toBeGreaterThan(1)
    // The restore can itself be reverted from the list.
    await rows(page).filter({ hasText: 'Vor Wiederherstellung' }).getByRole('button', { name: 'Wiederherstellen' }).click()
    await expect(page.getByTestId('data-restore-source')).toHaveText('25 Aufgaben')
  })

  test('a failed pre-restore backup stops the restore and says so inline', async ({ page }) => {
    await openDataPage(page, { backups: [OLD], failBackup: true })
    await rows(page).first().getByRole('button', { name: 'Wiederherstellen' }).click()
    await page.getByTestId('data-restore-confirm').click()
    await expect(page.getByTestId('data-restore-error')).toContainText('konnte nicht gesichert werden')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectNoSeriousA11yViolations(page)
  })
})

test.describe('Conflict', () => {
  const THEIRS = () => ({ ...envelope(tasks(31)), writtenAt: '2026-10-24T09:12:00.000Z' })

  async function openBoardInConflict(page: Page, data: DataStubOptions = {}) {
    await installTauriStub(page.context(), {
      data: { folder: CURRENT, envelope: boardEnvelope(), theirs: THEIRS(), ...data },
    })
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await emitDataStatus(page, { status: 'conflict' })
  }

  test('with edits of mine: the notice, the auto-opened modal and "Später" that keeps the conflict', async ({ page }) => {
    await openBoardInConflict(page)
    await expect(notice(page)).toContainText('Die Daten wurden anderswo geändert. Es wird nichts gespeichert.')
    await expect(notice(page)).toHaveAttribute('role', 'status')
    const dialog = conflictDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('data-conflict-theirs')).toContainText('anderes Gerät')
    await expect(dialog.getByTestId('data-conflict-theirs')).toContainText('31 Aufgaben')
    await expect(dialog.getByTestId('data-conflict-mine')).toContainText('ungespeicherte Änderungen')
    await expect(dialog).toContainText('Beide bleiben in den Sicherungen.')
    await expectNoSeriousA11yViolations(page)

    await dialog.getByRole('button', { name: 'Später' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(notice(page)).toBeVisible()
    // The app keeps working from memory and does not reopen by itself.
    await page.waitForTimeout(300)
    await expect(dialog).toHaveCount(0)
    await notice(page).getByRole('button', { name: 'Lösen' }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(notice(page)).toBeVisible()
  })

  test('"Diese Version behalten" files their version in the backups and clears the notice', async ({ page }) => {
    await openBoardInConflict(page)
    await conflictDialog(page).getByRole('button', { name: 'Diese Version behalten' }).click()
    await expect(conflictDialog(page)).toHaveCount(0)
    await expect(notice(page)).toHaveCount(0)
    const state = await stubState(page)
    expect(state.data.backups.map(b => b.kind)).toEqual(['conflict'])
    expect(state.data.status).toBe('ok')
  })

  test('"Andere Version laden" keeps mine as unsaved, then reloads on their file', async ({ page }) => {
    const theirs = { ...boardEnvelope([{ ...SEED_TASKS[0]!, id: 'their-task', title: 'Their task' }]) }
    await openBoardInConflict(page, { theirs })
    await conflictDialog(page).getByRole('button', { name: 'Andere Version laden' }).click()
    await expect(page.getByText('Their task').first()).toBeVisible()
    const state = await stubState(page)
    expect(state.data.backups.map(b => b.kind)).toEqual(['unsaved'])
    await expect(notice(page)).toHaveCount(0)
  })

  test('a failed backup stops "Andere Version laden" and the window does not reload', async ({ page }) => {
    await openBoardInConflict(page, { failBackup: true })
    await conflictDialog(page).getByRole('button', { name: 'Andere Version laden' }).click()
    await expect(page.getByTestId('data-conflict-error')).toContainText('Es wurde nichts verändert')
    await expect(conflictDialog(page)).toBeVisible()
    expect((await stubState(page)).data.status).toBe('conflict')
    await expectNoSeriousA11yViolations(page)
  })

  test('without edits of mine the choice collapses to "Neu laden"', async ({ page }) => {
    await openBoardInConflict(page, { localChanges: false, theirs: boardEnvelope() })
    const dialog = conflictDialog(page)
    await expect(dialog.getByRole('button', { name: 'Neu laden' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Diese Version behalten' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Andere Version laden' })).toHaveCount(0)
    await expect(dialog).toContainText('keine ungespeicherten Änderungen')
    await dialog.getByRole('button', { name: 'Neu laden' }).click()
    await expect(notice(page)).toHaveCount(0)
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    expect((await stubState(page)).data.backups).toEqual([])
  })

  test('the settings page explains the state and offers "Lösen"', async ({ page }) => {
    await installTauriStub(page.context(), { data: { folder: CURRENT, envelope: envelope(tasks(2)), theirs: THEIRS() } })
    await page.goto('/settings/data')
    await emitDataStatus(page, { status: 'conflict' })
    await expect(page.getByTestId('data-folder-problem')).toContainText('Die Daten wurden anderswo geändert')
    await conflictDialog(page).getByRole('button', { name: 'Später' }).click()
    await page.getByTestId('data-folder-resolve').click()
    await expect(conflictDialog(page)).toBeVisible()
    await expect(page.getByTestId('data-backups')).toBeVisible()
  })
})

test.describe('Folder unavailable', () => {
  test('mid-session: an error notice, the plain sentence on the page, and recovery through "Erneut versuchen"', async ({ page }) => {
    await openDataPage(page, { retryRecovers: true })
    await emitDataStatus(page, { status: 'folder-unavailable', error: 'No such file or directory' })
    await expect(notice(page)).toContainText('Datenordner nicht erreichbar. Das angezeigte Board ist nicht deine gespeicherte Version.')
    await expect(page.getByTestId('data-folder-problem')).toContainText('nicht deine gespeicherte Version')
    await expect(page.getByTestId('data-backups')).toHaveCount(0)
    await expectNoSeriousA11yViolations(page)
    await notice(page).getByRole('button', { name: 'Erneut versuchen' }).click()
    await expect(notice(page)).toHaveCount(0)
    await expect(page.getByTestId('data-backups')).toBeVisible()
    expect(await calls(page)).toContain('data_retry')
  })

  test('the page offers a retry and the folder picker', async ({ page }) => {
    await openDataPage(page)
    await emitDataStatus(page, { status: 'folder-unavailable', error: 'offline' })
    await expect(page.getByTestId('data-folder-retry')).toBeVisible()
    await expect(page.getByTestId('data-folder-choose')).toBeVisible()
    await page.getByTestId('data-folder-retry').click()
    await expect.poll(async () => (await calls(page)).filter(cmd => cmd === 'data_retry').length).toBe(1)
    await expect(notice(page)).toBeVisible()
  })

  test('at launch: stores hydrate empty and the notice is shown on the screen the app lands on', async ({ page }) => {
    await installTauriStub(page.context(), { data: { status: 'folder-unavailable', folder: CURRENT, envelope: boardEnvelope() } })
    await page.goto('/tasks')
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(notice(page)).toHaveCount(1)
    await expect(notice(page)).toContainText('nicht deine gespeicherte Version')
    const state = await stubState(page)
    expect(state.calls.filter(call => call.cmd === 'data_init')).toHaveLength(0)
  })
})

test.describe('Conflict copies', () => {
  const COPIES = [
    { name: 'kan-do-data 2.json', writtenAt: '2026-10-22T09:00:00.000Z', taskCount: 21, envelope: envelope(tasks(21)) },
    { name: "kan-do-data (Julius's MacBook's conflicted copy 2026-10-24).json", writtenAt: '2026-10-24T09:00:00.000Z', taskCount: 30, envelope: envelope(tasks(30)) },
  ]

  test('are listed with date and count and raise a non-blocking warning', async ({ page }) => {
    await openDataPage(page, { conflictCopies: COPIES })
    const section = page.getByTestId('data-copies')
    await expect(section.getByRole('heading', { name: 'Konflikt-Kopien' })).toBeVisible()
    await expect(page.getByTestId('data-copy-row')).toHaveCount(2)
    await expect(page.getByTestId('data-copy-row').first()).toContainText('21 Aufgaben')
    await expect(notice(page)).toContainText('Konflikt-Kopien')
    await expect(page.getByTestId('data-folder-problem')).toHaveCount(0)
    await expectNoSeriousA11yViolations(page)
  })

  test('"Ablegen" moves the copy into the backups; nothing is deleted', async ({ page }) => {
    await openDataPage(page, { conflictCopies: COPIES })
    await page.getByTestId('data-copy-row').first().getByRole('button', { name: 'Ablegen' }).click()
    await expect(page.getByTestId('data-copy-row')).toHaveCount(1)
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('Andere Version (Konflikt)')
    await page.getByTestId('data-copy-row').first().getByRole('button', { name: 'Ablegen' }).click()
    await expect(page.getByTestId('data-copies')).toHaveCount(0)
    await expect(notice(page)).toHaveCount(0)
  })

  test('"Wiederherstellen" runs the restore flow with the copy as source', async ({ page }) => {
    await openDataPage(page, { conflictCopies: COPIES })
    await page.getByTestId('data-copy-row').first().getByRole('button', { name: 'Wiederherstellen' }).click()
    await expect(page.getByTestId('data-restore-source')).toHaveText('21 Aufgaben')
    await page.getByTestId('data-restore-confirm').click()
    await expect(rows(page).filter({ hasText: 'Vor Wiederherstellung' })).toHaveCount(1)
  })
})

test.describe('Export and import', () => {
  test('export: the save dialog decides; cancelling writes nothing', async ({ page }) => {
    await openDataPage(page)
    await page.getByTestId('data-export').click()
    await expect.poll(async () => (await calls(page)).includes('plugin:dialog|save')).toBe(true)
    expect((await stubState(page)).data.exported).toBeNull()
    await expect(page.getByTestId('data-transfer-done')).toHaveCount(0)
  })

  test('export writes the current state as plain JSON without a secret', async ({ page }) => {
    await openDataPage(page, {
      saveTarget: '/Users/test/Desktop/kan-do-export.json',
      envelope: envelope(tasks(3), { notionConfig: { config: { token: 'ntn_SECRET_TOKEN_1234', databaseId: 'db-1' } } }),
    })
    await page.getByTestId('data-export').click()
    await expect(page.getByTestId('data-transfer-done')).toHaveText('Exportiert.')
    const exported = (await stubState(page)).data.exported
    expect(exported?.path).toBe('/Users/test/Desktop/kan-do-export.json')
    expect(exported?.contents).not.toContain('ntn_SECRET_TOKEN_1234')
    const parsed = JSON.parse(exported?.contents ?? '{}')
    expect(parsed.stores['tasks-store'].tasks).toHaveLength(3)
    expect(parsed.stores.notionConfig.config.databaseId).toBe('db-1')
  })

  test('import: invalid, foreign and newer files are refused inline and change nothing', async ({ page }) => {
    const files = {
      '/in/junk.json': 'nope',
      '/in/foreign.json': JSON.stringify({ hello: 'world' }),
      '/in/newer.json': JSON.stringify(envelope(tasks(1), {}, 99)),
    }
    await openDataPage(page, { importFiles: files })
    for (const [path, message] of [
      ['/in/junk.json', 'keine gültige JSON-Datei'],
      ['/in/foreign.json', 'keine Kan-Do-Exportdatei'],
      ['/in/newer.json', 'neueren App-Version'],
    ] as const) {
      await page.evaluate((target) => {
        ;(window as unknown as { __tauriStub: { data: { openTarget: string } } }).__tauriStub.data.openTarget = target
      }, path)
      await page.getByTestId('data-import').click()
      await expect(page.getByTestId('data-transfer-error')).toContainText(message)
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await calls(page)).not.toContain('data_import_apply')
  })

  test('import: a valid file is previewed, backed up first and replaces the data', async ({ page }) => {
    const incoming = JSON.stringify(envelope(tasks(7), { notionConfig: { config: { token: 'ntn_SECRET_TOKEN_1234', databaseId: 'db-9' } } }))
    await openDataPage(page, { openTarget: '/in/data.json', importFiles: { '/in/data.json': incoming } })
    await page.getByTestId('data-import').click()
    const dialog = page.getByRole('dialog', { name: 'Daten importieren' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('data-restore-source')).toHaveText('7 Aufgaben')
    await expect(dialog).toContainText('data.json')
    await expect(dialog).toContainText('Der aktuelle Stand wird vorher gesichert.')
    await expectNoSeriousA11yViolations(page)
    await dialog.getByTestId('data-restore-confirm').click()
    await expect(rows(page).filter({ hasText: 'Vor Wiederherstellung' })).toHaveCount(1)
    const state = await stubStateAcrossReload(page)
    expect(JSON.stringify(state.data.envelope)).not.toContain('ntn_SECRET_TOKEN_1234')
    expect(state.data.envelope).toMatchObject({ stores: { 'tasks-store': { tasks: expect.any(Array) } } })
  })

  test('import and restore stay off while a conflict is pending, and the page says why', async ({ page }) => {
    const old = backup({ name: 'old.json', kind: 'daily', ts: '2026-10-23T08:05:00.000Z' })
    await openDataPage(page, { theirs: envelope(tasks(2)), backups: [old] })
    await emitDataStatus(page, { status: 'conflict' })
    await conflictDialog(page).getByRole('button', { name: 'Später' }).click()
    await expect(page.getByTestId('data-import')).toBeDisabled()
    await expect(rows(page).first().getByRole('button', { name: 'Wiederherstellen' })).toBeDisabled()
    await expect(page.getByTestId('data-restore-blocked')).toContainText('erst möglich')
    await expect(page.getByTestId('data-import-blocked')).toBeVisible()
  })

  test('a newer-schema file turns restore off with the update hint', async ({ page }) => {
    const old = backup({ name: 'old.json', kind: 'daily', ts: '2026-10-23T08:05:00.000Z' })
    await openDataPage(page, { status: 'read-only-newer-schema', backups: [old] })
    await expect(rows(page).first().getByRole('button', { name: 'Wiederherstellen' })).toBeDisabled()
    await expect(page.getByTestId('data-restore-blocked')).toContainText('neueren App-Version')
  })

  test('an unreadable data file is exactly when restore is offered, and it works', async ({ page }) => {
    const old = backup({ name: 'old.json', kind: 'daily', ts: '2026-10-23T08:05:00.000Z', taskCount: 23 })
    await openDataPage(page, { status: 'read-only-corrupt', backups: [old] })
    await expect(page.getByTestId('data-restore-blocked')).toHaveCount(0)
    await expect(page.getByTestId('data-import')).toBeEnabled()
    await rows(page).first().getByRole('button', { name: 'Wiederherstellen' }).click()
    await page.getByTestId('data-restore-confirm').click()
    await expect(rows(page).filter({ hasText: 'Vor Wiederherstellung' })).toHaveCount(1)
    expect((await stubStateAcrossReload(page)).data.status).toBe('ok')
  })
})

/** #271: the iCloud upload state is a quiet, non-blocking field of the status payload (stubbed IPC). */
test.describe('Cloud upload state', () => {
  const SINCE = '2026-10-27T10:00:00.000Z'
  const pending = (patch: Partial<CloudSyncStub> = {}): CloudSyncStub => ({ state: 'pending', since: SINCE, visible: true, ...patch })
  const PENDING_TEXT = 'Noch nicht in iCloud hochgeladen. Lokal ist alles gespeichert.'
  const cloudLine = (page: Page) => page.getByTestId('data-folder-cloud')

  async function openBoard(page: Page, data: DataStubOptions = {}) {
    await installTauriStub(page.context(), { data: { folder: CURRENT, envelope: boardEnvelope(), ...data } })
    await page.goto('/tasks')
    await expect(page.getByText('Konzept ausarbeiten')).toBeVisible()
  }

  test('a late upload shows one quiet notice above the board, links to the details and clears by itself', async ({ page }) => {
    await openBoard(page)
    await expect(notice(page)).toHaveCount(0)
    await emitDataStatus(page, { cloudSync: pending() })
    await expect(notice(page)).toContainText(PENDING_TEXT)
    await expect(notice(page)).toHaveAttribute('role', 'status')
    await expect(notice(page).getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/settings/data')
    await expectNoSeriousA11yViolations(page)
    await emitDataStatus(page, { cloudSync: { state: 'uploaded', since: null, visible: false } })
    await expect(notice(page)).toHaveCount(0)
  })

  test('nothing shows for a plain folder or while the grace runs', async ({ page }) => {
    await openBoard(page, { cloudSync: null })
    await expect(notice(page)).toHaveCount(0)
    await emitDataStatus(page, { cloudSync: pending({ visible: false }) })
    await emitDataStatus(page, { cloudSync: { state: 'uploading', since: SINCE, visible: false } })
    await expect(notice(page)).toHaveCount(0)
  })

  test('an upload error waits for the grace and then shows the same neutral notice as pending', async ({ page }) => {
    await openBoard(page, { cloudSync: { state: 'error', message: 'The network is offline.', since: SINCE, visible: false } })
    await expect(notice(page)).toHaveCount(0)
    await emitDataStatus(page, { cloudSync: { state: 'error', message: 'The network is offline.', since: SINCE, visible: true } })
    await expect(notice(page)).toContainText(PENDING_TEXT)
    await expect(notice(page)).not.toHaveClass(/bg-warning|bg-error/)
  })

  test('every other status and conflict copies win over the cloud notice', async ({ page }) => {
    await openBoard(page, { cloudSync: pending(), conflictCopies: [{ name: 'kan-do-data 2.json', writtenAt: SINCE, taskCount: 3, envelope: envelope(tasks(3)) }] })
    await expect(notice(page)).toContainText('Konflikt-Kopien')
    await emitDataStatus(page, { conflictCopies: [], status: 'write-failed', error: 'disk full' })
    await expect(notice(page)).toContainText('Speichern fehlgeschlagen')
  })

  test('saving stays possible: a task added while the notice shows reaches the file, and no toast appears', async ({ page }) => {
    await openBoard(page, { cloudSync: pending() })
    await expect(notice(page)).toBeVisible()
    await openAddSheet(page)
    await page.locator('input[name="title"]').fill('Offline erledigt')
    await page.locator('input[name="title"]').press('Enter')
    await page.waitForURL(/\/tasks$/)
    await expect(page.locator('#column-open').getByLabel('Offline erledigt')).toBeVisible()
    await expect.poll(async () => JSON.stringify((await stubState(page)).data.envelope)).toContain('Offline erledigt')
    expect((await stubState(page)).data.status).toBe('ok')
    await expect(page.locator('[data-slot="toast"], [role="alert"]')).toHaveCount(0)
    await expect(notice(page)).toBeVisible()
  })

  test('on /settings/data: a muted line follows the live state, the iCloud reason shows for an error, no notice duplicate', async ({ page }) => {
    await openDataPage(page, { cloudSync: { state: 'uploaded', since: null, visible: false } })
    await expect(cloudLine(page)).toHaveText('In iCloud gesichert')
    await emitDataStatus(page, { cloudSync: { state: 'uploading', since: SINCE, visible: false } })
    await expect(cloudLine(page)).toHaveText('Wird hochgeladen…')
    await expect(notice(page)).toHaveCount(0)
    await emitDataStatus(page, { cloudSync: pending() })
    await expect(cloudLine(page)).toHaveText('Noch nicht in iCloud hochgeladen')
    await expect(notice(page)).toContainText(PENDING_TEXT)
    await expect(notice(page).getByRole('link', { name: 'Details' })).toHaveCount(0)
    await emitDataStatus(page, { cloudSync: { state: 'error', message: 'The network is offline.', since: SINCE, visible: true } })
    await expect(cloudLine(page)).toContainText('The network is offline.')
    await expectNoSeriousA11yViolations(page)
  })

  test('no cloud line for a folder that is not in iCloud', async ({ page }) => {
    await openDataPage(page)
    await expect(cloudLine(page)).toHaveCount(0)
  })

  test('"Ausblenden" hides the cloud notice for the session: repeated emit, uploaded then late again and an upload error stay hidden (#289)', async ({ page }) => {
    await openBoard(page, { cloudSync: pending() })
    const hide = notice(page).getByRole('button', { name: 'Ausblenden' })
    await expect(notice(page).getByRole('link', { name: 'Details' })).toBeVisible()
    await notice(page).getByRole('link', { name: 'Details' }).focus()
    await page.keyboard.press('Tab')
    await expect(hide).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(notice(page)).toHaveCount(0)
    await emitDataStatus(page, { cloudSync: pending() })
    await emitDataStatus(page, { cloudSync: { state: 'error', message: 'offline', since: SINCE, visible: true } })
    await emitDataStatus(page, { cloudSync: { state: 'uploaded', since: null, visible: false } })
    await emitDataStatus(page, { cloudSync: pending() })
    await expect(notice(page)).toHaveCount(0)
  })

  test('no other notice has the action (#284)', async ({ page }) => {
    await openBoard(page, { status: 'write-failed', error: 'disk full' })
    await expect(notice(page)).toBeVisible()
    await expect(notice(page).getByRole('button', { name: 'Ausblenden' })).toHaveCount(0)
  })

  test('on /settings/data the action still shows and the live line stays after hiding (#284)', async ({ page }) => {
    await openDataPage(page, { cloudSync: pending() })
    await expect(notice(page).getByRole('button', { name: 'Ausblenden' })).toBeVisible()
    await notice(page).getByRole('button', { name: 'Ausblenden' }).click()
    await expect(notice(page)).toHaveCount(0)
    await expect(cloudLine(page)).toHaveText('Noch nicht in iCloud hochgeladen')
  })

  test('at 390px both actions stay inside the notice with 44px hit areas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openBoard(page, { cloudSync: pending() })
    for (const locator of [notice(page).getByRole('link', { name: 'Details' }), notice(page).getByRole('button', { name: 'Ausblenden' })]) {
      const box = await locator.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('fits 390px wide without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openBoard(page, { cloudSync: pending() })
    await expect(notice(page)).toBeVisible()
    await expect(notice(page).getByRole('link', { name: 'Details' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.goto('/settings/data')
    await expect(cloudLine(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
