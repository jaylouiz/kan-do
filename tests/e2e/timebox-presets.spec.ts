import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';

/**
 * Timebox row in the add-task form (TaskForm).
 *
 * Since f0c614b ("unify task-add and task-detail modal structure") the timebox is an
 * row value (#161): a number input with a "min" suffix plus plain-text preset buttons
 * labelled "15" / "30" / "60" (the 5 and 10 min presets were dropped).
 */
test.describe('Task Form Timebox Presets', () => {
  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, []);
  });

  test('should update timebox input when preset is clicked', async ({ page }) => {
    await page.goto('/tasks/add');

    const timeboxInput = page.getByTestId('add-task-timebox-input');
    await expect(timeboxInput).toBeVisible();

    for (const mins of [15, 30, 60]) {
      await page.getByTestId(`timebox-preset-${mins}`).click();
      await expect(timeboxInput).toHaveValue(String(mins));
    }
  });

  test('should display min unit label in timebox input', async ({ page }) => {
    await page.goto('/tasks/add');

    const unitLabel = page.getByTestId('add-task-timebox').getByText('min', { exact: true });
    await expect(unitLabel).toBeVisible();
  });

  test('should allow manual override after preset selection', async ({ page }) => {
    await page.goto('/tasks/add');

    const timeboxInput = page.getByTestId('add-task-timebox-input');

    await page.getByTestId('timebox-preset-15').click();
    await expect(timeboxInput).toHaveValue('15');

    await timeboxInput.fill('45');
    await expect(timeboxInput).toHaveValue('45');
  });

  test('shows a solid focus ring on the keyboard-focused timebox input (#648, WCAG 2.4.7)', async ({ page }) => {
    await page.goto('/tasks/add');

    const timeboxInput = page.getByTestId('add-task-timebox-input');
    await timeboxInput.focus();
    await expect(timeboxInput).toHaveCSS('outline-style', 'solid');
    await expect(timeboxInput).toHaveCSS('outline-width', '2px');
  });

  test('starts empty with the muted placeholder, not 0 (#663)', async ({ page }) => {
    await page.goto('/tasks/add');

    const timeboxInput = page.getByTestId('add-task-timebox-input');
    await expect(timeboxInput).toHaveValue('');
    await expect(timeboxInput).toHaveAttribute('placeholder', '—');
    // No preset is pressed while there is no timebox
    for (const mins of [15, 30, 60]) {
      await expect(page.getByTestId(`timebox-preset-${mins}`)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('clearing the input, or typing 0, returns to no timebox (#663)', async ({ page }) => {
    await page.goto('/tasks/add');

    const timeboxInput = page.getByTestId('add-task-timebox-input');
    await page.getByTestId('timebox-preset-30').click();
    await expect(timeboxInput).toHaveValue('30');
    await expect(page.getByTestId('timebox-preset-30')).toHaveAttribute('aria-pressed', 'true');

    await timeboxInput.fill('');
    await expect(timeboxInput).toHaveValue('');
    await expect(page.getByTestId('timebox-preset-30')).toHaveAttribute('aria-pressed', 'false');

    await timeboxInput.fill('45');
    await timeboxInput.fill('0');
    await expect(page.getByTestId('timebox-preset-30')).toHaveAttribute('aria-pressed', 'false');
  });
});
