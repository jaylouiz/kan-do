import { test, expect, type Page } from '@playwright/test'
import { completeNotionWizard } from './helpers/notionWizard'
import { expectContrast } from './helpers/contrast'
import { moreButton, openSettings } from './helpers/appNav'
import { buildBoardStore, buildTasksStore, seedLocalBoard, SEED_TASKS } from './helpers/seed'
import { installTauriStub } from './helpers/tauriStub'

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

/** Start view -> step 2 -> Notion ticked -> the Notion setup (#294) */
async function openNotion(page: Page) {
  await page.getByRole('button', { name: 'Jetzt starten' }).click()
  await page.getByRole('checkbox', { name: 'Notion' }).click()
  await page.getByRole('button', { name: 'Mit Notion einrichten' }).click()
}

const storedSources = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('board-store') ?? '{}') as { boardConfig?: { sources?: unknown } }).boardConfig?.sources ?? null)

test('welcome start: one filled green "Jetzt starten", "Beispiel anzeigen" soft beside it, brand and subline above the sheet (#294, #437)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bereit für deine Aufgaben')
  const start = page.getByRole('button', { name: 'Jetzt starten' })
  const samples = page.getByRole('button', { name: 'Beispiel anzeigen' })
  await expect(start).toBeVisible()
  await expect(samples).toBeVisible()
  await expect(page.getByText(/Du kannst Aufgaben lokal auf diesem Gerät speichern/)).toBeVisible()
  await expect(page.getByText('Nur neugierig? Dann schau dir die App mit Beispielaufgaben an.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'In Notion' })).toHaveCount(0)
  await expect(page.locator('main.bg-page')).toBeVisible()

  // The one solid green is the start; the trial is not filled
  await expect(page.locator('main button.bg-primary')).toHaveCount(1)
  await expect(start).toHaveClass(/bg-primary/)
  await expect(samples).not.toHaveClass(/(^|\s)bg-primary(\s|$)/) // soft: a tint, not the solid fill
  // From 640px the two ways in sit side by side (#437)
  const [a, b] = await Promise.all([start, samples].map((el) => el.boundingBox()))
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1)
  expect(Math.abs(b!.y - a!.y)).toBeLessThan(2)

  // Brand and subline sit outside and above the sheet, and share its content's left edge
  const sheet = page.locator('.welcome-sheet')
  const brand = page.getByTestId('welcome-brand')
  await expect(brand).toHaveText('Kan-do')
  const [sheetBox, brandBox, titleBox] = await Promise.all([sheet.boundingBox(), brand.boundingBox(), page.getByRole('heading', { level: 1 }).boundingBox()])
  expect(brandBox!.y + brandBox!.height).toBeLessThanOrEqual(sheetBox!.y)
  expect(Math.abs(brandBox!.x - titleBox!.x)).toBeLessThan(1)
  await expect(sheet.getByText('Kan-do', { exact: true })).toHaveCount(0)
  await expectContrast(page, page.getByText(/Du kannst Aufgaben lokal auf diesem Gerät speichern/), 4.5)

  // #745: the legal pages are one click away before anything is set up
  await expect(sheet.getByRole('navigation', { name: 'Rechtliche Hinweise' }).getByRole('link')).toHaveText(['Impressum', 'Datenschutz', 'Nutzungsbedingungen'])
})

test('web welcome links to the latest release; the desktop app does not show it (#737)', async ({ page, baseURL, browser }) => {
  await page.goto(baseURL! + '/welcome')
  const link = page.getByTestId('welcome-app-download')
  await expect(link).toHaveText('Mac-App herunterladen')
  await expect(link).toHaveAttribute('href', 'https://github.com/jaylouiz/kan-do/releases/latest')
  await expect(link).toHaveAttribute('target', '_blank')

  // Not a step of the setup
  await page.getByRole('button', { name: 'Beispiel anzeigen' }).click()
  await expect(link).toHaveCount(0)

  const ctx = await browser.newContext({ locale: 'de-DE' })
  const desktop = await ctx.newPage()
  await installTauriStub(ctx)
  await desktop.goto(baseURL! + '/welcome')
  await expect(desktop.getByRole('button', { name: 'Jetzt starten' })).toBeVisible()
  await expect(desktop.getByTestId('welcome-app-download')).toHaveCount(0)
  await ctx.close()
})

