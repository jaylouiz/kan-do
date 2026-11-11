import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fillerTasks, seedLocalBoard, seedMixedBoard, SEED_TASKS } from './helpers/seed'
import { settleAnimations } from './helpers/settle'
import { appNav, openSettings } from './helpers/appNav'
import { showColumnPage } from './helpers/dnd'
import { expectContrast } from './helpers/contrast'

/**
 * Automated accessibility checks (axe-core) for the main surfaces:
 * board (desktop + mobile, light only), board with the Jetzt focus overlay on and off,
 * task detail modal, the Einstellungen page (focus option and Verbindungen) and statistics page.
 *
 * Only `serious` and `critical` violations fail the test. Known larger issues
 * are excluded narrowly per test and marked with `// a11y-backlog: <reason>`.
 *
 * Set A11Y_MAX_TARGETS=100 to print every offending node on failure.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const BLOCKING_IMPACTS = new Set(['serious', 'critical'])
const MAX_TARGETS = Number(process.env.A11Y_MAX_TARGETS ?? 3)
const MOBILE_VIEWPORT = { width: 390, height: 844 }

/**
 * #371, accepted trade-off (the `TaskStack` doc block): the content of the front card of a collapsed stack is
 * muted on purpose (it only signals that cards are stacked), so its contrast is not measured. Nothing
 * else is exempt: the pill, the peek layers' sheet and every other card keep 4.5:1.
 */
const MUTED_STACK_FRONT_CONTENT = '.task-stack .stacked-task--top > *'
const withMutedStackFrontExempt: AxeConfigure = (b) => b.exclude(MUTED_STACK_FRONT_CONTENT)

/**
 * #394, accepted trade-off (DESIGN.md "The Receding Text Rule", measured in the FocusOverlay doc block): while a task sits in Jetzt the rest of the board is dimmed
 * on purpose (a warm dusk up to 46 % at the rim, with a flat blur); one mouse move, a tap or the setting in
 * Einstellungen brings it back at full contrast. Only the overlay-on test exempts what the overlay covers
 * (Offen, Wartet, Erledigt with its footer; the app bar is not dimmed, #694); the lit part (the Jetzt column) keeps
 * 4.5:1, and the same board with the overlay off is measured plain, with no exclusions.
 */
const FOCUS_OVERLAY_COVERED = ['#column-open', '#column-waiting', '#column-done']
const withFocusOverlayExempt: AxeConfigure = (b) => FOCUS_OVERLAY_COVERED.reduce((builder, selector) => builder.exclude(selector), b)

/** Seed without an in-progress task (empty Jetzt column). */
const NO_PROGRESS_TASKS = SEED_TASKS.filter((t) => t.status !== 1)

/** Seeds a statistics history (5 weeks, a pattern in "Entwicklung", one off-target task today) into the statistics store. */
async function seedStatisticsRecords(page: Page) {
  await page.addInitScript(() => {
    const now = new Date()
    const at = (ago: number, i: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 9 + (i % 8), i % 50).toISOString()
    const history = Array.from({ length: 30 }, (_, i) => ({
      taskId: `stat-h-${i}`,
      title: `Verlauf ${i}`,
      completedAt: at(1 + ((i * 7) % 34), i),
      timeBoxSeconds: 1800,
      actualTimeSpentSeconds: i % 3 ? 2700 : 1800,
      estimationAccuracy: i % 3 ? 150 : 100,
      topic: i % 2 ? 'Entwicklung' : 'Büro',
      topicColorCode: null,
      activity: i % 2 ? 'Büro' : 'Vor Ort',
      isUnplanned: i % 5 === 0,
    }))
    // Eight weekdays 9:00 to 12:00 (#600), so the work-rhythm tile has data
    const workSessions = Array.from({ length: 12 }, (_, i) => i + 1)
      .filter(ago => ![0, 6].includes(new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago).getDay()))
      .slice(0, 8)
      .map(ago => ({ start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 9).getTime(), end: new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 12).getTime() }))
    localStorage.setItem('taskStatistics', JSON.stringify({
      workSessions,
      completionRecords: [...history, {
        taskId: 'stat-1',
        title: 'Statistik-Aufgabe',
        completedAt: now.toISOString(),
        timeBoxSeconds: 1800,
        actualTimeSpentSeconds: 3600,
        estimationAccuracy: 200,
        topic: 'Entwicklung',
        topicColorCode: '#3b82f6',
        activity: null,
        isUnplanned: false,
      }],
    }))
  })
}

type AxeConfigure = (builder: AxeBuilder) => AxeBuilder

