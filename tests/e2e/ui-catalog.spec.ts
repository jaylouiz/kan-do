import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { seedLocalBoard, type SeedTask } from './helpers/seed'
import { FINGERPRINT_PROPERTIES, diffFingerprint, readFingerprintDir, writeFingerprintDir } from './helpers/fingerprint'

/**
 * The `/ui` Components part (#66, epic #58 D2/D3), served by the E2E build (KANDO_UI_CATALOG, scripts/e2e-server.mjs) and by `nuxt dev`.
 * Proof entries: UButton (Nuxt UI, matrix from the merged theme) and ExternalLink (an app component).
 *
 * The style fingerprint records the computed styles of every sample into `snapshots/ui-catalog/<Component>.json` (one file per
 * component, #117: parallel PRs on different components never conflict) and diffs against them; it does not depend on the OS, so it runs in CI. A deliberate change of a theme token, of `app.config.ts`
 * or of a component's style moves it: re-record with `PORT=<free> npm run test:e2e -- tests/e2e/ui-catalog.spec.ts --update-snapshots`
 * and commit the JSON files. (Pixel baselines stay macOS-local, `visual-regression.spec.ts`.)
 */

const FINGERPRINT_DIR = resolve(__dirname, 'snapshots/ui-catalog')
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function openCatalog(page: Page, viewport = { width: 1280, height: 800 }) {
  await page.setViewportSize(viewport)
  await page.goto('/ui')
  await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
}

const button = (page: Page) => page.locator('#component-UButton')