test('welcome has no horizontal overflow at 390px, the headline stays within two lines and the sheet is lower than the old three-row one (#294)', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(baseURL! + '/welcome')
  await expect(page.getByRole('button', { name: 'Jetzt starten' })).toBeVisible()

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
  const lines = await page.getByRole('heading', { level: 1 }).evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size
  })
  expect(lines).toBeLessThanOrEqual(2)
  for (const name of ['Jetzt starten', 'Beispiel anzeigen']) {
    await expect(page.getByRole('button', { name })).toBeInViewport()
    expect((await page.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  // Below 640px the two ways in stack
  const [first, second] = await Promise.all(['Jetzt starten', 'Beispiel anzeigen'].map((name) => page.getByRole('button', { name }).boundingBox()))
  expect(second!.y).toBeGreaterThan(first!.y + first!.height)
  // More of the photo shows: the sheet takes at most 60% of the phone's height (the old one filled about 80%)
  expect((await page.locator('.welcome-sheet').boundingBox())!.height).toBeLessThan(844 * 0.6)
})

test('"Jetzt starten" opens step 2: local always, Notion first as a choice card, Todoist disabled "Bald verfügbar"; the button follows the checkbox (#294)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Jetzt starten' }).click()

  const flow = page.getByTestId('local-setup-flow')
  await expect(flow).toBeVisible()
  await expect(flow.getByRole('heading', { name: 'Eine App verbinden?' })).toBeFocused()
  const notion = flow.getByRole('checkbox', { name: 'Notion' })
  const todoist = flow.getByRole('checkbox', { name: 'Todoist' })
  await expect(notion).not.toBeChecked()
  await expect(todoist).toBeDisabled()
  await expect(flow.getByRole('button', { name: 'Zum Board' })).toBeVisible()
  await notion.click()
  await expect(flow.getByRole('button', { name: 'Mit Notion einrichten' })).toBeVisible()
  expect(await storedSources(page)).toBeNull() // nothing is stored before the confirmation
})

test('step 2 apps are choice cards (#651): Notion first, one tab stop per card, Space toggles, disabled cards state their reason, 64 px high with no inner scroll at 1280 and 390', async ({ page, baseURL }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto(baseURL! + '/welcome')
    await page.getByRole('button', { name: 'Jetzt starten' }).click()
    const flow = page.getByTestId('local-setup-flow')
    const cards = flow.getByRole('checkbox')
    await expect(cards).toHaveCount(3)
    // Order: Notion, Erinnerungen, Todoist; the group has a legend as its name
    await expect(cards.nth(0)).toHaveAttribute('data-testid', 'local-source-notion')
    await expect(cards.nth(1)).toHaveAttribute('data-testid', 'local-source-reminders')
    await expect(cards.nth(2)).toHaveAttribute('data-testid', 'local-source-todoist')
    await expect(flow.getByRole('group', { name: 'Du kannst eine oder mehrere verbinden' })).toBeVisible()
    // Disabled cards: reason on the card and in the accessible name, not an option the keyboard reaches
    await expect(flow.getByRole('checkbox', { name: 'Apple Erinnerungen Nur in der Mac-App' })).toBeDisabled()
    await expect(flow.getByRole('checkbox', { name: 'Todoist Bald verfügbar' })).toBeDisabled()
    // The main button is in view without scrolling, and the page does not scroll (#690)
    await expect.poll(async () => {
      const box = (await page.getByTestId('local-confirm').boundingBox())!
      return box.y + box.height <= viewport.height
    }).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
    // Geometry: at least 64 px high, filling the row, nothing scrolls inside
    for (const id of ['notion', 'reminders', 'todoist']) {
      const box = (await page.getByTestId(`local-source-${id}`).boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(64)
    }
    const fieldset = (await page.getByTestId('local-sources').boundingBox())!
    expect((await cards.nth(0).boundingBox())!.width).toBeGreaterThan(fieldset.width - 2)
    expect(await flow.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    // Keyboard: one tab stop for Notion, Space toggles it, the next stop is the confirm button
    await cards.nth(0).focus()
    await expect(cards.nth(0)).toBeFocused()
    await page.keyboard.press('Space')
    await expect(cards.nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(cards.nth(0)).toHaveAttribute('data-state', 'checked')
    await expect(page.getByTestId('local-confirm')).toHaveText('Mit Notion einrichten')
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('local-confirm')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Space')
    await expect(cards.nth(0)).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('local-confirm')).toHaveText('Zum Board')
  }
})

test('Notion ticked in step 2 shows the setup on the page (no dialog); Back returns to step 2 with the tick kept (#43, #294)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await openNotion(page)

  const flow = page.getByTestId('notion-setup-flow')
  await expect(flow).toBeVisible()
  await expect(flow.getByRole('group', { name: 'Vorbereitung' })).toBeFocused() // the shell's pane, named by the first step (#441, #649)
  await expect(page.getByTestId('wizard-proceed')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/welcome$/)

  await expect(page.getByTestId('setup-back')).toHaveText('Zurück zur Auswahl')
  await page.getByTestId('setup-back').click()
  await expect(flow).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Notion' })).toBeChecked() // step 2, tick kept
  await expect(page.getByTestId('local-setup-flow')).toBeVisible()
  expect(await storedSources(page)).toBeNull()
})

