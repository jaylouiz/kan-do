import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalBoard } from './helpers/seed'
import { githubCalls, installTauriStub, markRejected, setGithubMode, stubState } from './helpers/tauriStub'

/** #227: in-app feedback against the stubbed desktop IPC. `github_request` never reaches GitHub. */

const dialog = (page: Page) => page.getByRole('dialog', { name: /Feedback senden|Prüfen und senden/ })
const card = (page: Page, id: string) => page.locator(`.task-wrapper[data-task-id="${id}"]`)
const TOKEN = 'ghp_feedback_abcd'

async function openFeedback(page: Page) {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
  await palette.getByRole('option', { name: 'Feedback senden' }).click()
  await expect(page.getByTestId('feedback-form')).toBeVisible()
}

/** Axe samples blended colours while the modal still fades in; wait until nothing animates. */
async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target
      return !target?.closest('[data-testid="feedback-dialog"], [data-slot="overlay"]') || a.playState !== 'running'
    }))
}

async function pickCard(page: Page, id: string) {
  await page.getByTestId('feedback-pick-element').click()
  await expect(page.getByTestId('element-picker-bar')).toBeVisible()
  await expect(page.getByTestId('feedback-dialog')).toHaveCount(0)
  const box = (await card(page, id).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('element-picker-outline')).toBeVisible()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByTestId('feedback-form')).toBeVisible()
}

async function toReview(page: Page, title = 'Karte wird abgeschnitten') {
  await page.getByTestId('feedback-title').fill(title)
  await page.getByTestId('feedback-description').fill('Der lange Titel läuft aus der Karte.')
  await page.getByTestId('feedback-next').click()
  await expect(page.getByTestId('feedback-review')).toBeVisible()
}

test.describe('Feedback (web)', () => {
  test('the palette has no "Feedback senden" entry', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(palette.getByText('Statistik öffnen')).toBeVisible()
    await expect(palette.getByText('Feedback senden')).toHaveCount(0)
    await expect(page.getByTestId('element-picker-bar')).toHaveCount(0)
  })
})

