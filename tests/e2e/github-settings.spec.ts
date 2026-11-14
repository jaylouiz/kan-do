import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { elapseWindow, installClock } from './helpers/clock'
import { seedLocalBoard } from './helpers/seed'
import { githubCalls, installTauriStub, setGithubMode, stubState } from './helpers/tauriStub'

/** #223: /settings/github against the stubbed desktop IPC (see helpers/tauriStub.ts). */

const updates = (page: Page) => page.getByRole('region', { name: 'Updates' })
const feedback = (page: Page) => page.getByRole('region', { name: 'Feedback' })
const field = (row: ReturnType<typeof updates>) => row.getByLabel(/GitHub-Token/)
const TOKEN = 'ghp_abcdefghij_a1b2'

test.describe('GitHub settings (web)', () => {
  test('redirects to /tasks: there is no Keychain on web', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/settings/github')
    await expect(page).toHaveURL(/\/tasks$/)
  })

  test('the palette has no "GitHub-Zugriff" entry', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(palette.getByText('Statistik öffnen')).toBeVisible()
    await expect(palette.getByText('GitHub-Zugriff')).toHaveCount(0)
  })
})

test.describe('GitHub settings (desktop)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('palette lists "GitHub-Zugriff" and opens the page', async ({ context, page }) => {
    await installTauriStub(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await palette.getByRole('option', { name: 'GitHub-Zugriff' }).click()
    await expect(page).toHaveURL(/\/settings\/github$/)
    await expect(page.getByRole('heading', { name: 'GitHub-Zugriff' })).toBeVisible()
  })

  test('shows only the updates row in the empty state, with its external link; no feedback token UI (#280)', async ({ context, page }) => {
    await installTauriStub(context)
    await page.goto('/settings/github')

    await expect(field(updates(page))).toBeVisible()
    await expect(updates(page).getByRole('button', { name: 'Speichern' })).toBeDisabled()
    await expect(updates(page).getByRole('link', { name: /Token auf GitHub erstellen/ })).toHaveCount(1)
    await expect(updates(page)).toContainText('Nur Lesen (Inhalte), nur dieses Repository.')
    await expect(updates(page)).not.toContainText('Schreibrechte für Issues')
    // Nobody can add a feedback token any more: no row, no field, no scope help.
    await expect(feedback(page)).toHaveCount(0)
    await expect(page.getByText('Schreibrechte für Issues')).toHaveCount(0)

    // The external link goes through the opener plugin, not the webview.
    await updates(page).getByRole('link', { name: /Token auf GitHub erstellen/ }).click()
    await expect.poll(async () => (await stubState(page)).openedUrls).toEqual([
      'https://github.com/settings/personal-access-tokens/new',
    ])
  })

  test('a rejected feedback token stays a saved row with Löschen, never the paste form (#280)', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-feedback': TOKEN }, githubMode: 'unauthorized' })
    await page.goto('/settings/github')
    const saved = feedback(page).getByTestId('github-token-saved')
    await expect(saved.getByTestId('github-feedback-rejected')).toContainText('abgelehnt')
    await expect(saved.getByRole('button', { name: 'Löschen' })).toBeVisible()
    await expect(field(feedback(page))).toHaveCount(0)
    await expect(feedback(page).getByRole('link', { name: /Token auf GitHub erstellen/ })).toHaveCount(0)
  })

  test('a feedback token stored earlier still shows, with Testen and Löschen, and no paste field (#280)', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-feedback': TOKEN } })
    await page.goto('/settings/github')
    const saved = feedback(page).getByTestId('github-token-saved')
    await expect(saved).toContainText('●●●● a1b2')
    await expect(feedback(page)).toContainText('Issues + Inhalte: schreiben, nur dieses Repository.')
    await expect(feedback(page)).toContainText('Schreibrechte für Issues')
    await expect(saved.getByRole('button', { name: 'Testen' })).toBeVisible()
    await expect(field(feedback(page))).toHaveCount(0)
  })

  test('the developer\'s GitHub CLI token has no row and is not checked when the page opens (#280)', async ({ context, page }) => {
    await installTauriStub(context, { feedbackFromGh: true })
    await page.goto('/settings/github')
    await expect(updates(page)).toBeVisible()
    await expect(feedback(page)).toHaveCount(0)
    expect(await githubCalls(page)).toHaveLength(0)
  })

  test('Speichern checks first, then shows only the last four characters', async ({ context, page }) => {
    await installTauriStub(context)
    await page.goto('/settings/github')
    await field(updates(page)).fill(TOKEN)
    await updates(page).getByRole('button', { name: 'Speichern' }).click()

    const saved = updates(page).getByTestId('github-token-saved')
    await expect(saved).toContainText('●●●● a1b2')
    await expect(saved).toContainText('Gültig')
    await expect(saved.getByRole('button', { name: 'Testen' })).toBeVisible()
    await expect(saved.getByRole('button', { name: 'Löschen' })).toBeVisible()

    // The full token appears nowhere in the DOM or in the IPC log.
    expect(await page.content()).not.toContain(TOKEN)
    const state = await stubState(page)
    expect(JSON.stringify(state.calls)).not.toContain(TOKEN)
    expect(state.calls.map(c => c.cmd)).toContain('github_request')
    expect(state.calls.some(c => c.cmd === 'secret_get' && c.args.entry?.toString().startsWith('github-'))).toBe(false)
  })

  test('a rejected token (401) shows an inline error and stores nothing', async ({ context, page }) => {
    await installTauriStub(context, { githubMode: 'unauthorized' })
    await page.goto('/settings/github')
    await field(updates(page)).fill(TOKEN)
    await updates(page).getByRole('button', { name: 'Speichern' }).click()

    await expect(updates(page)).toContainText('GitHub hat dieses Token abgelehnt.')
    await expect(updates(page).getByTestId('github-token-saved')).toHaveCount(0)
    const state = await stubState(page)
    expect(state.entries['github-updates']).toBeUndefined()
  })

  test('a 403 names the missing permission, a 404 the invisible repository; neither is "rejected"', async ({ context, page }) => {
    await installTauriStub(context, { githubMode: 'forbidden' })
    await page.goto('/settings/github')
    await field(updates(page)).fill(TOKEN)
    await updates(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(updates(page)).toContainText('Dem Token fehlt die Berechtigung „Inhalte lesen“ für dieses Repository, nichts gespeichert.')
    await expect(page.getByText('abgelehnt')).toHaveCount(0)

    await setGithubMode(page, 'not-found')
    await updates(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(updates(page)).toContainText('Dieses Token sieht das Repository nicht')
    expect((await stubState(page)).entries['github-updates']).toBeUndefined()
  })

  test('a 403 is named, not rejected; offline says nothing was saved', async ({ context, page }) => {
    await installTauriStub(context, { githubMode: 'forbidden' })
    await page.goto('/settings/github')
    await field(updates(page)).fill(TOKEN)
    await updates(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(updates(page)).toContainText('Dem Token fehlt die Berechtigung')
    await expect(updates(page)).not.toContainText('abgelehnt')
    expect((await stubState(page)).entries['github-updates']).toBeUndefined()

    await setGithubMode(page, 'offline')
    await field(updates(page)).fill(TOKEN)
    await updates(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(updates(page)).toContainText('Keine Verbindung, nichts gespeichert.')
    expect((await stubState(page)).entries['github-updates']).toBeUndefined()
  })

  test('a failed check of a replacement keeps the stored token', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-updates': TOKEN } })
    await page.goto('/settings/github')
    await expect(updates(page).getByTestId('github-token-saved')).toContainText('Gültig')
    await setGithubMode(page, 'unauthorized')
    await updates(page).getByRole('button', { name: 'Testen' }).click()
    await expect(updates(page).getByTestId('github-token-rejected')).toBeVisible()

    // The replacement is also refused: the old (rejected) token is not deleted by the failed save.
    await field(updates(page)).fill('ghp_replacement_0000')
    await updates(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(updates(page)).toContainText('GitHub hat dieses Token abgelehnt.')
    const state = await stubState(page)
    expect(state.entries['github-updates']).toBe(TOKEN)
    expect(state.calls.filter(c => c.cmd === 'secret_set' || c.cmd === 'secret_delete')).toHaveLength(0)
  })

  test('Testen on a revoked token shows the rejected state once, until a new token is saved', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-updates': TOKEN } })
    await page.goto('/settings/github')
    const saved = updates(page).getByTestId('github-token-saved')
    await expect(saved).toContainText('Gültig')

    await setGithubMode(page, 'unauthorized')
    await saved.getByRole('button', { name: 'Testen' }).click()

    const rejected = updates(page).getByTestId('github-token-rejected')
    await expect(rejected).toContainText('●●●● a1b2')
    await expect(rejected).toContainText('GitHub hat dieses Token abgelehnt. Füge ein neues ein.')
    await expect(page.getByText('GitHub hat dieses Token abgelehnt.')).toHaveCount(1)

    // Reloading keeps the rejected flag for the session (Rust holds it): no second request is made.
    await page.reload()
    await expect(updates(page).getByTestId('github-token-rejected')).toBeVisible()
    // One request from the open check and one from Testen; the reloaded page skips the rejected row.
    expect(await githubCalls(page)).toHaveLength(2)

    // A new accepted token clears it.
    await setGithubMode(page, 'ok')
    await field(updates(page)).fill('ghp_newtoken_9z9z')
    await updates(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(updates(page).getByTestId('github-token-saved')).toContainText('●●●● 9z9z')
    await expect(updates(page).getByTestId('github-token-rejected')).toHaveCount(0)
  })

  test('a saved token shows "Gültig" after load without pressing Testen, and has no create-token link', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-updates': TOKEN } })
    await page.goto('/settings/github')
    const saved = updates(page).getByTestId('github-token-saved')
    await expect(saved).toContainText('Gültig')
    await expect(saved).toContainText('●●●● a1b2')
    await expect(updates(page).getByRole('link', { name: /Token auf GitHub erstellen/ })).toHaveCount(0)
    expect(await githubCalls(page)).toHaveLength(1)
  })

  test('the open check never rejects a token when offline: it stays "Gespeichert" with the calm line', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-updates': TOKEN }, githubMode: 'offline' })
    await page.goto('/settings/github')
    const saved = updates(page).getByTestId('github-token-saved')
    await expect(saved).toContainText('Keine Verbindung. Das Token wurde nicht geprüft.')
    await expect(saved).toContainText('Gespeichert')
    await expect(updates(page).getByTestId('github-token-rejected')).toHaveCount(0)
    await expect(saved.getByRole('button', { name: 'Löschen' })).toBeEnabled()
  })

  test('the open check marks a revoked token (401) rejected, in the error tone', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-updates': TOKEN }, githubMode: 'unauthorized' })
    await page.goto('/settings/github')
    const rejected = updates(page).getByTestId('github-token-rejected')
    await expect(rejected).toContainText('GitHub hat dieses Token abgelehnt. Füge ein neues ein.')
    // The rejection is a subtle error alert (#74): the tone sits on the alert root
    await expect(rejected.getByRole('status').filter({ hasText: 'GitHub hat dieses Token abgelehnt. Füge ein neues ein.' })).toHaveClass(/text-error/)
    await expect(rejected.getByRole('link', { name: /Token auf GitHub erstellen/ })).toBeVisible()
  })

  test('Löschen acts at once; Rückgängig brings the token back and focus returns', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-feedback': TOKEN } })
    await page.goto('/settings/github')
    const saved = feedback(page).getByTestId('github-token-saved')
    await saved.getByRole('button', { name: 'Löschen' }).click()

    // The row is hidden (it has no paste field to land in); nothing is lost until the toast closes.
    await expect(feedback(page)).toBeHidden()
    // Focus goes to the updates row, not to <body>.
    await expect(updates(page).getByRole('textbox')).toBeFocused()
    // Still in the Keychain while the undo toast is open.
    expect((await stubState(page)).entries['github-feedback']).toBe(TOKEN)

    await page.getByRole('button', { name: 'Rückgängig' }).click()
    await expect(saved).toContainText('●●●● a1b2')
    await expect(saved.getByRole('button', { name: 'Löschen' })).toBeFocused()
    expect((await stubState(page)).entries['github-feedback']).toBe(TOKEN)
    await expect.poll(async () => (await stubState(page)).calls.filter(c => c.cmd === 'secret_delete').length).toBe(0)
  })

  test('Löschen deletes from the Keychain after the undo toast closed', async ({ context, page }) => {
    await installClock(context) // the 5 s toast window runs on the page clock (#543)
    await installTauriStub(context, { entries: { 'github-updates': TOKEN } })
    await page.goto('/settings/github')
    await updates(page).getByRole('button', { name: 'Löschen' }).click()
    await expect(page.getByRole('button', { name: 'Rückgängig' })).toBeVisible()
    await elapseWindow(page)
    await expect.poll(async () => (await stubState(page)).entries['github-updates']).toBeUndefined()
    await expect(updates(page).getByTestId('github-token-empty')).toBeVisible()
  })

  test('has no serious or critical axe violations in the empty, saved and rejected states', async ({ context, page }) => {
    await installTauriStub(context, { entries: { 'github-updates': TOKEN } })
    await page.goto('/settings/github')
    await expect(updates(page).getByTestId('github-token-saved')).toContainText('Gültig')

    const scan = async () => {
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
      const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      expect(blocking.map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
    }
    await scan() // updates saved
    await setGithubMode(page, 'unauthorized')
    await updates(page).getByRole('button', { name: 'Testen' }).click()
    await expect(updates(page).getByTestId('github-token-rejected')).toBeVisible()
    await scan() // updates rejected
    await setGithubMode(page, 'offline')
    await field(updates(page)).fill('ghp_replacement_0000')
    await updates(page).getByRole('button', { name: 'Speichern' }).click()
    await expect(updates(page)).toContainText('Keine Verbindung. Das Token wurde nicht geprüft.')
    await scan() // inline error
  })

  test('an unreadable Keychain shows one sentence and no fields', async ({ context, page }) => {
    await installTauriStub(context, { keychainError: true })
    await page.goto('/settings/github')
    await expect(page.getByTestId('github-keychain-unavailable')).toContainText('Schlüsselbund')
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Speichern' })).toHaveCount(0)
  })
})

