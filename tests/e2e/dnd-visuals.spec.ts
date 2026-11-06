import { test, expect } from '@playwright/test';

test.describe('Drag and Drop Visuals (@dnd-kit/vue)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('board-store', JSON.stringify({
        boardConfig: { sources: { connected: [], default: 'local' } },
        columns: [
          { idClassSuffix: 'open', taskStatus: 0, taskOrder: [], taskPositions: {} },
          { idClassSuffix: 'progress', taskStatus: 1, taskOrder: [], taskPositions: {} },
          { idClassSuffix: 'waiting', taskStatus: 2, taskOrder: [], taskPositions: {} },
          { idClassSuffix: 'done', taskStatus: 3, taskOrder: [], taskPositions: {} },
        ],
        grouping: { enabled: false, key: null },
      }));

      localStorage.setItem('tasks-store', JSON.stringify({
        tasks: [
          { id: 'task-1', title: 'Open Task 1', status: 0, timeBoxSeconds: 0, timeSpentSeconds: 0, operationVersion: 0 },
          { id: 'task-2', title: 'Open Task 2', status: 0, timeBoxSeconds: 0, timeSpentSeconds: 0, operationVersion: 0 },
          { id: 'task-3', title: 'Waiting Task 1', status: 2, timeBoxSeconds: 0, timeSpentSeconds: 0, operationVersion: 0 },
        ],
        isLoading: false,
        lastSyncTimestamp: null,
        archivedTaskIds: [],
      }));
    });

    await page.goto('/tasks');
    await page.waitForSelector('.column', { timeout: 10000 });
  });

  test('should show dragging class on board during drag', async ({ page }) => {
    const task = page.locator('#column-open-list .task-wrapper').first();
    await expect(task).toBeVisible({ timeout: 10000 });
    const box = await task.boundingBox();
    if (!box) throw new Error('No bounding box');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(cx + 5, cy + 5, { steps: 3 });
    await page.mouse.move(cx + 60, cy + 60, { steps: 10 });

    // kando:dnd-start fires when drag begins → board gets 'dragging' class
    await expect(page.locator('.board')).toHaveClass(/dragging/, { timeout: 3000 });

    await page.mouse.up();
  });

  test('should clean up dragging class after drag ends', async ({ page }) => {
    const task = page.locator('#column-open-list .task-wrapper').first();
    await expect(task).toBeVisible({ timeout: 10000 });
    const box = await task.boundingBox();
    if (!box) throw new Error('No bounding box');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(cx + 5, cy + 5, { steps: 3 });
    await page.mouse.move(cx + 60, cy + 60, { steps: 10 });
    await page.mouse.up();

    // After drop: board dragging class should be removed
    await page.waitForTimeout(300);
    await expect(page.locator('.board')).not.toHaveClass(/dragging/);
    // No stale kando-dnd-dragged markers should remain
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0);
  });

  test('should transfer task from Open to Waiting column', async ({ page }) => {
    const openItems = page.locator('#column-open-list .task-wrapper');
    const waitingItems = page.locator('#column-waiting-list .task-wrapper');

    await expect(openItems).toHaveCount(2, { timeout: 10000 });
    await expect(waitingItems).toHaveCount(1);

    const source = openItems.first();
    const target = page.locator('#column-waiting-list');

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) throw new Error('Missing bounding box');

    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;
    const tx = targetBox.x + targetBox.width / 2;
    const ty = targetBox.y + targetBox.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(sx + 5, sy + 5, { steps: 3 });
    await page.mouse.move(tx, ty, { steps: 20 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(200);

    await expect(openItems).toHaveCount(1);
    await expect(waitingItems).toHaveCount(2);
  });
});
