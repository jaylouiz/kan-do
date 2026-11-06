import { test, expect, type BrowserContext } from '@playwright/test'
import { moreButton, openSettings } from './helpers/appNav'
import stubSchema from '../fixtures/notion/database-schema.json' with { type: 'json' }

// Minimal E2E: Stepper presence and steps per mode (settings vs setup)

const seedBoardNotion = {
  boardConfig: { sources: { connected: ['notion'], default: 'notion' } },
  columns: [
    { idClassSuffix: 'open', taskStatus: 0, taskOrder: [], taskPositions: {} },
    { idClassSuffix: 'progress', taskStatus: 1, taskOrder: [], taskPositions: {} },
    { idClassSuffix: 'waiting', taskStatus: 2, taskOrder: [], taskPositions: {} },
    { idClassSuffix: 'done', taskStatus: 3, taskOrder: [], taskPositions: {} },
  ],
  grouping: { enabled: false, key: null },
}

const seedNotionConfig = {
  config: {
    token: 'test-token',
    databaseId: 'db-123',
    propertyMapping: {
      title: 'Name',
      status: 'Status',
      dueDate: null,
      priority: null,
      timeBox: null,
      timeSpent: null,
      timeSpentUnit: 'minutes',
      customProperties: []
    },
    statusMapping: {
      today: 'Today',
      doing: 'Doing',
      done: 'Done',
      waiting: 'Waiting'
    }
  }
}

