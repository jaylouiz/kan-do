import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { seedMixedBoard, DEFAULT_NOTION_SEED_CONFIG, MIXED_SEED_TASKS } from './helpers/seed'
import { closeMore, goToPlace, moreButton, openDayClose, openMore, openSettings } from './helpers/appNav'
import { openAddSheet } from './helpers/addSheet'

/**
 * The final end-to-end pass of epic #264 (#325): the requirements' sections 1-10 at smoke level on one mixed
 * Local + Notion board, in the order a user meets them. Each section has its own spec with the depth
 * (source-connections, add-task-source, task-move-source, source-icon-footer, pending-sync, sources-settings,
 * welcome-setup, mixed-board-features); this walk proves they hold together on one board, one state after the
 * other, and fails on the first section that does not.
 */

const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)
const card = (page: Page, title: string) => page.locator('.task-wrapper', { hasText: title }).first()
const sheet = (page: Page) => page.getByRole('dialog')

interface StoredTask { id: string; title: string; source: string; externalId: string | null; status: number }
const storedTasks = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: StoredTask[] }).tasks ?? [])
const storedSources = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('board-store') ?? '{}') as { boardConfig?: { sources?: unknown } }).boardConfig?.sources)
const storedTask = async (page: Page, title: string) => (await storedTasks(page)).find((t) => t.title === title)

/** Notion maps a topic, so the add form shows a field the Local target lacks (section 9) */
const NOTION_WITH_TOPIC = {
  propertyMapping: { ...DEFAULT_NOTION_SEED_CONFIG.propertyMapping, topic: 'Projekt', customProperties: [{ key: 'projekt-nr', name: 'Projekt-Nr', type: 'text' as const, enabled: true }] },
}

