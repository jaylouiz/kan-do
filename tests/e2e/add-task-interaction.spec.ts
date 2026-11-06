import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';
import { openAddSheet } from './helpers/addSheet'

test.describe('Add Task Modal Interaction', () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    // Empty Local board, seeded before page JS runs (no goto + evaluate + reload, #512).
    await seedLocalBoard(context, []);
    await page.goto(baseURL!);
    await expect(page.locator('#column-open')).toBeVisible();
  });

  test('should autofocus task title input when modal opens', async ({ page }) => {
    // The sheet is reached through the command palette since the Offen button adds in the card (#649)
    await openAddSheet(page);
    
    // Check if the title input is focused
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toBeFocused();
  });

  test('should submit form when pressing Enter in title input', async ({ page }) => {
    // The sheet is reached through the command palette since the Offen button adds in the card (#649)
    await openAddSheet(page);
    
    // Fill title
    const titleInput = page.locator('input[name="title"]');
    await titleInput.fill('New Task via Enter');
    
    // Press Enter
    await titleInput.press('Enter');

    // Should navigate back to board (URL should not contain /add)
    await page.waitForURL((url) => !url.toString().includes('/tasks/add'));
    
    // Check if task exists
    const taskCard = page.locator('.task', { hasText: 'New Task via Enter' });
    await expect(taskCard).toBeVisible();
  });

  test('should submit form when pressing Cmd+Enter in notes textarea', async ({ page }) => {
    // The sheet is reached through the command palette since the Offen button adds in the card (#649)
    await openAddSheet(page);
    
    // Fill title
    await page.locator('input[name="title"]').fill('Task with Notes');
    
    // Fill notes (section is directly visible — no reveal button)
    const notesInput = page.locator('textarea[name="notes"]');
    await notesInput.fill('Some detailed notes');
    
    // Press Cmd+Enter (Meta+Enter)
    await notesInput.press('Meta+Enter');

    // Should navigate back to board
    await page.waitForURL((url) => !url.toString().includes('/tasks/add'));
    
    // Check if task exists
    const taskCard = page.locator('.task', { hasText: 'Task with Notes' });
    await expect(taskCard).toBeVisible();
  });
});
