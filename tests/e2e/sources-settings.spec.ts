import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, seedMixedBoard } from './helpers/seed'
import { completeNotionWizard } from './helpers/notionWizard'
import { contrastRatio, type Rgb } from './helpers/contrast'
import { closeMore, goToPlace, moreButton, morePanel, openMore, openSettings, resync, sourceAction } from './helpers/appNav'

/**
 * The "Speicherorte" page (#324, epic #264 section 6) on the Notion stub: the list with its states, the
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
  await expect(page.getByRole('heading', { level: 2, name: 'Deine Speicherorte' })).toBeVisible()
}

test.describe('Local only', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('/settings/notion without an integration shows the setup as a stage of the page: 768 px sheet, intro first, no dialog (#652)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/settings/notion`)

    const stage = page.getByTestId('notion-setup-stage')
    await expect(stage.getByTestId('notion-setup-flow')).toBeVisible()
    await expect(stage.getByTestId('notion-setup-steps').locator('[aria-current="step"]')).toContainText('Vorbereitung')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('sub-page-column')).toHaveCount(1)
    expect((await page.getByTestId('sub-page-column').boundingBox())!.width).toBe(768)

    // Zurück on the first step reads where it leads and returns to the sources tab, nothing is written
    await expect(stage.getByTestId('setup-back')).toHaveText('Zurück zu Einstellungen')
    await stage.getByTestId('setup-back').click()
    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
    await expect(page.getByTestId('source-more-notion')).toBeVisible()
    await expect(page.getByTestId('sub-page-column')).toHaveCount(1) // the page fade has ended
    expect((await page.getByTestId('sub-page-column').boundingBox())!.width).toBe(672) // the other pages keep their column
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: [], default: 'local' })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notionConfig') ?? '{}').config ?? null)).toBeNull()
  })

  test('/settings has no visible page header (the bar names it), a settings sub-page keeps its own (#670)', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)
    await expect(page.locator('header.page-header')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toHaveClass(/sr-only/)

    await page.goto(`${baseURL}/settings/topics`)
    await expect(page.locator('header.page-header h1')).toHaveText('Themen und Aktivitäten')
  })

  test('the System rows share the connection rows\' title size and icon column (#683, #691)', async ({ page, baseURL }) => {
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

  test('lists Lokal with the Standard badge and no button, Notion to connect and Todoist as "Bald in der Desktop-App"', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)

    await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible()
    await expect(page.getByTestId('sources-lead')).toHaveText(
      'Beim Hinzufügen kannst du einen anderen Speicherort wählen und du kannst Aufgaben jederzeit verschieben.',
    )
    await expect(page.getByText('Neue Aufgaben speichern in')).toHaveCount(0)

    const local = row(page, 'local')
    await expect(local).toContainText('Lokal')
    await expect(local).toContainText('Auf diesem Gerät gespeichert')
    await expect(page.getByTestId('source-default-local')).toHaveText('Standard')
    await expect(local.getByRole('button')).toHaveCount(0)
    await expect(page.getByTestId('sources-connected').locator('li')).toHaveCount(1)

    await expect(page.getByRole('heading', { level: 3, name: 'Eine App verbinden' })).toBeVisible()
    await expect(page.getByTestId('source-more-notion').getByRole('button', { name: 'Notion verbinden' })).toBeVisible()
    const todoist = page.getByTestId('source-more-todoist')
    await expect(todoist).toContainText('Bald in der Desktop-App')
    await expect(todoist.getByRole('button')).toHaveCount(0)
  })

  test('"Verbinden" runs the Notion setup: Notion joins the list with its tasks on the board, the default stays Lokal; then it can become the default', async ({ page, baseURL }) => {
    await openFromBoard(page, baseURL)
    await page.getByRole('button', { name: 'Notion verbinden' }).click()
    await expect(page).toHaveURL(/\/settings\/notion\?setup=connect$/)
    await expect(page.getByTestId('notion-setup-steps').locator('[aria-current="step"]')).toContainText('Vorbereitung') // starts at the intro
    await completeNotionWizard(page)

    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
    await expect(row(page, 'notion')).toBeVisible()
    await expect(page.getByTestId('source-more-notion')).toHaveCount(0)
    await expect(page.getByTestId('source-default-local')).toBeVisible()
    await expect(page.getByTestId('source-default-notion')).toHaveCount(0)
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'local' })
    await expect(page.getByTestId('source-status-notion')).toContainText('Synchronisiert')
    await expect(page.getByRole('button', { name: 'Notion verbinden' })).toHaveCount(0)

    await sourceAction(page, 'notion', 'Als Standard festlegen')
    await expect(page.getByTestId('source-default-notion')).toBeVisible()
    await expect(page.getByTestId('source-default-local')).toHaveCount(0)
    await expect(page.getByTestId('source-actions-local')).toBeVisible() // Local can take the default back
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
    await expect(page.getByTestId('source-status-notion')).toContainText('Synchronisiert ')
    await expect(page.getByTestId('source-actions-local')).toHaveAccessibleName('Aktionen für Lokal')
    await expect(page.getByTestId('source-actions-notion')).toBeVisible() // settings and disconnect; the default offers no „Als Standard festlegen“
    await expect(page.getByTestId('source-more-notion')).toHaveCount(0)

    await sourceAction(page, 'local', 'Als Standard festlegen')
    await expect(page.getByTestId('source-default-local')).toBeVisible()
    await expect(page.getByTestId('source-default-notion')).toHaveCount(0)
    await expect(page.getByTestId('source-actions-local')).toHaveCount(0) // the default Local has no action left
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'local' })

    await page.reload()
    await expect(page.getByTestId('source-default-local')).toBeVisible()
    await sourceAction(page, 'notion', 'Als Standard festlegen')
    await expect(page.getByTestId('source-default-notion')).toBeVisible()
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'notion' })
  })

  test('"Notion-Einstellungen" opens the Notion settings page', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await openFromBoard(page, baseURL)
    await sourceAction(page, 'notion', 'Notion-Einstellungen')
    await expect(page).toHaveURL(/\/settings\/notion$/)
    await expect(page.getByRole('heading', { name: 'Notion-Einstellungen' })).toBeVisible()
    await expect(page.getByTestId('notion-disconnect')).toHaveCount(0) // disconnecting lives on the Speicherorte page
  })

  test('set Notion as the default, then disconnect it: the dialog names the fallback, Lokal takes the badge, Notion is offered again', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await openFromBoard(page, baseURL)
    await expect(page.getByTestId('source-default-notion')).toBeVisible()

    const trigger = page.getByTestId('source-actions-notion')
    await sourceAction(page, 'notion', 'Trennen')
    const dialog = page.getByTestId('disconnect-dialog')
    await expect(dialog).toContainText('4 Aufgaben verlassen das Board')
    await expect(page.getByTestId('disconnect-default-note')).toHaveText('Neue Aufgaben werden danach lokal gespeichert.')

    // Cancel first: nothing changes and focus returns to the trigger
    await page.getByTestId('disconnect-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect.poll(() => sourcesFromStorage(page)).toEqual({ connected: ['notion'], default: 'notion' })

    await sourceAction(page, 'notion', 'Trennen')
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
    await sourceAction(page, 'notion', 'Trennen')
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
    await expect(page.getByRole('heading', { level: 2, name: 'Deine Speicherorte' })).toBeVisible()
  })
})

test.describe('Notion that needs attention', () => {
  test.beforeEach(async ({ context }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` } })
  })

  test('shows "Verbindung prüfen" in the warning colour with the repair, which opens the setup stage at the token step and leaves untouched on Zurück (#652)', async ({ page, baseURL }) => {
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
    await expect(page).toHaveURL(/\/settings\/notion\?setup=repair$/)
    const stage = page.getByTestId('notion-setup-stage')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(stage.getByPlaceholder('Integrationstoken eingeben')).toBeVisible() // the token step, not the intro or the mapping
    await expect(stage.getByTestId('notion-setup-steps').locator('[aria-current="step"]')).toContainText('Token')
    await expect(stage.getByText('Notion-Einrichtung ist nicht mehr gültig')).toBeVisible()
    await expect(stage.getByRole('button', { name: 'Zurücksetzen' })).toHaveCount(0) // the old reset is gone
    await expect(stage.getByTestId('setup-back')).toHaveText('Zurück zu Einstellungen')
    await stage.getByTestId('setup-back').click()
    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
    await expect(status).toHaveText('Verbindung prüfen') // leaving repairs nothing
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
    await expect(page.getByTestId('notion-setup-stage').getByPlaceholder('Integrationstoken eingeben')).toBeVisible()
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
    await sourceAction(page, 'notion', 'Trennen')
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
    await expect(page.getByRole('heading', { level: 2, name: 'Deine Speicherorte' })).toBeVisible()
    await expect(page.getByTestId('source-status-notion')).toHaveText(/^Synchronisiert/) // last-sync line, no warning
    await expect(page.getByRole('button', { name: 'Notion-Verbindung reparieren' })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

test.describe('Notion setup stage in settings mode (#652)', () => {
  test('a merely degraded connection opens the shorter mapping steps, Zurück on the first leaves the connection untouched', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { once: true })
    await page.goto(`${baseURL}/settings/notion?setup=settings`)

    const stage = page.getByTestId('notion-setup-stage')
    const steps = stage.getByTestId('notion-setup-steps')
    await expect(steps.locator('[aria-current="step"]')).toContainText('Eigenschaften')
    await expect(steps.getByText('Token', { exact: true })).toHaveCount(0) // the credentials are fine: no token, no database step
    await expect(steps.getByText('Vorbereitung', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const before = await page.evaluate(() => localStorage.getItem('notionConfig'))

    await expect(stage.getByTestId('setup-back')).toHaveText('Zurück zu Einstellungen')
    await stage.getByTestId('setup-back').click()
    await expect(page).toHaveURL(/\/settings\?tab=sources$/)
    expect(await page.evaluate(() => localStorage.getItem('notionConfig'))).toBe(before)
    await expect.poll(() => sourcesFromStorage(page)).toEqual(expect.objectContaining({ connected: expect.arrayContaining(['notion']) }))
  })
})

test.describe('at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('name and menu button share a line, only the repair takes the line below, nothing overflows and every button is 44px high (#333)', async ({ context, page, baseURL }) => {
    await seedMixedBoard(context, undefined, { defaultSource: 'local', notionConfig: { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` } })
    await openFromBoard(page, baseURL)
    await expect(page.getByTestId('source-status-notion')).toHaveText('Verbindung prüfen')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    const notion = row(page, 'notion')
    const nameBox = (await notion.locator('p').first().boundingBox())!
    const buttons = notion.getByRole('button')
    await expect(buttons).toHaveCount(2) // repair, and the menu with set default, settings and disconnect
    for (const button of await buttons.all()) {
      const box = (await button.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
    }
    const menuBox = (await page.getByTestId('source-actions-notion').boundingBox())!
    const menuCentre = menuBox.y + menuBox.height / 2
    const statusBox = (await page.getByTestId('source-status-notion').boundingBox())!
    expect(menuCentre).toBeGreaterThan(nameBox.y) // beside name and status, not under them
    expect(menuCentre).toBeLessThan(statusBox.y + statusBox.height)
    const repairBox = (await page.getByTestId('source-repair-notion').boundingBox())!
    expect(repairBox.y).toBeGreaterThan(statusBox.y + statusBox.height - 1) // the one part on a second line

    // The default Local has no action, so no button at all
    await expect(row(page, 'local').getByRole('button')).toHaveCount(0)
  })
})