test('the Notion setup is wider than the start screen and the sheet does not overflow at 390px (#43)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  const sheet = page.locator('.welcome-sheet')
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(512)
  await openNotion(page)
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(768)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('setup-progress')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the Notion setup on the shell at ${viewport.width}px: no scroll area at any step, the footer follows the step, facts are neutral badges, nothing stored before "Verbinden" (#649)`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport)
    await page.goto(baseURL! + '/welcome')
    await openNotion(page)
    const flow = page.getByTestId('notion-setup-flow')
    const proceed = page.getByTestId('wizard-proceed')
    const back = page.getByTestId('setup-back')
    const scrollAreas = () => flow.evaluate((root) => Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const { overflowY } = getComputedStyle(el)
      return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight
    }).length)

    // The intro: the fact badges are neutral (no border, no ring: nothing that reads as a button), the lone button fills the row on a phone
    await expect(back).toHaveText('Zurück zur Auswahl')
    await expect(proceed).toHaveText('Weiter') // the intro's button keeps its label ("onboarding.flow.notion.start")
    const badge = flow.getByRole('list', { name: 'Das brauchst du' }).getByRole('listitem').first().locator('span').first()
    await expect(badge).toBeVisible()
    expect(await badge.evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopWidth, s.boxShadow] })).toEqual(['0px', 'none'])
    expect(await scrollAreas()).toBe(0)
    await proceed.click()

    await expect(back).toHaveText('Zurück')
    const token = flow.getByPlaceholder('Integrationstoken eingeben')
    await token.fill('notion_test_stub')
    const stepNames = ['Token', 'Datenbank', 'Eigenschaften', 'Weitere Eigenschaften']
    for (const name of stepNames) {
      await expect(flow.getByRole('group', { name, exact: true })).toBeVisible()
      await expect(proceed).toBeEnabled()
      expect(await scrollAreas(), name).toBe(0)
      if (name === 'Datenbank') {
        // "Nötig" and "Optional" are neutral badges too
        await expect(flow.getByRole('list', { name: 'Nötig' }).getByRole('listitem')).toHaveText(['Titel', 'Status'])
      }
      await proceed.click()
      await expect(flow.getByRole('group', { name, exact: true })).toHaveCount(0)
    }
    // Weitere Eigenschaften -> (Priorität) -> Status; the last step's button reads "Verbinden"
    await expect(proceed).toBeEnabled()
    while ((await proceed.innerText()).trim() !== 'Verbinden') {
      const before = await flow.locator('[aria-current="step"]').first().innerText()
      await proceed.click()
      await expect(flow.locator('[aria-current="step"]').first()).not.toHaveText(before, { useInnerText: true })
      await expect(proceed).toBeEnabled()
    }
    expect(await scrollAreas()).toBe(0)
    // Nothing is written to the connection before the last step's button
    expect(await page.evaluate(() => localStorage.getItem('notionConfig'))).toBeNull()
    await proceed.click()
    await expect(page.getByTestId('setup-done')).toContainText('Notion ist verbunden')
    await expect(page).toHaveURL(/\/tasks$/, { timeout: 10_000 })
  })
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the Notion setup footer at ${viewport.width}px: Zurück and the proceed button are one footer cluster, the same height (#552, #43, #649)`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport)
    await page.goto(baseURL! + '/welcome')
    await openNotion(page)
    const proceed = page.getByTestId('wizard-proceed')
    await expect(proceed).toBeVisible()
    const height = async (locator: ReturnType<Page['locator']>) => Math.round((await locator.boundingBox())!.height)
    const phone = viewport.width === 390
    await expect.poll(() => height(proceed)).toBe(phone ? 48 : 36)
    expect(await height(page.getByTestId('setup-back'))).toBe(await height(proceed)) // a footer button, not the old 44 px link above the title
  })
}

