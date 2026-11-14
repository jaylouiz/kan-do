import { test, expect, type Page } from '@playwright/test'
import { completeNotionWizard } from './helpers/notionWizard'
import { expectContrast } from './helpers/contrast'
import { moreButton, openSettings } from './helpers/appNav'

// E2E: the welcome page asks one question with two equal answers (#324); both end on the board. The trial with sample
// tasks is a third row set apart with its own step 2 (#236).

/** Records the class and the computed transform of the step swap, so a test can read its direction without timing. */
async function watchSwap(page: Page) {
  await page.locator('.setup-body').waitFor()
  await page.evaluate(() => {
    const log: { cls: string; tx: number; duration: string }[] = []
    ;(window as unknown as { __swapLog: typeof log }).__swapLog = log
    const body = document.querySelector('.setup-body')!
    const note = (el: HTMLElement) => {
      const cls = Array.from(el.classList).find((c) => c.startsWith('slide-') && c.endsWith('-from')) ?? ''
      const active = Array.from(el.classList).find((c) => c.startsWith('slide-') && c.endsWith('-active')) ?? ''
      if (!cls && !active) return
      const style = getComputedStyle(el)
      const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform)
      log.push({ cls: cls || active, tx: matrix.m41, duration: style.transitionDuration })
    }
    new MutationObserver((records) => {
      for (const record of records) {
        // The entering block is inserted with its `-from` class already set (a childList record), later changes are attributes
        if (record.type === 'childList') record.addedNodes.forEach((node) => node instanceof HTMLElement && node.classList.contains('swap-block') && note(node))
        else if ((record.target as HTMLElement).classList.contains('swap-block')) note(record.target as HTMLElement)
      }
    }).observe(body, { childList: true, attributes: true, subtree: true, attributeFilter: ['class'] })
  })
}
const swapLog = (page: Page) => page.evaluate(() => (window as unknown as { __swapLog: { cls: string; tx: number; duration: string }[] }).__swapLog)

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
  for (const row of [nowhere, notion]) await expect(row).toHaveCSS('background-color', 'rgb(255, 255, 255)') // a go-on answer is never filled (a checked radio card is, kd#200)
  await expect(page.locator('main button.bg-primary')).toHaveCount(0)
})

test('the sample row is set apart under its own line, below the two answers, with a hint, and is not filled (#236)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  const nowhere = page.getByTestId('welcome-choice-local')
  const notion = page.getByTestId('welcome-choice-notion')
  const samples = page.getByTestId('welcome-choice-samples')
  const lead = page.getByText('Willst du erstmal nur schauen?')
  await expect(lead).toBeVisible()
  await expect(samples).toContainText('Mit Beispielaufgaben')
  await expect(samples).toContainText('Ein gefülltes Board zum Ausprobieren')
  await expect(samples).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  const [a, b, l, c] = await Promise.all([nowhere, notion, lead, samples].map((el) => el.boundingBox()))
  // order: two answers, the lead line, the sample row; the group is separated by more than the 12px between the two answers
  expect(l!.y).toBeGreaterThan(b!.y + b!.height)
  expect(c!.y).toBeGreaterThan(l!.y + l!.height)
  expect(l!.y - (b!.y + b!.height)).toBeGreaterThan(b!.y - (a!.y + a!.height))
  expect(c!.height).toBeGreaterThanOrEqual(64)
  expect(c!.width).toBe(a!.width)
  await expectContrast(page, lead, 4.5)
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
  for (const name of ['Noch nirgends', 'In Notion', 'Mit Beispielaufgaben']) {
    expect((await page.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(64)
  }
  await expect(page.getByTestId('welcome-choice-samples')).toBeInViewport() // the third row is reachable without scrolling a phone
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

  await expect(page.getByTestId('setup-back')).toHaveText('Zurück zur Auswahl')
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

test('local setup: the step confirms the empty board and offers no sample cards; Back leads to the choice with an arrow (#43, #236)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Noch nirgends' }).click()
  const flow = page.getByTestId('local-setup-flow')
  await expect(flow).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(flow.getByRole('radio')).toHaveCount(0)
  await expect(flow.getByText(/Beispielaufgaben/)).toHaveCount(0)
  await expect(flow.getByText('Das Board startet leer.')).toBeVisible()
  await expect(page).toHaveURL(/\/welcome$/)
  expect(await storedSources(page)).toBeNull() // nothing happens before the confirmation
  const back = page.getByTestId('setup-back')
  await expect(back).toHaveText('Zurück zur Auswahl')
  await expect(back.locator('[data-slot="leadingIcon"]')).toBeVisible() // the arrow
  await back.click()
  await expect(page.getByRole('button', { name: 'Noch nirgends' })).toBeFocused()
})

test('"Noch nirgends" -> local setup -> empty board -> Local is the only source and the default, on the board', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Noch nirgends' }).click()
  await page.getByRole('button', { name: 'Los geht’s' }).click()

  await expect(page).toHaveURL(/\/tasks$/)
  await expect(moreButton(page)).toBeVisible()
  await expect.poll(() => storedSources(page)).toEqual({ connected: [], default: 'local' })
  await expect(page.locator('.task-wrapper')).toHaveCount(0)
})

