import { expect, test, type Page, type Route } from '@playwright/test'
import { seedLocalBoard, seedMixedBoard, SEED_TASKS, type SeedTask } from './helpers/seed'
import { openMore } from './helpers/appNav'
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

test.describe('welcome page (#14)', () => {
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

test.describe('task sheet: time spent row (#4)', () => {
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
      // a fourth topic, so the Mehr list holds a value behind the three pills (#16)
      { ...SEED_TASKS[0]!, id: 'ncf-extra-2', title: 'Noch eine', topic: 'Vertrieb', activity: 'Telefonat', status: 2 },
    ])
    await gotoBoard(page)
    await page.locator('#column-open .add-task-button').click()
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
    // typing a name no value has: the "Neu" row (#16)
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
    await page.locator('#column-open .add-task-button').click()
    await page.getByTestId('new-card-title').fill('Erste Aufgabe')
    await page.keyboard.press('Enter')
    // an empty board has no topics or activities: Timebox comes first, with the full list behind the third pill
    await expect(page.getByTestId('new-card-step')).toHaveAttribute('data-step', 'timebox')
    await settleAnimations(page)
    await expect(page.getByTestId('new-card-flow')).toMatchAriaSnapshot({ name: 'new-card-timebox-390.aria.yml' })
  })
})
