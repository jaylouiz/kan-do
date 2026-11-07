import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedLocalBoard, type SeedTask } from './helpers/seed';
import { settleAnimations } from './helpers/settle';

/**
 * E2E tests for Task Detail view (page and modal)
 * Tests the shared TaskDetailContent component functionality
 */

// Mock task data for testing
const mockTasks = [
  {
    id: 'test-task-1',
    title: 'Test Aufgabe mit Timebox',
    status: 1, // Progress
    priority: 3,
    timeSpentSeconds: 1800,
    timeBoxSeconds: 3600,
    topic: 'Development',
    topicColorCode: 'blue',
    activity: 'Coding',
    notes: 'Dies sind Testnotizen für die Aufgabe.',
    timerId: null,
    isUnplanned: false,
  },
  {
    id: 'test-task-2',
    title: 'Ungeplante Aufgabe',
    status: 0, // Open
    priority: 2,
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    topic: null,
    topicColorCode: null,
    activity: null,
    notes: null,
    timerId: null,
    isUnplanned: true,
  },
  {
    id: 'test-task-3',
    title: 'Aufgabe ohne Thema/Aktivität',
    status: 1, // Progress
    priority: 2,
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    topic: null,
    topicColorCode: null,
    activity: null,
    notes: 'Test für Dropdown-Editing.',
    timerId: null,
    isUnplanned: false,
  },
  {
    id: 'test-task-4',
    title: 'Option-Seed Task',
    status: 3, // Done — hidden from board, just seeds options
    priority: 1,
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    topic: 'Marketing',
    topicColorCode: null,
    activity: 'Review',
    notes: null,
    timerId: null,
    isUnplanned: false,
  },
  {
    id: 'test-task-5',
    // Custom properties are Notion's: only a Notion task's sheet shows them (#325)
    source: 'notion',
    externalId: 'test-task-5',
    title: 'Aufgabe mit Datumfeld',
    status: 1, // Progress
    priority: 2,
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    topic: null,
    topicColorCode: null,
    activity: null,
    notes: null,
    timerId: null,
    isUnplanned: false,
    custom: {
      'faelligkeitsdatum': {
        key: 'faelligkeitsdatum',
        name: 'Fälligkeitsdatum',
        propType: 'date',
        value: { type: 'date', value: { start: '2026-04-15' } },
      },
    },
  },
  {
    id: 'test-task-6',
    // Custom properties are Notion's: only a Notion task's sheet shows them (#325)
    source: 'notion',
    externalId: 'test-task-6',
    title: 'Aufgabe mit Eigenschaften',
    status: 3, // Done — hidden from board
    priority: 2,
    timeSpentSeconds: 0,
    timeBoxSeconds: null,
    topic: null,
    topicColorCode: null,
    activity: null,
    notes: null,
    timerId: null,
    isUnplanned: false,
    custom: {
      'kommentar': {
        key: 'kommentar',
        name: 'Kommentar',
        propType: 'text',
        value: { type: 'text', value: 'Erster Stand' },
      },
      'freigegeben': {
        key: 'freigegeben',
        name: 'Freigegeben',
        propType: 'checkbox',
        value: { type: 'checkbox', value: true },
      },
      'tags': {
        key: 'tags',
        name: 'Tags',
        propType: 'multi_select',
        value: { type: 'multi_select', value: [{ name: 'Alpha', color: 'default' }] },
      },
    },
  },
  {
    id: 'test-task-7',
    // Outside Jetzt on purpose: a Jetzt task is timed from page load (#352), so its tracked time is never a fixed value
    title: 'Wartende Aufgabe mit Timebox',
    status: 2, // Waiting
    priority: 2,
    timeSpentSeconds: 1800,
    timeBoxSeconds: 3600,
    topic: null,
    topicColorCode: null,
    activity: null,
    notes: null,
    timerId: null,
    isUnplanned: false,
  },
  {
    id: 'test-task-8',
    // Waiting, 30 min 5 s tracked: the edit field shows whole minutes and must not round the total by itself (#4)
    title: 'Wartende Aufgabe mit krummer Zeit',
    status: 2, // Waiting
    priority: 2,
    timeSpentSeconds: 1805,
    timeBoxSeconds: null,
    topic: null,
    topicColorCode: null,
    activity: null,
    notes: null,
    timerId: null,
    isUnplanned: false,
  },
];

/** Opens a task's sheet by URL and waits until its property list is rendered, so what follows acts on a settled sheet. */
async function openSheet(page: Page, baseURL: string | undefined, id: string) {
  await page.goto(`${baseURL}/tasks/${id}`);
  await expect(page.getByTestId('task-property-list')).toBeVisible();
  await settleAnimations(page); // the sheet slides in: a position read before it stops moving is off by a few px
}

