import { test, expect, type Page } from '@playwright/test'
import { seedLocalBoard, SEED_TASKS } from './helpers/seed'
import { installTauriStub } from './helpers/tauriStub'
import { openSettings } from './helpers/appNav'

/** #691: Einstellungen is a tab strip of three groups (Board, Speicherorte, System); the tab lives in `?tab=`. */

const tab = (page: Page, name: string) => page.getByRole('tab', { name })
const tabNames = (page: Page) => page.getByRole('tab').allTextContents()

/** No card in Jetzt: a restarted "Start" is not answered at once by a step that is already done */
const OPEN_ONLY = SEED_TASKS.filter(task => task.status === 0)
/** A restarted record: cards in Offen are a planned day, so "Die Aufgaben des Tages planen" (#803) is answered at once by its step; nothing else is touched */
const RESTARTED = { on: true, quietDay: null, v: 2, hints: { planen: { answered: true, days: [] } } }
/** #845: what the root element carries (`inline`) and what it computes to; 100 % sets nothing */
const rootFontSize = (page: Page) =>
  page.evaluate(() => ({
    inline: document.documentElement.style.fontSize,
    px: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  }))
const storedScale = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('settings-store') ?? '{}') as { uiScale?: number }).uiScale ?? null)
const hintsRow = (page: Page) => page.getByTestId('intro-hints-setting')
const hintsButton = (page: Page) => page.getByTestId('intro-hints-toggle')
const hintsRecord = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('settings-store') ?? '{}') as { introHints?: unknown }).introHints ?? null)

test.describe('Hinweise zum Einstieg in the Board tab (#804)', () => {
  test('the row names the state: "Ausschalten" turns the hints off with a toast, "Erneut zeigen" starts them from the first', async ({ context, page }) => {
    await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { hints: true, once: true })
    await page.goto('/settings')
    await expect(hintsRow(page)).toContainText('Hinweise zum Einstieg')
    await expect(hintsRow(page)).toContainText('Kurze Hinweise auf dem Board zeigen dir den nächsten Schritt.')
    await expect(hintsButton(page)).toHaveText('Ausschalten')

    await hintsButton(page).click()
    await expect(hintsButton(page)).toHaveText('Erneut zeigen')
    // The toast confirms it and says where the intros are read
    await expect(page.getByText('Hinweise ausgeschaltet', { exact: true })).toBeVisible()
    await expect(page.getByText('Du kannst sie jederzeit unter Einstellungen, Board nachlesen.', { exact: true })).toBeVisible()
    await expect.poll(async () => (await hintsRecord(page) as { on: boolean }).on).toBe(false)

    await hintsButton(page).click()
    await expect(hintsButton(page)).toHaveText('Ausschalten')
    await expect.poll(() => hintsRecord(page)).toEqual(RESTARTED)
  })

  test('the help lists exactly the intro texts, on or off, with the phone text of "Start" at 390px', async ({ context, page }) => {
    await seedLocalBoard(context, undefined, {}, undefined, { hints: true, once: true })
    await page.goto('/settings')
    const list = page.getByTestId('intro-hints-help-list')
    await expect(list.locator('li')).toHaveCount(6)
    // the welcome of an empty board first (#853), each entry with its title and its text
    await expect(list.locator('li').first()).toContainText('Willkommen bei deinem Kanban-Board')
    await expect(list).toContainText('Ziehe in „Jetzt“, woran du gerade arbeitest.')
    await expect(list).toContainText('Die Zeit läuft mit und wenn du dir eine Timebox gegeben hast, siehst du wieviel Zeit davon noch übrig ist.')
    await expect(list).toContainText('Viel offen?Gestapelt nach Thema oder Priorität wählst du leichter aus. Die Stapel findest du auch unter „Mehr“.')
    await expect(list).toContainText('Genug für heute?„Tag abschließen“ zeigt dir, was du geschafft hast und was offen bleibt.')
    // the planning note of "Alle" in its own words (#741): the desktop sentence here, the phone's one line below
    await expect(list).toContainText('Schiebe sie in die heutige Auswahl oder drücke den Pfeil-Button. Sobald du loslegen willst, wechsle in der Navigation zu „Heute“.')
    await hintsButton(page).click()
    await expect(list.locator('li')).toHaveCount(6)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(list).toContainText('Halte die Karte und ziehe sie an den rechten Rand, in „Jetzt“.')
    await expect(list).toContainText('Wähle aus, was heute dran istSobald du loslegen willst, wechsle in der Navigation zu „Heute“.')
    const button = (await hintsButton(page).boundingBox())!
    expect(button.height).toBeGreaterThanOrEqual(44)
  })

  test('an install from before the hints has no record: the row offers "Erneut zeigen", which starts them', async ({ context, page }) => {
    await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { once: true })
    await page.goto('/settings')
    expect(await hintsRecord(page)).toBeNull()
    await expect(hintsButton(page)).toHaveText('Erneut zeigen')
    await hintsButton(page).click()
    await expect.poll(() => hintsRecord(page)).toEqual(RESTARTED)
    await expect(hintsButton(page)).toHaveText('Ausschalten')
  })
})

