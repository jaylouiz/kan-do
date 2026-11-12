import { test, expect } from '@playwright/test';
import { hover, pickUp } from './helpers/dnd';

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

  // kd#225: the dropped card flashed. Leaving the slot look started the card's own transitions, so its fill faded up
  // from the slot grey under the content that was already visible (and WebKit dipped the shadow to none and back).
  test('a dropped card takes the slot in one frame: its fill never fades up from the slot grey', async ({ page }) => {
    const card = page.locator('#column-open-list .task-wrapper').first();
    const id = await card.getAttribute('data-task-id');
    await pickUp(page, card);
    await hover(page, page.locator('#column-waiting-list .task-wrapper').first());

    // Sample the card every frame from the release on: once its content shows, the fill must be a card fill
    await page.evaluate((taskId) => {
      const resolve = (token: string) => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = `var(${token})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return value;
      };
      const allowed = [resolve('--ui-bg-elevated'), resolve('--task-card-hover-bg')];
      const seen = { frames: 0, wrong: [] as string[] };
      (window as unknown as { __dropFill: typeof seen }).__dropFill = seen;
      const start = performance.now();
      const tick = () => {
        const face = document.querySelector(`.board .task-wrapper[data-task-id="${taskId}"] .task`);
        const content = face?.firstElementChild;
        if (face && content && getComputedStyle(content).visibility === 'visible') {
          seen.frames += 1;
          const fill = getComputedStyle(face).backgroundColor;
          if (!allowed.includes(fill)) seen.wrong.push(fill);
        }
        if (performance.now() - start < 1200) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, id);
    await page.mouse.up();

    await expect.poll(() => page.evaluate(() => (window as unknown as { __dropFill: { frames: number } }).__dropFill.frames)).toBeGreaterThan(20);
    const seen = await page.evaluate(() => (window as unknown as { __dropFill: { wrong: string[] } }).__dropFill);
    expect(seen.wrong).toEqual([]);
  });
});
