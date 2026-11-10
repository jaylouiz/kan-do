import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The dev-only `/ui` catalog shell (#65): served by the E2E build (scripts/e2e-server.mjs sets KANDO_UI_CATALOG) and by
 * `nuxt dev`; a production build has no route (tests/config/ui-catalog-build-output.test.ts proves that one). The old
 * `/styleguide` is gone. Tokens are generated from the stylesheets and the app config, so the checks look for tokens
 * the code really defines. Chrome is English, light only.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test.describe('/ui catalog shell', () => {
  test('lists the Tokens part from the real sources, each token with its value and definition', async ({ page }) => {
    // the one-page view holds every token group at once
    await page.goto('/ui?v=all')
    await expect(page.locator('[data-kd-ui-catalog]')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'UI catalog' })).toHaveCount(1)
    await expect(page.getByRole('main')).toHaveCount(1)
    for (const name of ['Semantic colour roles', 'Palettes', 'Typography', 'Radii', 'Shadows', 'Spacing and sizes', 'Z-index', 'Motion', 'Breakpoints', 'Icon sizes', 'Component defaults from app.config']) {
      await expect(page.getByRole('heading', { level: 3, name, exact: true }), name).toBeVisible()
    }

    // A token the code defines: name, authored value, file and line, and the value under the mobile media query
    const gap = page.getByRole('listitem').filter({ has: page.locator('code', { hasText: /^--task-list-gap$/ }) })
    await expect(gap).toContainText('0.75rem')
    await expect(gap).toContainText(/assets\/css\/main\.css:\d+/)
    const noteHeight = page.getByRole('listitem').filter({ has: page.locator('code', { hasText: /^--task-note-height$/ }) })
    await expect(noteHeight).toContainText('max-width: 767px')

    // The frozen custom-ink ramp and the role mapping from app.config.ts
    await expect(page.getByText('primary → custom-ink')).toBeVisible()
    await expect(page.getByText('frozen (DESIGN.md)').first()).toBeVisible()
    await expect(page.locator('code', { hasText: /^custom-ink$/ }).first()).toBeVisible()

    // A token nothing defines does not appear
    await expect(page.locator('code', { hasText: /^--z-modal$/ })).toHaveCount(0)

    // The layer, motion and type tokens of #70 appear with today's value and the file that defines them
    for (const [token, value] of [['--z-overlay', '2100'], ['--duration-fast', '150ms'], ['--text-title', '0.9375rem']] as const) {
      const row = page.getByRole('listitem').filter({ has: page.locator('code', { hasText: new RegExp(`^${token}$`) }) })
      await expect(row, token).toContainText(value)
      await expect(row, token).toContainText(/assets\/css\/main\.css:\d+/)
    }
  })

  test('the Tokens view lists the groups as cards; a group opens alone (kd#127)', async ({ page }) => {
    await page.goto('/ui?v=tokens')
    const groups = page.getByRole('list', { name: 'Token groups' })
    await expect(groups.getByRole('listitem')).toHaveCount(13)
    await expect(page.locator('code', { hasText: /^--duration-fast$/ })).toHaveCount(0)
    await groups.getByRole('link', { name: 'Motion', exact: true }).click()
    await expect(page).toHaveURL(/v=tokens\.motion/)
    await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Motion'])
    await expect(page.locator('code', { hasText: /^--duration-fast$/ })).toBeVisible()
    await expect(page.locator('code', { hasText: /^--task-list-gap$/ })).toHaveCount(0)
  })

  test('the overview shows the kit and the feature parts as tiles; the sidebar opens a group from the keyboard (kd#127)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/ui')
    await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
    await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Kit', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Feature parts', exact: true })).toBeVisible()
    await expect(page.locator('[data-kd-tile="UButton"]')).toBeVisible()
    await expect(page.locator('[data-kd-tile="NewCardFlow"]')).toBeAttached()
    // a tile repeats a sample as a picture: none of them is a fingerprinted sample
    await expect(page.locator('[data-kd-sample]')).toHaveCount(0)
    await expect(page.locator('[data-kd-tile="UButton"] [data-kd-preview]')).toHaveCount(1)

    const nav = page.getByRole('complementary').getByRole('navigation', { name: 'Catalog' })
    const link = nav.getByRole('link', { name: /^Aktion/ })
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/v=kit\.action/)
    await expect(link).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 2, name: 'Kit: Aktion' })).toBeFocused()
    await expect(page.locator('[data-kd-tile="UButton"]')).toBeVisible()
    await expect(page.locator('[data-kd-tile="UInput"]')).toHaveCount(0)
  })

  test('a tile opens the page of its component; the breadcrumb and the back button lead back (kd#127)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/ui?v=kit.action')
    await page.locator('[data-kd-tile="UButton"]').getByRole('link', { name: 'UButton' }).click()
    await expect(page).toHaveURL(/c=UButton/)
    await expect(page.getByRole('heading', { level: 2, name: 'UButton' })).toBeFocused()
    await expect(page.locator('#component-UButton')).toContainText('The one button of the app')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Aktion' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/v=kit\.action/)
    await expect(page.locator('[data-kd-tile="UButton"]')).toBeVisible()
  })

  test('the search filters the tiles of both tiers and says so when nothing matches (kd#127)', async ({ page }) => {
    await page.goto('/ui')
    await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
    const search = page.getByRole('searchbox', { name: 'Search components' })
    await search.fill('stats ring')
    // both tiers: StatsRing is kit, StatsEstimateRing a statistics part
    await expect(page.locator('[data-kd-tile="StatsRing"]')).toBeVisible()
    await expect(page.locator('[data-kd-tile="StatsEstimateRing"]')).toBeVisible()
    await expect(page.locator('[data-kd-tile="UButton"]')).toHaveCount(0)
    expect(await page.locator('[data-kd-tile]').count()).toBeLessThan(10)
    await search.fill('zzzz')
    await expect(page.getByText('Nothing matches.')).toBeVisible()
    await search.fill('')
    await expect(page.getByRole('heading', { level: 2, name: 'Overview' })).toBeVisible()
  })

  test('on a phone the navigation sits in a menu that closes after a choice (kd#127)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ui')
    await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
    await expect(page.getByRole('complementary')).toBeHidden()
    await page.getByText('Menu', { exact: true }).click()
    await page.getByRole('banner').getByRole('navigation', { name: 'Catalog' }).getByRole('link', { name: /^Statistics/ }).click()
    await expect(page).toHaveURL(/v=parts\.statistics/)
    await expect(page.getByRole('banner').getByRole('navigation', { name: 'Catalog' })).toBeHidden()
    await expect(page.locator('[data-kd-tile="StatsTile"]')).toBeVisible()
  })

  test('has no app bar (a tool page, not an app destination)', async ({ page }) => {
    await page.goto('/ui')
    await expect(page.locator('[data-kd-ui-catalog]')).toBeVisible()
    await expect(page.getByRole('link', { name: 'UI catalog' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mehr', exact: true })).toHaveCount(0)
  })

  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile 390', { width: 390, height: 844 }]] as const) {
    for (const [view, url] of [['overview', '/ui'], ['tokens', '/ui?v=tokens.roles'], ['a component', '/ui?c=UButton']] as const) {
      test(`${label}, ${view}: no serious or critical axe violation and no horizontal scroll`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.goto(url)
        await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
        // resolved colours are read after mount: wait for the first role ramp to paint
        if (view === 'tokens') await expect(page.locator('#tokens-roles ~ ul li ul li').first()).toBeVisible()
        // The samples and tile previews are the app's own components (judged by a11y.spec.ts); the chrome of the page is held to AA
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('[data-kd-sample]').exclude('[data-kd-preview]').analyze()
        const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
        expect(blocking.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)).toEqual([])
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow).toBeLessThanOrEqual(0)
      })
    }
  }

  test('/styleguide is gone: no old page renders', async ({ page }) => {
    await page.goto('/styleguide')
    await expect(page.locator('[data-kd-ui-catalog]')).toHaveCount(0)
    await expect(page.getByText('Stil-Leitfaden')).toHaveCount(0)
  })
})
