import { expect, test, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

/**
 * Live copy editor (#59): a dev-only tool, present in the E2E build because `scripts/e2e-server.mjs` sets
 * KANDO_COPY_EDITOR=1 (a normal build drops it, `tests/config/copy-editor-build-output.test.ts`). Its dev routes do not
 * exist in a build, so the specs answer them with `page.route`; the real routes are covered by Vitest.
 * The tool's own copy is English and not in the locale files.
 */

const dialog = (page: Page) => page.getByTestId('copy-editor-dialog')
const bar = (page: Page) => page.getByRole('region', { name: 'UI copy editor' })
const heading = (page: Page, text: string) => page.getByRole('heading', { name: text, exact: true }).first()

async function enterMode(page: Page) {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Edit UI copy')
  await page.getByRole('option', { name: /Edit UI copy: text selection mode/ }).click()
  await expect(bar(page)).toBeVisible()
}

async function pickOffen(page: Page) {
  await page.getByText('Offen', { exact: true }).first().click()
  await expect(page.getByTestId('copy-editor-key')).toHaveText('board.columns.open')
}

test.describe('Live copy editor', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open-list .task-wrapper')).toHaveCount(2)
  })

  test('the mode is entered from the command bar; Alt+K is inert outside it; Esc leaves', async ({ page }) => {
    await page.keyboard.press('Alt+KeyK')
    await expect(dialog(page)).toHaveCount(0)
    await expect(bar(page)).toHaveCount(0)

    await enterMode(page)
    await expect(bar(page).getByRole('status')).toContainText('Text selection mode')
    await page.keyboard.press('Escape')
    await expect(bar(page)).toHaveCount(0)

    await enterMode(page)
    await bar(page).getByTestId('copy-editor-leave').click()
    await expect(bar(page)).toHaveCount(0)
    await page.keyboard.press('Alt+KeyK')
    await expect(dialog(page)).toHaveCount(0)
  })

  test('hover outlines editable text, a click picks its key instead of acting, task text is not editable', async ({ page }) => {
    await enterMode(page)
    await page.getByText('Offen', { exact: true }).first().hover()
    await expect(page.locator('[data-kando-copy-editor][aria-hidden="true"]')).toBeVisible()

    // A task title is user data (data-private), never copy; clicking it must not open the card either.
    await page.getByText('Dokumentation lesen').first().click()
    await expect(bar(page).getByRole('status')).toContainText('No UI copy here')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(dialog(page)).toHaveCount(0)

    await pickOffen(page)
    await expect(page.getByTestId('copy-editor-agent')).toContainText('agent translates at Publish')
  })

  test('an edit shows live in the app and survives a reload; Revert restores the original', async ({ page }) => {
    await enterMode(page)
    await pickOffen(page)
    await page.getByTestId('copy-editor-text').fill('Noch offen')
    await page.getByTestId('copy-editor-save').click()
    await expect(page.getByText('Saved. The app shows it now.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(heading(page, 'Noch offen')).toBeVisible()
    await expect(bar(page).getByTestId('copy-editor-publish')).toContainText('1')

    await page.reload()
    await expect(heading(page, 'Noch offen')).toBeVisible()

    await enterMode(page)
    await page.getByText('Noch offen', { exact: true }).first().click()
    await page.getByTestId('copy-editor-revert').click()
    await page.keyboard.press('Escape')
    await expect(heading(page, 'Offen')).toBeVisible()
  })

  test('switching the language you write keeps what was typed in each', async ({ page }) => {
    await enterMode(page)
    await pickOffen(page)
    await page.getByTestId('copy-editor-text').fill('Noch offen')
    await page.getByTestId('copy-editor-write-en').click()
    await expect(page.getByTestId('copy-editor-text')).toHaveValue('Open')
    await page.getByTestId('copy-editor-text').fill('Still open')
    await page.getByTestId('copy-editor-write-de').click()
    await expect(page.getByTestId('copy-editor-text')).toHaveValue('Noch offen')
    await page.getByTestId('copy-editor-write-other').click()
    await expect(page.getByTestId('copy-editor-other-text')).toHaveValue('Still open')
  })

  test('a decided term cannot be saved, a placeholder mismatch neither', async ({ page }) => {
    await enterMode(page)
    await pickOffen(page)
    await page.getByTestId('copy-editor-text').fill('Quelle')
    await expect(page.getByTestId('copy-editor-blocking')).toContainText('decided term')
    await page.getByTestId('copy-editor-save').click()
    await expect(page.getByText('Saved.')).toHaveCount(0)

    await page.getByTestId('copy-editor-write-other').click()
    await page.getByTestId('copy-editor-text').fill('Offen {x}')
    await expect(page.getByTestId('copy-editor-blocking')).toContainText('placeholders differ')
  })

  test('Alt+K searches every key in both languages, also copy that is not on screen', async ({ page }) => {
    await enterMode(page)
    await page.keyboard.press('Alt+KeyK')
    await expect(dialog(page)).toBeVisible()
    const search = dialog(page).getByPlaceholder('Search keys and text in DE and EN')
    await search.fill('Click to edit')
    await dialog(page).getByRole('option', { name: /common\.clickToEdit/ }).click()
    await expect(page.getByTestId('copy-editor-key')).toHaveText('common.clickToEdit')
    await search.fill('zzzzqqq')
    await expect(dialog(page).getByRole('status')).toContainText('No key or text matches')
  })

  test('Publish: the agent drafts the other language for review, then the PR is pushed', async ({ page }) => {
    const sent: { translate: unknown, publish: unknown } = { translate: null, publish: null }
    await page.route('**/api/dev/copy/translate', async (route) => {
      sent.translate = route.request().postDataJSON()
      await new Promise(resolve => setTimeout(resolve, 300))
      await route.fulfill({ json: { ok: true, drafts: { 'board.columns.open': { text: 'Still open', problems: [], warnings: [] } } } })
    })
    await page.route('**/api/dev/copy/publish', async (route) => {
      sent.publish = route.request().postDataJSON()
      await route.fulfill({ json: { ok: true, branch: 'copy/20260101-000000-board', prUrl: 'https://github.com/o/r/pull/9', note: null, edits: 1, files: 2, warnings: [] } })
    })

    await enterMode(page)
    await pickOffen(page)
    await page.getByTestId('copy-editor-text').fill('Noch offen')
    await page.getByTestId('copy-editor-save').click()
    await page.getByTestId('copy-editor-tab-publish').click()

    const view = page.getByTestId('copy-editor-publish-view')
    await expect(page.getByTestId('copy-editor-count')).toContainText('1 edit in 2 files')
    await expect(page.getByTestId('copy-editor-push')).toBeDisabled()
    await page.getByTestId('copy-editor-translate').click()
    await expect(page.getByTestId('copy-editor-translate')).toContainText('Agent is translating')
    await expect(view.getByText('agent draft')).toBeVisible()
    expect(sent.translate).toEqual({ items: [{ key: 'board.columns.open', from: 'de', value: 'Noch offen' }] })
    expect(sent.publish).toBeNull()

    await page.getByTestId('copy-editor-push').click()
    await expect(page.getByTestId('copy-editor-done')).toContainText('https://github.com/o/r/pull/9')
    expect(sent.publish).toEqual({ edits: [{ key: 'board.columns.open', de: 'Noch offen', en: 'Still open', changed: ['de', 'en'] }] })
    await expect(view.getByTestId('copy-editor-clear-published')).toBeVisible()
  })

  test('Publish failures keep the edits: translation failed, then writing the other language myself, then a failed push', async ({ page }) => {
    await page.route('**/api/dev/copy/translate', route => route.fulfill({ status: 502, json: { ok: false, errors: ['the agent command failed (1): not logged in'] } }))
    await page.route('**/api/dev/copy/publish', route => route.fulfill({ status: 502, json: { ok: false, step: 'check', errors: ['npm run i18n:check failed', 'FAIL terminology'] } }))

    await enterMode(page)
    await pickOffen(page)
    await page.getByTestId('copy-editor-text').fill('Noch offen')
    await page.getByTestId('copy-editor-save').click()
    await page.getByTestId('copy-editor-tab-publish').click()
    await page.getByTestId('copy-editor-translate').click()
    await expect(page.getByTestId('copy-editor-error')).toContainText('not logged in')
    await expect(page.getByTestId('copy-editor-count')).toContainText('1 edit')

    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await page.getByTestId('copy-editor-write-other').click()
    await page.getByTestId('copy-editor-other-text').fill('Still open')
    await page.getByTestId('copy-editor-save').click()
    await page.getByTestId('copy-editor-tab-publish').click()
    await expect(page.getByTestId('copy-editor-translate')).toHaveCount(0)
    await page.getByTestId('copy-editor-push').click()
    await expect(page.getByTestId('copy-editor-error')).toContainText('Publish stopped at "check"')
    await expect(page.getByTestId('copy-editor-error')).toContainText('FAIL terminology')
    await expect(page.getByTestId('copy-editor-count')).toContainText('1 edit')
  })

  test('at 390px the bar wraps, the dialog fits and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await enterMode(page)
    const box = await bar(page).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await bar(page).getByTestId('copy-editor-search').click()
    await expect(dialog(page)).toBeVisible()
    await dialog(page).getByRole('option', { name: /common\.clickToEdit/ }).click()
    await expect(page.getByTestId('copy-editor-text')).toBeVisible()
    // the list gives way to the editor; "All keys" brings it back
    await expect(dialog(page).getByRole('option', { name: /common\.clickToEdit/ })).toBeHidden()
    await page.getByTestId('copy-editor-all-keys').click()
    await expect(dialog(page).getByRole('option', { name: /common\.clickToEdit/ })).toBeVisible()
    await dialog(page).getByRole('option', { name: /common\.clickToEdit/ }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBe(0)
    const dialogBox = await dialog(page).boundingBox()
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
  })
})
