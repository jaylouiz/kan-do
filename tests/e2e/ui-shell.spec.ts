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
    await page.goto('/ui')
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

  test('the Components part lists the manifest components by category (the engine, #66)', async ({ page }) => {
    await page.goto('/ui')
    const part = page.locator('#components')
    await expect(part.getByRole('heading', { level: 2, name: 'Components' })).toBeVisible()
    await expect(part.getByRole('heading', { level: 3, name: 'Layout' })).toBeVisible()
    await expect(page.locator('[data-kd-catalog-ready]')).toBeAttached()
  })

  test('the part links work from the keyboard and move focus to the part', async ({ page }) => {
    await page.goto('/ui')
    const link = page.getByRole('navigation', { name: 'Catalog parts' }).getByRole('link', { name: 'Components' })
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#components')).toBeFocused()
    await expect(page.locator('#components')).toBeInViewport()
  })

  test('has no app bar (a tool page, not an app destination)', async ({ page }) => {
    await page.goto('/ui')
    await expect(page.locator('[data-kd-ui-catalog]')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Catalog parts' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mehr', exact: true })).toHaveCount(0)
  })

  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile 390', { width: 390, height: 844 }]] as const) {
    test(`${label}: no serious or critical axe violation and no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/ui')
      await expect(page.getByText('Semantic colour roles')).toBeVisible()
      // resolved colours are read after mount: wait for the first role ramp to paint
      await expect(page.locator('#tokens-roles ~ ul li ul li').first()).toBeVisible()
      // The Components part's samples are the app's own components (judged by a11y.spec.ts); ui-catalog.spec.ts holds the rest of the page to AA
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('[data-kd-sample]').analyze()
      const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
      expect(blocking.map(v => `${v.id}: ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)).toEqual([])
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })
  }

  test('/styleguide is gone: no old page renders', async ({ page }) => {
    await page.goto('/styleguide')
    await expect(page.locator('[data-kd-ui-catalog]')).toHaveCount(0)
    await expect(page.getByText('Stil-Leitfaden')).toHaveCount(0)
  })
})
