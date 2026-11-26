import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedLocalBoard, type SeedTask } from './helpers/seed';
import { settleAnimations } from './helpers/settle';
import { openTaskMenu, taskMenu, taskMenuItem } from './helpers/taskMenu';

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
    // Waiting, 30 min 5 s tracked: the edit field shows whole minutes and must not round the total by itself (kd#4)
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

/** Opens a tab of the sheet (#870): "Details" is the one a sheet opens on, the note and the extra properties are one click away. */
async function openTab(page: Page, name: 'Details' | 'Notiz' | 'Eigenschaften') {
  const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** The board's extra properties (#846, #870): the cells of the tab "Eigenschaften", edited in place. */
const customProperties = (page: Page): Locator => page.getByTestId('task-custom-properties');

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
      await openTab(page, 'Eigenschaften');

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
      await openTab(page, 'Eigenschaften');

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
      await openTab(page, 'Eigenschaften');

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
      await openTab(page, 'Eigenschaften');
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

  // kd#22: closing the sheet must not stack a /tasks entry
  test('closing a sheet opened from the board returns by history: Back leaves the board, not into the sheet', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks`);
    // The click may land before hydration attached the handler: retry it until the route changes
    await expect(async () => {
      await page.evaluate(() => document.querySelector<HTMLElement>('.task[data-task-id="test-task-7"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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
    await expect.soft(list.getByTestId('task-property-row'), 'properties render as labelled rows: seven rows (Heute, #795)').toHaveCount(7);
    for (const label of ['Status', 'Heute', 'Thema', 'Aktivität', 'Priorität', 'Timebox', 'Aufgewendet']) {
      await expect.soft(list.getByText(label, { exact: true }), `properties render as labelled rows: ${label}`).toBeVisible();
    }
    await expect.soft(page.getByTestId('task-status-select'), 'properties render as labelled rows: status name').toHaveAccessibleName('Status: Jetzt');
    await expect.soft(page.getByTestId('task-priority-select'), 'properties render as labelled rows: priority name').toHaveAccessibleName('Priorität: Hoch');
    // The priority picker offers the three levels, no "Keine" (#653)
    await page.getByTestId('task-priority-select').click();
    await expect.soft(page.getByRole('option'), 'priority picker: Niedrig, Normal, Hoch').toHaveText(['Niedrig', 'Normal', 'Hoch']);
    await page.keyboard.press('Escape');
    // A list value is a soft select with a chevron (#114); no row icons, chips or badges beside the values
    await expect.soft(list.locator('[class*="badge"]'), 'properties render as labelled rows: no chips or badges').toHaveCount(0);
    expect.soft(
      await list.locator('svg, .iconify').evaluateAll((icons) => icons.filter((icon) => !icon.closest('[aria-haspopup="listbox"]')).length),
      'properties render as labelled rows: no icons outside the selects',
    ).toBe(0);
    await expect.soft(page.getByTestId('task-status-select').locator('[data-slot="trailingIcon"]'), 'a list value shows its chevron at rest').toBeVisible();

    // navigates to task detail page via direct URL: key elements of TaskDetailContent
    await expect.soft(page.getByRole('tab').first(), 'navigates to task detail page via direct URL: opens on Details').toHaveAttribute('aria-selected', 'true');
    await expect.soft(page.getByRole('tab'), 'the tabs: Details and Notiz with its mark, no Eigenschaften on a board without them').toHaveText([/^Details$/, /^Notiz/]);
    await expect.soft(page.getByTestId('task-notes-mark'), 'a task with a note marks its tab').toBeVisible();

    // Task 1 has status 1 (Progress) = "Jetzt"
    await expect.soft(page.getByText('Jetzt').first(), 'shows status badge with correct German label').toBeVisible();
    // priority 3 = "Hoch"
    await expect.soft(page.getByText('Hoch').first(), 'shows priority information').toBeVisible();


    // Task 1 is planned (isUnplanned: false)
    // In the sheet: the board page also holds the headline "Alle Aufgaben" of the place "Alle" (#354), not shown on Heute
    await expect.soft(page.getByRole('dialog').getByText('Geplant').first(), 'shows planned status for planned task').toBeVisible();
    // Task 1 has topic "Development"
    await expect.soft(page.getByText('Development').first(), 'shows topic badge when topic is set').toBeVisible();

    // The cells stand in the shown order (#846): Status, Heute / Thema, Aktivität / Priorität, Timebox / time spent; the DOM order is the tab order
    await expect.soft(list.getByTestId('task-property-row').locator('> span:first-child'), 'the grid\'s order').toHaveText(['Status', 'Heute', 'Thema', 'Aktivität', 'Priorität', 'Timebox', 'Aufgewendet']);
    // #705: the task actions sit behind one menu in the title row (it reverses #244's bottom row); the footer line holds the facts only
    await expect.soft(page.getByTestId('task-detail-header').getByTestId('task-menu'), 'the menu is in the title row').toBeVisible();
    await expect.soft(page.getByTestId('task-metadata').getByRole('button'), 'no control in the footer line').toHaveCount(0);

    // Last on purpose (it switches the tab): the note is the body of its tab, without a heading of its own; the footer line stays
    await openTab(page, 'Notiz');
    await expect.soft(page.getByRole('tabpanel', { name: /^Notiz/ }).getByText('Dies sind Testnotizen'), 'shows the note in its tab').toBeVisible();
    await expect.soft(page.getByRole('dialog').getByRole('heading', { name: 'Notiz' }), 'the tab names the note: no heading').toHaveCount(0);
    await expect.soft(list, 'the properties left with their tab').toHaveCount(0);
    await expect.soft(page.getByTestId('task-metadata'), 'the footer line is on every tab').toBeVisible();
  });

  // #114: a value shows at rest what it is (no hover): a list value is a soft select with a chevron, a free value an editable label with a dotted rule
  test('property values show their affordance at rest: soft selects for list values, a dotted rule for free values, the topic mark inside its select, a gap between rows', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/test-task-1`);
    const list = page.getByTestId('task-property-list');
    await expect(list).toBeVisible();

    for (const testId of ['task-status-select', 'task-priority-select', 'task-topic-select', 'task-activity-select']) {
      const select = page.getByTestId(testId);
      await expect.soft(select, `${testId}: filled at rest`).toHaveCSS('background-color', /^(?!rgba\(0, 0, 0, 0\)|transparent).+/);
      await expect.soft(select.locator('[data-slot="trailingIcon"]'), `${testId}: chevron`).toBeVisible();
      expect.soft((await select.boundingBox())?.height, `${testId}: 36 px high`).toBeCloseTo(36, 0);
    }
    // the topic mark is inside the select, not beside it
    await expect.soft(page.getByTestId('task-topic-select').getByTestId('topic-mark'), 'topic mark inside the select').toHaveCount(1);
    await expect.soft(list.getByTestId('topic-mark'), 'no second topic mark beside the select').toHaveCount(1);

    // hover and focus change the fill; a click keeps it filled (no blank-out); keyboard focus draws the focus ring
    const status = page.getByTestId('task-status-select');
    const rest = await status.evaluate((el) => getComputedStyle(el).backgroundColor);
    await status.hover();
    await expect.poll(() => status.evaluate((el) => getComputedStyle(el).backgroundColor), 'status select: hover changes the fill').not.toBe(rest);
    await page.mouse.move(0, 0);
    await status.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect.soft(status, 'status select: keyboard focus ring is drawn').toHaveCSS('outline-style', 'solid');
    await expect.soft(status, 'status select: keyboard focus ring width').toHaveCSS('outline-width', '3px');
    await expect.soft(status, 'status select: focus keeps a fill').toHaveCSS('background-color', /^(?!rgba\(0, 0, 0, 0\)|transparent).+/);

    // a free value: dotted rule at rest, no fill
    const timebox = page.getByRole('button', { name: /^Timebox: / });
    await expect.soft(timebox, 'timebox: dotted rule at rest').toHaveCSS('text-decoration-style', 'dotted');
    await expect.soft(timebox, 'timebox: the rule is visible, not transparent').not.toHaveCSS('text-decoration-color', 'rgba(0, 0, 0, 0)');

    // two cells per row (#846): a pair shares its top, the pairs keep a visible gap
    const rows = await list.getByTestId('task-property-row').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
    for (let i = 1; i < rows.length; i += 2) {
      expect.soft(Math.abs(rows[i].top - rows[i - 1].top), `cells ${i - 1} and ${i} share a row`).toBeLessThanOrEqual(1);
      expect.soft(rows[i].left, `cell ${i} is right of cell ${i - 1}`).toBeGreaterThan(rows[i - 1].right);
    }
    for (let i = 2; i < rows.length; i += 2) expect.soft(rows[i].top - rows[i - 2].bottom, `rows of cells ${i - 2} and ${i} keep a gap`).toBeGreaterThanOrEqual(4);
  });

  test('the sheet holds the switch "Für heute eingeplant", the task menu the checked entry "Ad-hoc/Ungeplant" with its label under the title: each writes the task, the status stays (#795, #846)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/tasks/test-task-7`);
    const stored = () => page.evaluate(() => {
      const tasks = (JSON.parse(localStorage.getItem('tasks-store') ?? '{}') as { tasks?: Array<{ id: string; status: number; notPlanned?: boolean; isUnplanned?: boolean }> }).tasks ?? [];
      const found = tasks.find((t) => t.id === 'test-task-7');
      return found ? { status: found.status, notPlanned: found.notPlanned, isUnplanned: found.isUnplanned } : null;
    });
    const planned = page.getByRole('switch', { name: 'Für heute eingeplant' });
    // Ad-hoc work is no switch of the sheet any more (#846): a label under the title, set and cleared in the task menu
    await expect(page.getByRole('switch', { name: 'Ad-hoc/Ungeplant' })).toHaveCount(0);
    const adHocLabel = page.getByTestId('task-adhoc-label');
    await expect(adHocLabel).toHaveCount(0);
    await expect(planned).toBeChecked();
    await expect(planned).toBeEnabled();
    await expect(page.getByTestId('task-planned-hint')).toHaveCount(0);

    // A waiting task leaves today and keeps waiting, then comes back
    await planned.click();
    await expect(planned).not.toBeChecked();
    await expect.poll(stored).toMatchObject({ status: 2, notPlanned: true });
    await expect(page.getByTestId('task-status-select')).toHaveAccessibleName('Status: Wartet');
    await planned.click();
    await expect(planned).toBeChecked();
    await expect.poll(stored).toMatchObject({ status: 2, notPlanned: undefined });

    // The ad-hoc mark is a checked entry of the task menu; the menu stays open and the label under the title follows at once
    // measured inside the sheet (by its class: the open menu hides the sheet from the accessibility tree): a sheet that grows at the window's bottom edge moves up as a whole
    const titleTop = async () => (await page.getByTestId('task-detail-header').locator('[data-inline-editable]').boundingBox())!.y - (await page.locator('.task-morph-panel').boundingBox())!.y;
    const before = await titleTop();
    await taskMenu(page).click();
    const adHoc = page.getByRole('menuitemcheckbox', { name: 'Ad-hoc/Ungeplant' });
    await expect(adHoc).toHaveAttribute('aria-checked', 'false');
    await adHoc.click();
    await expect(adHoc).toHaveAttribute('aria-checked', 'true');
    await expect(adHocLabel).toHaveText('Ad-hoc');
    await expect.poll(stored).toMatchObject({ isUnplanned: true });
    // The title row stays where it is, with or without the label
    await settleAnimations(page);
    expect(Math.abs(await titleTop() - before)).toBeLessThanOrEqual(1);
    await adHoc.click();
    await expect(adHoc).toHaveAttribute('aria-checked', 'false');
    await expect(adHocLabel).toHaveCount(0);
    await expect.poll(stored).toMatchObject({ isUnplanned: false });
  });

  test('task sheet of an unplanned task without notes, timebox or time: empty notes, unplanned, no time block, the timebox row is the one way in', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-2');
    // no note: the tab carries no mark, and its body is the placeholder
    await expect.soft(page.getByTestId('task-notes-mark'), 'no note, no mark on the tab').toHaveCount(0);
    await openTab(page, 'Notiz');
    const notesTrigger = page.getByRole('button', { name: /^Notiz: / });
    await expect(notesTrigger).toBeVisible();

    // shows empty notes state: plain muted placeholder trigger, no tinted box
    await expect.soft(notesTrigger, 'shows empty notes state: name').toHaveAccessibleName(/^Notiz: Notiz hinzufügen/);
    await expect.soft(notesTrigger, 'shows empty notes state: text').toContainText('Notiz hinzufügen');
    await openTab(page, 'Details');
    // Task 2 is unplanned (isUnplanned: true)
    await expect.soft(page.getByText('Ungeplant').first(), 'shows unplanned status for ad-hoc task').toBeVisible();

    // no separate time block and no ring (kd#4): the time spent is a property row, empty reads "+ hinzufügen"
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
    const row = page.getByTestId('task-property-row').filter({ hasText: 'Aufgewendet' });
    await expect(row).toBeVisible();

    await expect.soft(row.getByTestId('time-spent-value'), 'time spent row: value').toHaveText('30 min');
    await expect.soft(row.getByTestId('time-remaining'), 'time spent row: time left').toHaveText('30 min übrig');
    await expect.soft(page.getByTestId('time-stats-data'), 'time spent row: no separate time block').not.toBeAttached();
    // The timebox value lives in its own row, directly above
    await expect.soft(page.getByRole('button', { name: /^Timebox: 1 h/ }), 'time spent row: timebox row').toBeVisible();
  });

  test.describe('editing the time spent (kd#4)', () => {
    const openRow = async (page: Page, baseURL: string | undefined, id: string) => {
      await page.goto(`${baseURL}/tasks/${id}`);
      const row = page.getByTestId('task-property-row').filter({ hasText: 'Aufgewendet' });
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
      // #286: the edit discards the collected seconds, so the stored total moves again at the next 10 s checkpoint,
      // ~10 s after the edit: more than the default 10 s expect timeout leaves (#324)
      await expect.poll(async () => (await storedTime(page, 'test-task-1')) ?? 0, { timeout: 20_000 }).toBeGreaterThan(3600);
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

  // #846: the id is shown nowhere in the sheet; the task menu copies it (reverses #244, which kept it readable in Metadaten)
  test('the id is not shown in the sheet; "ID kopieren" in the task menu copies it and says so', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openSheet(page, baseURL, 'test-task-1');

    await expect(page.getByRole('dialog').getByText('test-task-1')).toHaveCount(0);
    await (await openTaskMenu(page, 'ID kopieren')).click();
    await expect(page.getByText('ID kopiert', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('test-task-1');
  });

  test('Delete in the task menu opens the usual delete flow; a Local board\'s menu holds the task\'s own entries and Delete (#705, #846)', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-1');

    await taskMenu(page).click();
    await expect(page.getByRole('menuitem')).toHaveText(['ID kopieren', 'Löschen']);
    await expect(page.getByRole('menuitemcheckbox')).toHaveText(['Ad-hoc/Ungeplant']);
    await page.getByRole('menuitem', { name: /^Löschen/ }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.locator('.task-wrapper[data-task-id="test-task-1"]')).toHaveCount(0);
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

  test('the footer line always shows the source and the creation date, with no block to open and no id (#846)', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-1');

    await expect(page.getByRole('button', { name: /Metadaten/i })).toHaveCount(0);
    const footer = page.getByTestId('task-metadata');
    await expect(footer).toBeVisible();
    // A Local task shows the translated source label, never the raw source id (#326)
    await expect(footer.getByTestId('task-detail-source')).toHaveText('Lokal');
    await expect(footer.getByTestId('task-detail-source').locator('svg, .iconify')).toHaveCount(1);
    // The date alone, without the time of day
    await expect(footer.getByTestId('task-detail-created')).toHaveText(/^Erstellt: (—|\d{2}\.\d{2}\.\d{4})$/);
    await expect(footer).not.toContainText('test-task-1');
  });

  // ── Redesign: always-visible action buttons ──────────────────────────────

  // ── Redesign: time stats states ───────────────────────────────────────────

  // ── Redesign: date picker ─────────────────────────────────────────────────

  test('date custom field shows the formatted date, and a click on it opens the calendar', async ({ page, baseURL }) => {
    // task-5 has a date custom field with start: '2026-04-15'
    await openSheet(page, baseURL, 'test-task-5');
    await openTab(page, 'Eigenschaften');
    await expect(customProperties(page)).toBeVisible();

    const trigger = page.getByTestId('date-picker-trigger').first();
    await expect.soft(trigger, 'date custom field shows formatted date').toBeVisible();
    await expect.soft(trigger, 'date custom field shows formatted date: value').toContainText('15. April 2026');

    await trigger.click();
    await expect(page.getByTestId('date-picker-calendar')).toBeVisible();
  });

  // #303: the link is derived from source + externalId; Local has none
  test('a Notion task shows "In Notion öffnen" in the sheet, a Local task does not', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-5');
    await expect(await openTaskMenu(page, 'In Notion öffnen')).toBeVisible();
    await page.keyboard.press('Escape');

    await openSheet(page, baseURL, 'test-task-1');
    await taskMenu(page).click();
    await expect(taskMenuItem(page, /Löschen/)).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /öffnen/ })).toHaveCount(0);
  });

  test('Escape with the date picker open closes the picker only, not the sheet', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-5');
    await openTab(page, 'Eigenschaften');

    await page.getByTestId('date-picker-trigger').first().click();
    const calendar = page.getByTestId('date-picker-calendar');
    await expect(calendar).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(calendar).not.toBeVisible();
    // Only the topmost layer closed: the sheet is still open
    await expect(page.getByTestId('task-detail-header')).toBeVisible();
    await expect(customProperties(page)).toBeVisible();
    await expect(page).toHaveURL(/\/tasks\/test-task-5/);
  });

  test('date picker Heute sets todays date', async ({ page, baseURL }) => {
    await openSheet(page, baseURL, 'test-task-5');
    await openTab(page, 'Eigenschaften');

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
    await openTab(page, 'Eigenschaften');

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
      await openTab(page, 'Notiz');

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

    test('Esc in the timebox field cancels instead of saving the typed value (kd#12)', async ({ page, baseURL }) => {
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

      expect(optionSize).toBe('14px');
    });

    test('saved notes show rendered Markdown, editing shows the markup', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');
      await openTab(page, 'Notiz');

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
      await openTab(page, 'Notiz');
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
      await openTab(page, 'Notiz');
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
      await openTab(page, 'Notiz');

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
      await openTab(page, 'Notiz');

      await page.getByRole('button', { name: /^Notiz: / }).click();
      await expect(page.getByTestId('task-notes-hint')).toHaveText('Markdown unterstützt • Cmd + Enter zum Speichern');
      await page.keyboard.type('mit Cmd gespeichert');
      await page.keyboard.press('Meta+Enter');
      await expect(page.getByTestId('task-notes-rendered')).toContainText('mit Cmd gespeichert');
    });

    test.describe('on a phone (touch, no fine pointer)', () => {
      test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

      // #865: a phone has no Cmd or Ctrl key, so the hint names no shortcut
      test('the note hint names no keyboard shortcut', async ({ page, baseURL }) => {
        await openSheet(page, baseURL, 'test-task-2');
        await openTab(page, 'Notiz');
        await page.getByRole('button', { name: /^Notiz: / }).click();
        await expect(page.getByTestId('task-notes-hint')).toHaveText('Markdown unterstützt');
      });

      // #871: with a long note the tabs scroll away with the page, so Details needed a scroll to the top
      test('the tab list stays at the top of the drawer while a long note scrolls', async ({ page, baseURL }) => {
        await openSheet(page, baseURL, 'test-task-2');
        await openTab(page, 'Notiz');
        await page.getByRole('button', { name: /^Notiz: / }).click();
        await page.getByTestId('task-notes-input').fill(Array.from({ length: 60 }, (_, i) => `Absatz ${i + 1}`).join('\n\n'));
        await page.keyboard.press('Control+Enter');
        await expect(page.getByTestId('task-notes-rendered')).toContainText('Absatz 60');

        const tabList = page.getByRole('tablist');
        const scrolled = await page.getByTestId('task-notes').evaluate((el) => {
          let top = 0;
          for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
            if (node.scrollHeight > node.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(node).overflowY)) { node.scrollTop = 99999; top = Math.max(top, node.scrollTop); }
          }
          return top;
        });
        expect(scrolled, 'the long note scrolls the drawer').toBeGreaterThan(200);
        await expect.poll(async () => (await tabList.boundingBox())!.y, 'the tab list sticks at the top of the drawer, not scrolled out').toBeLessThan(120);
        expect((await tabList.boundingBox())!.y).toBeGreaterThanOrEqual(0);
      });
    });

    // #871: an empty note's body is a target, not only the line of its placeholder
    test('an empty note is a tall target, not just the placeholder line', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-4');
      await openTab(page, 'Notiz');
      const trigger = page.getByRole('button', { name: /^Notiz/ }).filter({ hasText: 'Notiz hinzufügen' });
      expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(90);
      const box = (await trigger.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
      await expect(page.getByTestId('task-notes-input')).toBeVisible();
    });

    // #871: a note longer than the frame says so with a shadow at the cut edge, and none when it fits
    test('a long note shows a scroll cue at the frame edge, a short one does not', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-3');
      await openTab(page, 'Notiz');
      await page.getByRole('button', { name: /^Notiz: / }).click();
      await page.getByTestId('task-notes-input').fill(Array.from({ length: 40 }, (_, i) => `Absatz ${i + 1}`).join('\n\n'));
      await page.keyboard.press('Control+Enter');
      const body = page.getByRole('tabpanel');
      await expect(body).toHaveClass(/task-scroll-cue/);
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    });

    // #865: the unchecked box is a rounded square, a circle reads as a radio button
    test('an unchecked checkbox property is a square box, not a circle', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-6');
      await openTab(page, 'Eigenschaften');
      const box = page.getByRole('checkbox').first();
      const { radius, width } = await box.evaluate((el) => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), width: el.getBoundingClientRect().width }));
      expect(radius).toBeLessThan(width / 2);
    });

    // #870: title across the top, the tabs, the open tab's body, the footer line last; the frame is the same on every tab
    test('desktop: the title spans the top, the tabs follow, the open tab has the body and the footer line is the last line on every tab', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');
      await settleAnimations(page);

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('task-detail-scroll')).toHaveCount(0);
      const header = (await page.getByTestId('task-detail-header').boundingBox())!;
      const tabs = (await page.getByRole('tablist').boundingBox())!;
      const props = (await page.getByTestId('task-property-list').boundingBox())!;
      const meta = (await page.getByTestId('task-metadata').boundingBox())!;
      const menu = (await taskMenu(page).boundingBox())!;
      const dialogBox = (await dialog.boundingBox())!;

      expect(tabs.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
      expect(props.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);
      // The footer line is last, close to the sheet's bottom edge
      expect(meta.y).toBeGreaterThanOrEqual(props.y + props.height - 1);
      expect(dialogBox.y + dialogBox.height - (meta.y + meta.height)).toBeLessThan(40);
      expect(menu.y).toBeLessThan(header.y + header.height);
      // Nothing scrolls while the tab's content fits its body
      const scrollAreas = () => dialog.evaluate((el) => [el, ...el.querySelectorAll('*')].filter((node) => node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)).length);
      expect(await scrollAreas()).toBe(0);

      // The note has the body of its tab, as wide as the grid was; frame, tabs and footer line do not move
      await openTab(page, 'Notiz');
      const notes = (await page.getByTestId('task-notes').boundingBox())!;
      expect(Math.abs(notes.x - props.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(notes.width - props.width)).toBeLessThanOrEqual(1);
      expect(notes.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);
      expect(await dialog.boundingBox()).toEqual(dialogBox);
      expect(await page.getByRole('tablist').boundingBox()).toEqual(tabs);
      expect(await page.getByTestId('task-metadata').boundingBox()).toEqual(meta);
      expect(await scrollAreas()).toBe(0);
    });

    test('mobile: the drawer has the same tabs; one column of rows with the label beside the value, the footer line last, and a shorter tab keeps the drawer\'s height', async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openSheet(page, baseURL, 'test-task-1');

      const scroll = page.getByTestId('task-detail-scroll');
      await expect(scroll.getByTestId('task-metadata')).toBeVisible();
      const rows = await page.getByTestId('task-property-list').getByTestId('task-property-row').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
      expect(new Set(rows).size, 'one column').toBe(1);
      const row = page.getByTestId('task-property-list').getByTestId('task-property-row').first();
      const label = (await row.locator('> span').first().boundingBox())!;
      const value = (await page.getByTestId('task-status-select').boundingBox())!;
      expect(value.x).toBeGreaterThan(label.x + label.width - 1);
      for (const tab of await page.getByRole('tab').all()) expect((await tab.boundingBox())!.height, 'a tab is a 44 px target').toBeGreaterThanOrEqual(44);
      const props = (await page.getByTestId('task-property-list').boundingBox())!;
      expect((await page.getByTestId('task-metadata').boundingBox())!.y).toBeGreaterThan(props.y + props.height);
      // A task outside Jetzt (no hint line under the switch): Details is the body's minimum
      await openSheet(page, baseURL, 'test-task-2');
      const drawerOnDetails = (await page.getByRole('dialog').boundingBox())!;

      // The note's tab is shorter than Details: the body keeps its minimum, the footer line does not move up past it
      await openTab(page, 'Notiz');
      await expect(scroll.getByTestId('task-notes')).toBeVisible();
      const notes = (await page.getByTestId('task-notes').boundingBox())!;
      const meta = (await page.getByTestId('task-metadata').boundingBox())!;
      expect(meta.y).toBeGreaterThan(notes.y + notes.height);
      // The drawer is anchored at the bottom: its top edge and height tell whether it got lower
      const drawerOnNotes = (await page.getByRole('dialog').boundingBox())!;
      expect(Math.abs(drawerOnNotes.y - drawerOnDetails.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(drawerOnNotes.height - drawerOnDetails.height)).toBeLessThanOrEqual(1);
    });

    // #199: the sheet freezes its variant while open, the content layout must follow it
    test('shrinking below 768px while the sheet is open keeps the sheet\'s layout: the frame, two cells per row', async ({ page, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-1');
      await settleAnimations(page);

      await page.setViewportSize({ width: 600, height: 800 });
      await expect(page.getByRole('dialog').getByTestId('task-detail-scroll')).toHaveCount(0);
      await expect.poll(async () => (await page.getByRole('dialog').boundingBox())!.width).toBeCloseTo(568, 0);
      const lefts = await page.getByTestId('task-property-list').getByTestId('task-property-row').evaluateAll((els) => els.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().left)));
      expect(lefts[1]).toBeGreaterThan(lefts[0]! + 100);
      await expect(page.getByTestId('task-metadata')).toBeVisible();
    });

    test('a link in the notes is reachable with Tab and Enter follows it without editing (#199)', async ({ page, context, baseURL }) => {
      await openSheet(page, baseURL, 'test-task-2');
      await openTab(page, 'Notiz');
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

// kd#178: one field height. Inputs, selects, textareas, the value controls of the task sheet's rows and the choice chip
// are 36 px high on desktop and 44 px on a phone (the `--field-h` token); the title keeps its own size, never under the field height (the phone floor, #592).
const heightOf = async (locator: Locator) => Math.round((await locator.boundingBox())!.height);

for (const { name, viewport, touch, expected } of [
  { name: '1280px', viewport: { width: 1280, height: 900 }, touch: false, expected: 36 },
  { name: '390px', viewport: { width: 390, height: 844 }, touch: true, expected: 44 },
]) {
  test.describe(`field height at ${name}`, () => {
    test.use({ viewport, hasTouch: touch, isMobile: touch })

    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context)
    })

    test(`the task sheet's select and value controls are ${expected} px`, async ({ page }) => {
      await page.goto('/tasks/seed-open-1')
      const rows = page.getByTestId('task-property-row')
      await expect(rows.first()).toBeVisible()
      // A value that opens a list (a select with a chevron)
      await expect.poll(() => heightOf(page.getByRole('button', { name: /^Status:/ }))).toBe(expected)
      await expect.poll(() => heightOf(page.getByRole('button', { name: /^Priorität:/ }))).toBe(expected)
      // A free value (text on a dotted rule)
      await expect.poll(() => heightOf(page.getByRole('button', { name: /^Timebox:/ }))).toBe(expected)
      await expect.poll(() => heightOf(page.getByRole('button', { name: /^Aufgewendete Zeit:/ }))).toBe(expected)
    })

    test(`the add sheet's fields are ${expected} px; the title keeps its own size`, async ({ page }) => {
      await page.goto('/tasks/add')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect.poll(() => heightOf(page.getByTestId('add-task-timebox-input'))).toBe(expected)
      await expect.poll(() => heightOf(page.getByRole('button', { name: /^Priorität:/ }))).toBe(expected)
      await expect.poll(() => heightOf(page.getByRole('button', { name: /^Thema:/ }))).toBe(expected)
      // A select beside an input: the same height
      expect(await heightOf(page.getByRole('button', { name: /^Priorität:/ }))).toBe(await heightOf(page.getByTestId('add-task-timebox-input')))
      // The title is the one field with its own size: taller than 36 px on desktop; on a phone the 44 px floor (#592) is the least it takes
      const titleHeight = await heightOf(page.locator('input[name="title"]'))
      if (touch) expect(titleHeight).toBeGreaterThanOrEqual(expected)
      else expect(titleHeight).not.toBe(expected)
      // A textarea line is never shorter than a field
      expect(await heightOf(page.locator('textarea[name="notes"]'))).toBeGreaterThanOrEqual(expected)
    })
  })
}