/** Runs axe on the page and asserts there are no serious/critical violations. */
async function expectNoSeriousA11yViolations(page: Page, configure: AxeConfigure = (b) => b) {
  const builder = configure(new AxeBuilder({ page }).withTags(WCAG_TAGS))
  const results = await builder.analyze()
  const blocking = results.violations.filter((v) => v.impact != null && BLOCKING_IMPACTS.has(v.impact))

  const summary = blocking
    .map((v) => {
      const targets = v.nodes
        .slice(0, MAX_TARGETS)
        .map((n) => {
          const detail = n.any[0]?.message ?? n.failureSummary?.split('\n')[1]?.trim() ?? ''
          return `      - ${n.target.join(' ')}\n        ${detail}`
        })
        .join('\n')
      const more = v.nodes.length > MAX_TARGETS ? `\n      … and ${v.nodes.length - MAX_TARGETS} more` : ''
      return `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n${targets}${more}`
    })
    .join('\n')

  expect(blocking.length, `Serious/critical a11y violations:\n${summary}`).toBe(0)
}

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('[data-task-id="seed-open-1"]').first()).toBeVisible()
}

test.describe('Accessibility (axe)', () => {
  test.describe('board', () => {
    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context, NO_PROGRESS_TASKS)
    })

    test('desktop', async ({ page }) => {
      await gotoBoard(page)
      await expectNoSeriousA11yViolations(page, (b) => b)
    })

    test('mobile', async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT)
      await gotoBoard(page)
      await expectNoSeriousA11yViolations(page, (b) => b)
    })

    // #632 / #615: the app bar's labels keep AA while cards scroll behind it (the brand sits on the paper veil, the
    // places on the white pill). Measured on painted pixels (helpers/contrast.ts).
    test('desktop – app bar labels over scrolled cards', async ({ page, context }) => {
      await seedLocalBoard(context, [...NO_PROGRESS_TASKS, ...fillerTasks(14)])
      await gotoBoard(page)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await settleAnimations(page)
      // The bar is only over cards when the page really scrolled (a short board would test the plain veil)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
      for (const label of [appNav(page).getByTestId('app-nav-brand'), appNav(page).getByTestId('app-nav-place-board'), appNav(page).getByTestId('app-nav-place-statistics')]) {
        await expectContrast(page, label)
      }
    })

    // #124: header, hint, Gestern note and done cards on the teal drop wash keep 4.5:1.
    // Scoped to Erledigt: during a drag the other column headings dim on purpose (board.css).
    test('desktop – dragging over Erledigt', async ({ page }) => {
      await gotoBoard(page)
      const source = (await page.locator('.task-wrapper[data-task-id="seed-open-1"]').boundingBox())!
      const target = (await page.locator('#column-done-list .task-wrapper').first().boundingBox())!
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(150)
      await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2 + 10, { steps: 3 })
      await page.mouse.move(target.x + target.width / 2, target.y + 10, { steps: 30 })
      await expect(page.locator('#column-done')).toHaveClass(/is-done-drop-target/)
      // Let the 200ms wash fade settle so contrast is measured on final colors.
      await page.waitForTimeout(400)
      await expectNoSeriousA11yViolations(page, (b) => b.include('#column-done'))
      await page.mouse.up()
    })
  })

  test.describe('with default seed (task in progress)', () => {
    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context)
    })

    test('board – focus overlay off (plain 4.5:1, no exclusions)', async ({ page }) => {
      await gotoBoard(page)
      await expect(page.getByTestId('focus-overlay')).toHaveCount(0)
      await expectNoSeriousA11yViolations(page, (b) => b)
    })

    test('board – focus overlay on: the lit Jetzt column keeps 4.5:1, what the overlay covers is exempt (#394, #503)', async ({ context, page }) => {
      await seedLocalBoard(context, SEED_TASKS, {}, undefined, { focus: true })
      await gotoBoard(page)
      await expect(page.getByTestId('focus-overlay')).toHaveClass(/is-on/)
      await settleAnimations(page)
      await expectNoSeriousA11yViolations(page, withFocusOverlayExempt)
      // The lit column on its own, as a guard that the exemption list is not hiding it
      await expectNoSeriousA11yViolations(page, (b) => b.include('#column-progress'))
    })

    // #388: text on every chip fill keeps 4.5:1: the grey chip over its grey fill (Offen, Erledigt) and the Jetzt bar
    // (spent and timebox text over track and fill) in primary and warning
    for (const [label, spent] of [['50 %', 1800], ['85 %', 3060], ['over the timebox', 4300]] as const) {
      test(`progress chips keep 4.5:1 with the Jetzt card at ${label} (#388)`, async ({ context, page }) => {
        const tasks = SEED_TASKS.map((t) => {
          if (t.id === 'seed-progress-1') return { ...t, timeSpentSeconds: spent }
          if (t.id === 'seed-open-2') return { ...t, timeSpentSeconds: spent }
          return t
        })
        await seedLocalBoard(context, tasks)
        await gotoBoard(page)
        await expect(page.locator('#column-progress [data-testid="task-progress-chip"]')).toHaveClass(/chip--now/)
        await settleAnimations(page)
        await expectNoSeriousA11yViolations(page, (b) => b.include('[data-testid="task-progress-chip"]'))
        await page.setViewportSize(MOBILE_VIEWPORT)
        await settleAnimations(page)
        await expectNoSeriousA11yViolations(page, (b) => b.include('[data-testid="task-progress-chip"]'))
      })
    }

    for (const [label, size] of [['desktop', { width: 1280, height: 720 }], ['390px', { width: 390, height: 844 }]] as const) {
      test(`timebox nudge on the Jetzt card keeps 4.5:1 on its buttons and the minutes field (${label}, #389)`, async ({ context, page }) => {
        await seedLocalBoard(context, SEED_TASKS.filter((t) => t.id !== 'seed-progress-1'))
        await page.setViewportSize(size)
        await gotoBoard(page)
        if (size.width < 768) await showColumnPage(page, 0)
        await page.locator('.task-wrapper', { hasText: 'Konzept ausarbeiten' }).first().click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Status ändern' }).click()
        await page.getByRole('menuitem', { name: 'Jetzt', exact: true }).click()
        if (size.width < 768) await showColumnPage(page, 1)
        const layer = page.getByRole('group', { name: 'Timebox hinzufügen?' })
        await expect(layer).toBeVisible()
        // (not settleAnimations: it would wait out the countdown) the 180ms fade-in is over once the layer is opaque
        await expect.poll(() => layer.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
        // The pointer on a control pauses the 8 s countdown, so axe (slow) measures a layer that is still there (this checks the hover pair)
        const thirty = layer.getByRole('button', { name: '30 min', exact: true })
        await thirty.hover()
        await thirty.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished))) // the 150ms colour transition
        await expect.poll(() => page.locator('.nudge__bar').evaluate((el) => getComputedStyle(el, '::after').animationPlayState)).toBe('paused')
        await expectNoSeriousA11yViolations(page, (b) => b.include('.nudge'))
        await layer.getByRole('button', { name: 'Eigene Dauer' }).click()
        await expect(layer.getByRole('spinbutton', { name: 'Minuten' })).toBeFocused()
        await expectNoSeriousA11yViolations(page, (b) => b.include('.nudge'))
      })
    }

    test('task detail sheet opened from a card (desktop)', async ({ page }) => {
      await gotoBoard(page)
      await page.locator('[data-task-id="seed-open-1"]').first().click()
      await expect(page).toHaveURL(/\/tasks\/seed-open-1/)
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(page.getByTestId('task-detail-header')).toBeVisible()
      // Let the open animation settle so contrast is measured on final colors.
      await page.waitForTimeout(500)
      await expectNoSeriousA11yViolations(page, (b) =>
        b.include('[role="dialog"]'),
      )
    })

    test('task detail sheet at 390px (drawer)', async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT)
      await page.goto('/tasks/seed-open-1')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(page.getByTestId('task-detail-header')).toBeVisible()
      await page.waitForTimeout(500)
      await expectNoSeriousA11yViolations(page, (b) =>
        b.include('[role="dialog"]'),
      )
    })

    test('add task sheet (desktop and 390px drawer)', async ({ page }) => {
      for (const viewport of [{ width: 1280, height: 800 }, MOBILE_VIEWPORT]) {
        await page.setViewportSize(viewport)
        await page.goto('/tasks/add')
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByTestId('add-task-context-bar')).toBeVisible()
        await page.waitForTimeout(500)
        await expectNoSeriousA11yViolations(page, (b) =>
          b.include('[role="dialog"]'),
        )
      }
    })

    test('Einstellungen page: Fokus option and Verbindungen (desktop and 390px)', async ({ page }) => {
      await gotoBoard(page)
      await openSettings(page)
      await expect(page.getByTestId('focus-switch')).toBeVisible()
      await expectNoSeriousA11yViolations(page)
      for (const tab of ['sources', 'manage'] as const) {
        await openSettings(page, tab)
        await settleAnimations(page) // the tab switch fades colours: axe would read a mid-transition shade
        await expectNoSeriousA11yViolations(page)
      }
      await page.setViewportSize(MOBILE_VIEWPORT)
      await page.mouse.move(0, 0) // the tab click left the pointer where a phone-bar item now sits: its tooltip would open
      await expect(page.getByRole('tab', { name: 'Verwaltung' })).toBeVisible()
      await expectNoSeriousA11yViolations(page)
    })

    test('Verbindungen page with a Notion row that needs attention (warning status, all actions)', async ({ context, page }) => {
      // Registered after the describe's Local seed, so this one wins on every load
      await seedMixedBoard(context, undefined, { defaultSource: 'local', notionConfig: { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` } })
      await page.goto('/tasks')
      await openSettings(page, 'sources')
      await settleAnimations(page)
      await expect(page.getByTestId('source-status-notion')).toHaveText('Verbindung prüfen')
      await expect(page.getByTestId('source-repair-notion')).toBeVisible()
      await expectNoSeriousA11yViolations(page)
      await page.setViewportSize(MOBILE_VIEWPORT)
      await expect(page.getByTestId('source-repair-notion')).toBeVisible()
      await expectNoSeriousA11yViolations(page)
    })

    test('statistics page (desktop, with data, each tile open in turn)', async ({ page }) => {
      await seedStatisticsRecords(page)
      await page.goto('/statistics')
      await expect(page.getByRole('heading', { level: 2, name: /Wo schätze ich falsch\?/ })).toBeVisible()
      await expectNoSeriousA11yViolations(page)
      for (const n of [2, 3, 4, 5]) {
        await page.getByTestId(`stats-tile-${n}-toggle`).click()
        await expect(page.getByTestId(`stats-tile-${n}-toggle`)).toHaveAttribute('aria-expanded', 'true')
        await expectNoSeriousA11yViolations(page)
      }
    })

    test('statistics page (first-run work-rhythm tile, desktop and 390px)', async ({ page }) => {
      await page.goto('/statistics')
      await expect(page.getByTestId('stats-tile-5')).toBeVisible()
      await expectNoSeriousA11yViolations(page)
      await page.setViewportSize(MOBILE_VIEWPORT)
      await expect(page.getByTestId('stats-tile-5')).toBeVisible()
      await expectNoSeriousA11yViolations(page)
    })

    test('statistics page (390px) has a focusable, named table scroll region and no violations with a tile open', async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT)
      await seedStatisticsRecords(page)
      await page.goto('/statistics?open=3')
      await expect(page.getByTestId('stats-tile-3-toggle')).toHaveAttribute('aria-expanded', 'true')
      await page.getByText(/Alle erledigten Aufgaben/).click()
      await expect(page.getByRole('region', { name: 'Tabelle erledigter Aufgaben, scrollbar' })).toBeVisible()
      await expectNoSeriousA11yViolations(page)
    })

    test('welcome page (desktop and 390px)', async ({ page }) => {
      await page.goto('/welcome')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousA11yViolations(page)
      await page.setViewportSize(MOBILE_VIEWPORT)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousA11yViolations(page)
    })
  })

  test.describe('with carried-over cards (#99)', () => {
    test.beforeEach(async ({ context }) => {
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const carried = (days: number) => ({ firstOn: '2026-01-01', days, lastOn: today, keptAtDays: null })
      await seedLocalBoard(context, SEED_TASKS, {
        'seed-open-1': carried(5),
        'seed-open-2': carried(9),
        'seed-waiting-1': carried(3),
      })
    })

    test('board with dots (desktop and 390px)', async ({ page }) => {
      await gotoBoard(page)
      await expect(page.getByTestId('carry-over-dots').first()).toBeVisible()
      // a sort label ("Manuell") still fades its colour on load/resize: axe would read a mid-transition shade (#100)
      await settleAnimations(page)
      await expectNoSeriousA11yViolations(page)
      await page.setViewportSize(MOBILE_VIEWPORT)
      await expect(page.getByTestId('carry-over-dots').first()).toBeVisible()
      await settleAnimations(page)
      await expectNoSeriousA11yViolations(page)
    })

    test('task sheet with the triage block (desktop and 390px drawer)', async ({ page }) => {
      await page.goto('/tasks/seed-open-1')
      await expect(page.getByTestId('carry-over-triage')).toBeVisible()
      await page.waitForTimeout(500)
      await expectNoSeriousA11yViolations(page, (b) => b.include('[role="dialog"]'))
      await page.setViewportSize(MOBILE_VIEWPORT)
      await page.goto('/tasks/seed-open-1')
      await expect(page.getByTestId('carry-over-triage')).toBeVisible()
      await page.waitForTimeout(500)
      await expectNoSeriousA11yViolations(page, (b) => b.include('[role="dialog"]'))
    })
  })
})

test.describe('Accessibility (axe): stacks (#147)', () => {
  // Two Open tasks share the topic "Design": a stack under topic grouping
  const STACK_TASKS = NO_PROGRESS_TASKS.map((t) =>
    t.id === 'seed-open-2' ? { ...t, topic: 'Design' } : t,
  )

  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, STACK_TASKS, {}, { enabled: true, key: 'topic' })
  })

  test('collapsed and expanded, desktop and 390px', async ({ page }) => {
    await page.goto('/tasks')
    const stack = page.locator('#column-open-list .task-stack')
    await expect(stack).toBeVisible()
    await settleAnimations(page)
    await expectNoSeriousA11yViolations(page, withMutedStackFrontExempt)

    const control = stack.locator('.task-stack__control')
    await control.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#column-open-list [data-from-stack="Design"]')).toHaveCount(2)
    // #197: the header row fades in while expanding; measure contrast on the resting colours
    await settleAnimations(page)
    await expectNoSeriousA11yViolations(page)

    await page.keyboard.press('Escape')
    await expect(stack).toHaveCount(1)
    // #197: the pill fades in while collapsing
    await settleAnimations(page)
    await page.setViewportSize(MOBILE_VIEWPORT)
    await settleAnimations(page)
    await expectNoSeriousA11yViolations(page, withMutedStackFrontExempt)
  })

  // #150: the whole stack in the air over Erledigt: preview, placeholder and wash keep their contrast
  test('dragging a whole stack over Erledigt (desktop)', async ({ page }) => {
    await page.goto('/tasks')
    const stack = page.locator('#column-open-list .task-stack')
    await expect(stack).toBeVisible()
    await expect(page.locator('#column-done-list .task-wrapper').first()).toBeVisible()
    const source = (await stack.boundingBox())!
    const target = (await page.locator('#column-done-list .task-wrapper').first().boundingBox())!
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(150)
    await page.mouse.move(source.x + source.width / 2 + 10, source.y + source.height / 2 + 10, { steps: 3 })
    await page.mouse.move(target.x + target.width / 2, target.y + 10, { steps: 30 })
    await expect(page.locator('#column-done')).toHaveClass(/is-done-drop-target/)
    await expect(page.locator('.kando-dnd-preview.task-stack')).toBeVisible()
    await page.waitForTimeout(400)
    await expectNoSeriousA11yViolations(page, (b) => withMutedStackFrontExempt(b.include('#column-done')))
    await page.mouse.up()
  })
})

test.describe('Landmarks, focus and motion', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, NO_PROGRESS_TASKS)
  })

  test('/tasks has one main landmark and one h1; Erledigt name has no glyph', async ({ page }) => {
    await gotoBoard(page)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 2, name: 'Erledigt', exact: true })).toBeVisible()
  })

  test('primary button shows the focus ring (DESIGN.md "States": the 3px halo, no offset)', async ({ page }) => {
    // A solid primary button on a real route: the confirmation of the Local setup on /welcome (#65: the styleguide that hosted this check is gone)
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-local').click()
    const button = page.getByTestId('local-confirm')
    await button.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(button).toBeFocused()
    const outline = await button.evaluate((el) => {
      const s = getComputedStyle(el)
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset), color: s.outlineColor }
    })
    expect(outline.style).toBe('solid')
    expect(outline.width).toBe(3)
    expect(outline.offset).toBe(0)
  })

  test('sort control becomes visible on keyboard focus', async ({ page }) => {
    await gotoBoard(page)
    const control = page.getByTestId('column-sorting-control').first()
    // The pointer may start over a column (seen on CI), which reveals the control via hover.
    await control.evaluate((el) => el.closest('.column')?.dispatchEvent(new MouseEvent('mouseleave')))
    await expect(control).toHaveCSS('opacity', '0')
    await control.getByRole('button').focus()
    await expect(control).toHaveCSS('opacity', '1')
  })

  test('mobile column slide is instant under prefers-reduced-motion', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoBoard(page)
    const board = page.locator('.board').first()
    await expect(board).toHaveCSS('transition-duration', '0s')
    await expect(board).toHaveCSS('will-change', 'auto')
  })
})