test.describe('Notion Setup Stepper', () => {
  test.describe('Settings mode', () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript(({ board, notion }) => {
        localStorage.setItem('board-store', JSON.stringify(board))
        localStorage.setItem('notionConfig', JSON.stringify(notion))
      }, { board: seedBoardNotion, notion: seedNotionConfig })
    })

    test('shows 3 steps and navigates mapping -> custom -> status', async ({ page, baseURL }) => {
      await page.goto(baseURL! + '/tasks')

      // ⋯ -> Einstellungen opens the Verbindungen page; its Notion row leads to the dedicated settings page
      await expect(moreButton(page)).toBeVisible({ timeout: 7000 })
      await openSettings(page, 'sources')
      await expect(page).toHaveURL(/\/settings(\?tab=sources)?$/)
      await page.getByTestId('source-settings-notion').click()

      await expect(page).toHaveURL(/\/settings\/notion/)

      // Tabs that correspond to the old stepper sections
      await expect(page.getByText('Eigenschaften', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Weitere Felder', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Status', { exact: true }).first()).toBeVisible()
    })

    test('scrolled, the page header scrolls away and the vertical tab list sticks below the app bar, not under it (#615)', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1280, height: 420 }) // short: the page must scroll for the list to stick
      await page.goto(baseURL! + '/settings/notion')
      const list = page.getByRole('tablist')
      await expect(list).toBeVisible()
      await expect(page.locator('.page-header')).toHaveCSS('position', 'static')
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100) // the premise: really scrolled
      // The header left with the page; the bar stays
      await expect.poll(async () => { const box = await page.locator('.page-header').boundingBox(); return box!.y + box!.height }).toBeLessThanOrEqual(0)
      const nav = (await page.getByTestId('app-nav').boundingBox())!
      expect(nav.y).toBe(0)
      // The list sticks at the veil's lower edge (row 3.5rem + hang 1.75rem), so the veil never washes it
      const veilBottom = await page.getByTestId('app-nav').evaluate(el => el.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(el, '::before').height))
      expect(veilBottom).toBeCloseTo(56 + 28, 0)
      await expect.poll(async () => (await list.boundingBox())!.y).toBeCloseTo(veilBottom, 0)
      // The first tab is reachable, not covered by the bar or its veil
      const first = list.getByRole('tab').first()
      const box = (await first.boundingBox())!
      expect(await first.evaluate((el, pt) => document.elementFromPoint(pt.x, pt.y) === el || el.contains(document.elementFromPoint(pt.x, pt.y)), { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe(true)
    })
  })

  test.describe('Tabs on a phone (#625)', () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript(({ board, notion }) => {
        localStorage.setItem('board-store', JSON.stringify(board))
        localStorage.setItem('notionConfig', JSON.stringify(notion))
      }, { board: seedBoardNotion, notion: seedNotionConfig })
    })

    test('at 390px the tabs are a horizontal, non-sticky row and the panel keeps the full width', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 420 })
      await page.goto(baseURL! + '/settings/notion')
      const list = page.getByRole('tablist')
      await expect(list).toBeVisible()
      await expect(list).toHaveAttribute('aria-orientation', 'horizontal')
      // The panel is the content column (390 - 2 x 16 padding), not the ~100px left beside a vertical list
      const panel = page.getByRole('tabpanel')
      await expect(panel).toBeVisible()
      expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(340)
      // The list sits above the panel
      expect((await list.boundingBox())!.y + (await list.boundingBox())!.height).toBeLessThanOrEqual((await panel.boundingBox())!.y)
      // No sideways page scroll; the tabs that do not fit scroll inside the list
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      // Not stuck at the viewport top (the phone bar is at the bottom, there is no offset to stick at)
      await expect(list).not.toHaveCSS('position', 'sticky')
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
      expect((await list.boundingBox())!.y).toBeLessThan(0)
      // 44px hit areas
      expect((await list.getByRole('tab').first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
    })

    test('at 390px the arrow keys are left/right and the chosen tab scrolls into view', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(baseURL! + '/settings/notion')
      const tabs = page.getByRole('tablist').getByRole('tab')
      await tabs.first().focus()
      await page.keyboard.press('ArrowRight')
      await expect(tabs.nth(1)).toBeFocused()
      await page.keyboard.press('ArrowDown') // vertical keys do nothing in a horizontal list
      await expect(tabs.nth(1)).toBeFocused()
      // The last tab ("Status") is off-screen to begin with; selecting it brings it fully into the list's box
      const last = tabs.last()
      await last.click()
      await expect(last).toHaveAttribute('data-state', 'active')
      await expect.poll(async () => {
        const [tab, list] = [(await last.boundingBox())!, (await page.getByRole('tablist').boundingBox())!]
        return tab.x >= list.x - 1 && tab.x + tab.width <= list.x + list.width + 1
      }).toBe(true)
    })

    test('crossing 768px switches the orientation and keeps the active tab', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(baseURL! + '/settings/notion')
      const list = page.getByRole('tablist')
      await expect(list).toHaveAttribute('aria-orientation', 'vertical')
      // An edit in progress in the panel survives the switch (same panel, only the list changes)
      await page.getByRole('button', { name: 'Datenbank ändern' }).click()
      await expect(page.getByRole('button', { name: 'Abbrechen' }).first()).toBeVisible()
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(list).toHaveAttribute('aria-orientation', 'horizontal')
      await expect(page.getByRole('button', { name: 'Abbrechen' }).first()).toBeVisible()
      await page.setViewportSize({ width: 1280, height: 800 })
      // The last tab is chosen at desktop width, then the viewport shrinks: it must not stay out of sight in the row
      await page.getByRole('tab', { name: 'Status' }).click()
      await page.setViewportSize({ width: 390, height: 844 })
      await expect.poll(async () => {
        const [tab, row] = [(await page.getByRole('tab', { name: 'Status' }).boundingBox())!, (await list.boundingBox())!]
        return tab.x >= row.x - 1 && tab.x + tab.width <= row.x + row.width + 1
      }).toBe(true)
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.getByRole('tab', { name: 'Eigenschaften' }).click()
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(list).toHaveAttribute('aria-orientation', 'horizontal')
      await expect(page.getByRole('tab', { name: 'Eigenschaften' })).toHaveAttribute('data-state', 'active')
      await page.setViewportSize({ width: 1280, height: 800 })
      await expect(list).toHaveAttribute('aria-orientation', 'vertical')
      await expect(page.getByRole('tab', { name: 'Eigenschaften' })).toHaveAttribute('data-state', 'active')
    })
  })

  test.describe('Priority tab (#617)', () => {
    // The stub schema has no priority property: the Status select stands in with its four options
    test('Save stays disabled until the mapping changes, then stores the new shape', async ({ context, page, baseURL }) => {
      await context.addInitScript(({ board, notion }) => {
        localStorage.setItem('board-store', JSON.stringify(board))
        localStorage.setItem('notionConfig', JSON.stringify(notion))
      }, {
        board: seedBoardNotion,
        notion: {
          config: {
            ...seedNotionConfig.config,
            token: 'notion_test_stub',
            dataSourceId: 'ds-123',
            propertyMapping: { ...seedNotionConfig.config.propertyMapping, priority: 'Status' },
            // The shape before #617: shown in the new form, replaced on save
            priorityMapping: { urgent: null, high: 'Today', medium: null, low: null },
          },
        },
      })
      // The stub's database has no properties: serve the fixture schema for the database details
      await page.route('**/api/notion/database?*', async (route) => {
        const url = new URL(route.request().url())
        if (!url.searchParams.get('id')) return route.fallback()
        const response = await route.fetch()
        const database = await response.json()
        await route.fulfill({ response, json: { ...database, properties: stubSchema } })
      })
      await page.goto(baseURL! + '/settings/notion')
      await page.getByRole('tab', { name: 'Priorität' }).click()
      const panel = page.getByRole('tabpanel')
      const save = panel.getByRole('button', { name: /Speichern/ })
      await expect(panel.getByTestId('priority-map-high')).toBeVisible()
      await expect(save).toBeDisabled()

      await panel.getByTestId('priority-map-regular').click()
      await page.getByRole('option', { name: 'Doing' }).click()
      await page.keyboard.press('Escape')
      await expect(save).toBeEnabled()

      await save.click()
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notionConfig')!).config.priorityMapping))
        .toEqual({ high: ['Today'], regular: ['Doing'], low: [] })
      await expect(save).toBeDisabled()
    })
  })

  test.describe('Priority tab dirty state (#627)', () => {
    // A priority property with names the suggestion fits, so a late schema load does assign levels
    const prioritySchema = {
      ...stubSchema,
      Priorität: {
        id: 'prop-prio',
        name: 'Priorität',
        type: 'select',
        select: { options: ['Hoch', 'Mittel', 'Niedrig'].map((name) => ({ id: name, name, color: 'gray' })) },
      },
    }

    async function seedPriorityTab(context: BrowserContext, priorityMapping?: unknown) {
      await context.addInitScript(({ board, notion }) => {
        localStorage.setItem('board-store', JSON.stringify(board))
        localStorage.setItem('notionConfig', JSON.stringify(notion))
      }, {
        board: seedBoardNotion,
        notion: {
          config: {
            ...seedNotionConfig.config,
            token: 'notion_test_stub',
            dataSourceId: 'ds-123',
            propertyMapping: { ...seedNotionConfig.config.propertyMapping, priority: 'Priorität' },
            ...(priorityMapping ? { priorityMapping } : {}),
          },
        },
      })
    }

    test('Cancel without a stored mapping restores the untouched form and disables Save', async ({ context, page, baseURL }) => {
      await seedPriorityTab(context)
      await page.route('**/api/notion/database?*', async (route) => {
        if (!new URL(route.request().url()).searchParams.get('id')) return route.fallback()
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), properties: prioritySchema } })
      })
      await page.goto(baseURL! + '/settings/notion')
      await page.getByRole('tab', { name: 'Priorität' }).click()
      const panel = page.getByRole('tabpanel')
      const save = panel.getByRole('button', { name: /Speichern/ })
      const high = panel.getByTestId('priority-map-high')
      const regular = panel.getByTestId('priority-map-regular')
      await expect(high).toContainText('Hoch')
      await expect(regular).toContainText('Mittel')
      await expect(save).toBeDisabled()

      await regular.click()
      await page.getByRole('option', { name: 'Mittel' }).click()
      await page.keyboard.press('Escape')
      await expect(save).toBeEnabled()
      await expect(regular).not.toContainText('Mittel')

      await panel.getByRole('button', { name: 'Abbrechen' }).click()
      await expect(save).toBeDisabled()
      await expect(high).toContainText('Hoch')
      await expect(regular).toContainText('Mittel')
      await expect(panel.getByTestId('priority-map-low')).toContainText('Niedrig')
    })

    test('a schema that loads after the tab opened keeps Save disabled', async ({ context, page, baseURL }) => {
      await seedPriorityTab(context)
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => { release = resolve })
      await page.route('**/api/notion/database?*', async (route) => {
        if (!new URL(route.request().url()).searchParams.get('id')) return route.fallback()
        await gate
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), properties: prioritySchema } })
      })
      await page.goto(baseURL! + '/settings/notion')
      await page.getByRole('tab', { name: 'Priorität' }).click()
      const panel = page.getByRole('tabpanel')
      const save = panel.getByRole('button', { name: /Speichern/ })
      await expect(panel.getByTestId('priority-map-high')).toBeVisible()
      await expect(save).toBeDisabled()

      release()
      await expect(panel.getByTestId('priority-map-high')).toContainText('Hoch')
      await expect(save).toBeDisabled()
      await expect(panel.getByRole('button', { name: 'Abbrechen' })).toHaveCount(0)
    })

    test('Cancel with a stored mapping still resets to it', async ({ context, page, baseURL }) => {
      await seedPriorityTab(context, { high: ['Hoch'], regular: [], low: ['Niedrig'] })
      await page.route('**/api/notion/database?*', async (route) => {
        if (!new URL(route.request().url()).searchParams.get('id')) return route.fallback()
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), properties: prioritySchema } })
      })
      await page.goto(baseURL! + '/settings/notion')
      await page.getByRole('tab', { name: 'Priorität' }).click()
      const panel = page.getByRole('tabpanel')
      const high = panel.getByTestId('priority-map-high')
      await expect(high).toContainText('Hoch')
      await high.click()
      await page.getByRole('option', { name: 'Mittel' }).click()
      await page.keyboard.press('Escape')
      await expect(high).toContainText('Mittel')

      await panel.getByRole('button', { name: 'Abbrechen' }).click()
      await expect(high).not.toContainText('Mittel')
      await expect(high).toContainText('Hoch')
      // A level stored as empty stays empty: the suggestion does not refill it
      await expect(panel.getByTestId('priority-map-regular')).not.toContainText('Mittel')
      await expect(panel.getByRole('button', { name: /Speichern/ })).toBeDisabled()
    })

    test('a level stored as empty stays empty on open and in the next save (#636)', async ({ context, page, baseURL }) => {
      await seedPriorityTab(context, { high: ['Hoch'], regular: [], low: ['Niedrig'] })
      await page.route('**/api/notion/database?*', async (route) => {
        if (!new URL(route.request().url()).searchParams.get('id')) return route.fallback()
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), properties: prioritySchema } })
      })
      await page.goto(baseURL! + '/settings/notion')
      await page.getByRole('tab', { name: 'Priorität' }).click()
      const panel = page.getByRole('tabpanel')
      const save = panel.getByRole('button', { name: /Speichern/ })
      const regular = panel.getByTestId('priority-map-regular')
      await expect(panel.getByTestId('priority-map-high')).toContainText('Hoch')
      await expect(panel.getByTestId('priority-map-low')).toContainText('Niedrig')
      // Mittel fits Regular by name, but the stored mapping leaves it empty
      await expect(regular).not.toContainText('Mittel')
      await expect(save).toBeDisabled()

      // Editing another level must not persist an unseen suggestion for Regular
      const low = panel.getByTestId('priority-map-low')
      await low.click()
      await page.getByRole('option', { name: 'Niedrig' }).click()
      await page.keyboard.press('Escape')
      await expect(save).toBeEnabled()
      await save.click()
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('notionConfig')!).config.priorityMapping))
        .toEqual({ high: ['Hoch'], regular: [], low: [] })
    })
  })

  test.describe('Setup mode', () => {
    test('shows 5 steps when opened from welcome', async ({ page, baseURL }) => {
      await page.goto(baseURL! + '/welcome')

      const setupButton = page.getByRole('button', { name: /Notion/i })
      await expect(setupButton).toBeVisible()
      await setupButton.click()

      const modal = page.getByRole('dialog')
      // Stepper steps (setup mode)
      await expect(modal.getByText('Token', { exact: true })).toBeVisible()
      await expect(modal.getByText('Datenbank', { exact: true })).toBeVisible()
      await expect(modal.getByText('Eigenschaften', { exact: true })).toBeVisible()
      await expect(modal.getByText('Weitere Eigenschaften', { exact: true })).toBeVisible()
      await expect(modal.getByText('Status', { exact: true })).toBeVisible()

      // Progress indicator is non-interactive: no focusable/dead buttons, active step exposed
      const steps = modal.getByTestId('notion-setup-steps')
      await expect(steps.getByRole('button')).toHaveCount(0)
      await expect(steps.locator('[aria-current="step"]')).toHaveCount(1)
      await expect(steps.locator('[aria-current="step"]')).toContainText('Token')

      // We deliberately do not proceed here as token validation would require API
    })
  })
})