// kd#201: at desktop width the task sheet shows a close button in its corner; the phone drawer has none (swipe, outside tap).
test.describe('task sheet close button (kd#201)', () => {
  test.describe('at 1280px', () => {
    test.use({ viewport: { width: 1280, height: 900 } })

    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context)
    })

    test('the detail sheet closes by the button, lands on /tasks and returns focus to the opening card; it clears the title and the menu', async ({ page }) => {
      await page.goto('/tasks')
      const card = page.locator('.task-wrapper[data-task-id="seed-open-1"]')
      await card.click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await settleAnimations(page)
      const close = dialog.getByRole('button', { name: /^(Schließen|Close)$/ })
      await expect(close).toBeVisible()

      // Clear of the title row: no overlap of the boxes
      const closeBox = (await close.boundingBox())!
      // The title, and the task menu beside the close button (#705)
      for (const target of [dialog.getByTestId('task-detail-header').locator('[data-inline-editable]'), taskMenu(page)]) {
        const box = (await target.boundingBox())!
        const overlaps = closeBox.x < box.x + box.width && closeBox.x + closeBox.width > box.x && closeBox.y < box.y + box.height && closeBox.y + closeBox.height > box.y
        expect(overlaps).toBe(false)
      }

      await close.click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page).toHaveURL(/\/tasks$/)
      await expect(card).toBeFocused()
    })

    test('the title runs clear of the close button and in a window too short for the frame the open tab scrolls, never the sheet (#870)', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 340 })
      await page.goto('/tasks/seed-open-1')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await settleAnimations(page)
      const closeBox = (await dialog.getByRole('button', { name: /^(Schließen|Close)$/ }).boundingBox())!
      const title = (await dialog.getByTestId('task-detail-header').locator('[data-inline-editable]').boundingBox())!
      const menuBox = (await taskMenu(page).boundingBox())!
      expect(title.x + title.width).toBeLessThanOrEqual(menuBox.x)
      expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(closeBox.x)
      // The sheet is the window minus 16 px to every edge at most; the open tab's body scrolls, the footer line stays in the frame
      const box = (await dialog.boundingBox())!
      expect(box.height).toBeLessThanOrEqual(340 - 32 + 1)
      const body = dialog.getByRole('tabpanel')
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      expect(await dialog.getByTestId('task-detail-sheet').evaluate((el) => getComputedStyle(el).overflowY)).toBe('visible')
      const footer = (await dialog.getByTestId('task-metadata').boundingBox())!
      expect(footer.y + footer.height).toBeLessThanOrEqual(box.y + box.height)
    })

    test('the add sheet has the same close button, and Escape still closes it', async ({ page }) => {
      await page.goto('/tasks/add')
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('button', { name: /^(Schließen|Close)$/ })).toBeVisible()
      await dialog.getByRole('button', { name: /^(Schließen|Close)$/ }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.goto('/tasks/add')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })
  })

  test.describe('at 390px', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test.beforeEach(async ({ context }) => {
      await seedLocalBoard(context)
    })

    test('the drawer has no close button', async ({ page }) => {
      await page.goto('/tasks/seed-open-1')
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByTestId('task-property-list')).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('button', { name: /^(Schließen|Close)$/ })).toHaveCount(0)
    })
  })
})

