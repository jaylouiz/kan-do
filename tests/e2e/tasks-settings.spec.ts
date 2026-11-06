import { test, expect } from '@playwright/test'
import { seedLocalBoard, seedNotionBoard } from './helpers/seed'
import { goToPlace, moreButton, openSettings } from './helpers/appNav'

// E2E: From /tasks ⋯ -> Einstellungen opens the "Verbindungen" page (#324), with one label for every board; the way back is the bar (#470)

const SETUP_TITLE = /Notion-Einstellungen|Mit Notion verbinden|Notion-Integration einrichten/

test('Local board: ⋯ -> Einstellungen opens the Verbindungen page and Heute returns to the board', async ({ context, page, baseURL }) => {
  await seedLocalBoard(context, undefined, {}, undefined, { once: true })
  await page.goto(baseURL! + '/tasks')

  await openSettings(page)
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible()

  await goToPlace(page, 'Heute')
  await expect(page).toHaveURL(/\/tasks$/)
})

test('Notion board with a connection that cannot be loaded: no setup dialog opens by itself, ⋯ -> Einstellungen opens the page', async ({ context, page, baseURL }) => {
  // The token is the stub's fail token: the failed fetch marks the source, it never opens the dialog (#318)
  await seedNotionBoard(context, undefined, { token: `notion_test_stub:fail=401:${crypto.randomUUID()}` })
  await page.goto(baseURL! + '/tasks')
  await expect(moreButton(page)).toBeVisible()
  // The fail=401 fetch has returned and marked the source: only now can "no dialog" fail
  await expect(moreButton(page)).toHaveAccessibleName('Mehr, Verbindungsproblem')
  await expect(page.getByText(SETUP_TITLE)).toHaveCount(0)

  await openSettings(page, 'sources')
  await expect(page.getByTestId('source-row-notion')).toBeVisible()
})