test.describe('/ui Components part: UButton', () => {
  test('shows every color x variant x size the theme defines, plus the states', async ({ page }) => {
    await openCatalog(page)
    const card = button(page)
    // The axis values come from the switchers, which read the merged theme: the matrix must have exactly their product.
    const count = async (axis: string) => (await card.getByRole('group', { name: axis, exact: true }).getByRole('button').count()) - 1 // minus "All"
    const [colors, variants, sizes] = [await count('color'), await count('variant'), await count('size')]
    expect([colors, variants, sizes]).toEqual([7, 6, 5]) // Nuxt UI's colour roles, variants and sizes today; a theme that gains one changes this on purpose
    await expect(card.locator('[data-kd-sample^="UButton:matrix:"]')).toHaveCount(colors * variants * sizes)
    for (const key of ['primary/solid/md', 'neutral/link/xl', 'error/outline/xs']) {
      await expect(card.locator(`[data-kd-sample="UButton:matrix:${key}"] button`), key).toBeVisible()
    }
    await expect(card.locator('[data-kd-sample="UButton:state:disabled"] button')).toBeDisabled()
    await expect(card.locator('[data-kd-sample="UButton:state:loading"] button [class*="animate-spin"], [data-kd-sample="UButton:state:loading"] button [class*="loading"]').first()).toBeAttached()
    await expect(card.locator('[data-kd-sample="UButton:state:icon-only"] button')).toHaveAccessibleName('Schließen')
    await expect(card.locator('[data-kd-sample="UButton:state:icon-leading"] button')).toContainText('Hier ablegen, um die Aufgabe als erledigt zu markieren')
  })

  test('the variant and state switchers narrow the samples, "All" brings them back', async ({ page }) => {
    await openCatalog(page)
    const card = button(page)
    const total = await card.locator('[data-kd-sample]').count()
    await card.getByRole('group', { name: 'color', exact: true }).getByRole('button', { name: 'error', exact: true }).click()
    await expect(card.locator('[data-kd-sample^="UButton:matrix:"]')).toHaveCount(6 * 5)
    await expect(card.locator('[data-kd-sample^="UButton:matrix:primary/"]')).toHaveCount(0)
    await card.getByRole('group', { name: 'size', exact: true }).getByRole('button', { name: 'md (default)' }).click()
    await expect(card.locator('[data-kd-sample^="UButton:matrix:"]')).toHaveCount(6)
    await card.getByRole('group', { name: 'state', exact: true }).getByRole('button', { name: 'disabled', exact: true }).click()
    await expect(card.locator('[data-kd-sample^="UButton:state:"]')).toHaveCount(1)
    for (const axis of ['color', 'size', 'state']) await card.getByRole('group', { name: axis, exact: true }).getByRole('button', { name: 'All' }).click()
    await expect(card.locator('[data-kd-sample]')).toHaveCount(total)
  })

  test('the switchers work from the keyboard (aria-pressed buttons)', async ({ page }) => {
    await openCatalog(page)
    const all = button(page).getByRole('group', { name: 'state', exact: true }).getByRole('button', { name: 'All' })
    const loading = button(page).getByRole('group', { name: 'state', exact: true }).getByRole('button', { name: 'loading' })
    await expect(all).toHaveAttribute('aria-pressed', 'true')
    await loading.focus()
    await page.keyboard.press('Enter')
    await expect(loading).toHaveAttribute('aria-pressed', 'true')
    await expect(all).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('/ui Components part: sections and texts', () => {
  test('sections carry their display titles; each component shows description, usage, avoid and alternatives from the manifest', async ({ page }) => {
    await openCatalog(page)
    const part = page.locator('#components')
    for (const title of ['Eingabe', 'Aktion', 'Navigation', 'Feedback', 'Overlay', 'Darstellung', 'Layout', 'Formularstruktur', 'Tastatur']) {
      await expect(part.getByRole('heading', { level: 3, name: title, exact: true }), title).toBeVisible()
    }
    // Aktion lists the components before its blocks; the sections arrive in the order of the issue
    // section titles only: a live sample may carry its own h3 (StatsOutliers, TaskDetailMetadata)
    const titles = await part.locator('h3').evaluateAll(els => els.filter(el => !el.closest('[data-kd-sample]')).map(el => el.textContent?.trim()))
    expect(titles).toEqual(['Eingabe', 'Aktion', 'Navigation', 'Feedback', 'Overlay', 'Darstellung', 'Layout', 'Formularstruktur', 'Tastatur'])

    const link = page.locator('#component-ExternalLink')
    await expect(link).toContainText('Link to an external page')
    await expect(link).toContainText('Only for pages outside the app')
    await expect(link.getByText('Alternatives')).toHaveCount(0) // ExternalLink names none
    await expect(button(page).getByText('Alternatives')).toBeVisible()
    await expect(button(page).getByRole('link', { name: 'ExternalLink' })).toBeVisible()
    // Every category has landed (#77), so every component has an entry; a whole page such as Board says why it has no live sample
    const noSample = page.locator('#component-Board')
    await expect(noSample.getByTestId('catalog-sample-note')).toContainText('No live sample')
    await expect(noSample.locator('[data-kd-sample]')).toHaveCount(0)
  })

  test('an alternative links to its component', async ({ page }) => {
    await openCatalog(page)
    await button(page).getByRole('link', { name: 'ExternalLink' }).click()
    await expect(page.locator('#component-ExternalLink')).toBeInViewport()
    await expect(page.locator('#component-ExternalLink h4')).toBeFocused()
  })
})

test.describe('/ui Components part: language toggle and viewport switch', () => {
  const sampleText = (page: Page) => page.locator('[data-kd-sample="UButton:matrix:primary/solid/md"]')

  test('de/en switches the sample copy, not the chrome, and is remembered like the app locale', async ({ page }) => {
    await openCatalog(page)
    await expect(sampleText(page)).toHaveText('Speichern')
    const language = page.locator('#components').getByRole('group', { name: 'Sample language' })
    await language.getByRole('button', { name: 'en' }).click()
    await expect(sampleText(page)).toHaveText('Save')
    await expect(button(page).locator('[data-kd-sample="UButton:state:icon-leading"]')).toContainText('Drop here to mark the task as done')
    // chrome stays English and unchanged
    await expect(page.getByRole('heading', { level: 2, name: 'Components' })).toBeVisible()
    await expect(language.getByRole('button', { name: 'en' })).toHaveAttribute('aria-pressed', 'true')
    expect(await page.evaluate(() => window.localStorage.getItem('kando-locale'))).toBe('en')

    await page.reload()
    await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
    await expect(sampleText(page)).toHaveText('Save')
    await language.getByRole('button', { name: 'de' }).click()
    await expect(sampleText(page)).toHaveText('Speichern')
  })

  test('the viewport switch narrows the sample frame to 390 px and back', async ({ page }) => {
    await openCatalog(page)
    const frame = button(page).locator('[data-kd-sample="UButton:state:disabled"]').locator('xpath=ancestor::div[contains(@class,"space-y-6")][1]')
    expect((await frame.boundingBox())!.width).toBeGreaterThan(390)
    const viewport = page.locator('#components').getByRole('group', { name: 'Viewport' })
    await viewport.getByRole('button', { name: '390 px' }).click()
    await expect.poll(async () => (await frame.boundingBox())!.width).toBeLessThanOrEqual(390)
    await viewport.getByRole('button', { name: 'Desktop' }).click()
    await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(390)
  })
})

test.describe('/ui Components part: dev-tool acceptance', () => {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile 390', { width: 390, height: 844 }]] as const) {
    test(`${label}: no serious axe violation outside the samples, no horizontal page scroll`, async ({ page }) => {
      await openCatalog(page, viewport)
      // The samples are the app's own components: their contrast is the app's design, judged where the app is (a11y.spec.ts), and
      // a matrix shows every colour role on purpose. The catalog's chrome is held to AA here.
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('[data-kd-sample]').analyze()
      const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      expect(blocking.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    })
  }

  test('a matrix scrolls inside its own keyboard-focusable region, never the page', async ({ page }) => {
    await openCatalog(page, { width: 390, height: 844 })
    const region = button(page).getByRole('region', { name: 'UButton size md samples' })
    await region.focus()
    await expect(region).toBeFocused()
    expect(await region.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  })
})

test.describe('/ui style fingerprint', () => {
  test('the computed styles of every sample match tests/e2e/snapshots/ui-catalog/', async ({ page }, testInfo) => {
    await openCatalog(page)
    // Transitions would move a sample mid-way to its resting style
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' })
    await page.evaluate(() => document.fonts.ready)

    const actual = await page.evaluate((properties) => {
      const result: Record<string, Record<string, string>> = {}
      const duplicates: string[] = []
      for (const wrapper of Array.from(document.querySelectorAll<HTMLElement>('[data-kd-sample]'))) {
        const key = wrapper.dataset.kdSample!
        // A hosted sample (#77): the component sits inside the host's frame; the frame is not what the sample shows
        const frame = wrapper.querySelector<HTMLElement>('[data-kd-board-host]')
        const element = (frame ?? wrapper).firstElementChild as HTMLElement | null
        if (!element) throw new Error(`${key} rendered nothing`)
        if (key in result) duplicates.push(key)
        // A focus ring exists only while the element has focus
        if (wrapper.dataset.kdState === 'focus') element.focus()
        const style = getComputedStyle(element)
        // font-family: the first family only; the fallback list Nuxt Fonts appends is long and says nothing the first one does not
        // outline-style `auto` is the browser's own focus ring: its colour and width come from the OS accent, so they differ between macOS and Linux and are not recorded
        const uaRing = style.getPropertyValue('outline-style') === 'auto'
        result[key] = Object.fromEntries(properties.map(property => [property, property === 'font-family' ? style.getPropertyValue(property).split(',')[0]!.trim() : uaRing && (property === 'outline-color' || property === 'outline-width') ? 'ua-default' : style.getPropertyValue(property)]))
        if (wrapper.dataset.kdState === 'focus') element.blur()
      }
      if (duplicates.length) throw new Error(`duplicate sample keys: ${duplicates.join(', ')}`)
      return result
    }, [...FINGERPRINT_PROPERTIES])

    expect(Object.keys(actual).length).toBeGreaterThan(200)
    // The focus sample must really record a ring, or the focus state would be a vacuous check
    expect(actual['UButton:state:focus']!['outline-style']).not.toBe('none')
    expect(actual['UButton:state:disabled']!['opacity']).not.toBe('1')

    if (testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed') {
      writeFingerprintDir(FINGERPRINT_DIR, actual)
      return
    }
    expect(existsSync(FINGERPRINT_DIR), 'no recorded fingerprint: run this spec with --update-snapshots and commit tests/e2e/snapshots/ui-catalog/').toBe(true)
    const expected = readFingerprintDir(FINGERPRINT_DIR)
    const problems = diffFingerprint(expected, actual)
    expect(problems.slice(0, 40), `${problems.length} differences (--update-snapshots records an intended change)`).toEqual([])
  })
})

test.describe('/ui board samples and the real board', () => {
  test('a visit to /ui leaves the stacks expanded on the board intact (#77: the samples keep their own stack state)', async ({ page, context }) => {
    const now = new Date().toISOString()
    const member = (id: string, title: string, topic: string): SeedTask => ({ id, title, status: 0, priority: 1, timeSpentSeconds: 0, timeBoxSeconds: null, topic, custom: {}, createdAt: now, updatedAt: now })
    await seedLocalBoard(context, [member('a1', 'Konzept ausarbeiten', 'Design'), member('a2', 'Farben abstimmen', 'Design'), member('a3', 'Raster festlegen', 'Design')], {}, { enabled: true, key: 'topic' })
    await page.goto('/tasks')
    const control = page.locator('#column-open-list .task-stack__control')
    const members = page.locator('#column-open-list [data-from-stack="Design"]')
    await control.click()
    await expect(members).toHaveCount(3)
    await expect(control).toHaveCount(0)

    // Client-side navigation: a reload would forget the (in-memory) expansion by itself
    const go = (path: string) => page.evaluate(p => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => Promise<unknown> } } }).useNuxtApp().$router.push(p), path)
    await go('/ui')
    await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
    await expect(page.locator('[data-kd-board-host]').first()).toBeAttached()
    await go('/tasks')
    await expect(members).toHaveCount(3)
    await expect(control).toHaveCount(0)
  })
})
