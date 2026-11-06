import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalBoard } from './helpers/seed'
import { openMore } from './helpers/appNav'
import { settleAnimations } from './helpers/settle'
import {
  installTauriStub, setInstallFailure, stubState, type UpdateStubOptions, type UpdateStubResult,
} from './helpers/tauriStub'

/** #225: version, update check and install against the stubbed IPC (see helpers/tauriStub.ts). */

const AVAILABLE: UpdateStubResult = { status: 'available', version: '0.2.0', notes: 'Raw release body' }
const palette = (page: Page) => page.getByRole('dialog', { name: 'Befehlspalette' })
const updateDialog = (page: Page) => page.getByRole('dialog', { name: 'Version 0.2.0 ist verfügbar' })
const checkButton = (page: Page) => page.getByTestId('updates-check')

async function openUpdatesPage(page: Page, update: UpdateStubOptions = {}) {
  await installTauriStub(page.context(), { update })
  await page.goto('/settings/updates')
  await expect(page.getByRole('heading', { name: 'Version', level: 2 })).toBeVisible()
}

async function expectNoSeriousA11yViolations(page: Page) {
  await settleAnimations(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
  expect(blocking.map(v => `${v.id}: ${v.nodes.map(n => `${n.target.join(' ')} (${n.any[0]?.message ?? ''})`).join(', ')}`)).toEqual([])
}

test.describe('Updates (web)', () => {
  test('redirects to /tasks and offers no update command', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/settings/updates')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page).getByText('Statistik öffnen')).toBeVisible()
    await expect(palette(page).getByText('Nach Updates suchen')).toHaveCount(0)
    await expect(palette(page).getByText('Version & Updates')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // the Mehr panel has no App-Update row in the web build (absent, never disabled; #470)
    const panel = await openMore(page)
    await expect(panel.getByTestId('more-settings')).toBeVisible()
    await expect(panel.getByTestId('more-update')).toHaveCount(0)
    await expect(panel.getByText('App-Update')).toHaveCount(0)
  })
})

test.describe('Updates page (desktop)', () => {
  test('the Mehr panel has an App-Update row that opens the page (desktop app only, #470)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, {})
    await page.goto('/tasks')
    const panel = await openMore(page)
    const row = panel.getByTestId('more-update')
    await expect(row).toHaveText('App-Update')
    await expect(row).toBeEnabled()
    await row.click()
    await expect(page).toHaveURL(/\/settings\/updates$/)
    await expect(page.getByRole('heading', { name: 'Version', level: 2 })).toBeVisible()
    await expect(page.getByTestId('app-nav-place-more')).toHaveAttribute('aria-current', 'page') // the third segment, reading Einstellungen
    await expect(page.getByTestId('app-nav-place-more')).toHaveText('Einstellungen')
    await expect(page.getByTestId('app-nav-more')).not.toHaveAttribute('aria-current', 'page')
  })

  test('shows the version, "not checked yet" and the log folder before any check', async ({ page }) => {
    await openUpdatesPage(page, { appVersion: '0.1.0' })
    await expect(page.getByTestId('updates-version')).toHaveText('Kan-Do 0.1.0')
    await expect(page.getByTestId('updates-last-checked')).toHaveText('Noch nicht geprüft.')
    await expect(page.getByTestId('updates-status')).toHaveCount(0)
    await expect(page.getByTestId('updates-log-path')).toHaveText('/Users/test/Library/Logs/com.julius.kan-do')
    await page.getByTestId('updates-log-reveal').click()
    await expect.poll(async () => (await stubState(page)).calls.some(call => call.cmd === 'log_reveal')).toBe(true)
  })

  test('up to date: one calm line and the time of the check', async ({ page }) => {
    await openUpdatesPage(page)
    await checkButton(page).click()
    await expect(page.getByTestId('updates-status')).toHaveText('Du hast die neueste Version.')
    await expect(page.getByTestId('updates-last-checked')).toContainText('Zuletzt geprüft:')
    await expect(page.getByTestId('updates-open-github')).toHaveCount(0)
    await expect(updateDialog(page)).toHaveCount(0)
  })

  const STATES: Array<{ name: string; check: UpdateStubResult; text: string; retry: boolean; github: boolean }> = [
    { name: 'token rejected', check: { status: 'rejected' }, text: 'GitHub hat das Token für Updates abgelehnt. Füge ein neues ein.', retry: false, github: true },
    { name: 'offline', check: { status: 'offline' }, text: 'Keine Verbindung. Versuche es später erneut.', retry: true, github: false },
    { name: 'no release', check: { status: 'no-release-or-access' }, text: 'Noch keine veröffentlichte Version.', retry: false, github: false },
    { name: 'rate limited', check: { status: 'rate-limited' }, text: 'GitHub nimmt gerade keine weiteren Anfragen an. Versuche es später erneut.', retry: true, github: false },
    { name: 'not configured', check: { status: 'not-configured' }, text: 'Updates sind in diesem Build nicht eingerichtet: Es fehlt der öffentliche Schlüssel.', retry: false, github: false },
    { name: 'error', check: { status: 'error', reason: 'manifest-missing' }, text: 'Die neueste Version enthält keine Update-Datei.', retry: true, github: false },
  ]

  for (const state of STATES) {
    test(`explains "${state.name}" in one sentence`, async ({ page }) => {
      await openUpdatesPage(page, { check: state.check })
      await checkButton(page).click()
      await expect(page.getByText(state.text, { exact: true })).toBeVisible()
      await expect(checkButton(page)).toHaveText(state.retry ? 'Erneut versuchen' : 'Nach Updates suchen')
      await expect(page.getByTestId('updates-open-github')).toHaveCount(state.github ? 1 : 0)
      if (state.github) await expect(page.getByTestId('updates-open-github')).toHaveAttribute('href', '/settings/github')
      await expect(updateDialog(page)).toHaveCount(0)
    })
  }

  test('the update dialog lists the new version\'s highlights in the UI locale, never the fixes', async ({ page }) => {
    const notes = '## Highlights\n### de\n- **Neues Ding.** Es tut etwas.\n### en\n- **New thing.** It does something.\n\n## Fixes\n- hidden fix'
    await openUpdatesPage(page, { check: { ...AVAILABLE, notes } })
    await checkButton(page).click()
    const list = updateDialog(page).getByTestId('update-notes')
    await expect(list).toContainText('Neues Ding. Es tut etwas.')
    await expect(updateDialog(page).getByTestId('update-notes-label')).toHaveText('Neu seit deiner Version (0.1.0):')
    await expect(list).toHaveAttribute('aria-labelledby', 'update-notes-label')
    await expect(updateDialog(page).getByTestId('update-current')).toHaveCount(0)
    await expect(updateDialog(page)).not.toContainText('hidden fix')
  })

  test('an available update opens the dialog straight from the button', async ({ page }) => {
    await openUpdatesPage(page, { check: AVAILABLE })
    await checkButton(page).click()
    await expect(updateDialog(page)).toBeVisible()
    await expect(updateDialog(page).getByTestId('update-current')).toHaveText('Du nutzt 0.1.0.')
    await expect(updateDialog(page)).toContainText('Vor der Installation sichert Kan-Do deine Daten. Danach startet die App neu.')
    // Unparseable notes (not the Highlights format) give null: no empty section, and the raw body is not shown.
    await expect(updateDialog(page).getByTestId('update-notes')).toHaveCount(0)
    await expect(updateDialog(page)).not.toContainText('Raw release body')
    await updateDialog(page).getByTestId('update-later').click()
    await expect(updateDialog(page)).toHaveCount(0)
    await expect(page.getByTestId('updates-status')).toHaveText('Version 0.2.0 ist verfügbar.')
    await page.getByTestId('updates-details').click()
    await expect(updateDialog(page)).toBeVisible()
  })

  test('has no serious or critical axe violations on the page and in the dialog', async ({ page }) => {
    await openUpdatesPage(page, { check: { status: 'rejected' } })
    await checkButton(page).click()
    await expect(page.getByTestId('updates-open-github')).toBeVisible()
    await expectNoSeriousA11yViolations(page)
    await setAvailable(page)
    await checkButton(page).click()
    await expect(updateDialog(page)).toBeVisible()
    await expectNoSeriousA11yViolations(page)
  })
})

