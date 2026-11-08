import { test, expect, type Page } from '@playwright/test'
import { completeNotionWizard } from './helpers/notionWizard'
import { expectContrast } from './helpers/contrast'
import { moreButton, openSettings } from './helpers/appNav'

// E2E: the welcome page asks one question with two equal answers (#324); both end on the board

const storedSources = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('board-store') ?? '{}') as { boardConfig?: { sources?: unknown } }).boardConfig?.sources ?? null)

test('welcome asks one question with two equal rows, no filled button and no Todoist', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wo sind deine Aufgaben heute?')
  const nowhere = page.getByRole('button', { name: 'Noch nirgends' })
  const notion = page.getByRole('button', { name: 'In Notion' })
  await expect(nowhere).toBeVisible()
  await expect(notion).toBeVisible()
  await expect(page.getByText('Weitere Verbindungen kannst du später in den Einstellungen hinzufügen.')).toBeVisible()
  await expect(page.getByText(/Todoist/i)).toHaveCount(0)
  await expect(page.locator('main.bg-page')).toBeVisible()

  // Equal: same size, at least 64px high, neither filled
  const boxes = await Promise.all([nowhere, notion].map((row) => row.boundingBox()))
  expect(boxes[0]!.height).toBeGreaterThanOrEqual(64)
  expect(boxes[0]!.height).toBe(boxes[1]!.height)
  expect(boxes[0]!.width).toBe(boxes[1]!.width)
  for (const row of [nowhere, notion]) await expect(row).not.toHaveClass(/bg-(primary|inverted)/)
  await expect(page.locator('main button.bg-primary')).toHaveCount(0)
})

test('welcome has no horizontal overflow and the headline stays within two lines at 390px', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(baseURL! + '/welcome')
  await expect(page.getByRole('button', { name: 'In Notion' })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const lines = await page.getByRole('heading', { level: 1 }).evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size
  })
  expect(lines).toBeLessThanOrEqual(2)
  for (const name of ['Noch nirgends', 'In Notion']) {
    expect((await page.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(64)
  }
})

test('"In Notion" shows the setup on the page (no dialog) and Back returns to the choice with focus on its row (#43)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'In Notion' }).click()

  const flow = page.getByTestId('notion-setup-flow')
  await expect(flow).toBeVisible()
  await expect(flow.getByRole('heading', { name: 'Notion-Token' })).toBeFocused()
  await expect(page.getByTestId('wizard-proceed')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/welcome$/)

  await page.getByTestId('setup-back').click()
  await expect(flow).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'In Notion' })).toBeFocused() // focus returns to the row
  expect(await storedSources(page)).toBeNull()
})

test('the Notion setup is wider than the start screen and the sheet does not overflow at 390px (#43)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  const sheet = page.locator('.welcome-sheet')
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(512)
  await page.getByRole('button', { name: 'In Notion' }).click()
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(768)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('setup-progress')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the Notion setup footer at ${viewport.width}px: the proceed button is the lg CTA, Back a 44px target (#552, #43)`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport)
    await page.goto(baseURL! + '/welcome')
    await page.getByRole('button', { name: 'In Notion' }).click()
    const proceed = page.getByTestId('wizard-proceed')
    await expect(proceed).toBeVisible()
    const height = async (locator: ReturnType<Page['locator']>) => Math.round((await locator.boundingBox())!.height)
    const phone = viewport.width === 390
    await expect.poll(() => height(proceed)).toBe(phone ? 48 : 36)
    expect(await height(page.getByTestId('setup-back'))).toBeGreaterThanOrEqual(44)
  })
}

test('local setup: nothing happens on the pick alone, Back returns to the choice (#43)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Noch nirgends' }).click()
  await page.getByRole('radio', { name: /Mit Beispielaufgaben starten/ }).click()
  await expect(page).toHaveURL(/\/welcome$/)
  expect(await storedSources(page)).toBeNull()
  await page.getByTestId('setup-back').click()
  await expect(page.getByRole('button', { name: 'Noch nirgends' })).toBeFocused()
})