test('local step: no sample cards, nothing stored before the confirmation; Back leads to the start with an arrow (#43, #236, #294)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Jetzt starten' }).click()
  const flow = page.getByTestId('local-setup-flow')
  await expect(flow).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(flow.getByRole('radio')).toHaveCount(0)
  await expect(flow.getByText(/Beispielaufgaben/)).toHaveCount(0)
  await expect(page).toHaveURL(/\/welcome$/)
  expect(await storedSources(page)).toBeNull() // nothing happens before the confirmation
  const back = page.getByTestId('setup-back')
  await expect(back).toHaveText('Zurück zur Auswahl')
  await expect(back.locator('[data-slot="leadingIcon"]')).toBeVisible() // the arrow
  await back.click()
  await expect(page.getByRole('button', { name: 'Jetzt starten' })).toBeFocused()
})

test('"Jetzt starten" -> step 2 -> "Zum Board" -> empty board -> Local is the only source and the default, on the board', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByRole('button', { name: 'Jetzt starten' }).click()
  await page.getByRole('button', { name: 'Zum Board' }).click()

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
  await expect(note).toContainText('In den Einstellungen')
  await expect(note).toContainText('zurücksetzen')
  await expect(note).toContainText('Statistik')
  await expect(flow.getByRole('button', { name: 'Board ansehen' })).toBeVisible()
  await expect(page.getByTestId('setup-back')).toHaveText('Zurück zur Auswahl')
  expect(await storedSources(page)).toBeNull() // nothing is stored before "Board ansehen"
  await expectContrast(page, note.locator('p'), 4.5)

  await page.getByTestId('setup-back').click()
  await expect(flow).toHaveCount(0)
  await expect(page.getByTestId('welcome-choice-samples')).toBeFocused() // focus returns to the button it came from
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
  await page.getByRole('button', { name: 'Jetzt starten' }).click()
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

test('Loslegen -> Notion ticked -> setup on the stub -> Notion is connected and the default, on the board; the page then lists it', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await openNotion(page)
  await completeNotionWizard(page)

  await expect(page).toHaveURL(/\/tasks$/)
  await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'notion' })

  await openSettings(page, 'sources')
  await expect(page.getByTestId('source-default-notion')).toBeVisible()
  await expect(page.getByTestId('source-actions-local')).toBeVisible() // holds „Als Standard festlegen“
  await expect(page.getByTestId('source-more-notion')).toHaveCount(0)
})