async function setAvailable(page: Page) {
  await page.evaluate((value) => {
    ;(window as unknown as { __tauriStub: { update: { check: unknown } } }).__tauriStub.update.check = value
  }, AVAILABLE)
}

test.describe('Update dialog (desktop)', () => {
  async function openDialog(page: Page, update: UpdateStubOptions = {}) {
    await openUpdatesPage(page, { check: AVAILABLE, ...update })
    await checkButton(page).click()
    await expect(updateDialog(page)).toBeVisible()
  }

  test('installs only on confirmation, flushing the data first', async ({ page }) => {
    await openDialog(page)
    expect((await stubState(page)).calls.some(call => call.cmd === 'update_install')).toBe(false)
    await updateDialog(page).getByTestId('update-install').click()
    await expect.poll(async () => (await stubState(page)).calls.map(call => call.cmd).filter(cmd => cmd === 'data_flush' || cmd === 'update_install'))
      .toEqual(['data_flush', 'update_install'])
  })

  test('cannot be closed while it downloads and installs, and shows plain progress', async ({ page }) => {
    await openDialog(page, { installHangs: true })
    const dialog = updateDialog(page)
    await dialog.getByTestId('update-install').click()
    await expect(dialog.getByTestId('update-install')).toBeDisabled()
    await expect(dialog.getByTestId('update-install')).toContainText('Wird installiert…')
    await expect(dialog.getByTestId('update-later')).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Schließen' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('update-progress-live')).toHaveText('Wird installiert…')
  })

  test('a failed install stays inline, changes nothing and can be retried', async ({ page }) => {
    await openDialog(page, { installFailure: { kind: 'install_failed' } })
    const dialog = updateDialog(page)
    await dialog.getByTestId('update-install').click()
    await expect(dialog.getByTestId('update-error')).toHaveText('Die Installation konnte nicht abgeschlossen werden. Es wurde nichts geändert.')
    await expect(dialog.getByTestId('update-install')).toHaveText('Erneut versuchen')
    await expect(dialog.getByTestId('update-install')).toBeEnabled()
    await expect(dialog.getByTestId('update-later')).toBeEnabled()
    await setInstallFailure(page, undefined)
    await dialog.getByTestId('update-install').click()
    await expect(dialog.getByTestId('update-error')).toHaveCount(0)
  })

  for (const blocked of [
    { reason: 'folder-unavailable', text: 'Datenordner nicht erreichbar. Es wurde nichts geändert.' },
    { reason: 'unreadable', text: 'Die Datendatei ist nicht lesbar. Löse das zuerst; es wurde nichts geändert.' },
  ]) {
    test(`refuses with "${blocked.reason}" before touching anything`, async ({ page }) => {
      await openDialog(page, { installFailure: { kind: 'data_blocked', reason: blocked.reason } })
      await updateDialog(page).getByTestId('update-install').click()
      await expect(updateDialog(page).getByTestId('update-error')).toHaveText(blocked.text)
      await updateDialog(page).getByTestId('update-open-data').click()
      await expect(page).toHaveURL(/\/settings\/data$/)
    })
  }

  test('"Später" closes it and nothing is persisted', async ({ page }) => {
    await openDialog(page)
    await updateDialog(page).getByTestId('update-later').click()
    await expect(updateDialog(page)).toHaveCount(0)
    expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage)))).not.toContain('0.2.0')
  })
})

