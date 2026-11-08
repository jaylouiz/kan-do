import { test, expect, type Locator, type Page } from '@playwright/test';
import { pinClock } from './helpers/clock';
import { showColumnPage } from './helpers/dnd';

interface SortingSeedOptions {
  /** Adds a card to the Jetzt column. */
  progressTask?: boolean;
  /** Leaves the Wartet column empty. */
  emptyWaiting?: boolean;
}

/**
 * Seeds the sorting board and opens it. The seed is written by an init script, so it is in place before the one
 * and only page load: a test that needs another seed passes options here instead of editing storage and reloading.
 * The old goto -> evaluate -> reload sequence flaked ~3% of runs with a blank page (#499): the reload right after the
 * first load sent its module requests over connections to the dev server that were already dead
 * (net::ERR_CONNECTION_RESET / _REFUSED / _SOCKET_NOT_CONNECTED), so `entry.async.js` never loaded (#523: the
 * visibility test did the same to apply a second seed). No test in this describe reloads, so the init script needs
 * no once guard.
 */
async function openSortingBoard(page: Page, baseURL: string | undefined, options: SortingSeedOptions = {}) {
  await page.addInitScript((options: SortingSeedOptions) => {
    const now = Date.now();
    const hour = 3600000;
    // Done cards must be "today" at any pinned time (the Done column hides yesterday's behind a note): clamp to this midnight,
    // keeping the order (a larger h is earlier). At 00:01 that is 00:00:10-00:00:40.
    const startOfToday = new Date(now).setHours(0, 0, 0, 0);
    const doneAt = (h: number) => new Date(Math.max(now - h * hour, startOfToday + (6 - h) * 10_000)).toISOString();

    const tasks: Array<Record<string, string | number>> = [
      // Open Column Tasks (Default: Manual)
      {
        id: 'task-open-1',
        title: 'Task Open 1 (High Prio, Old)',
        status: 0, // Open
        priority: 3, // High
        createdAt: new Date(now - 10 * hour).toISOString(),
        updatedAt: new Date(now - 10 * hour).toISOString(),
      },
      {
        id: 'task-open-2',
        title: 'Task Open 2 (Low Prio, New)',
        status: 0, // Open
        priority: 1, // Low
        createdAt: new Date(now - 1 * hour).toISOString(),
        updatedAt: new Date(now - 1 * hour).toISOString(),
      },

      // Waiting Column Tasks (Default: Longest waiting/Oldest update first)
      {
        id: 'task-waiting-1',
        title: 'Task Waiting 1 (Oldest Update)',
        status: 2, // Waiting
        updatedAt: new Date(now - 5 * hour).toISOString(),
      },
      {
        id: 'task-waiting-2',
        title: 'Task Waiting 2 (Newest Update)',
        status: 2, // Waiting
        updatedAt: new Date(now - 1 * hour).toISOString(),
      },

      // Done Column Tasks (Default: First completed/Oldest completed first)
      {
        id: 'task-done-1',
        title: 'Task Done 1 (Completed Early)',
        status: 3, // Done
        completedAt: doneAt(5),
      },
      {
        id: 'task-done-2',
        title: 'Task Done 2 (Completed Late)',
        status: 3, // Done
        completedAt: doneAt(1),
      },
    ];

    // Variants a test needs from its very first load (set before the page loads, never by editing storage afterwards)
    if (options.progressTask) {
      tasks.push({
        id: 'task-progress-1',
        title: 'Task in Progress',
        status: 1, // Progress
        updatedAt: new Date(now).toISOString(),
      });
    }
    const seededTasks = options.emptyWaiting ? tasks.filter((t) => t.status !== 2) : tasks;

    localStorage.setItem('tasks-store', JSON.stringify({
      tasks: seededTasks,
      isLoading: false,
      lastSyncTimestamp: null,
      archivedTaskIds: [],
    }));

    // Ensure manual order is set initially to match index order
    const columns = [
      {
        idClassSuffix: 'open',
        taskStatus: 0,
        taskOrder: ['task-open-1', 'task-open-2'],
        taskPositions: { 'task-open-1': 1000, 'task-open-2': 2000 },
        sorting: { field: 'manual', direction: 'asc' }
      },
      {
        idClassSuffix: 'progress',
        taskStatus: 1,
        taskOrder: [],
        taskPositions: {},
        sorting: { field: 'manual', direction: 'asc' }
      },
      {
        idClassSuffix: 'waiting',
        taskStatus: 2,
        taskOrder: ['task-waiting-1', 'task-waiting-2'],
        taskPositions: { 'task-waiting-1': 1000, 'task-waiting-2': 2000 },
        sorting: { field: 'dateUpdated', direction: 'asc' }
      },
      {
        idClassSuffix: 'done',
        taskStatus: 3,
        taskOrder: ['task-done-1', 'task-done-2'],
        taskPositions: { 'task-done-1': 1000, 'task-done-2': 2000 },
        sorting: { field: 'dateCompleted', direction: 'asc' }
      },
    ];
    if (options.progressTask) {
      const col = columns.find((c) => c.taskStatus === 1)!;
      col.taskOrder = ['task-progress-1'];
      col.taskPositions = { 'task-progress-1': 1000 };
    }
    if (options.emptyWaiting) {
      const col = columns.find((c) => c.taskStatus === 2)!;
      col.taskOrder = [];
      col.taskPositions = {};
    }
    localStorage.setItem('board-store', JSON.stringify({
      boardConfig: { sources: { connected: [], default: 'local' } },
      columns,
      grouping: { enabled: false, key: null },
    }));
  }, options);

  await page.goto(baseURL!);
  if (page.url().includes('/welcome')) {
    console.error('Redirected to welcome page! Seeding failed?');
  }

  // Wait for board to be visible to ensure hydration
  await expect(page.locator('.board')).toBeVisible({ timeout: 15000 });
}