test.describe('Feedback (desktop)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, { entries: { 'github-feedback': TOKEN } })
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
  })

  test('opens from the palette after it has left; Escape closes, the draft survives, discard drops it', async ({ page }) => {
    await openFeedback(page)
    await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toHaveCount(0)
    await expect(page.getByTestId('feedback-next')).toBeDisabled()
    await page.getByTestId('feedback-title').fill('Entwurf bleibt')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()

    await openFeedback(page)
    await expect(page.getByTestId('feedback-title')).toHaveValue('Entwurf bleibt')
    await page.getByTestId('feedback-discard').click()
    await expect(page.getByTestId('feedback-title')).toHaveValue('')
    await expect(page.getByTestId('feedback-discard')).toHaveCount(0)

    // Discard is undoable, like deletes elsewhere.
    await page.getByTestId('feedback-undo-discard').click()
    await expect(page.getByTestId('feedback-title')).toHaveValue('Entwurf bleibt')
  })

  test('review: names the target repo, moves focus to the step, and the picker chip names what is outlined', async ({ page }) => {
    await openFeedback(page)
    // With a token the app sends itself: no word about an account
    await expect(page.getByTestId('feedback-public-note')).toHaveText('Dein Feedback wird ein öffentliches Issue auf GitHub.')
    await pickCard(page, 'seed-open-1')
    await page.getByTestId('feedback-title').fill('Fokus')
    await page.getByTestId('feedback-next').click()
    await expect(page.getByTestId('feedback-review-intro')).toContainText('als öffentliches Issue an jaylouiz/kan-do')
    await expect(page.getByTestId('feedback-review-intro')).toBeFocused()
    await page.getByTestId('feedback-back').click()
    await expect(page.getByTestId('feedback-title')).toBeFocused()
  })

  test('while picking the cursor is a crosshair and the chip names the part inside the component', async ({ page }) => {
    await openFeedback(page)
    await page.getByTestId('feedback-pick-element').click()
    await expect(page.getByTestId('element-picker-bar')).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/kando-picking/)
    const box = (await card(page, 'seed-open-1').boundingBox())!
    await page.mouse.move(box.x + 60, box.y + 40)
    await expect(page.getByTestId('element-picker-chip')).toContainText('TaskCard')
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).not.toHaveClass(/kando-picking/)
  })

  test('keeps the draft out of every storage', async ({ page }) => {
    await openFeedback(page)
    await page.getByTestId('feedback-title').fill('Nur im Speicher')
    await page.getByTestId('feedback-description').fill('Geheimnis-12345')
    await page.keyboard.press('Escape')
    const dump = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    expect(dump).not.toContain('Nur im Speicher')
    expect(dump).not.toContain('Geheimnis-12345')
  })

  test('picking hides the dialog, outlines the card with its component name and leaves the board alone', async ({ page }) => {
    await openFeedback(page)
    await page.getByTestId('feedback-title').fill('Kartenproblem')
    await page.getByTestId('feedback-pick-element').click()

    const bar = page.getByTestId('element-picker-bar')
    await expect(bar).toContainText('Klicke ein Element an')
    await expect(page.getByTestId('feedback-dialog')).toHaveCount(0)

    const box = (await card(page, 'seed-open-1').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByTestId('element-picker-chip')).toBeVisible()
    await expect(page.getByTestId('element-picker-live')).toContainText(',')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    // The pick never clicked, opened or moved anything.
    await expect(page.getByTestId('feedback-form')).toBeVisible()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByTestId('feedback-title')).toHaveValue('Kartenproblem')
    const chosen = page.getByTestId('feedback-element')
    await expect(chosen).toBeVisible()
    await expect(chosen).toContainText('TaskCard')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)

    // After the picker dnd-kit works as before: a drag moves the card and leaves no stuck state.
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    const source = (await card(page, 'seed-open-2').boundingBox())!
    const target = (await page.locator('#column-waiting').boundingBox())!
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(100)
    await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2 + 10, { steps: 5 })
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 })
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(1)
    await page.mouse.up()
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0)
    await expect(page.locator('#column-waiting-list .task-wrapper[data-task-id="seed-open-2"]')).toHaveCount(1)
  })

  test('Escape in pick mode reopens the dialog unchanged', async ({ page }) => {
    await openFeedback(page)
    await page.getByTestId('feedback-title').fill('Unverändert')
    await page.getByTestId('feedback-pick-element').click()
    await expect(page.getByTestId('element-picker-bar')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('element-picker-bar')).toHaveCount(0)
    await expect(page.getByTestId('feedback-title')).toHaveValue('Unverändert')
    await expect(page.getByTestId('feedback-element')).toHaveCount(0)
  })

  test('the picker works from the keyboard: Tab, arrows, Enter', async ({ page }) => {
    await openFeedback(page)
    await page.getByTestId('feedback-pick-element').click()
    await expect(page.getByTestId('element-picker-bar')).toBeVisible()
    await page.keyboard.press('Tab')
    const live = page.getByTestId('element-picker-live')
    await expect(live).not.toHaveText('')
    const first = await live.textContent()
    await page.keyboard.press('ArrowUp')
    await expect(live).not.toHaveText(first ?? '')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('feedback-element')).toBeVisible()
  })

  test('review shows the exact body, items are removable, send posts it through github_request only', async ({ page }) => {
    await openFeedback(page)
    await pickCard(page, 'seed-open-1')
    await toReview(page)

    const preview = page.getByTestId('feedback-body-preview')
    await expect(preview).toContainText('## Description')
    await expect(preview).toContainText('Der lange Titel läuft aus der Karte.')
    await expect(preview).toContainText('seed-open-1')
    await expect(preview).toContainText('| Version |')
    await expect(preview).toContainText('0.1.0') // the real app version from the Tauri app plugin
    await expect(preview).toContainText('Log (last 1 lines)')
    await expect(preview).toContainText('update check: up-to-date')
    await expect(preview).not.toContainText('Konzept ausarbeiten') // the task title is opt-in

    await page.getByTestId('feedback-include-log').uncheck()
    await expect(preview).not.toContainText('update check: up-to-date')
    await page.getByTestId('feedback-include-version').uncheck()
    await expect(preview).not.toContainText('| Version |')
    await page.getByTestId('feedback-include-task-title').check()
    await expect(preview).toContainText('Konzept ausarbeiten')

    const body = (await preview.textContent())!
    await page.getByTestId('feedback-send').click()
    await expect(page.getByText('Danke, das Feedback ist als Issue #4711 angelegt.').first()).toBeVisible()
    await expect(dialog(page)).toBeHidden()

    const calls = await githubCalls(page)
    expect(calls).toHaveLength(1)
    const [issue] = await githubCalls(page, { method: 'POST', path: '/issues' })
    expect(issue).toMatchObject({ entry: 'github-feedback', method: 'POST', path: '/repos/jaylouiz/kan-do/issues' })
    expect(issue!.body).toEqual({ title: 'Karte wird abgeschnitten', body: body.trimEnd() + '\n', labels: ['inbox'] })
    const state = await stubState(page)
    // The app's own bootstrap reads the Notion/Todoist tokens; the feedback token is never read.
    expect(state.calls.filter(c => c.cmd === 'secret_get' && c.args.entry === 'github-feedback')).toEqual([])
    expect(state.calls.filter(c => c.cmd.startsWith('plugin:http'))).toEqual([])

    // The toast opens the issue through the opener, inside the pinned repo.
    await page.getByRole('button', { name: 'Im Browser öffnen' }).click()
    await expect.poll(async () => (await stubState(page)).openedUrls).toEqual(['https://github.com/jaylouiz/kan-do/issues/4711'])

    // Sent: the draft is gone.
    await openFeedback(page)
    await expect(page.getByTestId('feedback-title')).toHaveValue('')
    await expect(page.getByTestId('feedback-element')).toHaveCount(0)
  })

  test('offline keeps the draft; "Erneut versuchen" sends once the connection is back', async ({ page }) => {
    await setGithubMode(page, 'offline')
    await openFeedback(page)
    await toReview(page)
    await page.getByTestId('feedback-send').click()
    await expect(page.getByTestId('feedback-problem')).toContainText('Keine Verbindung. Dein Entwurf bleibt erhalten.')
    await expect(dialog(page)).toBeVisible()
    expect(await githubCalls(page)).toHaveLength(1) // never an automatic retry
    await page.waitForTimeout(500)
    expect(await githubCalls(page)).toHaveLength(1)

    await setGithubMode(page, 'ok')
    await page.getByRole('button', { name: 'Erneut versuchen' }).click()
    await expect(page.getByText('Danke, das Feedback ist als Issue #4711 angelegt.').first()).toBeVisible()
  })

  test('a rate-limit answer is shown inline and keeps the draft', async ({ page }) => {
    await setGithubMode(page, 'forbidden')
    await openFeedback(page)
    await toReview(page)
    await page.getByTestId('feedback-send').click()
    await expect(page.getByTestId('feedback-problem')).toContainText('GitHub hat die Anfrage abgelehnt')
    await page.getByTestId('feedback-back').click()
    await expect(page.getByTestId('feedback-title')).toHaveValue('Karte wird abgeschnitten')
  })

  test('Escape and Abbrechen cannot close the dialog mid-send; the failure is shown afterwards (#254 L1)', async ({ page }) => {
    await setGithubMode(page, 'slow-forbidden')
    await openFeedback(page)
    await toReview(page)
    await page.getByTestId('feedback-send').click()
    await expect(page.getByTestId('feedback-send')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeVisible()
    await expect(page.getByTestId('feedback-problem')).toContainText('GitHub hat die Anfrage abgelehnt')
    await expect(dialog(page)).toBeVisible()
  })

  test('the review shows no fallback note while the token check is pending (#254 L7)', async ({ page }) => {
    // The Tauri API reads `__TAURI_INTERNALS__.invoke` per call, so wrapping it here delays the token check.
    await page.evaluate(() => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
      const original = internals.invoke
      internals.invoke = async (cmd, args) => {
        if (cmd === 'secret_status') await new Promise(resolve => setTimeout(resolve, 1500))
        return original(cmd, args)
      }
    })
    await openFeedback(page)
    await toReview(page)
    await expect(page.getByTestId('feedback-open-browser')).toBeDisabled()
    await expect(page.getByTestId('feedback-fallback-note')).toHaveCount(0)
    await expect(page.getByTestId('feedback-trimmed-note')).toHaveCount(0)
    await expect(page.getByTestId('feedback-send')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('feedback-fallback-note')).toHaveCount(0)
  })

  test('a rejected token shows the link to the GitHub access page and the browser fallback, without a request', async ({ page }) => {
    await markRejected(page, 'github-feedback')
    await openFeedback(page)
    await toReview(page)
    await expect(page.getByTestId('feedback-fallback-note')).toContainText('GitHub hat das Feedback-Token abgelehnt')
    await expect(page.getByTestId('feedback-send')).toHaveCount(0)
    await expect(page.getByTestId('feedback-open-browser')).toBeVisible()
    expect(await githubCalls(page)).toEqual([])
    await page.getByRole('link', { name: 'GitHub-Zugriff' }).click()
    await expect(page).toHaveURL(/\/settings\/github$/)
  })

  test('a 401 switches to the fallback for the rest of the session', async ({ page }) => {
    // Since the repo is public the access check on open reads the token first, so a 401 shows before any send.
    await setGithubMode(page, 'unauthorized')
    await openFeedback(page)
    await toReview(page)
    await expect(page.getByTestId('feedback-fallback-note')).toContainText('GitHub hat das Feedback-Token abgelehnt')
    await expect(page.getByTestId('feedback-open-browser')).toBeVisible()
    await expect(page.getByTestId('feedback-send')).toHaveCount(0)
    await page.getByTestId('feedback-back').click()
    await expect(page.getByTestId('feedback-title')).toHaveValue('Karte wird abgeschnitten')
    expect(await githubCalls(page, { method: 'POST' })).toEqual([])
  })

  test('review and form pass axe', async ({ page }) => {
    await openFeedback(page)
    await pickCard(page, 'seed-open-1')
    await page.getByTestId('feedback-title').fill('Axe')
    await settleAnimations(page)
    const form = await new AxeBuilder({ page }).include('[data-testid="feedback-dialog"]').analyze()
    expect(form.violations).toEqual([])
    await page.getByTestId('feedback-next').click()
    await expect(page.getByTestId('feedback-review')).toBeVisible()
    await settleAnimations(page)
    const review = await new AxeBuilder({ page }).include('[data-testid="feedback-dialog"]').analyze()
    expect(review.violations).toEqual([])
  })

  test('the picker bar passes axe', async ({ page }) => {
    await openFeedback(page)
    await page.getByTestId('feedback-pick-element').click()
    await expect(page.getByTestId('element-picker-bar')).toBeVisible()
    const box = (await card(page, 'seed-open-1').boundingBox())!
    await page.mouse.move(box.x + 20, box.y + 20)
    const results = await new AxeBuilder({ page }).include('[data-feedback-picker]').analyze()
    expect(results.violations).toEqual([])
  })
})

