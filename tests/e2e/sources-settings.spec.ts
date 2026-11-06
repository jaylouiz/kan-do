import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, seedMixedBoard } from './helpers/seed'
import { completeNotionWizard } from './helpers/notionWizard'
import { contrastRatio, type Rgb } from './helpers/contrast'
import { closeMore, goToPlace, moreButton, morePanel, openMore, openSettings, resync } from './helpers/appNav'

/**
 * The "Verbindungen" page (#324, epic #264 section 6) on the Notion stub: the list with its states, the
 * default in the rows, repair / settings / disconnect / connect, and the ways onto the page. Sequences, not
 * single calls: set the default, then disconnect the default; connect, then make the new source the default.
 */

const row = (page: Page, id: string) => page.getByTestId(`source-row-${id}`)
const sourcesFromStorage = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('board-store') ?? '{}') as { boardConfig?: { sources?: unknown } }).boardConfig?.sources ?? null)

/** From the board by the gear, so a fetch has run and the health is real. */
async function openFromBoard(page: Page, baseURL: string | undefined) {
  await page.goto(`${baseURL}/tasks`)
  await openSettings(page, 'sources')
  await expect(page.getByRole('heading', { level: 2, name: 'Deine Verbindungen' })).toBeVisible()
}

test.describe('Local only', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('/settings/notion without an integration is one muted sentence and a soft button, no warning block (#557)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/settings/notion`)

    const block = page.getByTestId('notion-not-configured')
    await expect(block).toContainText('Noch keine Notion-Integration eingerichtet.')
    await expect(block.locator('svg, [class*="text-warning"]')).toHaveCount(0)
    await block.getByRole('link', { name: 'Integration einrichten' }).click()
    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
  })

  test('/settings has no visible page header (the bar names it), a settings sub-page keeps its own (#670)', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)
    await expect(page.locator('header.page-header')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toHaveClass(/sr-only/)

    await page.goto(`${baseURL}/settings/topics`)
    await expect(page.locator('header.page-header h1')).toHaveText('Themen und Aktivitäten')
  })

  test('the Verwaltung rows share the connection rows\' title size and icon column (#683, #691)', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)
    const sizeOf = (el: import('@playwright/test').Locator) => el.evaluate(node => getComputedStyle(node).fontSize)
    const iconX = (el: import('@playwright/test').Locator) => el.evaluate(node => node.getBoundingClientRect().x)
    const iconOf = (el: import('@playwright/test').Locator) => el.locator('svg, [class*="i-ph"], span[class*="iconify"]').first()
    const notion = page.getByTestId('source-more-notion')
    const sourceSize = await sizeOf(notion.locator('p'))
    const sourceIconX = await iconX(iconOf(notion))

    await openSettings(page, 'manage')
    const link = page.getByTestId('settings-subpages').getByTestId('settings-subpage-link').first()
    await expect(link).toContainText('Themen und Aktivitäten')
    expect(await sizeOf(link.getByTestId('settings-subpage-link-label'))).toBe(sourceSize)
    expect(await iconX(iconOf(link))).toBe(sourceIconX)
  })

  test('the Fokus switch\'s off state meets 3:1 against the page background (#683, WCAG 1.4.11)', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)
    await openSettings(page, 'board')
    const sw = page.getByTestId('focus-switch')
    await expect(sw).toHaveAttribute('data-state', 'unchecked')
    const rgbOf = (color: string) => page.evaluate((value) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.fillStyle = value
      ctx.fillRect(0, 0, 1, 1)
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)) as Rgb
    }, color)
    const border = await sw.evaluate(node => getComputedStyle(node).borderTopColor)
    const thumb = await sw.locator('span').first().evaluate(node => getComputedStyle(node).backgroundColor)
    const pageBg = await page.evaluate(() => getComputedStyle(document.querySelector('.sub-page')!).backgroundColor)
    const page_ = await rgbOf(pageBg)
    expect(contrastRatio(await rgbOf(border), page_)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(await rgbOf(thumb), page_)).toBeGreaterThanOrEqual(3)
  })

  test('lists Lokal with the Standard badge and no button, Notion to connect and Todoist as "bald verfügbar"', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)

    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible()
    await expect(page.getByTestId('sources-lead')).toHaveText(
      'Neue Aufgaben landen in der Verbindung mit „Standard“. Beim Hinzufügen kannst du eine andere Verbindung wählen. Schnell gestartete Aufgaben in „Jetzt“ landen immer hier.',
    )
    await expect(page.getByText('Neue Aufgaben speichern in')).toHaveCount(0)

    const local = row(page, 'local')
    await expect(local).toContainText('Lokal')
    await expect(local).toContainText('Auf diesem Gerät gespeichert')
    await expect(page.getByTestId('source-default-local')).toHaveText('Standard')
    await expect(local.getByRole('button')).toHaveCount(0)
    await expect(page.getByTestId('sources-connected').locator('li')).toHaveCount(1)

    await expect(page.getByRole('heading', { level: 2, name: 'Weitere Verbindungen' })).toBeVisible()
    await expect(page.getByTestId('source-more-notion').getByRole('button', { name: 'Notion verbinden' })).toBeVisible()
    const todoist = page.getByTestId('source-more-todoist')
    await expect(todoist).toContainText('bald verfügbar')
    await expect(todoist.getByRole('button')).toHaveCount(0)
  })

  test('"Verbinden" runs the Notion setup: Notion joins the list with its tasks on the board, the default stays Lokal; then it can become the default', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)
    await page.getByRole('button', { name: 'Notion verbinden' }).click()
    await completeNotionWizard(page)

    await expect(row(page, 'notion')).toBeVisible()
    await expect(page.getByTestId('source-more-notion')).toHaveCount(0)
    await expect(page.getByTestId('source-default-local')).toBeVisible()
    await expect(page.getByTestId('source-default-notion')).toHaveCount(0)
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'local' })
    await expect(page.getByTestId('source-status-notion')).toContainText('Synchronisiert')
    await expect(page.getByRole('button', { name: 'Notion verbinden' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Notion als Standard festlegen' }).click()
    await expect(page.getByTestId('source-default-notion')).toBeVisible()
    await expect(page.getByTestId('source-default-local')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Lokal als Standard festlegen' })).toBeVisible()
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'notion' })

    await goToPlace(page, 'Heute')
    await expect(page.locator('.task-wrapper', { hasText: 'Fokusaufgabe vorbereiten' }).first()).toBeVisible()
    await expect(page.locator('.task-wrapper', { hasText: 'Konzept ausarbeiten' }).first()).toBeVisible() // the Local tasks stayed
  })

  test('a never-onboarded visitor is sent to the welcome page', async ({ browser, baseURL }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${baseURL}/settings/sources`)
    await expect(page).toHaveURL(/\/welcome$/)
    await context.close()
  })
})

test.describe('Local and Notion connected', () => {
  test('the default moves with "Als Standard festlegen", survives a reload and returns', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await openFromBoard(page, baseURL)

    await expect(page.getByTestId('source-default-notion')).toBeVisible()
    await expect(page.getByTestId('source-status-notion')).toContainText('Synchronisiert · ')
    await expect(page.getByTestId('source-set-default-local')).toHaveAccessibleName('Lokal als Standard festlegen')
    await expect(page.getByTestId('source-more-notion')).toHaveCount(0)

    await page.getByRole('button', { name: 'Lokal als Standard festlegen' }).click()
    await expect(page.getByTestId('source-default-local')).toBeVisible()
    await expect(page.getByTestId('source-default-notion')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Notion als Standard festlegen' })).toBeVisible()
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'local' })

    await page.reload()
    await expect(page.getByTestId('source-default-local')).toBeVisible()
    await page.getByRole('button', { name: 'Notion als Standard festlegen' }).click()
    await expect(page.getByTestId('source-default-notion')).toBeVisible()
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'notion' })
  })

  test('"Notion-Einstellungen" opens the Notion settings page', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await openFromBoard(page, baseURL)
    await page.getByRole('button', { name: 'Notion-Einstellungen' }).click()
    await expect(page).toHaveURL(/\/settings\/notion$/)
    await expect(page.getByRole('heading', { name: 'Notion-Einstellungen' })).toBeVisible()
    await expect(page.getByTestId('notion-disconnect')).toHaveCount(0) // disconnecting lives on the Verbindungen page
  })

  test('set Notion as the default, then disconnect it: the dialog names the fallback, Lokal takes the badge, Notion is offered again', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await openFromBoard(page, baseURL)
    await expect(page.getByTestId('source-default-notion')).toBeVisible()

    const trigger = page.getByRole('button', { name: 'Notion trennen' })
    await trigger.click()
    const dialog = page.getByTestId('disconnect-dialog')
    await expect(dialog).toContainText('4 Aufgaben verlassen das Board')
    await expect(page.getByTestId('disconnect-default-note')).toHaveText('Neue Aufgaben werden danach lokal gespeichert.')

    // Cancel first: nothing changes and focus returns to the trigger
    await page.getByTestId('disconnect-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'notion' })

    await trigger.click()
    await page.getByTestId('disconnect-anyway').click()
    await expect(page).toHaveURL(/\/settings(\?tab=sources)?$/)
    await expect(row(page, 'notion')).toHaveCount(0)
    await expect(page.getByTestId('source-default-local')).toBeVisible()
    await expect(page.getByTestId('source-more-notion').getByRole('button', { name: 'Notion verbinden' })).toBeVisible()
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: [], default: 'local' })
  })

  test('disconnecting a Notion that is not the default keeps Lokal as the default', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', once: true })
    await openFromBoard(page, baseURL)
    await page.getByRole('button', { name: 'Notion trennen' }).click()
    await expect(page.getByTestId('disconnect-default-note')).toHaveCount(0)
    await page.getByTestId('disconnect-anyway').click()
    await expect(row(page, 'notion')).toHaveCount(0)
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: [], default: 'local' })
  })

  test('the palette entry "Einstellungen öffnen" lands on the page', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/tasks`)
    await expect(moreButton(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' })
    await expect(palette).toBeVisible()
    await palette.getByRole('option', { name: 'Einstellungen öffnen' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('tab', { name: 'Board' })).toHaveAttribute('aria-selected', 'true')
    await openSettings(page, 'sources')
    await expect(page.getByRole('heading', { level: 2, name: 'Deine Verbindungen' })).toBeVisible()
  })
})

