import { test, expect, type Page } from '@playwright/test';
import { seedLocalBoard, SEED_TASKS } from './helpers/seed';
import { focusUntilActive, flushFrames } from './helpers/settle';
import { installClock, elapseWindow } from './helpers/clock';

/**
 * Keyboard access to board cards (issue #32): Enter opens details, Space drags,
 * the card is named by its title, and dnd-kit announces in German with titles and column names.
 */
test.describe('Keyboard: board cards', () => {
  test.beforeEach(async ({ context, page }) => {
    await seedLocalBoard(context);
    await page.goto('/tasks');
    await expect(page.locator('.task-wrapper').first()).toBeVisible();
  });

  const first = SEED_TASKS.find(t => t.status === 0)!;

  test('card is a focusable group named by its task title', async ({ page }) => {
    const card = page.locator(`.task-wrapper[data-task-id="${first.id}"]`);
    await expect(card).toHaveAttribute('aria-label', first.title);
    await expect(card).toHaveAttribute('role', 'group');
    await expect(card).toHaveAttribute('aria-roledescription', 'Verschiebbare Aufgabe');
    await expect(page.getByRole('group', { name: first.title, exact: true })).toBeVisible();
    await card.focus();
    await expect(card).toBeFocused();
  });

  test('Enter on a focused card opens the task details', async ({ page }) => {
    const card = page.locator(`.task-wrapper[data-task-id="${first.id}"]`);
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/tasks/${first.id}`));
  });

  test('Space keyboard drag announces German text with title and column names', async ({ page }) => {
    const card = page.locator(`.task-wrapper[data-task-id="${first.id}"]`);
    const live = page.locator('body > [aria-live]');
    await card.focus();

    await page.keyboard.press('Space');
    await expect(live).toContainText(`„${first.title}“`);
    await expect(live).toContainText('aufgenommen');
    await expect(live).toContainText('Spalte Offen');
    await expect(live).not.toContainText(first.id);

    await page.keyboard.press('ArrowRight');
    await expect(live).toContainText('verschoben', { timeout: 5000 });
    await expect(live).toContainText('Spalte Jetzt');

    await page.keyboard.press('Space');
    await expect(live).toContainText('abgelegt');
    await expect(live).toContainText(`„${first.title}“`);
    await expect(live).not.toContainText('Draggable item');
  });

  test('Escape cancels the keyboard drag and announces it', async ({ page }) => {
    const card = page.locator(`.task-wrapper[data-task-id="${first.id}"]`);
    const live = page.locator('body > [aria-live]');
    await card.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(live).toContainText('abgebrochen');
    await expect(live).toContainText('Spalte Offen');
  });
});

/**
 * Delete / Backspace on a focused card deletes it (#579): the usual gap with Undo, focus on the neighbour card,
 * one card per key press.
 */
test.describe('Keyboard: delete the focused card (#579)', () => {
  const LIST = '#column-open-list';
  const openIds = SEED_TASKS.filter(t => t.status === 0).map(t => t.id);
  const [firstId, secondId] = openIds as [string, string];
  const wrapper = (page: Page, id: string) => page.locator(`${LIST} .task-wrapper[data-task-id="${id}"]`);
  const gap = (page: Page) => page.locator(`${LIST} .task-gap`);
  const activeTaskId = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.taskId ?? null);

  test.beforeEach(async ({ context, page }) => {
    await installClock(context);
    await seedLocalBoard(context);
    await page.goto('/tasks');
    await expect(wrapper(page, firstId)).toBeVisible();
  });

  for (const key of ['Delete', 'Backspace']) {
    test(`${key} deletes the card, focus moves to the next card, Undo brings it back`, async ({ page }) => {
      await focusUntilActive(wrapper(page, firstId));
      await page.keyboard.press(key);
      await expect(gap(page)).toHaveCount(1);
      await expect(wrapper(page, firstId)).toHaveCount(0);
      await expect.poll(() => activeTaskId(page)).toBe(secondId);

      await gap(page).getByRole('button', { name: /Rückgängig/ }).click();
      await expect(gap(page)).toHaveCount(0);
      await expect(wrapper(page, firstId)).toBeVisible();
    });
  }

  test('after the undo window the card is in the trash', async ({ page }) => {
    await focusUntilActive(wrapper(page, firstId));
    await page.keyboard.press('Delete');
    await expect(gap(page)).toHaveCount(1);
    // the pointer must not rest on the gap: hover pauses the window
    await page.mouse.move(2, 2);
    await elapseWindow(page);
    await expect(gap(page)).toHaveCount(0);
    const trashed = await page.evaluate(() => (JSON.parse(localStorage.getItem('trash-store') ?? '{"entries":[]}') as { entries: Array<{ taskId: string }> }).entries.map(e => e.taskId));
    expect(trashed).toContain(firstId);
  });

  test('a held key deletes one card only', async ({ page }) => {
    await focusUntilActive(wrapper(page, firstId));
    await page.keyboard.down('Delete');
    await page.keyboard.down('Delete'); // auto-repeat: event.repeat is true
    await page.keyboard.down('Delete');
    await page.keyboard.up('Delete');
    await flushFrames(page);
    await expect(gap(page)).toHaveCount(1);
    await expect(wrapper(page, secondId)).toBeVisible();
  });

  test('a modifier combination deletes nothing', async ({ page }) => {
    await focusUntilActive(wrapper(page, firstId));
    await page.keyboard.press('Shift+Delete');
    await page.keyboard.press('Alt+Backspace');
    await flushFrames(page);
    await expect(gap(page)).toHaveCount(0);
    await expect(wrapper(page, firstId)).toBeVisible();
  });

  test('Delete does nothing while the card is picked up for a keyboard drag', async ({ page }) => {
    await focusUntilActive(wrapper(page, firstId));
    await page.keyboard.press('Space');
    await expect(page.locator('body > [aria-live]')).toContainText(`„${SEED_TASKS.find(t => t.id === firstId)!.title}“`);
    await page.keyboard.press('Delete');
    await flushFrames(page);
    await expect(gap(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(wrapper(page, firstId)).toBeVisible();
  });
});
