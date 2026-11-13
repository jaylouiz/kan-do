import { expect, test, type Page, type Route } from '@playwright/test'
import { seedLocalBoard, seedMixedBoard, seedNewDayBoard, SEED_TASKS, type SeedTask } from './helpers/seed'
import { openDayClose, openMore } from './helpers/appNav'
import { pinClock, pinnedNow } from './helpers/clock'
import { settleAnimations } from './helpers/settle'

/**
 * Structure of the empty, loading and error states and of the open task sheet, as Playwright ARIA snapshots
 * (`toMatchAriaSnapshot`, files in `snapshots/state-structure.spec.ts/*.aria.yml`): roles, accessible names, states
 * and copy, without pixels. The default UI acceptance criterion "Empty, loading and error states handled"
 * (`.claude/issue-workflow.md`) gets evidence that a later change cannot silently drop, and the visual-regression
 * shots stay free to change the look.
 *
 * Each snapshot is scoped to the region of the state (a column, the Mehr panel, the sheet), so a change elsewhere
 * does not touch it. An intended change: `npm run test:e2e -- tests/e2e/state-structure.spec.ts --update-snapshots`,
 * then read the `.aria.yml` diff like copy and a11y review (it is the screen reader's view of the state).
 */

const MOBILE = { width: 390, height: 844 }

async function gotoBoard(page: Page) {
  await page.goto('/tasks')
  await expect(page.locator('#column-open')).toBeVisible()
  await settleAnimations(page)
}

test.describe('empty states', () => {
  test('empty board: every column with its empty state (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [])
    await gotoBoard(page)
    await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'empty-board-1280.aria.yml' })
  })

  test('empty board: the Offen page (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context, [])
    await gotoBoard(page)
    await expect(page.locator('#column-open')).toMatchAriaSnapshot({ name: 'empty-board-open-390.aria.yml' })
  })
})

test.describe('Offen add button (#248)', () => {
  test('the header button at rest and while a draft is open: named, then disabled in place (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await gotoBoard(page)
    const header = page.locator('#column-open .column-header')
    await expect(header).toMatchAriaSnapshot({ name: 'add-button-rest-1280.aria.yml' })
    await header.getByRole('button', { name: 'Aufgabe hinzufügen' }).click()
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await settleAnimations(page)
    await expect(header).toMatchAriaSnapshot({ name: 'add-button-draft-open-1280.aria.yml' })
  })
})

test.describe('loading state', () => {
  test('sync in progress: the Mehr panel while Notion has not answered', async ({ context, page }) => {
    await seedMixedBoard(context)
    await gotoBoard(page)
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()

    // Hold every Notion request until the snapshot is taken, so the sync stays in flight.
    const held: Route[] = []
    await page.route('**/api/notion/**', route => { held.push(route) })
    const panel = await openMore(page)
    await panel.getByTestId('more-sync').click()
    await expect.poll(() => held.length).toBeGreaterThan(0)
    await expect(panel).toMatchAriaSnapshot({ name: 'sync-loading-more-panel.aria.yml' })

    await page.unroute('**/api/notion/**')
    for (const route of held) await route.continue().catch(() => {})
  })
})

test.describe('board menu: stacking (kd#178)', () => {
  test('the group-by options are choice chips and the picked one is pressed (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await gotoBoard(page)
    const panel = await openMore(page)
    await panel.getByTestId('more-stack').click()
    const group = panel.getByRole('group', { name: 'Gruppieren nach' })
    await expect(group).toBeVisible()
    await expect(group).toMatchAriaSnapshot({ name: 'more-panel-group-by-1280.aria.yml' })
  })
})