test.describe('Notion that needs attention', () => {
  test.beforeEach(async ({ context }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` } })
  })

  test('shows "Verbindung prüfen" in the warning colour with the repair, which opens the setup at the token step and returns focus on cancel', async ({ page, baseURL }) => {
    const rejected = page.waitForResponse((res) => res.url().includes('/api/notion/') && res.status() === 401)
    await page.goto(`${baseURL}/tasks`)
    await rejected
    await openSettings(page, 'sources')

    const status = page.getByTestId('source-status-notion')
    await expect(status).toHaveText('Verbindung prüfen')
    await expect(status).toHaveClass(/text-warning/)
    const repair = page.getByRole('button', { name: 'Notion-Verbindung reparieren' })
    await expect(repair).toBeVisible()

    await repair.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Mit Notion verbinden')).toBeVisible()
    await expect(dialog.getByPlaceholder('Integrationstoken eingeben')).toBeVisible() // the token step, not the mapping
    await expect(dialog.getByText('Notion-Einrichtung ist nicht mehr gültig')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Zurücksetzen' })).toHaveCount(0) // the old reset is gone
    await page.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(repair).toBeFocused()
    await expect(page).toHaveURL(/\/settings(\?tab=sources)?$/)
    await expect(status).toHaveText('Verbindung prüfen') // cancelling repairs nothing
  })

  test('sequence: revoked token, repair from the Mehr panel, a new token, the source is healthy and the sync works', async ({ page, baseURL }) => {
    const rejected = page.waitForResponse((res) => res.url().includes('/api/notion/') && res.status() === 401)
    await page.goto(`${baseURL}/tasks`)
    await rejected
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible() // tasks stay

    await expect(moreButton(page)).toHaveAccessibleName('Mehr, Verbindungsproblem')
    await (await openMore(page)).getByTestId('sync-repair-notion').click()
    await expect(page).toHaveURL(/\/settings(\?tab=sources)?$/)
    await expect(page.getByTestId('source-status-notion')).toHaveText('Verbindung prüfen')

    await page.getByRole('button', { name: 'Notion-Verbindung reparieren' }).click()
    await expect(page.getByRole('dialog').getByPlaceholder('Integrationstoken eingeben')).toBeVisible()
    await completeNotionWizard(page) // a fresh stub token: the revoked one is replaced

    const status = page.getByTestId('source-status-notion')
    await expect(status).toHaveText(/^Synchronisiert/)
    await expect(status).not.toHaveClass(/text-warning/)
    await expect(page.getByRole('button', { name: 'Notion-Verbindung reparieren' })).toHaveCount(0)

    // Back on the board the dot and the repair line are gone and a sync goes through
    await page.goBack()
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(moreButton(page)).toHaveAccessibleName('Mehr')
    const sync = page.waitForResponse((res) => res.url().includes('/api/notion/') && res.status() === 200)
    await resync(page)
    await sync
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
  })

  test('a broken Notion can still be disconnected from its row', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`)
    await openSettings(page, 'sources')
    await expect(page.getByTestId('source-status-notion')).toHaveText('Verbindung prüfen')
    await page.getByRole('button', { name: 'Notion trennen' }).click()
    await expect(page.getByTestId('disconnect-sync-first')).toHaveCount(0) // unreachable: no "sync first"
    await page.getByTestId('disconnect-anyway').click()
    await expect(row(page, 'notion')).toHaveCount(0)
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: [], default: 'local' })
  })
})