test.describe('Feedback fallback without a token (desktop)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
  })

  test('opens a prefilled issues/new link through the opener and sends nothing', async ({ page }) => {
    await openFeedback(page)
    // Public repository: the form says so before anything is written, and that sending needs a GitHub account
    await expect(page.getByTestId('feedback-public-note')).toHaveText('Dein Feedback wird ein öffentliches Issue auf GitHub. Zum Absenden brauchst du ein GitHub-Konto.')
    await pickCard(page, 'seed-open-1')
    await toReview(page, 'Titel mit Ümläut & Zeichen')
    await expect(page.getByTestId('feedback-review-intro')).toContainText('öffentliches Issue an jaylouiz/kan-do, angemeldet mit deinem GitHub-Konto')
    await expect(page.getByTestId('feedback-fallback-note')).toHaveCount(0)
    await expect(page.getByTestId('feedback-send')).toHaveCount(0)

    await page.getByTestId('feedback-open-browser').click()
    await expect(dialog(page)).toBeHidden()
    await expect(page.getByText('GitHub ist im Browser geöffnet. Sende das Issue dort ab.', { exact: true })).toBeVisible()
    const state = await stubState(page)
    expect(state.openedUrls).toHaveLength(1)
    const url = new URL(state.openedUrls[0]!)
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/jaylouiz/kan-do/issues/new')
    expect(url.searchParams.get('title')).toBe('Titel mit Ümläut & Zeichen')
    expect(url.searchParams.get('labels')).toBe('inbox')
    expect(url.searchParams.get('body')).toContain('Der lange Titel läuft aus der Karte.')
    expect(await githubCalls(page)).toEqual([])
  })
})

test.describe('Feedback with a token of a user without write access (desktop)', () => {
  // A public user may store a token (the updates token is optional too): only write access to the repo means in-app send.
  test('takes the browser path; the only request is the read-only access check', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, { entries: { 'github-feedback': TOKEN }, githubMode: 'read-only' })
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await openFeedback(page)
    await expect(page.getByTestId('feedback-public-note')).toContainText('Zum Absenden brauchst du ein GitHub-Konto.')
    await toReview(page, 'Ohne Schreibrecht')
    await expect(page.getByTestId('feedback-send')).toHaveCount(0)
    await expect(page.getByTestId('feedback-fallback-note')).toHaveCount(0)
    await page.getByTestId('feedback-open-browser').click()
    await expect(dialog(page)).toBeHidden()
    expect((await stubState(page)).openedUrls).toHaveLength(1)
    expect((await githubCalls(page, { accessCheck: true })).map(call => `${call.method} ${call.path}`)).toEqual(['GET /repos/jaylouiz/kan-do'])
  })
})