test('requirements sections 1-10 hold on one mixed board', async ({ context, page, baseURL, browser }) => {
  test.setTimeout(120_000)
  await seedMixedBoard(context, undefined, { once: true, notionConfig: NOTION_WITH_TOPIC })
  await page.goto('/tasks')
  await expect(card(page, 'Fokusaufgabe vorbereiten')).toBeVisible()

  // 4. Board: a source icon on every card of the mixed board, no source filter, no grouping by source
  await expect(page.locator('.task[data-task-id]')).toHaveCount(MIXED_SEED_TASKS.length)
  await expect(page.getByTestId('task-source-icon')).toHaveCount(MIXED_SEED_TASKS.length)
  const panel = await openMore(page)
  await panel.getByRole('switch', { name: /Karten stapeln/ }).click()
  // 9. Grouping on a mixed board offers properties every source has: topic, activity and priority, no custom property
  await expect(panel.getByRole('group', { name: 'Gruppieren nach' }).getByRole('button')).toHaveCount(3)
  await panel.getByRole('switch', { name: /Karten stapeln/ }).click() // grouping off again: single cards for the rest of the walk
  await closeMore(page)
  await expect(page.getByText(/nach Verbindung|Verbindung filtern/i)).toHaveCount(0)

  // 5. Sync: healthy sources leave the sync button a plain refresh; no card shows a cloud or a health state
  await expect(moreButton(page)).toHaveAccessibleName('Mehr')
  const syncPanel = await openMore(page)
  await expect(syncPanel.getByTestId('more-sync')).toBeEnabled()
  await expect(syncPanel.locator('[data-testid^="sync-problem-"]')).toHaveCount(0)
  await closeMore(page)
  await expect(page.getByTestId('task-save-pending')).toHaveCount(0)

  // 9. The task sheet follows the task's own source
  await page.goto('/tasks/page-1')
  await expect(page.getByRole('heading', { name: 'Eigenschaften', level: 3 })).toBeVisible()
  await page.getByRole('button', { name: 'Metadaten' }).click()
  await expect(page.getByTestId('task-detail-source')).toHaveText('Notion')
  await page.goto('/tasks/local-open-1')
  await page.getByRole('button', { name: 'Metadaten' }).click()
  await expect(page.getByTestId('task-detail-source')).toHaveText('Lokal')
  await expect(page.getByRole('heading', { name: 'Eigenschaften', level: 3 })).toHaveCount(0)
  await page.goto('/tasks')

  // 7. Verbindungen: the default sits in the rows; make Local the default
  await openSettings(page, 'sources')
  await expect(page).toHaveURL(/\/settings(\?tab=sources)?$/)
  await expect(page.getByTestId('source-default-notion')).toBeVisible()
  await expect(page.getByTestId('source-row-local')).toBeVisible()
  await page.getByRole('button', { name: /Lokal als Standard festlegen|Als Standard festlegen/ }).first().click()
  await expect.poll(() => storedSources(page)).toEqual({ connected: ['notion'], default: 'local' })

  // 1. Disconnecting states the count and what stays; cancel changes nothing
  await page.getByTestId('source-disconnect-notion').click()
  await expect(page.getByTestId('disconnect-dialog')).toContainText(/\d+ Aufgaben? verlassen? das Board/)
  await page.getByTestId('disconnect-cancel').click()
  await expect(page.getByTestId('disconnect-dialog')).toHaveCount(0)
  expect(await storedSources(page)).toEqual({ connected: ['notion'], default: 'local' })
  await goToPlace(page, 'Heute')
  await expect(page).toHaveURL(/\/tasks$/)

  // 2. Add: the form starts on the new default (Local), a second add switches to Notion and creates there
  await openAddSheet(page)
  await expect(sheet(page).locator('button[aria-label^="Speichern in"]')).toHaveAttribute('aria-label', 'Speichern in: Lokal')
  await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Walk: lokal angelegt')
  await sheet(page).getByRole('button', { name: 'Aufgabe erstellen' }).click()
  await expect.poll(async () => (await storedTask(page, 'Walk: lokal angelegt'))?.source).toBe('local')

  await openAddSheet(page)
  await sheet(page).locator('button[aria-label^="Speichern in"]').click()
  await page.getByRole('option', { name: /^Notion/ }).click()
  await sheet(page).getByPlaceholder('Aufgabe benennen…').fill('Walk: in Notion angelegt')
  await sheet(page).getByRole('button', { name: 'Aufgabe erstellen' }).click()
  await expect.poll(async () => (await storedTask(page, 'Walk: in Notion angelegt'))?.source).toBe('notion')
  await expect.poll(async () => (await storedTask(page, 'Walk: in Notion angelegt'))?.externalId).not.toBeNull()

  // 3. Move: a Notion task goes to Local from the card menu, keeps its column, and Undo brings it back
  await card(page, 'Blocker klären').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Verschieben nach …' }).click()
  await page.getByRole('menuitem', { name: /^Lokal/ }).click()
  await expect.poll(async () => (await storedTask(page, 'Blocker klären'))?.source).toBe('local')
  await expect(column(page, 'waiting').getByText('Blocker klären')).toBeVisible()
  await page.getByRole('button', { name: 'Rückgängig', includeHidden: true }).last().click()
  await expect.poll(async () => (await storedTask(page, 'Blocker klären'))?.source).toBe('notion')

  // 8. Existing features: delete follows the task's source (undo toast), the palette runs on either source
  await card(page, 'Walk: lokal angelegt').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Löschen' }).click()
  await expect(card(page, 'Walk: lokal angelegt')).toHaveCount(0)
  await page.getByRole('button', { name: 'Rückgängig', includeHidden: true }).last().click()
  await expect(card(page, 'Walk: lokal angelegt')).toBeVisible()
  await openDayClose(page)
  const dayClose = page.getByRole('dialog', { name: 'Tag abschließen' })
  await dayClose.getByTestId('day-close-open-details').locator('summary').click() // the open tasks sit in the "Für morgen" list
  await expect(dayClose.getByText('Walk: lokal angelegt')).toBeVisible()
  await expect(dayClose.getByText('Fokusaufgabe vorbereiten')).toBeVisible()
  await expect(dayClose.getByTestId('task-source-icon')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dayClose).toBeHidden()

  // 6. Welcome: a browser that never onboarded is asked the one question (no source chosen yet)
  const fresh = await browser.newContext({ locale: 'de-DE', baseURL })
  try {
    const first = await fresh.newPage()
    await first.goto('/welcome')
    await expect(first.getByRole('button', { name: 'Loslegen' })).toBeVisible()
    await expect(first.getByRole('button', { name: 'Mit Beispielaufgaben starten' })).toBeVisible()
  } finally {
    await fresh.close()
  }

  // 10. Announcement: the release notes carry the "Mehrere Quellen" highlight in both languages, nothing else in-app
  const notes = await readFile(join(process.cwd(), 'release-notes', '0.3.0.md'), 'utf8')
  expect(notes).toMatch(/### de[\s\S]*\*\*Mehrere Quellen\.\*\*/)
  expect(notes).toMatch(/### en[\s\S]*\*\*(Several|Multiple) sources\.\*\*/)
})