test.describe('topic focus (#161)', () => {
  const NOW = new Date().toISOString()
  const withTopic = (task: SeedTask, topic: string): SeedTask => ({ ...task, topic, updatedAt: NOW })
  const tasks = SEED_TASKS.map((task, i) => withTopic(task, i % 2 === 0 ? 'Baustelle' : 'Büro'))

  test('the funnel at rest and with the chip row open (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, tasks)
    await gotoBoard(page)
    await expect(page.getByTestId('focus-trigger')).toMatchAriaSnapshot({ name: 'focus-trigger-rest-1280.aria.yml' })
    await page.getByTestId('focus-trigger').click()
    await expect(page.getByTestId('focus-bar')).toMatchAriaSnapshot({ name: 'focus-chips-1280.aria.yml' })
  })

  test('a focus is on: the pill and the funnel that ends it (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, tasks)
    await gotoBoard(page)
    await page.getByTestId('focus-trigger').click()
    await page.getByTestId('focus-chip').first().click()
    await expect(page.getByTestId('focus-bar')).toMatchAriaSnapshot({ name: 'focus-pill-1280.aria.yml' })
    await expect(page.getByTestId('focus-trigger')).toMatchAriaSnapshot({ name: 'focus-trigger-active-1280.aria.yml' })
  })
})

test.describe('swap on the running card (#162)', () => {
  test('a keyboard drag over the running card announces the swap (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await gotoBoard(page)
    await page.locator('.task-wrapper[data-task-id="seed-open-1"]').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    const live = page.locator('body > [aria-live]')
    await expect(live).toContainText('Beim Ablegen wechseln beide')
    await expect(live).toMatchAriaSnapshot({ name: 'swap-announcement-1280.aria.yml' })
    await page.keyboard.press('Escape')
  })
})

test.describe('error states', () => {
  test('Notion unreachable: the Mehr panel names the problem', async ({ context, page }) => {
    await seedMixedBoard(context)
    await gotoBoard(page)
    await expect(page.locator('#column-open-list').getByText('Fokusaufgabe vorbereiten')).toBeVisible()

    await page.route('**/api/notion/**', route => route.abort('connectionrefused'))
    const panel = await openMore(page)
    await panel.getByTestId('more-sync').click()
    await expect(panel.getByTestId('sync-problem-notion')).toBeVisible()
    await expect(panel).toMatchAriaSnapshot({ name: 'sync-offline-more-panel.aria.yml' })
  })

  test('Notion rejects the database (404): the source is broken and the panel offers the repair', async ({ context, page }) => {
    await seedMixedBoard(context, undefined, { notionConfig: { token: `notion_test_stub:fail=404:${crypto.randomUUID()}` } })
    const rejected = page.waitForResponse(res => res.url().includes('/api/notion/') && res.status() === 404)
    await page.goto('/tasks')
    await rejected
    const panel = await openMore(page)
    await expect(panel.getByTestId('sync-problem-notion')).toBeVisible()
    await expect(panel).toMatchAriaSnapshot({ name: 'sync-broken-more-panel.aria.yml' })
  })
})

test.describe('welcome page (kd#14)', () => {
  test('first run: wordmark, tagline, question and the two answers (1280)', async ({ page }) => {
    await page.goto('/welcome')
    await expect(page.getByTestId('welcome-choice-local')).toBeVisible()
    await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'welcome-1280.aria.yml' })
  })

  test('the photo fails to load: the same structure on the paper colour', async ({ page }) => {
    await page.route('**/welcome/*.webp', route => route.abort('failed'))
    await page.goto('/welcome')
    await expect(page.getByTestId('welcome-choice-local')).toBeVisible()
    await expect(page.getByTestId('welcome-photo')).toHaveCSS('opacity', '0')
    await expect(page.locator('main')).toMatchAriaSnapshot({ name: 'welcome-1280.aria.yml' })
  })
})

test.describe('welcome setup on the page (#43)', () => {
  test('Notion: first step with the guide rail (1280)', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-notion').click()
    await expect(page.getByRole('heading', { name: 'Notion-Token' })).toBeFocused()
    await expect(page.getByTestId('notion-setup-flow')).toMatchAriaSnapshot({ name: 'welcome-notion-first-step-1280.aria.yml' })
  })

  test('Local: the two radio cards and the confirmation (1280)', async ({ page }) => {
    await page.goto('/welcome')
    await page.getByTestId('welcome-choice-local').click()
    await expect(page.getByTestId('local-confirm')).toBeVisible()
    await expect(page.getByTestId('local-setup-flow')).toMatchAriaSnapshot({ name: 'welcome-local-1280.aria.yml' })
  })
})

