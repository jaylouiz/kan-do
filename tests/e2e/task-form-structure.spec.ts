/**
 * E2E tests: Unified structure for Task Add form (TaskForm) vs Task Detail modal
 *
 * These tests assert the shared labelled-property-rows layout (#161) that add and detail speak:
 *  - Label/value rows (Priorität, Timebox) instead of a chip row
 *  - Thema/Aktivität are rows in stable positions with the empty "Auswählen" state (no add-line)
 *  - Help text lives in the picker / accessible description, not in info-icon tooltips
 *  - Notes section always visible (no "Notiz hinzufügen" reveal button)
 *  - The add sheet title uses the display font (DESIGN.md "Type")
 */

import { test, expect } from '@playwright/test';
import { seedLocalBoard, seedNotionBoard, DEFAULT_NOTION_SEED_CONFIG, type SeedTask } from './helpers/seed';

const SEED: SeedTask[] = [
  {
    id: 'uts-task-1',
    title: 'Testaufgabe Strukturprüfung',
    status: 0,
    priority: 2,
    timeSpentSeconds: 0,
    timeBoxSeconds: 1800,
    activity: 'Planung',
    topic: 'Design',
    topicColorCode: null,
    notes: 'Testnotizen für Struktur.',
    custom: {},
  },
];

test.beforeEach(async ({ context }) => {
  await seedLocalBoard(context, SEED);
});

// ---------------------------------------------------------------------------
// Add modal structure
// ---------------------------------------------------------------------------

