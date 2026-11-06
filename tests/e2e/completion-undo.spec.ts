import { test, expect, type Locator, type Page } from '@playwright/test'
import { seedLocalBoard } from './helpers/seed'

/** Toast card for a task title (includeHidden: an open sheet aria-hides everything outside it). */
const toastFor = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).locator('xpath=ancestor::*[.//button[normalize-space()="Rückgängig"]][1]')
const toast = (page: Page) => toastFor(page, 'Dokumentation lesen').last()
const undoButton = (t: Locator) => t.getByRole('button', { name: 'Rückgängig', includeHidden: true })
const column = (page: Page, key: string) => page.locator(`#column-${key}-list`)

async function contextMenuMoveTo(page: Page, title: string, target: string) {
  await page.locator('.task-wrapper', { hasText: title }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Status ändern' }).click()
  await page.getByRole('menuitem', { name: target, exact: true }).click()
}
const contextMenuMoveToDone = (page: Page, title: string) => contextMenuMoveTo(page, title, 'Erledigt')

test.describe('Undo toast after completing a task', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context)
  })

  test('context menu: toast offers undo that restores column and position', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`)
    await expect(column(page, 'open').locator('.task-wrapper')).toHaveCount(2)

    // Complete the second Open card; undo must put it back in second place.
    await contextMenuMoveToDone(page, 'Dokumentation lesen')
    await expect(column(page, 'done').getByText('Dokumentation lesen')).toBeVisible()
    await expect(toast(page)).toBeVisible()
    // The same completion burst as for a drop (#692); undo ends it at once
    await expect(page.getByTestId('completion-burst')).toHaveCount(1)

    await undoButton(toast(page)).click()
    await expect(page.getByTestId('completion-burst')).toHaveCount(0)

    const openTitles = column(page, 'open').locator('.task-wrapper .task')
    await expect(openTitles.nth(1)).toContainText('Dokumentation lesen')
    await expect(column(page, 'done').getByText('Dokumentation lesen')).toHaveCount(0)
    await expect(toast(page)).toHaveCount(0)
  })

  test('detail sheet status select shows the toast', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/seed-open-2`)
    await page.getByTestId('task-status-select').click()
    await page.getByRole('option', { name: 'Erledigt', exact: true }).click()
    await expect(toast(page)).toBeVisible()
    await undoButton(toast(page)).click()
    await expect(page.getByTestId('task-status-select')).toContainText('Offen')
  })

  test('drag to Erledigt shows no toast: the card and the drop announcement confirm it (#136)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`)
    const card = page.locator('.task-wrapper', { hasText: 'Dokumentation lesen' }).first()
    const src = (await card.boundingBox())!
    const sx = src.x + src.width / 2
    const sy = src.y + src.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.waitForTimeout(150)
    await page.mouse.move(sx + 10, sy + 10, { steps: 3 })
    await page.waitForTimeout(300)
    const dst = (await page.locator('#column-done .column-drop-zone').boundingBox())!
    await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 40 })
    await page.waitForTimeout(300)
    await page.mouse.up()

    await expect(column(page, 'done').getByText('Dokumentation lesen')).toBeVisible()
    await expect(page.locator('[data-slot="viewport"] [data-slot="root"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rückgängig', includeHidden: true })).toHaveCount(0)
  })

  test('no toast for moves that are not completions', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`)
    await contextMenuMoveTo(page, 'Dokumentation lesen', 'Warten')
    await expect(column(page, 'waiting').getByText('Dokumentation lesen')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rückgängig', includeHidden: true })).toHaveCount(0)
  })

  test('undo into a full Jetzt sends the card to Wartet', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`)
    await contextMenuMoveToDone(page, 'Review schreiben')
    const t = toastFor(page, 'Review schreiben').last()
    await expect(t).toBeVisible()
    // Occupy Jetzt meanwhile
    await contextMenuMoveTo(page, 'Dokumentation lesen', 'Jetzt')
    await undoButton(t).click()
    await expect(column(page, 'progress').locator('.task-wrapper')).toHaveCount(1)
    await expect(column(page, 'waiting').getByText('Review schreiben')).toBeVisible()
  })
})