test.describe('task sheet', () => {
  test('open from the board (1280)', async ({ context, page }) => {
    await seedLocalBoard(context)
    await page.goto(`/tasks/${SEED_TASKS[0]!.id}`)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await settleAnimations(page)
    await expect(sheet).toMatchAriaSnapshot({ name: 'task-sheet-1280.aria.yml' })
  })

  test('open as a drawer (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context)
    await page.goto(`/tasks/${SEED_TASKS[0]!.id}`)
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await settleAnimations(page)
    await expect(sheet).toMatchAriaSnapshot({ name: 'task-sheet-390.aria.yml' })
  })
})

test.describe('task sheet: time spent row (kd#4)', () => {
  // A waiting task (no timer ticks): 30 of 60 min, with a Timebox
  const WAITING_WITH_TIME: SeedTask = {
    id: 'time-edit-1', title: 'Wartende Aufgabe', status: 2, priority: 1, activity: null, topic: null, topicColorCode: null,
    timeSpentSeconds: 1800, timeBoxSeconds: 3600, custom: {},
  }
  const timeSpentRow = (page: Page) => page.getByTestId('task-property-row').filter({ hasText: 'Aufgewendete Zeit' })

  test('time and time left beside it (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [WAITING_WITH_TIME], {}, undefined, { once: true })
    await page.goto('/tasks/time-edit-1')
    await expect(timeSpentRow(page)).toBeVisible()
    await settleAnimations(page)
    await expect(timeSpentRow(page)).toMatchAriaSnapshot({ name: 'time-spent-row-1280.aria.yml' })
  })

  test('the minutes field is open (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context, [WAITING_WITH_TIME], {}, undefined, { once: true })
    await page.goto('/tasks/time-edit-1')
    await timeSpentRow(page).getByRole('button', { name: /^Aufgewendete Zeit: / }).click()
    await expect(page.getByTestId('time-spent-edit-input')).toBeVisible()
    await settleAnimations(page)
    await expect(timeSpentRow(page)).toMatchAriaSnapshot({ name: 'time-spent-row-edit-390.aria.yml' })
  })
})

test.describe('add-task sheet validation (#662)', () => {
  test('empty-title submit: the title is invalid and described by its error (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [])
    await page.goto('/tasks/add')
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Aufgabe erstellen' }).click()
    await expect(sheet.getByTestId('add-task-title-error')).toBeVisible()
    await settleAnimations(page)
    await expect(sheet).toMatchAriaSnapshot({ name: 'add-task-title-error-1280.aria.yml' })
  })
})

