import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { seedLocalBoard } from './helpers/seed'
import { githubCalls, installTauriStub, setClipboardFails, setGithubMode, stubState } from './helpers/tauriStub'

/**
 * #247: screenshot in the in-app feedback, against the stubbed desktop IPC. `feedback_capture` answers a
 * generated PNG, `github_request` never reaches GitHub, nothing is written to the real feedback-assets branch.
 */

const TOKEN = 'ghp_feedback_abcd'
const dialog = (page: Page) => page.getByRole('dialog', { name: /Feedback senden|Screenshot markieren|Prüfen und senden/ })

async function openFeedback(page: Page) {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
  await palette.getByRole('option', { name: 'Feedback senden' }).click()
  await expect(page.getByTestId('feedback-form')).toBeVisible()
}

async function settleAnimations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target
      return !target?.closest('[data-testid="feedback-dialog"], [data-slot="overlay"]') || a.playState !== 'running'
    }))
}

async function addScreenshot(page: Page, title = 'Karte wird abgeschnitten') {
  await page.getByTestId('feedback-title').fill(title)
  await page.getByTestId('feedback-add-screenshot').click()
  await expect(page.getByTestId('feedback-annotate')).toBeVisible()
}

/** Drags on the annotate canvas between two fractions of its size. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByTestId('annotate-canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 })
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 })
  await page.mouse.up()
}

async function toReviewWithShot(page: Page) {
  await addScreenshot(page)
  await page.getByTestId('annotate-done').click()
  await expect(page.getByTestId('feedback-review')).toBeVisible()
}

const methods = async (page: Page) => (await githubCalls(page)).map(call => `${call.method} ${call.path.replace('/repos/jaylouiz/kan-do', '')}`)

test.describe('Feedback screenshot (desktop, token with Contents)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, { entries: { 'github-feedback': TOKEN } })
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await openFeedback(page)
  })

  test('the dialog is gone and the mask is set while the window is captured, then the annotate step opens', async ({ page }) => {
    await addScreenshot(page)
    const state = await stubState(page)
    expect(state.captures).toEqual([{ dialogPresent: false, mask: true }])
    await expect(page.locator('html')).not.toHaveClass(/kando-capture-mask/)
    await expect(dialog(page)).toContainText('Screenshot markieren')
    await expect(page.getByTestId('annotate-canvas')).toHaveAccessibleName('Screenshot-Vorschau, 0 Markierungen')
    await expect(page.getByTestId('annotate-tool-rect')).toBeFocused()
    await expect(page.getByTestId('annotate-mask')).toBeChecked()
  })

  test('switching the mask off takes the screenshot again without the mask', async ({ page }) => {
    await addScreenshot(page)
    await page.getByTestId('annotate-mask').uncheck()
    await expect(page.getByTestId('annotate-canvas')).toBeVisible()
    await expect.poll(async () => (await stubState(page)).captures).toEqual([
      { dialogPresent: false, mask: true },
      { dialogPresent: false, mask: false },
    ])
  })

  test('private task text is hidden behind the ink token while the mask class is set', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    const title = page.locator('.task-wrapper[data-task-id="seed-open-1"] [data-private]').first()
    const before = await title.evaluate(el => getComputedStyle(el).color)
    const masked = await title.evaluate((el) => {
      document.documentElement.classList.add('kando-capture-mask')
      const style = getComputedStyle(el)
      const result = { color: style.color, background: style.backgroundColor }
      document.documentElement.classList.remove('kando-capture-mask')
      return result
    })
    expect(masked.color).toBe('rgba(0, 0, 0, 0)')
    expect(masked.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(await title.evaluate(el => getComputedStyle(el).color)).toBe(before)
  })

  test('a redacted rectangle is one opaque colour in the flattened image; rectangle and arrow draw too', async ({ page }) => {
    await addScreenshot(page)
    await page.getByTestId('annotate-tool-redact').click()
    await expect(page.getByTestId('annotate-tool-redact')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('annotate-tool-rect')).toHaveAttribute('aria-pressed', 'false')
    await drag(page, [0.2, 0.2], [0.5, 0.45])
    await page.getByTestId('annotate-tool-rect').click()
    await drag(page, [0.6, 0.2], [0.9, 0.4])
    await page.getByTestId('annotate-tool-arrow').click()
    await drag(page, [0.6, 0.8], [0.8, 0.6])
    await expect(page.getByTestId('annotate-canvas')).toHaveAccessibleName('Screenshot-Vorschau, 3 Markierungen')

    await page.getByTestId('annotate-undo').click()
    await expect(page.getByTestId('annotate-canvas')).toHaveAccessibleName('Screenshot-Vorschau, 2 Markierungen')
    await page.getByTestId('annotate-clear').click()
    await expect(page.getByTestId('annotate-canvas')).toHaveAccessibleName('Screenshot-Vorschau, 0 Markierungen')
    await page.getByTestId('annotate-tool-redact').click()
    await drag(page, [0.2, 0.2], [0.5, 0.45])

    await page.getByTestId('annotate-done').click()
    await expect(page.getByTestId('feedback-review')).toBeVisible()
    const pixels = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="feedback-review-image"] canvas') as HTMLCanvasElement
      const ctx = canvas.getContext('2d')!
      const region = (x1: number, y1: number, x2: number, y2: number) => {
        const x = Math.round(canvas.width * x1)
        const y = Math.round(canvas.height * y1)
        const data = ctx.getImageData(x, y, Math.round(canvas.width * (x2 - x1)), Math.round(canvas.height * (y2 - y1))).data
        const colours = new Set<string>()
        for (let i = 0; i < data.length; i += 4) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`)
        return colours.size
      }
      return { redacted: region(0.23, 0.23, 0.47, 0.42), outside: region(0.6, 0.5, 0.9, 0.7), width: canvas.width }
    })
    expect(pixels.redacted).toBe(1)
    expect(pixels.outside).toBeGreaterThan(20)
    expect(pixels.width).toBe(1200)
  })

  test('review shows the image, the exact body and one line on what happens to it; unticking removes both', async ({ page }) => {
    await toReviewWithShot(page)
    await expect(page.getByTestId('feedback-review-image').locator('canvas')).toHaveAccessibleName('Screenshot, bereit zum Senden')
    await expect(page.getByTestId('feedback-delivery')).toHaveText('Wird mit dem Issue hochgeladen.')
    const preview = page.getByTestId('feedback-body-preview')
    await expect(preview).toContainText('![Screenshot](https://github.com/jaylouiz/kan-do/blob/feedback-assets/feedback/')
    await expect(preview).toContainText('gh api repos/jaylouiz/kan-do/contents/feedback/')
    await page.getByTestId('feedback-include-screenshot').uncheck()
    await expect(preview).not.toContainText('Screenshot')
    await expect(page.getByTestId('feedback-review-image')).toHaveCount(0)
  })

  test('send uploads first, then creates the issue; the body names the uploaded path', async ({ page }) => {
    await toReviewWithShot(page)
    await page.getByTestId('feedback-send').click()
    await expect(page.getByText('Danke, das Feedback ist als Issue #4711 angelegt.').first()).toBeVisible()

    expect(await methods(page)).toEqual(['GET /git/ref/heads/feedback-assets', expect.stringMatching(/^PUT \/contents\/feedback\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/), 'POST /issues'])
    const [put] = await githubCalls(page, { method: 'PUT' })
    const [issue] = await githubCalls(page, { method: 'POST', path: '/issues' })
    expect(put!.body).toMatchObject({ branch: 'feedback-assets' })
    expect(String(put!.body!.content)).toMatch(/^iVBORw0KGgo/) // PNG signature in base64
    expect(put!.body).not.toHaveProperty('sha')
    const path = put!.path.replace('/repos/jaylouiz/kan-do/contents/', '')
    expect(issue!.body!.body).toContain(`feedback-assets/${path}?raw=true`)
    expect(issue!.body!.labels).toEqual(['inbox'])

    // Sent: the image is gone from memory.
    await expect(dialog(page)).toBeHidden()
    await openFeedback(page)
    await expect(page.getByTestId('feedback-add-screenshot')).toBeVisible()
  })

  test('the first screenshot creates the orphan feedback-assets branch', async ({ page }) => {
    await page.evaluate(() => { (window as unknown as { __tauriStub: { assetsBranch: boolean } }).__tauriStub.assetsBranch = false })
    await toReviewWithShot(page)
    await page.getByTestId('feedback-send').click()
    await expect(page.getByText('Danke, das Feedback ist als Issue #4711 angelegt.').first()).toBeVisible()
    expect((await methods(page)).slice(0, 5)).toEqual([
      'GET /git/ref/heads/feedback-assets', 'POST /git/blobs', 'POST /git/trees', 'POST /git/commits', 'POST /git/refs',
    ])
    expect((await githubCalls(page, { method: 'POST', path: '/git/commits' }))[0]!.body).toMatchObject({ parents: [] })
    expect((await githubCalls(page, { method: 'POST', path: '/git/refs' }))[0]!.body).toMatchObject({ ref: 'refs/heads/feedback-assets' })
  })

  test('a retry after a failed issue reuses the uploaded image', async ({ page }) => {
    await setGithubMode(page, 'issue-fails')
    await toReviewWithShot(page)
    await page.getByTestId('feedback-send').click()
    await expect(page.getByTestId('feedback-problem')).toContainText('GitHub hat gerade Probleme')
    await setGithubMode(page, 'ok')
    await page.getByRole('button', { name: 'Erneut versuchen' }).click()
    await expect(page.getByText('Danke, das Feedback ist als Issue #4711 angelegt.').first()).toBeVisible()
    const all = await methods(page)
    expect(all.filter(m => m.startsWith('PUT '))).toHaveLength(1)
    expect(all.filter(m => m === 'POST /issues')).toHaveLength(2)
  })

  test('a token without Contents: write stops before any issue, then "Ohne Bild senden" copies the image and sends the text', async ({ page }) => {
    await setGithubMode(page, 'no-contents')
    await toReviewWithShot(page)
    await page.getByTestId('feedback-send').click()
    await expect(page.getByTestId('feedback-problem')).toContainText('Das Bild konnte nicht hochgeladen werden')
    expect((await methods(page)).filter(m => m === 'POST /issues')).toHaveLength(0)
    await expect(page.getByTestId('feedback-delivery')).toContainText('Das Token darf keine Dateien speichern')
    await expect(page.getByTestId('feedback-body-preview')).toContainText('Screenshot: paste it here (copied to the clipboard).')
    await expect(page.getByTestId('feedback-send')).toHaveText('Ohne Bild senden')
    expect((await stubState(page)).clipboard).toEqual([]) // nothing leaves without the click

    await page.getByTestId('feedback-send').click()
    await expect(page.getByText('Danke, das Feedback ist als Issue #4711 angelegt.').first()).toBeVisible()
    const state = await stubState(page)
    expect(state.clipboard).toEqual([{ type: 'image/png', size: expect.any(Number) }])
    expect(state.clipboard[0]!.size).toBeGreaterThan(1000)
    const issue = (await githubCalls(page, { path: '/issues' })).at(-1)!
    expect(issue.body!.body).toContain('Screenshot: paste it here (copied to the clipboard).')
    expect(issue.body!.body).not.toContain('![Screenshot]')
  })

  test('a failed capture says so and the rest of the report still goes through', async ({ context, page }) => {
    await page.evaluate(() => { (window as unknown as { __tauriStub: { captureError: string } }).__tauriStub.captureError = 'failed' })
    await page.getByTestId('feedback-title').fill('Ohne Bild')
    await page.getByTestId('feedback-add-screenshot').click()
    await expect(page.getByTestId('feedback-screenshot-failed')).toContainText('Screenshot nicht möglich')
    await expect(page.getByTestId('feedback-title')).toHaveValue('Ohne Bild')
    await page.getByTestId('feedback-next').click()
    await expect(page.getByTestId('feedback-review')).toBeVisible()
    await expect(page.getByTestId('feedback-body-preview')).not.toContainText('Screenshot')
    await page.getByTestId('feedback-send').click()
    await expect(page.getByText('Danke, das Feedback ist als Issue #4711 angelegt.').first()).toBeVisible()
    expect(await methods(page)).toEqual(['POST /issues'])
    void context
  })

  test('"Zurück" from the annotate step keeps the capture; "Entfernen" drops it', async ({ page }) => {
    await addScreenshot(page)
    await page.getByTestId('annotate-back').click()
    await expect(page.getByTestId('feedback-screenshot-thumb')).toBeVisible()
    await page.getByTestId('feedback-screenshot-edit').click()
    await expect(page.getByTestId('feedback-annotate')).toBeVisible()
    await page.getByTestId('annotate-back').click()
    await page.getByTestId('feedback-screenshot-remove').click()
    await expect(page.getByTestId('feedback-add-screenshot')).toBeVisible()
  })

  test('the image and strokes never reach storage', async ({ page }) => {
    await addScreenshot(page)
    await drag(page, [0.2, 0.2], [0.5, 0.45])
    await page.getByTestId('annotate-done').click()
    await page.keyboard.press('Escape')
    const dump = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }).replace(/__tauriStub[\s\S]*$/, ''))
    expect(dump).not.toContain('iVBORw0KGgo')
    expect(dump).not.toContain('feedback/20')
  })

  test('annotate and review steps pass axe', async ({ page }) => {
    await addScreenshot(page)
    await settleAnimations(page)
    const annotate = await new AxeBuilder({ page }).include('[data-testid="feedback-dialog"]').analyze()
    expect(annotate.violations).toEqual([])
    await page.getByTestId('annotate-done').click()
    await expect(page.getByTestId('feedback-review')).toBeVisible()
    await settleAnimations(page)
    const review = await new AxeBuilder({ page }).include('[data-testid="feedback-dialog"]').analyze()
    expect(review.violations).toEqual([])
  })
})

test.describe('Feedback screenshot (desktop, no token)', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
    await openFeedback(page)
  })

  test('opens the prefilled link and copies the image to the clipboard; no GitHub request', async ({ page }) => {
    await toReviewWithShot(page)
    await expect(page.getByTestId('feedback-delivery')).toContainText('Füge es auf GitHub mit ⌘V in das Issue ein.')
    await page.getByTestId('feedback-open-browser').click()
    await expect(dialog(page)).toBeHidden()
    const state = await stubState(page)
    expect(state.clipboard).toEqual([{ type: 'image/png', size: expect.any(Number) }])
    expect(state.openedUrls).toHaveLength(1)
    expect(decodeURIComponent(state.openedUrls[0]!)).toContain('Screenshot: paste it here (copied to the clipboard).')
    expect(await githubCalls(page)).toEqual([])
  })

  test('a clipboard failure is reported and the link still opens', async ({ page }) => {
    await setClipboardFails(page, true)
    await toReviewWithShot(page)
    await page.getByTestId('feedback-open-browser').click()
    await expect(page.getByText('Das Bild konnte nicht in die Zwischenablage kopiert werden.').first()).toBeVisible()
    expect((await stubState(page)).openedUrls).toHaveLength(1)
  })
})

// /settings/github also makes the read-only open-time token check (GET .../issues); only the probe's blob writes count here.
const probeCalls = async (page: Page) => githubCalls(page, { path: '/git/blobs' })

test.describe('Settings: screenshot upload probe', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context, { entries: { 'github-feedback': TOKEN } })
    await page.goto('/settings/github')
  })

  test('creates an unreferenced blob only, and tells allowed from missing Contents: write', async ({ page }) => {
    const row = page.getByRole('region', { name: 'Feedback' })
    await row.getByRole('button', { name: 'Screenshot-Upload prüfen' }).click()
    await expect(row.getByTestId('github-upload-probe-result')).toHaveText('Upload erlaubt')
    const [call] = await probeCalls(page)
    expect(call).toMatchObject({ entry: 'github-feedback', method: 'POST', path: '/repos/jaylouiz/kan-do/git/blobs', body: { content: '', encoding: 'utf-8' } })

    await setGithubMode(page, 'no-contents')
    await row.getByRole('button', { name: 'Screenshot-Upload prüfen' }).click()
    await expect(row.getByTestId('github-upload-probe-result')).toContainText('Dem Token fehlt Inhalte: schreiben. Screenshots gehen dann in die Zwischenablage.')
    await expect(row.getByRole('link', { name: 'Token auf GitHub ändern' })).toBeVisible()
    expect((await probeCalls(page)).map(c => `${c.method} ${c.path.replace('/repos/jaylouiz/kan-do', '')}`)).toEqual(['POST /git/blobs', 'POST /git/blobs'])
  })

  test('the updates token has no probe', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'Updates' }).getByRole('button', { name: 'Screenshot-Upload prüfen' })).toHaveCount(0)
  })

  test('passes axe in the denied state', async ({ page }) => {
    await setGithubMode(page, 'no-contents')
    const row = page.getByRole('region', { name: 'Feedback' })
    await row.getByRole('button', { name: 'Screenshot-Upload prüfen' }).click()
    await expect(row.getByTestId('github-upload-probe-result')).toBeVisible()
    const result = await new AxeBuilder({ page }).analyze()
    expect(result.violations).toEqual([])
  })
})
