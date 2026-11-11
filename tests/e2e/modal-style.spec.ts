import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';

test.describe('Modal Style Validation', () => {
  test.beforeEach(async ({ context }) => {
    // Empty Local board, seeded before page JS runs (no goto + evaluate + reload, #512).
    await seedLocalBoard(context, []);
  });

  test('sheet background is elevated', async ({ page }) => {
    // Navigate to add task to open the modal
    await page.goto('/tasks/add');
    
    // Locate the modal content (TaskSheet)
    const modalCard = page.getByRole('dialog');
    await expect(modalCard).toBeVisible();
    
    // Check computed background color of the modal card
    const dialogBg = await modalCard.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    
    // The sheet uses bg-elevated: every lifted surface is the white sheet (DESIGN.md "Colour")
    expect(dialogBg).toBe('rgb(255, 255, 255)');
  });
});
