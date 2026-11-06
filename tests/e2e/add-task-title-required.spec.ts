import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';
import { expectContrast } from './helpers/contrast';
import { settleAnimations } from './helpers/settle';

/**
 * Empty-title submit of the add-task sheet (#662): an inline error at the title field, announced
 * (aria-invalid, described-by, role="alert"), focus back on the title; it clears once the title has text.
 */
test.describe('Add-task sheet: empty title', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, []);
  });

  for (const how of ['button', 'enter'] as const) {
    test(`submitting an empty title with ${how} shows an inline error and focuses the title`, async ({ page }) => {
      await page.goto('/tasks/add');
      const dialog = page.getByRole('dialog');
      const title = dialog.getByPlaceholder('Aufgabe benennen…');
      const error = dialog.getByTestId('add-task-title-error');
      await expect(title).toBeVisible();
      await expect(error).toHaveCount(0);
      await expect(title).not.toHaveAttribute('aria-invalid');

      // Whitespace-only counts as empty; move focus away first so the refocus is observable
      await title.fill('   ');
      await dialog.getByTestId('timebox-preset-15').focus();
      if (how === 'button') await dialog.getByRole('button', { name: 'Aufgabe erstellen' }).click();
      else {
        await title.focus();
        await page.keyboard.press('Enter');
      }

      await expect(error).toHaveText('Gib der Aufgabe einen Titel.');
      await expect(error).toHaveAttribute('role', 'alert');
      await expect(title).toHaveAttribute('aria-invalid', 'true');
      const errorId = await error.getAttribute('id');
      await expect(title).toHaveAttribute('aria-describedby', errorId!);
      await expect(title).toBeFocused();
      await settleAnimations(page);
      await expectContrast(page, error, 4.5);
      // Nothing was created: the sheet is still open
      await expect(dialog).toBeVisible();

      // Typing clears the error; a valid submit behaves as before
      await title.fill('Fenster putzen');
      await expect(error).toHaveCount(0);
      await expect(title).not.toHaveAttribute('aria-invalid');
      await dialog.getByRole('button', { name: 'Aufgabe erstellen' }).click();
      await expect(dialog).toBeHidden();
    });
  }
});