test.describe('Notion token on desktop', () => {
  test('the settings field shows only dots and the last four characters; the persisted blob has no token', async ({ context, page }) => {
    const token = 'notion_test_stub:session-wxyz'
    await context.addInitScript((value) => {
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { sources: { connected: ['notion'], default: 'notion' } }, columns: [], grouping: { enabled: false, key: null } }))
      localStorage.setItem('notionConfig', JSON.stringify({ config: {
        databaseId: 'db-123', dataSourceId: 'ds-123',
        propertyMapping: { title: 'Name', status: 'Status', dueDate: null, priority: null, timeBox: 'Timebox', timeSpent: 'Aufwand', timeSpentUnit: 'minutes', customProperties: [] },
        statusMapping: { today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting' },
      } }))
      void value
    }, token)
    await installTauriStub(context, { entries: { 'notion-token': token } })
    await page.goto('/settings/notion')

    // Configured on the first render: the page shows the connection tab, not "not configured".
    const input = page.getByPlaceholder('ntn_...')
    await expect(input).toHaveValue('●●●● wxyz')
    expect(await page.content()).not.toContain(token)
    const blob = await page.evaluate(() => localStorage.getItem('notionConfig') ?? '')
    expect(blob).not.toContain(token)
  })

  test('a token left in localStorage by an older build migrates into the Keychain and leaves the blob', async ({ context, page }) => {
    const token = 'notion_test_stub:legacy-1234'
    await context.addInitScript((value) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('board-store', JSON.stringify({ boardConfig: { sources: { connected: ['notion'], default: 'notion' } }, columns: [], grouping: { enabled: false, key: null } }))
      localStorage.setItem('notionConfig', JSON.stringify({ config: {
        token: value, databaseId: 'db-123', dataSourceId: 'ds-123',
        propertyMapping: { title: 'Name', status: 'Status', dueDate: null, priority: null, timeBox: 'Timebox', timeSpent: 'Aufwand', timeSpentUnit: 'minutes', customProperties: [] },
        statusMapping: { today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting' },
      } }))
    }, token)
    await installTauriStub(context)
    await page.goto('/settings/notion')

    await expect(page.getByPlaceholder('ntn_...')).toHaveValue('●●●● 1234')
    const state = await stubState(page)
    expect(state.entries['notion-token']).toBe(token)
    const blob = await page.evaluate(() => localStorage.getItem('notionConfig') ?? '')
    expect(blob).not.toContain(token)
    expect(JSON.parse(blob).config.databaseId).toBe('db-123')
  })

  test('a Todoist token left in localStorage survives the upgrade: board hydration must not strip it first (#223 H1)', async ({ context, page }) => {
    const token = 'td_legacy_token_5678'
    await context.addInitScript((value) => {
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      localStorage.setItem('board-store', JSON.stringify({
        boardConfig: { sources: { connected: [], default: 'local' }, todoistApiToken: value }, columns: [], grouping: { enabled: false, key: null },
      }))
    }, token)
    await installTauriStub(context)
    await page.goto('/tasks')

    await expect.poll(async () => (await stubState(page)).entries['todoist-token']).toBe(token)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('board-store') ?? '')).not.toContain(token)
    expect(await page.content()).not.toContain(token)
  })
})
