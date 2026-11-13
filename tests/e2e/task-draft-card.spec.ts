import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';
import { openAddSheet } from './helpers/addSheet'

/**
 * #110: while the add form is open, a draft card replaces the add button in Offen
 * and fills live; cancel removes it, save turns it into the real card.
 */
test.describe('Draft card while adding a task', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context);
    await page.goto('/tasks');
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible();
  });

  const openColumn = (page: import('@playwright/test').Page) => page.locator('#column-open');

  test('shows an empty draft card at the top of Offen and fills live', async ({ page }) => {
    const column = openColumn(page);
    await openAddSheet(page);
    await page.waitForURL(/\/tasks\/add/);

    const draft = column.getByTestId('task-draft-card');
    await expect(draft).toBeVisible();
    // The header button (#248) stays in place but does nothing while the draft is open
    // (the sheet makes the rest of the page inert for the accessibility tree, so the testid is the handle)
    await expect(column.getByTestId('add-task-header-button')).toBeDisabled();
    await expect(draft.locator('.task-title-text')).toHaveText('');

    await page.locator('input[name="title"]').fill('Entwurf schreiben');
    await expect(draft.locator('.task-title-text')).toHaveText('Entwurf schreiben');
  });

  test('dims the other cards while the draft is open, like an open task sheet (#102)', async ({ page }) => {
    const column = openColumn(page);
    await openAddSheet(page);
    await expect(column.getByTestId('task-draft-card')).toBeVisible();

    const draftCard = column.getByTestId('task-draft-card').locator('.task');
    await expect(draftCard).toHaveCSS('opacity', '1');
    await expect(column.locator('.task:not([data-sheet-active])').first()).not.toHaveCSS('opacity', '1');
    await expect(column.getByTestId('task-draft-card')).toHaveCSS('outline-style', 'none');
  });

  test('removes the draft card on Escape and the header button is live again', async ({ page }) => {
    const column = openColumn(page);
    await openAddSheet(page);
    await expect(column.getByTestId('task-draft-card')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForURL(/\/tasks$/);
    await expect(column.getByTestId('task-draft-card')).toHaveCount(0);
    await expect(column.getByTestId('add-task-header-button')).toBeEnabled();
  });

  test('turns the draft into the saved card and the header button is live again', async ({ page }) => {
    const column = openColumn(page);
    await openAddSheet(page);
    await page.locator('input[name="title"]').fill('Gespeicherte Aufgabe');
    await page.locator('input[name="title"]').press('Enter');
    await page.waitForURL(/\/tasks$/);

    await expect(column.getByTestId('task-draft-card')).toHaveCount(0);
    await expect(column.locator('.task', { hasText: 'Gespeicherte Aufgabe' })).toHaveCount(1);
    await expect(column.getByTestId('add-task-header-button')).toBeEnabled();
  });

  test('also appears when the add form is opened by URL', async ({ page }) => {
    await page.goto('/tasks/add');
    await expect(openColumn(page).getByTestId('task-draft-card')).toBeVisible();
  });
});