test('"Noch nirgends" -> local setup (fresh) -> Local is the only source and the default, on the board', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Noch nirgends' }).click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('radiogroup', { name: 'Wie möchtest du starten?' })).toBeVisible()
  await expect(page.getByRole('radio', { name: /Neu starten/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Los geht’s' }).click()

  await expect(page).toHaveURL(/\/tasks$/)
  await expect(moreButton(page)).toBeVisible()
  await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })
})

test('"Noch nirgends" -> "Mit Beispielaufgaben starten" -> the demo board (#527): every column filled, topics with symbols, carry-over kept', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Noch nirgends' }).click()
  await page.getByRole('radio', { name: /Mit Beispielaufgaben starten/ }).click()
  await page.getByRole('button', { name: 'Los geht’s' }).click()

  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByText('Bagger für Montag disponieren')).toBeVisible() // Offen
  await expect(page.getByText('Angebot Dachbegrünung Hotel Seeblick kalkulieren')).toBeVisible() // Jetzt
  await expect(page.getByText('Liefertermin Hainbuchen bestätigen lassen')).toBeVisible() // Wartet
  await expect(page.getByText('Baustellenbegehung Müller mit dem Bauleiter')).toBeVisible() // Erledigt
  await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })

  // The topic colours and symbols and the carried-over counters of the sample set survive the board's first day count
  const stored = await page.evaluate(() => ({
    styles: Object.keys((JSON.parse(localStorage.getItem('topic-styles') ?? '{}') as { styles?: object }).styles ?? {}),
    carried: Object.keys((JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { carryOverByTaskId?: object }).carryOverByTaskId ?? {}).length,
  }))
  expect(stored.styles).toContain('Baustelle Müller')
  expect(stored.carried).toBeGreaterThan(0)

  // The sample's done tasks never become permanent statistics, not even through the backfill on the next app start
  await page.reload()
  await expect(page.getByText('Baustellenbegehung Müller mit dem Bauleiter')).toBeVisible()
  const records = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('taskStatistics') ?? '{}') as { completionRecords?: unknown[] }).completionRecords ?? [],
  )
  expect(records).toHaveLength(0)
})

test('"In Notion" -> setup on the stub -> Notion is connected and the default, on the board; the page then lists it', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'In Notion' }).click()
  await completeNotionWizard(page)

  await expect(page).toHaveURL(/\/tasks$/)
  await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'notion' })

  await openSettings(page, 'sources')
  await expect(page.getByTestId('source-default-notion')).toBeVisible()
  await expect(page.getByTestId('source-set-default-local')).toBeVisible()
  await expect(page.getByTestId('source-more-notion')).toHaveCount(0)
})

test('welcome: the small texts on the sheet keep AA contrast (kd#14)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await expect(page.getByTestId('welcome-photo')).toHaveCSS('opacity', '1')
  await expectContrast(page, page.getByText('Weitere Verbindungen kannst du später'), 4.5)
  await expectContrast(page, page.getByText(/^Version:/), 4.5)
  await expectContrast(page, page.getByText('Ein ruhiges Board für die Aufgaben des Tages.'), 4.5)
})

test('welcome sheet pads its bottom by the safe-area inset on a phone, 40px on desktop', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(baseURL! + '/welcome')
  const sheet = page.locator('.welcome-sheet')
  await expect(sheet).toBeVisible()
  await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).paddingBottom)).toBe('24px')

  // Emulate a 34px home indicator: rewrite the real rule in place (keeps its cascade layer), so a utility that
  // out-ranks it would still win and the padding would stay 24px.
  const rewritten = await page.evaluate(() => {
    const walk = (rules: CSSRuleList): boolean => {
      for (const rule of Array.from(rules)) {
        const style = rule as CSSStyleRule
        if (style.selectorText === '.welcome-sheet' && style.style.paddingBottom.includes('safe-area-inset-bottom')) {
          style.style.paddingBottom = 'calc(1.5rem + 34px)'
          return true
        }
        if ('cssRules' in rule && walk((rule as CSSGroupingRule).cssRules)) return true
      }
      return false
    }
    return Array.from(document.styleSheets).some((sheet) => walk(sheet.cssRules))
  })
  expect(rewritten).toBe(true)
  await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).paddingBottom)).toBe('58px')

  await page.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).paddingBottom)).toBe('40px')
})