test.describe('Notion that is merely offline', () => {
  test('the Mehr panel repair lands on the page, which offers no repair and forces no token step', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    // The page-load sync must have finished before Notion goes offline: one still running when the route is
    // installed fails mid-way and puts the problem dot on ⋯ (its last call is the query)
    const loadSync = page.waitForResponse((res) => res.url().includes('/api/notion/query-data-source'))
    await page.goto(`${baseURL}/tasks`)
    await loadSync
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()
    await expect((await openMore(page)).getByTestId('more-sync')).toBeEnabled()
    await closeMore(page)

    await page.route('**/api/notion/**', (route) => route.abort('internetdisconnected'))
    await resync(page)
    await morePanel(page).getByTestId('sync-repair-notion').click()

    await expect(page).toHaveURL(/\/settings(\?tab=sources)?$/)
    await expect(page.getByRole('heading', { level: 2, name: 'Deine Verbindungen' })).toBeVisible()
    await expect(page.getByTestId('source-status-notion')).toHaveText(/^Synchronisiert/) // last-sync line, no warning
    await expect(page.getByRole('button', { name: 'Notion-Verbindung reparieren' })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test.describe('at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('rows wrap their actions under the name, nothing overflows and every button is 44px high', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', notionConfig: { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` } })
    await openFromBoard(page, baseURL)
    await expect(page.getByTestId('source-status-notion')).toHaveText('Verbindung prüfen')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    const notion = row(page, 'notion')
    const nameBox = (await notion.locator('p').first().boundingBox())!
    const buttons = notion.getByRole('button')
    await expect(buttons).toHaveCount(4) // set default, repair, settings, disconnect
    for (const button of await buttons.all()) {
      const box = (await button.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.y).toBeGreaterThan(nameBox.y + nameBox.height - 1) // wrapped under the name
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
  })
})