test.describe('Task Detail View', () => {
  test.beforeEach(async ({ context }) => {
    // Seeded before page JS runs (no goto + evaluate + reload, #512). `once`: the persistence tests reload
    // and must keep their edits. Property options are auto-populated via afterRestore → extractOptionsFromTasks
    // from test-task-1 (Development/Coding) and test-task-4 (Marketing/Review).
    await seedLocalBoard(context, mockTasks as SeedTask[], {}, undefined, { once: true });
  });

  // #161: Thema/Aktivität are always property rows in a stable position; unset they show the empty
  // "Auswählen…" state (review remark: no add-line, nothing moves while you interact).
  for (const field of [
    { name: 'topic', label: 'Thema', testId: 'task-topic-select', option: 'Marketing' },
    { name: 'activity', label: 'Aktivität', testId: 'task-activity-select', option: 'Review' },
  ] as const) {
    test(`edits ${field.name} via select dropdown and persists after reload`, async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-3');

      // Empty: the row is there in its stable position with the empty state
      const select = page.getByTestId(field.testId);
      await expect(select).toBeVisible();
      await expect(select).toContainText('Auswählen');
      await expect(select).toHaveAccessibleName(new RegExp(`^${field.label}: Auswählen`));
      const before = await select.boundingBox();

      await select.click();
      // The option name starts with its label (the topic mark and the aria-hidden edit pencil add no text, #430)
      const option = page.getByRole('option', { name: new RegExp(`^${field.option}`) });
      await expect(option).toBeVisible();
      await option.click();

      // The same row now displays the selected value, without having moved
      await expect(select).toContainText(field.option);
      await expect(select).toHaveAccessibleName(`${field.label}: ${field.option}`);
      const after = await select.boundingBox();
      expect(after!.y).toBe(before!.y);

      // Wait until Pinia persisted state has written the update to localStorage
      await page.waitForFunction(({ key, value }) => {
        try {
          const raw = localStorage.getItem('tasks-store');
          if (!raw) return false;
          const data = JSON.parse(raw);
          return Array.isArray(data?.tasks)
            && data.tasks.some((t: Record<string, unknown>) => t.id === 'test-task-3' && t[key] === value);
        } catch {
          return false;
        }
      }, { key: field.name, value: field.option });

      // Reload and ensure persistence
      await page.reload();
      await expect(page.getByTestId(field.testId)).toContainText(field.option);
    });

    test(`${field.name}: Escape closes the empty picker only, the row stays`, async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-3');

      const select = page.getByTestId(field.testId);
      await select.click();
      await expect(page.getByRole('option', { name: new RegExp(`^${field.option}`) })).toBeVisible();

      // Escape closes the picker only, never the sheet
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('option', { name: new RegExp(`^${field.option}`) })).not.toBeVisible();
      await expect(select).toBeVisible();
      await expect(select).toContainText('Auswählen');
      await expect(select).toBeFocused();
    });
  }

  test('clearing a topic from inside the picker returns its row to the empty state', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-1');

    const select = page.getByTestId('task-topic-select');
    await expect(select).toContainText('Development');
    await select.click();
    // No × on the trigger: the clear action lives in the picker
    await page.getByTestId('task-property-clear').click();

    // The row stays where it is and reads "Auswählen" again
    await expect(select).toBeVisible();
    await expect(select).toContainText('Auswählen');
    await expect.poll(() => page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem('tasks-store') ?? '{}');
      return data.tasks?.find((t: { id: string }) => t.id === 'test-task-1')?.topic ?? null;
    })).toBeNull();
  });

  test.describe('custom property rows stay while being edited', () => {
    test('clearing a text value keeps its row (no unmount under the user)', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-6');

      const row = page.getByTestId('task-property-row').filter({ hasText: 'Kommentar' });
      await row.getByRole('button', { name: /^Kommentar: / }).click();
      const input = row.getByRole('textbox', { name: 'Kommentar' });
      await expect(input).toBeFocused();
      await input.fill('');
      await input.press('Enter');

      await expect(row).toBeVisible();
      await expect(row.getByRole('button', { name: /^Kommentar: / })).toBeVisible();
    });

    test('deselecting the last multi-select option keeps the row and the open picker', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-6');

      const row = page.getByTestId('task-property-row').filter({ hasText: 'Tags' });
      const trigger = row.getByRole('button', { name: /^Tags: / });
      await trigger.click();
      await page.getByRole('option', { name: 'Alpha', exact: true }).click();

      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('option', { name: 'Alpha', exact: true })).toBeVisible();
    });

    test('unchecking a checkbox keeps its row', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-6');

      const row = page.getByTestId('task-property-row').filter({ hasText: 'Freigegeben' });
      const checkbox = row.getByRole('checkbox', { name: 'Freigegeben' });
      await expect(checkbox).toBeChecked();
      await checkbox.click();
      await expect(checkbox).not.toBeChecked();
      await expect(row).toBeVisible();
    });

    test('the whole 44px row is the checkbox target at 390px', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openSheet(page, baseURL, 'test-task-6');
      await page.waitForTimeout(500);

      const row = page.getByTestId('task-property-row').filter({ hasText: 'Freigegeben' });
      const target = row.locator('label');
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThan(100);

      // A tap far to the right of the 16px box still toggles it
      const checkbox = row.getByRole('checkbox', { name: 'Freigegeben' });
      await expect(checkbox).toBeChecked();
      await page.mouse.click(box!.x + box!.width - 8, box!.y + box!.height / 2);
      await expect(checkbox).not.toBeChecked();
    });
  });

  // #22: closing the sheet must not stack a /tasks entry
  test('closing a sheet opened from the board returns by history: Back leaves the board, not into the sheet', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`);
    // The dblclick may land before hydration attached the handler: retry it until the route changes
    await expect(async () => {
      await page.evaluate(() => document.querySelector<HTMLElement>('.task[data-task-id="test-task-7"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      await expect(page).toHaveURL(/\/tasks\/test-task-7$/, { timeout: 1000 });
    }).toPass({ timeout: 10000 });
    await expect(page.getByTestId('task-property-list')).toBeVisible();
    await settleAnimations(page);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('task-property-list')).toBeHidden();
    await page.goBack();
    await expect(page).not.toHaveURL(/\/tasks\/test-task-7/);
  });

  test('closing a deep-linked sheet replaces the entry with /tasks', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-1');
    const before = await page.evaluate(() => history.length);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/tasks$/);
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  // Render-only facts of the task sheet, one test per seeded task or state (#544). Every former test is an
  // expect.soft whose message names it: a failure still reports each broken fact, and which one it was.
  test('task sheet of a Jetzt task with notes and a topic: properties, status, priority, notes, planned, topic, header actions', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/test-task-1`);
    await expect(page.getByTestId('task-property-list')).toBeVisible();

    // properties render as labelled rows without chips or icons
    const list = page.getByTestId('task-property-list');
    await expect.soft(list.getByTestId('task-property-row'), 'properties render as labelled rows: six rows').toHaveCount(6);
    for (const label of ['Status', 'Priorität', 'Thema', 'Aktivität', 'Timebox', 'Aufgewendete Zeit']) {
      await expect.soft(list.getByText(label, { exact: true }), `properties render as labelled rows: ${label}`).toBeVisible();
    }
    await expect.soft(page.getByTestId('task-status-select'), 'properties render as labelled rows: status name').toHaveAccessibleName('Status: Jetzt');
    await expect.soft(page.getByTestId('task-priority-select'), 'properties render as labelled rows: priority name').toHaveAccessibleName('Priorität: Hoch');
    // The priority picker offers the three levels, no "Keine" (#653)
    await page.getByTestId('task-priority-select').click();
    await expect.soft(page.getByRole('option'), 'priority picker: Niedrig, Normal, Hoch').toHaveText(['Niedrig', 'Normal', 'Hoch']);
    await page.keyboard.press('Escape');
    // Plain text values: no icons, chips or badges inside the list
    await expect.soft(list.locator('svg, [class*="badge"], .iconify'), 'properties render as labelled rows: no icons, chips or badges').toHaveCount(0);

    // navigates to task detail page via direct URL: key elements of TaskDetailContent
    const hasNotes = await page.getByRole('heading', { name: 'Notiz' }).isVisible().catch(() => false);
    const hasTime = await page.getByRole('heading', { name: 'Zeiterfassung' }).isVisible().catch(() => false);
    expect.soft(hasNotes || hasTime, 'navigates to task detail page via direct URL').toBe(true);

    // Task 1 has status 1 (Progress) = "Jetzt"
    await expect.soft(page.getByText('Jetzt').first(), 'shows status badge with correct German label').toBeVisible();
    // priority 3 = "Hoch"
    await expect.soft(page.getByText('Hoch').first(), 'shows priority information').toBeVisible();

    // shows notes section with content
    await expect.soft(page.getByRole('heading', { name: 'Notiz' }), 'shows notes section with content: heading').toBeVisible();
    await expect.soft(page.getByText('Dies sind Testnotizen'), 'shows notes section with content: text').toBeVisible();

    // Task 1 is planned (isUnplanned: false)
    await expect.soft(page.getByText('Geplant').first(), 'shows planned status for planned task').toBeVisible();
    // Task 1 has topic "Development"
    await expect.soft(page.getByText('Development').first(), 'shows topic badge when topic is set').toBeVisible();

    // Utility menu trigger lives in the content header; the sheet has no close button (Escape, overlay, swipe)
    await expect.soft(
      page.getByTestId('task-detail-header').getByTestId('task-actions-menu'),
      'action buttons are visible in the header without hovering',
    ).toBeVisible();
  });

  test('task sheet of an unplanned task without notes, timebox or time: empty notes, unplanned, no time block, the timebox row is the one way in', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/test-task-2`);
    const notesTrigger = page.getByRole('button', { name: /^Notiz: / });
    await expect(notesTrigger).toBeVisible();

    // shows empty notes state: plain muted placeholder trigger, no tinted box
    await expect.soft(notesTrigger, 'shows empty notes state: name').toHaveAccessibleName(/^Notiz: Notiz hinzufügen/);
    await expect.soft(notesTrigger, 'shows empty notes state: text').toContainText('Notiz hinzufügen');
    // Task 2 is unplanned (isUnplanned: true)
    await expect.soft(page.getByText('Ungeplant').first(), 'shows unplanned status for ad-hoc task').toBeVisible();

    // no separate time block and no ring (#4): the time spent is a property row, empty reads "+ hinzufügen"
    await expect.soft(page.getByTestId('time-stats-data'), 'no time block: time-stats-data').not.toBeAttached();
    await expect.soft(page.locator('[data-section="time-stats"]'), 'no time block: section').toHaveCount(0);
    await expect.soft(page.getByRole('button', { name: 'Aufgewendete Zeit: + hinzufügen' }), 'time spent row: empty state').toBeVisible();
    await expect.soft(page.getByTestId('time-remaining'), 'time spent row: no remaining time without a timebox').not.toBeAttached();

    // timebox has a single entry point: its property row, no second CTA in the time block
    await expect.soft(page.getByTestId('set-timebox-cta'), 'timebox single entry point: no set-timebox-cta').not.toBeAttached();
    await expect.soft(page.getByText('Timebox setzen'), 'timebox single entry point: no "Timebox setzen"').toHaveCount(0);
    await expect.soft(page.getByTestId('timebox-edit-input'), 'timebox single entry point: no edit input at rest').not.toBeAttached();

    // Last on purpose (it interacts): the row is the one way in, and it opens the input
    await page.getByRole('button', { name: /Timebox/ }).first().click();
    await expect(page.getByTestId('timebox-edit-input')).toBeVisible();
  });

  test('task sheet of a waiting task with a timebox and tracked time: the time spent row, time left beside it and the timebox row', async ({ page, baseURL }) => {
    // Task 7 has timebox of 3600s (1h) and timeSpent of 1800s (30min); it waits, so no timer counts on
    await page.goto(`${baseURL}/tasks/test-task-7`);
    const row = page.getByTestId('task-property-row').filter({ hasText: 'Aufgewendete Zeit' });
    await expect(row).toBeVisible();

    await expect.soft(row.getByTestId('time-spent-value'), 'time spent row: value').toHaveText('30 min');
    await expect.soft(row.getByTestId('time-remaining'), 'time spent row: time left').toHaveText('30 min übrig');
    await expect.soft(page.getByTestId('time-stats-data'), 'time spent row: no separate time block').not.toBeAttached();
    // The timebox value lives in its own row, directly above
    await expect.soft(page.getByRole('button', { name: /^Timebox: 1 h/ }), 'time spent row: timebox row').toBeVisible();
  });

  test.describe('editing the time spent (#4)', () => {
    const openRow = async (page: Page, baseURL: string | undefined, id: string) => {
      await page.goto(`${baseURL}/tasks/${id}`);
      const row = page.getByTestId('task-property-row').filter({ hasText: 'Aufgewendete Zeit' });
      await expect(row).toBeVisible();
      return row;
    };
    const storedTime = (page: Page, id: string) => page.evaluate((taskId) => {
      const tasks = (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; timeSpentSeconds: number }> }).tasks ?? [];
      return tasks.find((t) => t.id === taskId)?.timeSpentSeconds;
    }, id);

    test('Enter saves the new total; the time left follows', async ({ page, baseURL }) => {
      const row = await openRow(page, baseURL, 'test-task-7');
      await row.getByRole('button', { name: /^Aufgewendete Zeit: / }).click();
      const input = page.getByRole('spinbutton', { name: 'Aufgewendete Zeit in Minuten' });
      await expect(input).toBeFocused();
      await expect(input).toHaveValue('30');
      await input.fill('50');
      await input.press('Enter');

      await expect(row.getByTestId('time-spent-value')).toHaveText('50 min');
      await expect(row.getByTestId('time-remaining')).toHaveText('10 min übrig');
      await expect.poll(() => storedTime(page, 'test-task-7')).toBe(3000);
    });

    test('lowering works, 0 shows "+ hinzufügen", and a time can be added to a task without any', async ({ page, baseURL }) => {
      const row = await openRow(page, baseURL, 'test-task-7');
      await row.getByRole('button', { name: /^Aufgewendete Zeit: / }).click();
      await page.getByTestId('time-spent-edit-input').fill('0');
      await page.getByTestId('time-spent-edit-input').press('Enter');
      await expect(row.getByRole('button', { name: 'Aufgewendete Zeit: + hinzufügen' })).toBeVisible();
      await expect.poll(() => storedTime(page, 'test-task-7')).toBe(0);

      await row.getByRole('button', { name: 'Aufgewendete Zeit: + hinzufügen' }).click();
      await page.getByTestId('time-spent-edit-input').fill('20');
      await page.getByTestId('time-spent-edit-input').press('Enter');
      await expect(row.getByTestId('time-spent-value')).toHaveText('20 min');
      await expect.poll(() => storedTime(page, 'test-task-7')).toBe(1200);
    });

    test('Esc cancels, blur saves, a blank or too large entry changes nothing', async ({ page, baseURL }) => {
      const row = await openRow(page, baseURL, 'test-task-7');
      const trigger = row.getByRole('button', { name: /^Aufgewendete Zeit: / });
      const input = page.getByTestId('time-spent-edit-input');

      await trigger.click();
      await input.fill('99');
      await input.press('Escape');
      await expect(row.getByTestId('time-spent-value')).toHaveText('30 min');

      await trigger.click();
      await input.fill('');
      await input.press('Enter');
      await expect(row.getByTestId('time-spent-value')).toHaveText('30 min');

      await trigger.click();
      await input.fill('99999'); // above the 9999-minute limit: dropped like a blank entry
      await input.press('Enter');
      await expect(row.getByTestId('time-spent-value')).toHaveText('30 min');

      await trigger.click();
      await input.fill('45');
      await page.getByTestId('task-property-row').filter({ hasText: 'Status' }).click();
      await expect(row.getByTestId('time-spent-value')).toHaveText('45 min');
    });

    test('leaving the field unchanged keeps the exact total (30 min 5 s stays)', async ({ page, baseURL }) => {
      const row = await openRow(page, baseURL, 'test-task-8');
      await row.getByRole('button', { name: /^Aufgewendete Zeit: / }).click();
      await expect(page.getByTestId('time-spent-edit-input')).toHaveValue('30');
      await page.getByTestId('time-spent-edit-input').press('Enter');
      await expect(row.getByRole('button', { name: /^Aufgewendete Zeit: / })).toBeVisible();
      await expect.poll(() => storedTime(page, 'test-task-8')).toBe(1805);
    });

    test('a running timer keeps counting from the edited total', async ({ page, baseURL }) => {
      const row = await openRow(page, baseURL, 'test-task-1'); // in Jetzt: timed from page load
      await row.getByRole('button', { name: /^Aufgewendete Zeit: / }).click();
      await page.getByTestId('time-spent-edit-input').fill('60');
      await page.getByTestId('time-spent-edit-input').press('Enter');
      await expect.poll(() => storedTime(page, 'test-task-1')).toBeGreaterThanOrEqual(3600);
      await expect.poll(async () => (await storedTime(page, 'test-task-1')) ?? 0).toBeGreaterThan(3600);
      expect(await storedTime(page, 'test-task-1')).toBeLessThan(3700);
    });
  });

  test('error state shows when task not found', async ({ page, baseURL }) => {
    // Navigate directly to a non-existent task
    await page.goto(`${baseURL}/tasks/non-existent-task-id-12345`);
    
    // Should show error message
    const errorText = page.getByText('Aufgabe nicht gefunden');
    await expect(errorText).toBeVisible();
    // #557: a headline-role heading and a muted sentence, no warning icon
    await expect(page.getByTestId('task-not-found').getByRole('heading', { name: 'Aufgabe nicht gefunden' })).toBeVisible();
    await expect(page.getByTestId('task-not-found').locator('svg')).toHaveCount(0);
  });

  // Since 66d6f42 the header action buttons were replaced by a single "Mehr Aktionen"
  // utility menu (copy ID, open in source, delete).
  test('copies task ID via the actions menu', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openSheet(page, baseURL, 'test-task-1');

    await page.getByTestId('task-actions-menu').click();
    const copyItem = page.getByRole('menuitem', { name: 'ID kopieren' });
    await expect(copyItem).toBeVisible();
    await copyItem.click();

    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('test-task-1');
  });

  // Status is the first property row: a text-style picker named "Status: <value>"
  test('shows status picker in the property rows', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-1');

    const statusSelect = page.getByTestId('task-status-select');
    await expect(statusSelect).toBeVisible();
    await expect(statusSelect).toContainText('Jetzt');

    await statusSelect.click();
    for (const label of ['Offen', 'Jetzt', 'Wartet', 'Erledigt']) {
      await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
  });

  test('shows collapsible metadata section', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-1');

    // Metadata button should be visible
    const metadataButton = page.getByRole('button', { name: /Metadaten/i });
    await expect(metadataButton).toBeVisible();

    // Click to expand
    await metadataButton.click();
    await page.waitForTimeout(300);

    // Should show task ID in metadata
    const taskIdText = page.getByText('test-task-1');
    await expect(taskIdText).toBeVisible();

    // A Local task shows the translated source label, never the raw source id (#326)
    await expect(page.getByTestId('task-detail-source')).toHaveText('Lokal');
  });

  // ── Redesign: always-visible action buttons ──────────────────────────────

  // ── Redesign: time stats states ───────────────────────────────────────────

  // ── Redesign: date picker ─────────────────────────────────────────────────

  test('date custom field shows the formatted date, and a click on it opens the calendar', async ({ page, baseURL }) => {
    // task-5 has a date custom field with start: '2026-04-15'
    await page.goto(`${baseURL}/tasks/test-task-5`);

    const trigger = page.getByTestId('date-picker-trigger').first();
    await expect.soft(trigger, 'date custom field shows formatted date').toBeVisible();
    await expect.soft(trigger, 'date custom field shows formatted date: value').toContainText('15. April 2026');

    await trigger.click();
    await expect(page.getByTestId('date-picker-calendar')).toBeVisible();
  });

  test('Escape with the date picker open closes the picker only, not the sheet', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-5');

    await page.getByTestId('date-picker-trigger').first().click();
    const calendar = page.getByTestId('date-picker-calendar');
    await expect(calendar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(calendar).not.toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\/test-task-5/);
  });

  test('date picker Heute sets todays date', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-5');

    const trigger = page.getByTestId('date-picker-trigger').first();
    await trigger.click();
    await expect(page.getByTestId('date-picker-calendar')).toBeVisible();

    // Use JS click to bypass the animated-modal-body pointer-events interception
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="date-picker-today"]') as HTMLElement | null;
      btn?.click();
    });

    // After clicking Heute, trigger should show a date (not the empty CTA)
    await expect(trigger).not.toContainText('+ Datum setzen');
  });

  test('date picker Löschen clears the date value', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-5');

    const trigger = page.getByTestId('date-picker-trigger').first();
    await trigger.click();
    await expect(page.getByTestId('date-picker-calendar')).toBeVisible();

    // Use JS click to bypass the animated-modal-body pointer-events interception
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="date-picker-clear"]') as HTMLElement | null;
      btn?.click();
    });

    // An emptied property keeps its row until the sheet closes (it must not vanish under the user)
    await expect(trigger).toContainText('+ Datum setzen');
  });

  test.describe('keyboard: inline-editable fields', () => {
    test('title trigger is a focusable button named with field label and value', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');

      const trigger = page.getByRole('button', { name: 'Titel: Test Aufgabe mit Timebox' });
      await expect(trigger).toBeVisible();
      await trigger.focus();
      await expect(trigger).toBeFocused();
    });

    test('Enter edits, Escape cancels and returns focus to the trigger', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');

      const trigger = page.getByRole('button', { name: 'Titel: Test Aufgabe mit Timebox' });
      await trigger.focus();
      await page.keyboard.press('Enter');

      const input = page.getByRole('textbox').first();
      await expect(input).toBeFocused();
      await page.keyboard.type(' geändert');
      await page.keyboard.press('Escape');

      await expect(trigger).toBeFocused();
      await expect(trigger).toContainText('Test Aufgabe mit Timebox');
      await expect(trigger).not.toContainText('geändert');
    });

    test('Space edits and Enter saves, focus returns to the trigger', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');

      await page.getByRole('button', { name: 'Titel: Test Aufgabe mit Timebox' }).focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('End');
      await page.keyboard.type(' neu');
      await page.keyboard.press('Enter');

      const saved = page.getByRole('button', { name: 'Titel: Test Aufgabe mit Timebox neu' });
      await expect(saved).toBeFocused();
    });

    test('Tab order reaches the notes trigger', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');

      const notes = page.getByRole('button', { name: /^Notiz: / });
      await notes.focus();
      await expect(notes).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByPlaceholder('Notiz hinzufügen…')).toBeFocused();
    });
  });

  // -------------------------------------------------------------------------
  // #161 review round: timebox focus, dropdown size, Markdown notes, OS shortcut, notes before metadata (#386)
  // -------------------------------------------------------------------------
  test.describe('review remarks (#161)', () => {
    test('one click on the timebox value puts the input into focus', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');

      await page.getByRole('button', { name: /^Timebox: / }).click();
      const input = page.getByTestId('timebox-edit-input');
      await expect(input).toBeFocused();

      // Typing goes straight into the field and saves with Enter
      await page.keyboard.type('25');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'Timebox: 25 min' })).toBeVisible();
    });

    test('Esc in the timebox field cancels instead of saving the typed value (#12)', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');

      const trigger = page.getByRole('button', { name: /^Timebox: / });
      const before = await trigger.getAttribute('aria-label');
      await trigger.click();
      await expect(page.getByTestId('timebox-edit-input')).toBeFocused();
      await page.keyboard.type('99');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('timebox-edit-input')).not.toBeAttached();
      await expect(page.getByRole('button', { name: /^Timebox: / })).toHaveAttribute('aria-label', before!);
      await expect(page.getByRole('button', { name: 'Timebox: 99 min' })).toHaveCount(0);
    });

    test('property dropdown items use the text size of the task card context menu', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-3');

      await page.getByTestId('task-topic-select').click();
      const option = page.getByRole('option', { name: /^Marketing/ });
      await expect(option).toBeVisible();
      const optionSize = await option.evaluate((el) => getComputedStyle(el).fontSize);
      await page.keyboard.press('Escape');

      // The utility menu is a Nuxt UI menu at the same size step as the card context menu (md)
      await page.getByTestId('task-actions-menu').click();
      const item = page.getByRole('menuitem').first();
      await expect(item).toBeVisible();
      const menuSize = await item.evaluate((el) => getComputedStyle(el).fontSize);
      expect(optionSize).toBe(menuSize);
      expect(optionSize).toBe('14px');
    });

    test('saved notes show rendered Markdown, editing shows the markup', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');

      await page.getByRole('button', { name: /^Notiz: / }).click();
      await page.keyboard.type('# Plan\n\n- **fett** eins\n- zwei\n\n<script>window.__xss = 1</script>\n\n[Link](https://example.com)');
      await page.keyboard.press('Control+Enter');

      const rendered = page.getByTestId('task-notes-rendered');
      await expect(rendered.locator('h1')).toHaveText('Plan');
      await expect(rendered.locator('li strong')).toHaveText('fett');
      await expect(rendered.locator('li')).toHaveCount(2);
      await expect(rendered.locator('a')).toHaveAttribute('href', 'https://example.com');
      await expect(rendered.locator('script')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      // No raw markup in the read mode
      await expect(rendered).not.toContainText('**');
      await expect(rendered).not.toContainText('# Plan');

      // The trigger still opens the editor on the Markdown source
      await page.getByRole('button', { name: /^Notiz: / }).click();
      await expect(page.getByTestId('task-notes-input')).toHaveValue(/# Plan/);
    });

    test('a click on a link in the notes follows the link and does not start editing', async ({ page, context, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');
      await page.getByRole('button', { name: /^Notiz: / }).click();
      await page.keyboard.type('[Link](https://example.com/)');
      await page.keyboard.press('Control+Enter');

      const link = page.getByTestId('task-notes-rendered').locator('a');
      await expect(link).toBeVisible();
      const popup = context.waitForEvent('page');
      await link.click();
      await (await popup).close();
      await expect(page.getByTestId('task-notes-input')).toHaveCount(0);
    });

    test('notes links are real links outside the edit trigger (#208)', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');
      await page.getByRole('button', { name: /^Notiz: / }).click();
      await page.keyboard.type('Text davor [Link](https://example.com/) danach');
      await page.keyboard.press('Control+Enter');

      const trigger = page.getByRole('button', { name: /^Notiz: / });
      await expect(trigger).toBeFocused();
      await expect(trigger.locator('a')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Link' })).toBeVisible();

      const results = await new AxeBuilder({ page }).include('[data-testid="task-notes"]').analyze();
      expect(results.violations.filter((v) => v.id === 'nested-interactive')).toEqual([]);

      // Tab order: trigger first, then the link
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Link' })).toBeFocused();

      // Shift+Tab returns to the trigger; Space edits, Escape cancels (link click not editing: #199 test above)
      await page.keyboard.press('Shift+Tab');
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Space');
      await expect(page.getByTestId('task-notes-input')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('task-notes-input')).toHaveCount(0);

      // A click on the text edits
      // (mouse, not locator.click: the text is pointer-transparent by design, the trigger below takes the click)
      const text = (await page.getByTestId('task-notes-rendered').getByText('Text davor').boundingBox())!;
      await page.mouse.click(text.x + 8, text.y + text.height / 2);
      await expect(page.getByTestId('task-notes-input')).toBeVisible();
    });

    test('the save hint names Strg on Windows and Linux, and Ctrl+Enter saves', async ({ page, baseURL }) => {
      await page.addInitScript(() => {
        // userAgentData wins over platform in the app, so drop it to let the stubbed platform decide
        Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
        Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' });
      });
      await openSheet(page, baseURL, 'test-task-2');

      await page.getByRole('button', { name: /^Notiz: / }).click();
      await expect(page.getByTestId('task-notes-hint')).toHaveText('Markdown unterstützt • Strg + Enter zum Speichern');
      await page.keyboard.type('mit Strg gespeichert');
      await page.keyboard.press('Control+Enter');
      await expect(page.getByTestId('task-notes-rendered')).toContainText('mit Strg gespeichert');
    });

    test('the save hint names Cmd on macOS, and Cmd+Enter saves', async ({ page, baseURL }) => {
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
        Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
      });
      await openSheet(page, baseURL, 'test-task-2');

      await page.getByRole('button', { name: /^Notiz: / }).click();
      await expect(page.getByTestId('task-notes-hint')).toHaveText('Markdown unterstützt • Cmd + Enter zum Speichern');
      await page.keyboard.type('mit Cmd gespeichert');
      await page.keyboard.press('Meta+Enter');
      await expect(page.getByTestId('task-notes-rendered')).toContainText('mit Cmd gespeichert');
    });

    // #386: notes directly after the main fields, the metadata is the footer
    test('desktop: notes follow the properties in the scroll region, the metadata is pinned to the bottom', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');

      const scroll = page.getByTestId('task-detail-scroll');
      await expect(scroll.getByTestId('task-property-list')).toBeVisible();
      await expect(scroll.getByTestId('task-notes')).toBeVisible();
      await expect(scroll.getByTestId('task-metadata')).toHaveCount(0);

      const props = (await page.getByTestId('task-property-list').boundingBox())!;
      const notes = (await page.getByTestId('task-notes').boundingBox())!;
      expect(notes.y).toBeGreaterThan(props.y + props.height);

      // The metadata hugs the bottom edge of the sheet even though the content above is short, below the notes
      const dialogBox = (await page.getByRole('dialog').boundingBox())!;
      const meta = (await page.getByTestId('task-metadata').boundingBox())!;
      expect(Math.abs(dialogBox.y + dialogBox.height - (meta.y + meta.height))).toBeLessThan(40);
      expect(meta.y).toBeGreaterThan(notes.y + notes.height);
    });

    test('mobile: the notes follow the properties, the metadata comes last in the flow', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openSheet(page, baseURL, 'test-task-1');

      const scroll = page.getByTestId('task-detail-scroll');
      await expect(scroll.getByTestId('task-notes')).toBeVisible();
      await expect(scroll.getByTestId('task-metadata')).toBeVisible();
      const props = (await page.getByTestId('task-property-list').boundingBox())!;
      const notes = (await page.getByTestId('task-notes').boundingBox())!;
      const meta = (await page.getByTestId('task-metadata').boundingBox())!;
      expect(notes.y).toBeGreaterThan(props.y + props.height);
      expect(meta.y).toBeGreaterThan(notes.y + notes.height);
    });

    // #199: the sheet freezes its variant while open, the content layout must follow it
    test('shrinking below 768px while the slideover is open keeps the metadata pinned and its state', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');

      await page.setViewportSize({ width: 600, height: 800 });
      const scroll = page.getByTestId('task-detail-scroll');
      await expect(scroll.getByTestId('task-metadata')).toHaveCount(0);
      await expect(scroll.getByTestId('task-notes')).toBeVisible();
      const dialogBox = (await page.getByRole('dialog').boundingBox())!;
      const metaBox = (await page.getByTestId('task-metadata').boundingBox())!;
      expect(metaBox.y + metaBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height + 1);
      expect(metaBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    });

    test('a link in the notes is reachable with Tab and Enter follows it without editing (#199)', async ({ page, context, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');
      await page.getByRole('button', { name: /^Notiz: / }).click();
      await page.keyboard.type('[Link](https://example.com/) und <tag> bleibt');
      await page.keyboard.press('Control+Enter');

      const rendered = page.getByTestId('task-notes-rendered');
      await expect(rendered).toContainText('<tag>');
      const trigger = page.getByRole('button', { name: /^Notiz: / });
      await expect(trigger).toHaveAccessibleName(/<tag>/);
      await trigger.focus();
      await page.keyboard.press('Tab');
      const link = rendered.locator('a');
      await expect(link).toBeFocused();

      const popup = context.waitForEvent('page');
      await page.keyboard.press('Enter');
      await (await popup).close();
      await expect(page.getByTestId('task-notes-input')).toHaveCount(0);

      // Enter on the trigger itself still starts the edit
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('task-notes-input')).toBeVisible();
    });
  });
});