test.describe('Board Sorting', () => {
  test.beforeEach(async ({ page }) => {
    // Enable console logging from the browser
    page.on('console', msg => console.log(`[Browser] ${msg.text()}`));
    page.on('pageerror', err => console.error(`[Browser Error] ${err.message}`));

    // Pin the browser clock (local midday by default) so the seeded "now - Nh" timestamps always fall on
    // the same calendar day (the Done column groups by completion day, e.g. the "Gestern erledigt" note).
    await pinClock(page);
  });

  test('validates default sorting behavior', async ({ page, baseURL }) => {
    await openSortingBoard(page, baseURL);

    // Waiting Column: Oldest update first (dateUpdated asc)
    const waitingColumn = page.locator('.column[data-status="waiting"]');
    // Ensure tasks are rendered (target wrapper to avoid double counting task element + wrapper)
    await expect(waitingColumn.locator('.task-wrapper')).toHaveCount(2);
    
    const firstWaiting = waitingColumn.locator('.task-wrapper').nth(0);
    const secondWaiting = waitingColumn.locator('.task-wrapper').nth(1);
    
    await expect(firstWaiting).toContainText('Task Waiting 1');
    await expect(secondWaiting).toContainText('Task Waiting 2');

    // Done Column: Oldest completion first (dateCompleted asc)
    const doneColumn = page.locator('.column[data-status="done"]');
    await expect(doneColumn.locator('.task-wrapper')).toHaveCount(2);
    
    await expect(doneColumn.locator('.task-wrapper').nth(0)).toContainText('Task Done 1');
    await expect(doneColumn.locator('.task-wrapper').nth(1)).toContainText('Task Done 2');
  });

  test('validates sorting control interaction', async ({ page, baseURL }) => {
    await openSortingBoard(page, baseURL);

    const openColumn = page.locator('.column[data-status="open"]');
    await expect(openColumn.locator('.task-wrapper')).toHaveCount(2);
    
    // Hover the column to show sorting control
    await openColumn.hover();
    
    // Wait for control to be visible (opacity 1)
    const control = openColumn.locator('[data-testid="column-sorting-control"]');
    await expect(control).toHaveClass(/opacity-100/);
    
    // Default label is 'Manuell'
    const sortBtn = control.locator('button');
    await expect(sortBtn).toContainText('Manuell');
    await sortBtn.click();

    // Change to Priority Desc
    await page.getByRole('menuitemcheckbox', { name: /Priorität/ }).click();

    // Verify Order (High Prio first)
    await expect(openColumn.locator('.task-wrapper').nth(0)).toContainText('Task Open 1');
    
    // Change sorting to Date Created Asc (Oldest first)
    await openColumn.hover();
    await expect(control).toHaveClass(/opacity-100/);
    await expect(sortBtn).toContainText('Priorität');
    await sortBtn.click();
    
    await page.getByRole('menuitemcheckbox', { name: /Erstellt.*älteste zuerst/ }).click();
    
    await expect(openColumn.locator('.task-wrapper').nth(0)).toContainText('Task Open 1'); // Oldest

    // Change sorting to Date Created Desc (Newest first)
    await openColumn.hover();
    await expect(control).toHaveClass(/opacity-100/);
    await expect(sortBtn).toContainText('Erstellt');
    await sortBtn.click();
    
    await page.getByRole('menuitemcheckbox', { name: /Erstellt.*neueste zuerst/ }).click();
    
    await expect(openColumn.locator('.task-wrapper').nth(0)).toContainText('Task Open 2'); // Newest
  });

  test('switches to manual sorting on drag and drop', async ({ page, baseURL }) => {
    await openSortingBoard(page, baseURL);

    const openColumn = page.locator('.column[data-status="open"]');
    await expect(openColumn.locator('.task-wrapper')).toHaveCount(2);
    
    // Set sorting to Created Desc (Newest first) -> Task 2 on top
    await openColumn.hover();
    const control = openColumn.locator('[data-testid="column-sorting-control"]');
    await expect(control).toHaveClass(/opacity-100/);
    const sortBtn = control.locator('button');
    
    await sortBtn.click();
    await page.getByRole('menuitemcheckbox', { name: /Erstellt.*neueste zuerst/ }).click();
    
    await expect(openColumn.locator('.task-wrapper').nth(0)).toContainText('Task Open 2');

    // Drag Task 2 (top) to below Task 1
    const dragItem = openColumn.locator('.task-wrapper[data-task-id="task-open-2"]');
    const dropTarget = openColumn.locator('.task-wrapper[data-task-id="task-open-1"]');
    
    // Ensure elements are stable
    await expect(dragItem).toBeVisible();
    await expect(dropTarget).toBeVisible();
    
    const dragBox = await dragItem.boundingBox();
    const dropBox = await dropTarget.boundingBox();
    
    if (dragBox && dropBox) {
      // Reset mouse to neutral position
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // Move to center of drag item
      const startX = dragBox.x + dragBox.width / 2;
      const startY = dragBox.y + dragBox.height / 2;
      await page.mouse.move(startX, startY);
      
      // Start drag (a plain press and release would open the task sheet, #25)
      await page.mouse.down();
      await page.waitForTimeout(500); // Increased wait for drag init
      
      // Move slightly to start drag
      await page.mouse.move(startX, startY + 10, { steps: 10 });
      await page.waitForTimeout(100);
      
      // Move to target center (swapping usually happens when overlapping > 50%)
      // We want to move Task 2 (Top) DOWN to Task 1 (Bottom).
      // So we target the bottom edge of Task 1 + buffer.
      const targetX = dropBox.x + dropBox.width / 2;
      const targetY = dropBox.y + dropBox.height + 20;
      
      await page.mouse.move(targetX, targetY, { steps: 50 });
      
      await page.waitForTimeout(500); // Hover to ensure the target detects it
      // Make sure the drag actually activated; otherwise the "not dragging" check below passes vacuously
      await expect(page.locator('.board')).toHaveClass(/dragging/);
      await page.mouse.up();
      
      // Wait for DnD to finish; the assertions below auto-wait for the store/DOM update
      await expect(page.locator('.board')).not.toHaveClass(/dragging/);
    }

    // Verify sorting switched to Manual
    await openColumn.hover();
    await expect(control).toHaveClass(/opacity-100/);
    await expect(sortBtn).toContainText('Manuell');
    
    // Verify Task 2 is now second
    await expect(openColumn.locator('.task-wrapper').nth(1)).toContainText('Task Open 2');
  });

  test('validates sorting control visibility rules', async ({ page, baseURL }) => {
    // One seed covers every rule: a card in Jetzt (the exclusion rule) and an empty Wartet column (the empty rule).
    await openSortingBoard(page, baseURL, { progressTask: true, emptyWaiting: true });

    // 1. Verify Progress column does NOT show sorting control (even if it has tasks)
    const progressColumn = page.locator('.column[data-status="progress"]');
    // Ensure task is present so we know we are testing the exclusion rule, not the empty rule
    await expect(progressColumn.locator('.task-wrapper')).toHaveCount(1);
    
    await progressColumn.hover();
    await expect(progressColumn.locator('[data-testid="column-sorting-control"]')).toHaveCount(0);

    // 2. Verify Open column (has tasks) DOES show sorting control
    const openColumn = page.locator('.column[data-status="open"]');
    await openColumn.hover();
    const control = openColumn.locator('[data-testid="column-sorting-control"]');
    await expect(control).toBeVisible();

    // 3. Verify Empty column does NOT show sorting control
    const waitingColumn = page.locator('.column[data-status="waiting"]');
    await expect(waitingColumn.locator('.task-wrapper')).toHaveCount(0);
    
    await waitingColumn.hover();
    await expect(waitingColumn.locator('[data-testid="column-sorting-control"]')).toHaveCount(0);
    
    // 4. Capture screenshot for visual review of centering
    await openColumn.hover();
    // Wait for opacity transition
    await expect(control).toHaveClass(/opacity-100/);
    await page.waitForTimeout(500); 
    await page.screenshot({ path: 'tests/e2e/screenshots/sorting-control-position.png', fullPage: true });
  });
});