test.describe('guided new card (#649)', () => {
  test('title step, a choice step with all options, and the Notiz step (1280)', async ({ context, page }) => {
    await seedLocalBoard(context, [
      ...SEED_TASKS,
      { ...SEED_TASKS[0]!, id: 'ncf-extra', title: 'Weitere', topic: 'Büro', activity: 'Abstimmung', status: 2 },
      // a fourth topic, so the Mehr list holds a value behind the three pills (kd#16)
      { ...SEED_TASKS[0]!, id: 'ncf-extra-2', title: 'Noch eine', topic: 'Vertrieb', activity: 'Telefonat', status: 2 },
    ])
    await gotoBoard(page)
    await page.locator('#column-open [data-testid="add-task-header-button"]').click()
    const card = page.getByTestId('new-card-flow')
    await expect(page.getByTestId('new-card-title')).toBeFocused()
    await settleAnimations(page)
    await expect(card).toMatchAriaSnapshot({ name: 'new-card-title-1280.aria.yml' })

    await page.getByTestId('new-card-title').fill('Angebot schreiben')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', 'topic')
    await settleAnimations(page)
    await expect(card).toMatchAriaSnapshot({ name: 'new-card-topic-1280.aria.yml' })

    await page.getByTestId('new-card-more').click()
    const list = page.getByRole('group', { name: 'Thema?' }).last()
    await expect(list.getByRole('button', { name: 'Vertrieb' })).toBeVisible()
    await expect(list).toMatchAriaSnapshot({ name: 'new-card-all-options-1280.aria.yml' })
    // typing a name no value has: the "Neu" row (kd#16)
    await page.getByTestId('new-card-search').fill('Gartenpflege')
    await expect(page.getByTestId('new-card-new')).toBeVisible()
    await expect(list).toMatchAriaSnapshot({ name: 'new-card-search-new-1280.aria.yml' })
    await page.keyboard.press('Escape')

    await page.getByTestId('new-card-step').focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter')
    await expect(page.getByTestId('new-card-notes')).toBeFocused()
    await settleAnimations(page)
    await expect(card).toMatchAriaSnapshot({ name: 'new-card-notes-1280.aria.yml' })
  })

  test('the Notiz step at 390 (drawer for all options, no key cues)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedLocalBoard(context, [])
    await gotoBoard(page)
    await page.locator('#column-open [data-testid="add-task-header-button"]').click()
    await page.getByTestId('new-card-title').fill('Erste Aufgabe')
    await page.keyboard.press('Enter')
    // an empty board has no topics or activities: Timebox comes first, with the full list behind the third pill
    await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', 'timebox')
    await settleAnimations(page)
    await expect(page.getByTestId('new-card-flow')).toMatchAriaSnapshot({ name: 'new-card-timebox-390.aria.yml' })
  })
})

test.describe('new-day recap (#44)', () => {
  const recap = (page: Page) => page.getByTestId('new-day-recap')

  test('stage on the photo with both decks (1280)', async ({ context, page }) => {
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    await expect(recap(page)).toMatchAriaSnapshot({ name: 'recap-stage-1280.aria.yml' })
  })

  test('stage with the deck switcher (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedNewDayBoard(context)
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    await expect(recap(page)).toMatchAriaSnapshot({ name: 'recap-stage-390.aria.yml' })
  })

  test('nothing open: the stage shows only the done deck, no switcher (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await seedNewDayBoard(context, { allDone: true })
    await page.goto('/tasks')
    await expect(recap(page)).toBeVisible()
    await settleAnimations(page)
    await expect(recap(page)).toMatchAriaSnapshot({ name: 'recap-stage-all-done-390.aria.yml' })
  })
})

test.describe('day close sheet (#237)', () => {
  const sheet = (page: Page) => page.getByRole('dialog', { name: 'Tag abschließen' })
  /** Fixed data on the pinned day, so the date, the sums and the facts read the same on every run. */
  const doneAt = () => new Date(pinnedNow().getTime() - 3_600_000).toISOString()
  const task = (id: string, title: string, status: SeedTask['status'], extra: Partial<SeedTask> = {}): SeedTask =>
    ({ id, title, status, priority: 2, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {}, ...extra })
  const DONE: SeedTask[] = [
    task('dc-1', 'Angebot schreiben', 3, { timeSpentSeconds: 4500, timeBoxSeconds: 3600, completedAt: doneAt() }),
    task('dc-2', 'Steuerunterlagen sortieren', 3, { timeSpentSeconds: 2700, timeBoxSeconds: 3600, completedAt: doneAt() }),
  ]
  const OPEN: SeedTask[] = [
    task('dc-3', 'Konzept ausarbeiten', 0),
    task('dc-4', 'Review schreiben', 1, { timeSpentSeconds: 1800, timeBoxSeconds: 3600 }),
    task('dc-5', 'Blocker klären', 2),
  ]

  test('modal: the summary, the done rows and "Für morgen" with the list open and one task deselected (1280)', async ({ context, page }) => {
    await pinClock(context) // the sheet shows today's date
    await seedLocalBoard(context, [...DONE, ...OPEN])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(sheet(page)).toBeVisible()
    await sheet(page).getByTestId('day-close-open-details').locator('summary').click()
    await sheet(page).getByRole('checkbox').first().click()
    await settleAnimations(page)
    await expect(sheet(page)).toMatchAriaSnapshot({ name: 'day-close-modal-1280.aria.yml' })
  })

  test('drawer: the summary and "Für morgen" with the list closed (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await pinClock(context)
    await seedLocalBoard(context, [...DONE, ...OPEN])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(sheet(page)).toBeVisible()
    await settleAnimations(page)
    await expect(sheet(page)).toMatchAriaSnapshot({ name: 'day-close-drawer-390.aria.yml' })
  })

  test('nothing left open: the trophy headline and no "Für morgen" (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await pinClock(context)
    await seedLocalBoard(context, DONE)
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(sheet(page)).toBeVisible()
    await settleAnimations(page)
    await expect(sheet(page)).toMatchAriaSnapshot({ name: 'day-close-all-done-390.aria.yml' })
  })

  test('nothing done and nothing open: the empty sheet (1280)', async ({ context, page }) => {
    await pinClock(context)
    await seedLocalBoard(context, [])
    await page.goto('/tasks')
    await openDayClose(page)
    await expect(sheet(page)).toBeVisible()
    await settleAnimations(page)
    await expect(sheet(page)).toMatchAriaSnapshot({ name: 'day-close-empty-1280.aria.yml' })
  })
})