test.describe('Größe der Anzeige in the Board tab (#845)', () => {
  test('the Board tab holds "Größe der Anzeige": five steps, 100 % the standard; a step scales the whole app at once and survives a reload (#845)', async ({ context, page }) => {
    // `once`: the page loads below must keep what the test stored. No card in Jetzt: a card there notes "Jetzt was used"
    // (#853), a write of the settings blob, and this test reads an install that stored nothing yet
    await seedLocalBoard(context, OPEN_ONLY, {}, undefined, { once: true })
    await page.goto('/settings')
    const sheet = page.getByTestId('display-settings')
    await expect(sheet.getByRole('heading', { name: 'Darstellung', level: 2 })).toBeVisible()
    await expect(sheet).toContainText('Macht alles in Kan-do größer oder kleiner.')
    // The web app has no shortcuts of its own for it: the browser keeps its zoom
    await expect(sheet).not.toContainText('Plus')
    const select = page.getByRole('combobox', { name: 'Größe der Anzeige' })
    await expect(select).toContainText('100 % (Standard)')
    // An install from before the setting stores no value: 100 %, and nothing is set on the root
    expect(await rootFontSize(page)).toEqual({ inline: '', px: 16 })
    expect(await storedScale(page)).toBeNull()

    await select.click()
    await expect(page.getByRole('option')).toHaveText(['80 %', '90 %', '100 % (Standard)', '110 %', '125 %'])
    await page.getByRole('option', { name: '125 %' }).click()
    await expect(select).toContainText('125 %')
    await expect.poll(() => rootFontSize(page)).toEqual({ inline: '125%', px: 20 })
    await expect.poll(() => storedScale(page)).toBe(125)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // The whole app follows, also after a reload
    await page.goto('/tasks')
    await expect(page.locator('#column-open')).toBeVisible()
    expect(await rootFontSize(page)).toEqual({ inline: '125%', px: 20 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // Smaller, then back to the standard: the root carries nothing again (A -> B -> A)
    await page.goto('/settings')
    await select.click()
    await page.getByRole('option', { name: '80 %' }).click()
    await expect.poll(() => rootFontSize(page)).toEqual({ inline: '80%', px: 12.8 })
    await select.click()
    await page.getByRole('option', { name: '100 % (Standard)' }).click()
    await expect.poll(() => rootFontSize(page)).toEqual({ inline: '', px: 16 })
    await expect.poll(() => storedScale(page)).toBe(100)
  })
})

test.describe('Einstellungen tabs (#691)', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('three tabs in order, Board active by default and holding Fokus and the hints, nothing of the other groups', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    expect((await tabNames(page)).map(n => n.trim())).toEqual(['Board', 'Speicherorte', 'System'])
    await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('focus-switch')).toBeVisible()
    await expect(page.getByTestId('sources-connected')).toHaveCount(0)
    await expect(page.getByTestId('settings-subpages')).toHaveCount(0)
  })

  test('the Board tab holds the Arbeitszeit select under Fokus: Automatisch by default, 1 h to 12 h in half-hour steps (#306)', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page)
    const select = page.getByTestId('working-hours-select')
    await expect(select).toContainText('Automatisch')
    await expect(page.getByRole('combobox', { name: 'Arbeitszeit pro Tag' })).toBeVisible()
    await select.click()
    const options = page.getByRole('option')
    await expect(options).toHaveCount(24)
    await expect(options.nth(0)).toHaveText('Automatisch')
    await expect(options.nth(1)).toHaveText('1 h')
    await expect(options.nth(2)).toHaveText('1,5 h')
    await expect(options.nth(23)).toHaveText('12 h')
    await page.keyboard.press('Escape')
    const fokus = (await page.getByTestId('focus-switch').boundingBox())!
    expect((await select.boundingBox())!.y).toBeGreaterThan(fokus.y)
  })

  test('each group shows its own content; the tab is in the URL, an unknown tab falls back to Board', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'sources')
    await expect(page.getByTestId('sources-connected')).toBeVisible()
    await expect(page.getByTestId('sources-more')).toBeVisible()
    await expect(page.getByTestId('focus-switch')).toHaveCount(0)

    await openSettings(page, 'manage')
    const links = page.getByTestId('settings-subpage-link-label')
    await expect(links).toHaveText(['Themen und Aktivitäten', 'Daten & Speicher'])
    await expect(page.getByTestId('settings-tab-lead')).toContainText('Themen und Daten pflegst du hier')

    await page.goto('/settings?tab=nonsense')
    await expect(tab(page, 'Board')).toHaveAttribute('aria-selected', 'true')
    await page.goto('/settings?tab=manage')
    await expect(tab(page, 'System')).toHaveAttribute('aria-selected', 'true')
  })

  test('back from a sub-page returns to the tab it was opened from', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await page.getByRole('link', { name: /Daten & Speicher/ }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/settings\?tab=manage$/)
    await expect(tab(page, 'System')).toHaveAttribute('aria-selected', 'true')
  })

  test('leaving a sub-page through the app bar restores its tab', async ({ page }) => {
    await page.goto('/tasks')
    await openSettings(page, 'manage')
    await page.getByRole('link', { name: /Daten & Speicher/ }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await page.getByTestId('app-nav-place-more').click()
    await expect(page).toHaveURL(/\/settings\?tab=manage$/)
    await expect(tab(page, 'System')).toHaveAttribute('aria-selected', 'true')
  })

  test('a tab click adds no history entry', async ({ page }) => {
    await page.goto('/settings')
    const before = await page.evaluate(() => history.length)
    await tab(page, 'Speicherorte').click()
    await tab(page, 'System').click()
    expect(await page.evaluate(() => history.length)).toBe(before)
  })

  test('keyboard: arrow keys move between the tabs', async ({ page }) => {
    await page.goto('/settings')
    await tab(page, 'Board').focus()
    await page.keyboard.press('ArrowRight')
    await expect(tab(page, 'Speicherorte')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/tab=manage$/)
  })

  test('the web app leaves Cmd/Ctrl with +, - and 0 to the browser (#845)', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByTestId('ui-scale-select')).toBeVisible()
    for (const key of ['=', '+', '-', '0']) {
      for (const mod of ['metaKey', 'ctrlKey']) {
        const cancelled = await page.evaluate((init) => {
          const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
          document.body.dispatchEvent(event)
          return event.defaultPrevented
        }, { key, [mod]: true })
        expect(cancelled, `${mod}+${key}`).toBe(false)
      }
    }
    expect(await rootFontSize(page)).toEqual({ inline: '', px: 16 })
  })

  test('a stored value that is no step reads as 100 % (#845)', async ({ context, page }) => {
    await context.addInitScript(() => {
      const settings = JSON.parse(localStorage.getItem('settings-store') ?? '{}') as Record<string, unknown>
      localStorage.setItem('settings-store', JSON.stringify({ ...settings, uiScale: 150 }))
    })
    await page.goto('/settings')
    await expect(page.getByRole('combobox', { name: 'Größe der Anzeige' })).toContainText('100 % (Standard)')
    expect(await rootFontSize(page)).toEqual({ inline: '', px: 16 })
  })

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('at 80 % and at 125 % nothing scrolls sideways and the app bar stays inside the viewport; the select sits below its label (#845)', async ({ context, page }) => {
      for (const scale of [80, 125]) {
        await context.addInitScript((value) => {
          const settings = JSON.parse(localStorage.getItem('settings-store') ?? '{}') as Record<string, unknown>
          localStorage.setItem('settings-store', JSON.stringify({ ...settings, uiScale: value }))
        }, scale)
        for (const path of ['/settings', '/tasks']) {
          await page.goto(path)
          await expect(page.locator('.app-nav-more')).toBeVisible()
          await expect.poll(() => rootFontSize(page)).toEqual({ inline: `${scale}%`, px: 16 * scale / 100 })
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} at ${scale} %`).toBe(true)
          // The pill and the round ⋯ beside it, not their group: the group's own box is clamped to the bar (`max-width`)
          const pill = (await page.locator('.app-nav-pill').boundingBox())!
          const more = (await page.locator('.app-nav-more').boundingBox())!
          expect(pill.x, `${path} at ${scale} %: pill`).toBeGreaterThanOrEqual(0)
          expect(more.x + more.width, `${path} at ${scale} %: ⋯`).toBeLessThanOrEqual(390)
          // Above 100 % the phone bar keeps its 100 % size: a 52 px pill; below it scales down with everything else
          expect(pill.height, `${path} at ${scale} %: pill height`).toBeCloseTo(scale > 100 ? 52 : 52 * scale / 100, 0)
        }
      }
      await page.goto('/settings')
      const label = (await page.locator('#ui-scale-label').boundingBox())!
      const select = (await page.getByTestId('ui-scale-select').boundingBox())!
      expect(select.y).toBeGreaterThan(label.y + label.height)
    })

    test('all three labels are visible without horizontal scroll', async ({ page }) => {
      await page.goto('/settings')
      for (const name of ['Board', 'Speicherorte', 'System']) await expect(tab(page, name)).toBeInViewport({ ratio: 1 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  })
})

test.describe('Einstellungen tabs, desktop app (#691)', () => {
  test('System ends with Rechtliches: Impressum, Datenschutz, Nutzungsbedingungen and the no-affiliation line (#745)', async ({ context, page }) => {
    // Without a board the settings page redirects to /welcome (#821)
    await seedLocalBoard(context)
    await page.goto('/settings?tab=manage')
    const legal = page.getByTestId('legal-settings')
    await expect(legal.getByRole('heading', { name: 'Rechtliches', level: 2 })).toBeVisible()
    const nav = legal.getByRole('navigation', { name: 'Rechtliche Hinweise' })
    await expect(nav.getByRole('link')).toHaveText(['Impressum', 'Datenschutz', 'Nutzungsbedingungen'])
    await expect(nav.getByRole('link', { name: 'Impressum' })).toHaveAttribute('href', /^https:\/\/[^/]+\/impressum\/$/)
    await expect(legal.getByTestId('legal-no-affiliation')).toHaveText('Notion ist eine Marke von Notion Labs, Inc. Todoist ist eine Marke von Doist. Kan-do ist mit keinem der beiden Unternehmen verbunden.')
  })

  test('System also holds Updates and GitHub-Zugriff, each opening its page', async ({ context, page }) => {
    await seedLocalBoard(context)
    await installTauriStub(context)
    await page.goto('/settings?tab=manage')
    await expect(page.getByTestId('settings-tab-lead')).toContainText('Updates und Zugriffe')
    await expect(page.getByTestId('settings-subpage-link-label')).toHaveText(['Themen und Aktivitäten', 'Daten & Speicher', 'Updates', 'GitHub-Zugriff'])
    await page.getByRole('link', { name: /^Updates/ }).click()
    await expect(page).toHaveURL(/\/settings\/updates$/)
    await page.goBack()
    await page.getByRole('link', { name: /GitHub-Zugriff/ }).click()
    await expect(page).toHaveURL(/\/settings\/github$/)
  })
})