test('welcome: the small texts on the sheet keep AA contrast (kd#14)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await expect(page.getByTestId('welcome-photo')).toHaveCSS('opacity', '1')
  await expectContrast(page, page.getByText(/Du kannst Aufgaben lokal auf diesem Gerät speichern/), 4.5)
  await expectContrast(page, page.getByText(/^Version:/), 4.5)
  await expectContrast(page, page.getByText('Das Kanban-Board, mit dem du deine Aufgaben des Tages fokussiert erledigst.'), 4.5)
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

test('welcome: brand and subline sit on the photo with AA contrast at 1280 and 390px (#437, Bright Ground Rule)', async ({ page, baseURL }) => {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto(baseURL! + '/welcome')
    await expect(page.getByTestId('welcome-photo')).toHaveCSS('opacity', '1')
    await expectContrast(page, page.getByTestId('welcome-brand'), 3)
    await expectContrast(page, page.getByText('Das Kanban-Board, mit dem du deine Aufgaben des Tages fokussiert erledigst.'), 4.5)
  }
})

test('in the Notion setup the subline keeps AA contrast on the photo at the token step at 390px (the sheet is shorter there, #649)', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(baseURL! + '/welcome')
  await openNotion(page)
  await page.getByTestId('wizard-proceed').click()
  await expect(page.getByRole('group', { name: 'Token', exact: true })).toBeVisible()
  await page.mouse.move(0, 0)
  await expectContrast(page, page.getByText('Das Kanban-Board, mit dem du deine Aufgaben des Tages fokussiert erledigst.'), 4.5)
})

test('in the Notion setup the brand keeps the sheet\'s left edge while the sheet widens (#437)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  const brand = page.getByTestId('welcome-brand')
  const sheet = page.locator('.welcome-sheet')
  const edge = async () => Math.round((await brand.boundingBox())!.x - (await sheet.boundingBox())!.x)
  await expect.poll(edge).toBe(32) // the sheet's padding at 1280
  await openNotion(page)
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.width)).toBe(768)
  await expect.poll(edge).toBe(32)
})

/** Notes whether the brand flight's clone ever appears (it is removed again at the end of the flight). */
async function watchFlight(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __flightSeen: boolean }).__flightSeen = false
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="brand-flight"]')) (window as unknown as { __flightSeen: boolean }).__flightSeen = true
    }).observe(document.body, { childList: true })
  })
}
const flightSeen = (page: Page) => page.evaluate(() => (window as unknown as { __flightSeen: boolean }).__flightSeen)

test('finish on desktop: the brand flies to the app bar brand and leaves no clone behind (#437)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByTestId('welcome-choice-samples').click()
  await page.getByTestId('samples-confirm').click()
  await expect(page.getByTestId('brand-flight')).toBeAttached()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect(page.getByTestId('brand-flight')).toHaveCount(0)
  await expect(page.getByTestId('app-nav-brand').locator('.app-nav-brand-text')).toBeVisible()
  await expect(page.getByTestId('app-nav-brand').locator('.app-nav-brand-text')).toHaveCSS('visibility', 'visible')
})

test('the flight ends exactly on the app bar brand (#437)', async ({ page, baseURL }) => {
  await page.goto(baseURL! + '/welcome')
  await page.getByTestId('welcome-choice-samples').click()
  await page.getByTestId('samples-confirm').click()
  // Jump the flight to its end and compare the clone's text box with the bar brand's (the clone is removed right after)
  const boxes = await page.evaluate(async () => {
    const textBox = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }
    for (let i = 0; i < 200; i++) {
      const clone = document.querySelector('[data-testid="brand-flight"]')
      const target = document.querySelector('[data-testid="app-nav-brand"] .app-nav-brand-text')
      const anim = clone?.getAnimations().find((a) => a instanceof CSSAnimation === false)
      if (clone && target && anim) {
        anim.finish()
        return { clone: textBox(clone), target: textBox(target) }
      }
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return null
  })
  expect(boxes).not.toBeNull()
  expect(Math.abs(boxes!.clone.x - boxes!.target.x)).toBeLessThan(2)
  expect(Math.abs(boxes!.clone.y + boxes!.clone.h / 2 - (boxes!.target.y + boxes!.target.h / 2))).toBeLessThan(2)
  expect(Math.abs(boxes!.clone.w - boxes!.target.w)).toBeLessThan(2)
})