test.describe('Updates in the palette and at launch (desktop)', () => {
  async function openBoard(page: Page, update: UpdateStubOptions) {
    await seedLocalBoard(page.context())
    await installTauriStub(page.context(), { update })
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
  }

  async function runCommand(page: Page, name: string) {
    await page.keyboard.press('ControlOrMeta+k')
    await expect(palette(page)).toBeVisible()
    await palette(page).getByRole('option', { name }).click()
    await expect(palette(page)).toBeHidden()
  }

  test('"Version & Updates" opens the page', async ({ page }) => {
    await openBoard(page, {})
    await runCommand(page, 'Version & Updates')
    await expect(page).toHaveURL(/\/settings\/updates$/)
  })

  test('"Nach Updates suchen" with a rejected token explains it on the page', async ({ page }) => {
    await openBoard(page, { check: { status: 'rejected' } })
    await runCommand(page, 'Nach Updates suchen')
    await expect(page).toHaveURL(/\/settings\/updates$/)
    await expect(page.getByTestId('updates-open-github')).toBeVisible()
  })

  test('"Nach Updates suchen" opens the dialog for an update, after the palette has left', async ({ page }) => {
    await openBoard(page, { check: AVAILABLE })
    await runCommand(page, 'Nach Updates suchen')
    await expect(updateDialog(page)).toBeVisible()
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('"Nach Updates suchen" when current is one short toast', async ({ page }) => {
    await openBoard(page, { check: { status: 'up-to-date' } })
    await runCommand(page, 'Nach Updates suchen')
    // Nuxt UI repeats the title in a visually hidden live region.
    await expect(page.getByText('Du hast die neueste Version.').first()).toBeVisible()
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('the launch check shows one toast for an update; "Details" opens the dialog', async ({ page }) => {
    await page.clock.install()
    await openBoard(page, { check: AVAILABLE })
    await page.clock.fastForward(11_000)
    await expect(page.getByText('Version 0.2.0 ist verfügbar').first()).toBeVisible()
    await page.getByRole('button', { name: 'Details' }).click()
    await expect(updateDialog(page)).toBeVisible()
    expect((await stubState(page)).calls.filter(call => call.cmd === 'update_check')).toHaveLength(1)
  })

  for (const status of ['up-to-date', 'rate-limited', 'offline', 'rejected', 'error'] as const) {
    test(`the launch check stays silent for "${status}"`, async ({ page }) => {
      await page.clock.install()
      await openBoard(page, { check: { status } })
      await page.clock.fastForward(11_000)
      await expect.poll(async () => (await stubState(page)).calls.some(call => call.cmd === 'update_check')).toBe(true)
      await expect(page.getByText('Version 0.2.0 ist verfügbar')).toHaveCount(0)
      await expect(page.getByText('Du hast die neueste Version.')).toHaveCount(0)
    })
  }
})