test.describe('Add task modal — unified calm structure', () => {
  test('renders labelled property rows instead of a chip row', async ({ page }) => {
    await page.goto('/tasks/add');
    await expect(page.getByRole('dialog')).toBeVisible();

    // The property list holds Priorität and Timebox as label/value rows
    const list = page.getByTestId('add-task-context-bar');
    await expect(list).toBeVisible();
    await expect(page.getByTestId('add-task-priority-chip')).toBeVisible();
    await expect(page.getByTestId('add-task-timebox')).toBeVisible();
    await expect(list.getByText('Priorität', { exact: true })).toBeVisible();
    await expect(list.getByText('Timebox', { exact: true })).toBeVisible();

    // Thema/Aktivität are rows too, in empty state, no add-line
    await expect(list.getByRole('button', { name: /^Thema: Auswählen/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /^Aktivität: Auswählen/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /hinzufügen$/ })).toHaveCount(0);

    // No info-icon tooltips
    await expect(list.locator('[class*="cursor-help"]')).toHaveCount(0);
  });

  test('picking a Thema fills its row in place; the row does not move', async ({ page }) => {
    await page.goto('/tasks/add');
    await expect(page.getByRole('dialog')).toBeVisible();

    const topic = page.getByTestId('add-task-topic-select');
    await expect(topic).toContainText('Auswählen');
    const before = await topic.boundingBox();
    await topic.click();
    await page.getByRole('option', { name: 'Design', exact: true }).click();
    await expect(topic).toContainText('Design');
    await expect(topic).toHaveAccessibleName('Thema: Design');
    expect((await topic.boundingBox())!.y).toBe(before!.y);
  });

  test('a custom row stays mounted and focused while its text is cleared', async ({ page, context }) => {
    await seedNotionBoard(context, SEED, {
      propertyMapping: {
        ...DEFAULT_NOTION_SEED_CONFIG.propertyMapping,
        customProperties: [{ key: 'kommentar', name: 'Kommentar', type: 'text', enabled: true }],
      },
    });
    await page.goto('/tasks/add');
    await expect(page.getByRole('dialog')).toBeVisible();

    // The empty custom row is there from the start, no "+ n weitere"
    const input = page.getByRole('textbox', { name: 'Kommentar' });
    await input.fill('x');
    await input.fill('');

    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test('notes section is directly accessible — no reveal button required', async ({ page }) => {
    await page.goto('/tasks/add');
    await expect(page.getByRole('dialog')).toBeVisible();

    // Notes section header should be visible without any interaction
    const notesSection = page.getByTestId('add-task-notes-section');
    await expect(notesSection).toBeVisible();

    // The notes textarea must be directly in the DOM (not hidden behind a button)
    const notesInput = page.locator('textarea[name="notes"]');
    await expect(notesInput).toBeVisible();

    // The old "Notiz hinzufügen" reveal button must NOT exist
    const revealBtn = page.getByRole('button', { name: 'Notiz hinzufügen' });
    await expect(revealBtn).toHaveCount(0);
  });

  test('priority is a plain-text row value, not a chip or button group', async ({ page }) => {
    await page.goto('/tasks/add');
    await expect(page.getByRole('dialog')).toBeVisible();

    const priorityRow = page.getByTestId('add-task-priority-chip');
    await expect(priorityRow).toBeVisible();
    const trigger = priorityRow.getByRole('button', { name: /^Priorität: / });
    await expect(trigger).toHaveAccessibleName('Priorität: Normal');

    // The hint lives in the open picker (reachable on touch), not in a tooltip
    await trigger.click();
    await expect(page.getByText('Wie wichtig ist diese Aufgabe?')).toBeVisible();
    // No "Keine" (#653): exactly the three levels
    await expect(page.getByRole('option')).toHaveText(['Niedrig', 'Normal', 'Hoch']);
    await page.keyboard.press('Escape');

    // There should be no UFieldGroup / segmented button row for priority
    const buttonGroupLabel = page.locator('[class*="field-group"]');
    await expect(buttonGroupLabel).toHaveCount(0);
  });

  test('form can still be submitted after structural refactor', async ({ page }) => {
    await page.goto('/tasks/add');
    await expect(page.getByRole('dialog')).toBeVisible();

    // Title input must be focusable and accept input
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Neue Strukturaufgabe');

    // Notes textarea must be directly fillable (no reveal step)
    const notesInput = page.locator('textarea[name="notes"]');
    await notesInput.fill('Notizen ohne Reveal-Button');

    // Submit via Enter on title
    await titleInput.press('Enter');

    // Should navigate back to the board
    await page.waitForURL((url) => !url.toString().includes('/tasks/add'));

    // Task card should appear on the board
    const taskCard = page.locator('.task', { hasText: 'Neue Strukturaufgabe' });
    await expect(taskCard).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Font assertions: the add sheet title uses the display font
// ---------------------------------------------------------------------------

test.describe('Sheet title typography - display font', () => {
  test('add sheet title uses the display font (Figtree 600)', async ({ page }) => {
    await page.goto('/tasks/add');
    const dialog = page.getByRole('dialog');
    const sheetTitle = dialog.getByRole('heading').first();
    await expect(sheetTitle).toBeVisible();

    const fontFamily = await sheetTitle.evaluate(
      (el) => window.getComputedStyle(el).fontFamily
    );

    expect(fontFamily).toContain('Figtree');
  });
});

// ---------------------------------------------------------------------------
// Footer touch targets (#181)
// ---------------------------------------------------------------------------

test.describe('Sheet footer touch targets', () => {
  const expectFooterButtons = async (page: import('@playwright/test').Page, minHeight: number) => {
    const buttons = page.getByRole('dialog').locator('.sheet-footer button');
    await expect(buttons.first()).toBeVisible();
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      // Layout size is transform-independent; boundingBox() is read while the
      // drawer may still be transitioning in and carries float noise (#203).
      const layout = await buttons.nth(i).evaluate((el) => {
        const { offsetHeight, offsetWidth } = el as HTMLElement;
        return { height: offsetHeight, width: offsetWidth };
      });
      expect(layout.height).toBeGreaterThanOrEqual(minHeight);
      expect(layout.width).toBeGreaterThanOrEqual(44);
      const box = await buttons.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(minHeight - 0.5);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44 - 0.5);
    }
  };

  test('add sheet footer buttons are at least 44px at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks/add');
    await expectFooterButtons(page, 44);
  });

  test('mouse desktop keeps compact footer buttons', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tasks/add');
    const button = page.getByRole('dialog').locator('.sheet-footer button').first();
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeLessThan(44);
  });
});
