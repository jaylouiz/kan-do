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
    
    // The modal uses bg-elevated which resolves to a light near-white tone.
    // Accept any oklch lightness >= 0.96 with the stone hue signature (~106).
    const validColors = ['rgb(245, 245, 244)', 'oklch(0.97 0.001 106.424)'];
    
    // Check if the returned color matches one of our expected formats
    // We use a flexible check because exact oklch decimals can vary slightly by browser version
    const isValid = validColors.some(c => dialogBg === c) || 
                   /oklch\(0\.9[6-9]/.test(dialogBg);
                   
    if (!isValid) {
      console.log(`Expected one of ${validColors.join(' or ')}, got ${dialogBg}`);
    }
    
    expect(isValid).toBeTruthy();
  });
});