test('the samples row opens its own step 2: the reset note, the way back and one primary action (#236)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByTestId('welcome-choice-samples').click()

  const flow = page.getByTestId('samples-setup-flow')
  await expect(flow).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(flow.getByRole('heading', { name: 'Beispielaufgaben' })).toBeFocused() // after the swap, like every step
  const note = page.getByTestId('samples-reset-note')
  await expect(note).toContainText('Einstellungen › Daten & Speicher')
  await expect(note).toContainText('Beispielaufgaben')
  await expect(note).toContainText('Statistik')
  await expect(flow.getByRole('button', { name: 'Board ansehen' })).toBeVisible()
  await expect(page.getByTestId('setup-back')).toHaveText('Zurück zur Auswahl')
  expect(await storedSources(page)).toBeNull() // nothing is stored before "Board ansehen"
  await expectContrast(page, note.locator('p'), 4.5)

  await page.getByTestId('setup-back').click()
  await expect(flow).toHaveCount(0)
  await expect(page.getByTestId('welcome-choice-samples')).toBeFocused() // focus returns to the row it came from
})

test('the step swap slides sideways: forward from the right, back mirrored (#236)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await watchSwap(page)
  await page.getByTestId('welcome-choice-samples').click()
  await expect(page.getByTestId('samples-setup-flow')).toBeVisible()
  await expect.poll(async () => (await swapLog(page)).some((e) => e.cls === 'slide-fwd-enter-from')).toBe(true)
  const forward = (await swapLog(page)).find((e) => e.cls === 'slide-fwd-enter-from')!
  expect(forward.tx).toBeGreaterThan(0) // the next step starts at the right

  await page.getByTestId('setup-back').click()
  await expect(page.getByTestId('welcome-choice-samples')).toBeVisible()
  await expect.poll(async () => (await swapLog(page)).some((e) => e.cls === 'slide-back-enter-from')).toBe(true)
  const back = (await swapLog(page)).find((e) => e.cls === 'slide-back-enter-from')!
  expect(back.tx).toBeLessThan(0) // the way back starts at the left
})

test('under reduced motion the step swap is instant (#236)', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(baseURL! + '/welcome')
  await watchSwap(page)
  await page.getByTestId('welcome-choice-samples').click()
  await expect(page.getByTestId('samples-setup-flow')).toBeVisible()
  const log = await swapLog(page)
  expect(log.length).toBeGreaterThan(0)
  for (const entry of log) {
    expect(entry.tx).toBe(0) // no offset
    expect(entry.duration).toBe('0s') // no transition
  }
})

test('the heading focus after the swap never steals focus the user already moved into the setup (#100)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Noch nirgends' }).click()
  // The swap's height animation (300 ms) is still running; the heading takes focus only when it ends, so a Tab or click before then must win
  const back = page.getByTestId('setup-back')
  await back.focus()
  await page.waitForTimeout(800)
  await expect(back).toBeFocused()
})

test('"Mit Beispielaufgaben" -> "Board ansehen" -> the demo board (#527, #236): every column filled, topics with symbols, carry-over kept', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByTestId('welcome-choice-samples').click()
  await page.getByRole('button', { name: 'Board ansehen' }).click()

  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByText('Bagger für Montag disponieren')).toBeVisible() // Offen
  await expect(page.getByText('Angebot Dachbegrünung Hotel Seeblick kalkulieren')).toBeVisible() // Jetzt
  await expect(page.getByText('Liefertermin Hainbuchen bestätigen lassen')).toBeVisible() // Wartet
  await expect(page.getByText('Angebot Terrassenbau Familie Hoffmann verschicken')).toBeVisible() // Erledigt
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
  await expect(page.getByText('Angebot Terrassenbau Familie Hoffmann verschicken')).toBeVisible()
  const records = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('taskStatistics') ?? '{}') as { completionRecords?: unknown[] }).completionRecords ?? [],
  )
  expect(records).toHaveLength(0)
})

test('after a sample start and a finished sample task, the app reset removes the samples and the statistics and lands on the welcome page (#236, kd#227)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByTestId('welcome-choice-samples').click()
  await page.getByRole('button', { name: 'Board ansehen' }).click()
  await expect(page).toHaveURL(/\/tasks$/)

  // Finishing a sample task records a statistic (the sample board itself stores none)
  const title = 'Bagger für Montag disponieren'
  await page.locator('.task-wrapper', { hasText: title }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: 'Erledigt', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('taskStatistics') ?? '{}') as { completionRecords?: unknown[] }).completionRecords?.length ?? 0)).toBeGreaterThan(0)

  await page.goto(baseURL! + '/settings/data')
  await page.getByTestId('data-reset-open').click()
  await page.getByTestId('reset-confirm').click()
  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page.getByTestId('welcome-photo')).toBeAttached()
  for (const key of ['tasks-store', 'taskStatistics', 'topic-styles']) {
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) ?? '', key)).not.toContain('Bagger')
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) ?? '', key)).not.toContain('completionRecords":[{')
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k) ?? '', key)).not.toContain('Baustelle Müller')
  }
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
  await expectContrast(page, page.getByText('Willst du erstmal nur schauen?'), 4.5)
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