// Live copy editor (#59): a dev-only tool that the E2E build carries (KANDO_COPY_EDITOR=1). Its dev routes are mocked.
test.describe('live copy editor (#59)', () => {
  // The shortcut hints are platform glyphs (Nuxt UI's UKbd reads `Macintosh;` from the user agent: "⌥" there, "Alt" elsewhere);
  // the snapshots record the macOS spelling, so the editor specs pin a macOS user agent and read the same on a Linux runner (#100).
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' })

  async function openEditor(context: Parameters<typeof seedLocalBoard>[0], page: Page) {
    await seedLocalBoard(context)
    await page.goto('/tasks')
    await expect(page.locator('#column-open')).toBeVisible()
    await page.keyboard.press('Control+k')
    await page.keyboard.type('Edit UI copy')
    await page.getByRole('option', { name: /Edit UI copy: text selection mode/ }).click()
  }

  test('the mode bar (1280)', async ({ context, page }) => {
    await openEditor(context, page)
    await expect(page.getByRole('region', { name: 'UI copy editor' })).toMatchAriaSnapshot({ name: 'copy-editor-bar-1280.aria.yml' })
  })

  test('the editor pane: one language written, the other left to the agent (1280)', async ({ context, page }) => {
    await openEditor(context, page)
    await page.getByText('Offen', { exact: true }).first().click()
    await expect(page.getByTestId('copy-editor-form')).toMatchAriaSnapshot({ name: 'copy-editor-editor-1280.aria.yml' })
  })

  test('Publish: empty state, then the translation failing keeps the edit (390)', async ({ context, page }) => {
    await page.setViewportSize(MOBILE)
    await page.route('**/api/dev/copy/translate', route => route.fulfill({ status: 502, json: { ok: false, errors: ['the agent did not answer within 180 s'] } }))
    await openEditor(context, page)
    await page.getByTestId('copy-editor-publish').click()
    await expect(page.getByTestId('copy-editor-publish-view')).toMatchAriaSnapshot({ name: 'copy-editor-publish-empty-390.aria.yml' })

    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    await page.getByTestId('copy-editor-search-list').getByRole('option').first().click()
    await page.getByTestId('copy-editor-text').fill('Zurück zur Liste')
    await page.getByTestId('copy-editor-save').click()
    await page.getByTestId('copy-editor-tab-publish').click()
    await page.getByTestId('copy-editor-translate').click()
    await expect(page.getByTestId('copy-editor-error')).toBeVisible()
    await expect(page.getByTestId('copy-editor-publish-view')).toMatchAriaSnapshot({ name: 'copy-editor-publish-error-390.aria.yml' })
  })
})
