import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';
import { showColumnPage } from './helpers/dnd';

/**
 * Issue #33: the "Aufgabe hinzufügen" control is always visible (no hover), keyboard
 * reachable with a visible focus ring, and thumb-reachable on the mobile Offen tab.
 */
test.describe('Add task: persistent control', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context);
  });

  test('desktop: visible without hover, reachable via keyboard, opens the new card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/tasks');

    const add = page.locator('#column-open').getByRole('button', { name: 'Aufgabe hinzufügen' });
    await expect(add).toBeVisible();
    const box = (await add.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);

    // Keyboard: focus shows the focus ring (DESIGN.md "States": the 3px halo); Enter opens the form.
    await add.focus();
    await expect(add).toBeFocused();
    await expect(add).toHaveCSS('outline-style', 'solid');
    await expect(add).toHaveCSS('outline-width', '3px');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('new-card-title')).toBeFocused(); // the card itself, no sheet (#649)
  });

  test('mobile 390px: add control is on the Offen tab, 44px+, opens the new card', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks');
    await showColumnPage(page, 0) // the board opens on Jetzt while a task sits there (kd#191);

    const add = page.locator('#column-open').getByRole('button', { name: 'Aufgabe hinzufügen' });
    await expect(add).toBeVisible();
    const box = (await add.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    // Follows the last Offen card (#144) and stays fully above the 60px tab bar.
    expect(box.y + box.height).toBeLessThanOrEqual(844 - 60);

    await add.click();
    await expect(page.getByTestId('new-card-title')).toBeVisible();
  });
});