test('finish on a phone or with reduced motion: no flight, the page just fades (#437)', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(baseURL! + '/welcome')
  await watchFlight(page)
  await page.getByTestId('welcome-choice-samples').click()
  await page.getByTestId('samples-confirm').click()
  await expect(page).toHaveURL(/\/tasks$/)
  expect(await flightSeen(page)).toBe(false)

  await page.evaluate(() => localStorage.clear())
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(baseURL! + '/welcome')
  await watchFlight(page)
  await page.getByTestId('welcome-choice-samples').click()
  await page.getByTestId('samples-confirm').click()
  await expect(page).toHaveURL(/\/tasks$/)
  expect(await flightSeen(page)).toBe(false)
})

// The column hangs from a line above the page's middle (#437); on a short window it must still clear the desktop bar row
// and the data-storage notice of an unreachable folder.
for (const height of [600, 700, 800]) {
  test(`welcome: the brand clears the unreachable-folder notice and the desktop bar row at ${height}px height (#437)`, async ({ page, baseURL }) => {
    // The same launch as data-safety.spec.ts: stores hydrate empty and /tasks lands on the welcome page
    await installTauriStub(page.context(), { data: { status: 'folder-unavailable', folder: '/Users/test/data', envelope: { schemaVersion: 1, stores: { 'board-store': buildBoardStore('local'), 'tasks-store': buildTasksStore(SEED_TASKS) } } } })
    await page.setViewportSize({ width: 1280, height })
    await page.goto(baseURL! + '/welcome')
    const notice = page.locator('.welcome-root').getByTestId('data-storage-notice')
    await expect(notice).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-shell', 'desktop')
    const noticeBox = (await notice.boundingBox())!
    const brandBox = (await page.getByTestId('welcome-brand').boundingBox())!
    expect(brandBox.y).toBeGreaterThanOrEqual(noticeBox.y + noticeBox.height)
  })
}

// A board that is already set up does not get the first-run page again (#561): a bookmark, a typed address or a history
// entry that points at /welcome ends on Heute. App reset still reaches the page (data-settings.spec.ts, the samples test above).
test.describe('a set-up board requests /welcome (#561)', () => {
  test('a board with tasks opens Heute, the welcome page never shows', async ({ page, context, baseURL }) => {
    await seedLocalBoard(context)
    await page.goto(baseURL! + '/welcome')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByTestId('welcome-photo')).toHaveCount(0)
    await expect(page.locator('[data-task-id="seed-open-1"]').first()).toBeVisible()
  })

  test('a board started fresh (no tasks) opens Heute too', async ({ page, context, baseURL }) => {
    await seedLocalBoard(context, [])
    await page.goto(baseURL! + '/welcome')
    await expect(page).toHaveURL(/\/tasks$/)
    await expect(page.getByTestId('welcome-photo')).toHaveCount(0)
  })

  test('the redirect replaces the history entry: Back does not bounce to /welcome', async ({ page, context, baseURL }) => {
    await seedLocalBoard(context)
    await page.goto(baseURL! + '/settings')
    await page.goto(baseURL! + '/welcome')
    await expect(page).toHaveURL(/\/tasks$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings$/)
  })

  test('a board that is not set up still gets the welcome page', async ({ page, baseURL }) => {
    await page.goto(baseURL! + '/welcome')
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(page.getByTestId('welcome-choice-local')).toBeVisible()
  })
})

test('the welcome curtain is the page transition: .welcome-root leaves with page-leave-active (#601, #463)', async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(baseURL! + '/welcome')
  await page.evaluate(() => {
    const w = window as unknown as { __leave?: boolean }
    new MutationObserver(() => {
      if (document.querySelector('.welcome-root.page-leave-active')) w.__leave = true
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true })
  })
  await page.getByTestId('welcome-choice-samples').click()
  await page.getByTestId('samples-confirm').click()
  await expect(page).toHaveURL(/\/tasks$/)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __leave?: boolean }).__leave)).toBe(true)
})