// #870: one fixed frame for every task; the board's extra properties are a tab of their own (reverses the content height of #846)
test.describe('task sheet frame and extra properties (#870)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  const customs = (count: number, filled: boolean) => Object.fromEntries(Array.from({ length: count }, (_, i) => {
    const key = `eigenschaft-${i + 1}`
    return [key, { key, name: `Eigenschaft ${i + 1}`, propType: 'text', value: { type: 'text', value: filled ? `Wert Nummer ${i + 1}` : '' } }]
  }))
  const frameTask = (id: string, source: 'local' | 'notion', custom: Record<string, unknown>): SeedTask => ({
    id, source, externalId: source === 'notion' ? id : null, title: `Rahmen ${id}`, status: 0, priority: 2,
    timeSpentSeconds: 0, timeBoxSeconds: null, topic: null, topicColorCode: null, activity: null, notes: null, isUnplanned: false, custom,
  })

  test.beforeEach(async ({ context }) => {
    await seedLocalBoard(context, [
      frameTask('frame-none', 'local', {}),
      frameTask('frame-four', 'notion', customs(4, true)),
      frameTask('frame-eleven', 'notion', customs(11, true)),
      { ...frameTask('frame-long', 'local', {}), notes: Array.from({ length: 60 }, (_, i) => `Absatz ${i + 1} der langen Notiz.`).join('\n\n') },
      frameTask('frame-empty', 'notion', customs(2, false)),
      frameTask('frame-tags', 'notion', { tags: { key: 'tags', name: 'Stichwörter', propType: 'multi_select', value: { type: 'multi_select', value: Array.from({ length: 14 }, (_, i) => ({ name: `Stichwort Nummer ${i + 1}`, color: 'default' })) } } }),
    ], {}, undefined, { once: true })
  })

  const sheetBox = async (page: Page) => (await page.getByRole('dialog').boundingBox())!
  /** Elements inside the sheet that scroll right now */
  const scrolling = (page: Page) => page.getByRole('dialog').evaluate((el) => [...el.querySelectorAll<HTMLElement>('*')]
    .filter((node) => node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY))
    .map((node) => node.dataset.testid ?? (node.getAttribute('role') === 'tabpanel' ? 'tab-panel' : node.tagName)))

  test('one frame for every task and every tab: 720 x 403, whatever the task holds; nothing scrolls while a tab fits', async ({ page }) => {
    for (const id of ['frame-none', 'frame-four', 'frame-eleven', 'frame-long']) {
      await openSheet(page, '', id)
      const box = await sheetBox(page)
      expect(Math.round(box.width), `${id}: width`).toBe(720)
      expect(Math.round(box.height), `${id}: height`).toBe(403)
      expect(await scrolling(page), `${id}: Details fits`).toEqual([])
      for (const tab of await page.getByRole('tab').all()) {
        await tab.click()
        expect(await sheetBox(page), `${id}: the frame does not move with a tab`).toEqual(box)
        // every part is inside the sheet: the last line is the footer
        const footer = (await page.getByTestId('task-metadata').boundingBox())!
        expect(footer.y + footer.height).toBeLessThanOrEqual(box.y + box.height)
      }
    }
  })

  test('extra properties are the cells of their own tab with a count, set and empty ones alike; no strip, button or popover', async ({ page }) => {
    await openSheet(page, '', 'frame-eleven')
    const tab = page.getByRole('tab', { name: /^Eigenschaften/ })
    await expect(tab).toHaveText(/Eigenschaften\s*11/)
    await expect(page.getByTestId('task-custom-properties')).toHaveCount(0)
    // the same two tracks as the standard properties
    const standard = await page.getByTestId('task-property-list').getByTestId('task-property-row').evaluateAll((els) => els.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().left)))
    await tab.click()
    const section = page.getByTestId('task-custom-properties')
    await expect(section.getByTestId('task-property-row')).toHaveCount(11)
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Eigenschaften' })).toHaveCount(0)
    await expect(page.getByText(/weitere/)).toHaveCount(0)
    for (const gone of ['task-property-strip', 'task-properties-button', 'task-properties-popover']) await expect(page.getByTestId(gone)).toHaveCount(0)
    const extra = await section.getByTestId('task-property-row').evaluateAll((els) => els.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().left)))
    expect(extra).toEqual(standard)
    // eleven do not fit the body: the tab scrolls inside, the frame stays
    expect(await scrolling(page)).toEqual(['tab-panel'])

    // an empty one keeps its cell and is edited in place
    await openSheet(page, '', 'frame-empty')
    await page.getByRole('tab', { name: /^Eigenschaften/ }).click()
    await expect(page.getByTestId('task-custom-properties').getByTestId('task-property-row')).toHaveCount(2)
    await page.getByRole('button', { name: 'Eigenschaft 1: + hinzufügen' }).click()
    await page.getByRole('textbox', { name: 'Eigenschaft 1' }).fill('Neuer Wert')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Eigenschaft 1: Neuer Wert' })).toBeVisible()
  })

  test('a task without extra properties has two tabs, Details and Notiz', async ({ page }) => {
    await openSheet(page, '', 'frame-none')
    await expect(page.getByRole('tab')).toHaveText([/^Details$/, /^Notiz$/])
    await expect(page.getByTestId('task-custom-properties')).toHaveCount(0)
  })

  test('a long note scrolls inside its tab: the frame, the tabs and the footer line stay', async ({ page }) => {
    await openSheet(page, '', 'frame-long')
    const box = await sheetBox(page)
    await page.getByRole('tab', { name: /^Notiz/ }).click()
    expect(await sheetBox(page)).toEqual(box)
    expect(await scrolling(page)).toEqual(['tab-panel'])
    const tabs = (await page.getByRole('tablist').boundingBox())!
    await page.getByRole('tabpanel').evaluate((el) => { el.scrollTop = el.scrollHeight })
    expect(await page.getByRole('tablist').boundingBox()).toEqual(tabs)
    const footer = (await page.getByTestId('task-metadata').boundingBox())!
    expect(footer.y + footer.height).toBeLessThanOrEqual(box.y + box.height)
  })

  test('writing a note never changes the frame, and the mark on the tab follows the saved note', async ({ page }) => {
    await openSheet(page, '', 'frame-none')
    const before = await sheetBox(page)
    await expect(page.getByTestId('task-notes-mark')).toHaveCount(0)
    await page.getByRole('tab', { name: /^Notiz/ }).click()
    await page.getByRole('button', { name: /^Notiz: / }).click()
    await page.getByTestId('task-notes-input').fill(Array.from({ length: 30 }, (_, i) => `Zeile ${i + 1}`).join('\n'))
    expect(await sheetBox(page)).toEqual(before)
    expect(await page.getByRole('dialog').evaluate((el) => el.getAnimations().length)).toBe(0)
    await page.keyboard.press('Control+Enter')
    await expect(page.getByTestId('task-notes-mark')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Notiz vorhanden' })).toHaveAttribute('aria-selected', 'true')
    expect(await sheetBox(page)).toEqual(before)
  })

  test('the task menu opens by keyboard and Escape returns focus to it', async ({ page }) => {
    await openSheet(page, '', 'frame-four')
    const menu = taskMenu(page)
    await menu.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: /Notion öffnen/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitem')).toHaveCount(0)
    await expect(menu).toBeFocused()
    await expect(page.getByTestId('task-detail-header')).toBeVisible()
  })
})