/** Resolves once two consecutive bounding-box reads 100ms apart are identical (slide/popper finished). */
async function waitForStableBox(locator: Locator) {
  let previous = '';
  await expect
    .poll(
      async () => {
        const current = JSON.stringify(await locator.boundingBox());
        const stable = current === previous;
        previous = current;
        return stable;
      },
      { intervals: [100] }
    )
    .toBe(true);
}

test.describe('Sort menu layout', () => {
  // The dayclose seed puts done cards "1-4 h ago": after midnight they are yesterday's and the Erledigt column has no sort control (#449).
  test.beforeEach(async ({ page }) => {
    await pinClock(page);
  });

  test('390px: open menu stays inside the viewport and no label is ellipsized', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks?seed=local');
    await expect(page.locator('.board')).toBeVisible({ timeout: 15000 });
    const button = page.locator('[data-testid="column-sorting-control"] button').first();
    // Touch has no hover: reveal the control through focus, then open it with the keyboard.
    await button.focus();
    await button.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemcheckbox').first()).toBeVisible();
    await waitForStableBox(menu);
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const clipped = await menu.locator('[data-reka-collection-item] *').evaluateAll(
      (els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length
    );
    expect(clipped).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test('390px: Erledigt menu wraps a long label instead of clipping it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks?seed=dayclose');
    await expect(page.locator('.board')).toBeVisible({ timeout: 15000 });
    const button = page.locator('[data-testid="column-sorting-control"] button').last();
    // Swipe to the Erledigt page (no tabs, #470); it slides (translateX): let the control stop moving before opening the menu.
    await showColumnPage(page, 2);
    await waitForStableBox(button);
    await button.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await waitForStableBox(menu);
    const item = menu.getByRole('menuitemcheckbox', { name: /Zuletzt erledigt/ });
    await expect(item).toBeVisible();
    // Force a long label so wrapping is exercised regardless of the current copy length.
    const metrics = await item.evaluate((el) => {
      const label = el.querySelector('span.truncate, span') as HTMLElement;
      label.textContent = 'Zuletzt erledigt und sehr lange Beschriftung die umbrechen muss';
      const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
      return {
        lines: Math.round(label.getBoundingClientRect().height / lineHeight),
        clipped: label.scrollWidth > label.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
      };
    });
    expect(metrics.lines).toBeGreaterThan(1);
    expect(metrics.clipped).toBe(false);
    // The longer label resizes the menu and popper re-positions it asynchronously: wait for it to settle.
    await waitForStableBox(menu);
    const settled = (await item.boundingBox())!;
    expect(settled.x + settled.width).toBeLessThanOrEqual(390);
  });
});
