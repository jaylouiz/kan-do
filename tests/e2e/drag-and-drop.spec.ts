import { test, expect, type Page, type Locator } from '@playwright/test';
import { seedLocalBoard, type SeedTask as BoardSeedTask } from './helpers/seed';

type SeedTask = {
  id: string;
  title: string;
  status: number;
  priority: number;
  timeSpentSeconds: number;
  custom: Record<string, unknown>;
};

/**
 * Seed board + tasks via localStorage, navigate to /tasks, wait for render.
 */
async function seedBoard(page: Page, baseURL: string | undefined, tasks: SeedTask[]) {
  const base = baseURL || 'http://localhost:3000';
  // addInitScript seeds before page JS runs; no goto + evaluate + reload (#512)
  await seedLocalBoard(page.context(), tasks.map(t => ({ timeBoxSeconds: null, ...t })) as BoardSeedTask[]);
  await page.goto(`${base}/tasks`);
  await expect(page.locator('#column-open-list')).toBeVisible();
}

/**
 * Pointer-based drag-and-drop helper for @dnd-kit/vue.
 * Uses mouse events (move, down, move, up) instead of synthetic HTML5 DragEvents.
 *
 * The target should be a task-list container (e.g. #column-progress-list).
 * The helper resolves the .column-drop-zone inside it as the actual drop target,
 * ensuring the pointer lands on a registered dnd-kit droppable element.
 */
async function pointerDrag(
  page: Page,
  source: Locator,
  target: Locator,
) {
  const sourceBox = (await source.boundingBox())!;
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;

  // Press and initiate drag
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(150);

  // Small move to trigger dnd-kit drag start
  await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
  await page.waitForTimeout(300);

  // Resolve the .column-drop-zone inside the target (the actual dnd-kit droppable)
  const dropZone = target.locator('.column-drop-zone');
  const dzBox = (await dropZone.boundingBox())!;
  const tx = dzBox.x + dzBox.width / 2;
  const ty = dzBox.y + dzBox.height / 2;

  // Move to target drop zone
  await page.mouse.move(tx, ty, { steps: 40 });
  await page.waitForTimeout(300);

  // Drop
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe('Drag and Drop (@dnd-kit)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'open-2', title: 'Open 2', status: 0, priority: 2, timeSpentSeconds: 0, custom: {} },
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'wait-2', title: 'Waiting 2', status: 2, priority: 2, timeSpentSeconds: 0, custom: {} },
    ]);
  });

  test('drag task from Open to Progress', async ({ page }) => {
    const taskCard = page.locator('.task-wrapper[data-task-id="open-1"]');
    const progressList = page.locator('#column-progress-list');

    await expect(taskCard).toBeVisible();
    await pointerDrag(page, taskCard, progressList);

    // Task appears in Progress
    const taskInProgress = progressList.locator('.task-wrapper[data-task-id="open-1"]');
    await expect(taskInProgress).toBeVisible({ timeout: 5000 });
    await expect(taskInProgress).toHaveCount(1);

    // No longer in Open
    await expect(page.locator('#column-open-list .task-wrapper[data-task-id="open-1"]')).toHaveCount(0);

    // After drop, board should reflect progress state
  });

  test('drag task from Open to Waiting', async ({ page }) => {
    const taskCard = page.locator('.task-wrapper[data-task-id="open-1"]');
    const waitingList = page.locator('#column-waiting-list');

    await pointerDrag(page, taskCard, waitingList);

    const taskInWaiting = waitingList.locator('.task-wrapper[data-task-id="open-1"]');
    await expect(taskInWaiting).toBeVisible({ timeout: 5000 });
    await expect(taskInWaiting).toHaveCount(1);
    await expect(page.locator('#column-open-list .task-wrapper[data-task-id="open-1"]')).toHaveCount(0);
  });
});

/**
 * Starts a drag from source and moves to the .column-drop-zone of target without releasing.
 * Returns a cleanup function that releases the mouse (drops).
 */
async function pointerDragHold(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<() => Promise<void>> {
  const sourceBox = (await source.boundingBox())!;
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
  await page.waitForTimeout(300);

  const dropZone = target.locator('.column-drop-zone');
  const dzBox = (await dropZone.boundingBox())!;
  const tx = dzBox.x + dzBox.width / 2;
  const ty = dzBox.y + dzBox.height / 2;

  await page.mouse.move(tx, ty, { steps: 40 });
  await page.waitForTimeout(300);

  return async () => {
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
}

test.describe('Ghost placeholder on empty column drop zone', () => {
  test('ghost appears in empty column while dragging over it', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');
    await expect(source).toBeVisible();

    const drop = await pointerDragHold(page, source, page.locator('#column-waiting-list'));

    // Exactly one ghost is rendered — inside the waiting column
    const ghost = page.locator('#column-waiting .column-drop-zone__ghost');
    await expect(ghost).toHaveCount(1);
    // No ghost in any other column
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(1);
    // Source slot still exists in DOM (layout preserved)
    await expect(page.locator('.task-wrapper.kando-dnd-dragged')).toHaveCount(1);

    await drop();
  });

  test('ghost appears in empty Open column while dragging over it', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="wait-1"]');
    await expect(source).toBeVisible();

    const drop = await pointerDragHold(page, source, page.locator('#column-open-list'));

    // Exactly one ghost is rendered — inside the Open column (status 0)
    const ghost = page.locator('#column-open .column-drop-zone__ghost');
    await expect(ghost).toHaveCount(1);
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(1);
    await expect(page.locator('.task-wrapper.kando-dnd-dragged')).toHaveCount(1);

    await drop();
  });

  test('no drop-zone ghost when hovering over a sortable task in a non-empty column', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');
    await expect(source).toBeVisible();

    // Drag source to the sortable task card in Waiting (not the drop zone area)
    const waitingTask = page.locator('.task-wrapper[data-task-id="wait-1"]');
    const sourceBox = (await source.boundingBox())!;
    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
    await page.waitForTimeout(300);

    const taskBox = (await waitingTask.boundingBox())!;
    const tx = taskBox.x + taskBox.width / 2;
    const ty = taskBox.y + taskBox.height / 2;
    await page.mouse.move(tx, ty, { steps: 40 });
    await page.waitForTimeout(300);

    // No drop-zone ghost while hovering a sortable item (sortable handles the ghost)
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(0);

    await page.mouse.up();
    await page.waitForTimeout(300);
  });

  test('no drop-zone ghost when hovering the bottom area of a non-empty column', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');

    // pointerDragHold moves to the #column-waiting-list area
    const drop = await pointerDragHold(page, source, page.locator('#column-waiting-list'));

    // ColumnDropZone ghost does NOT appear — sortable's .kando-dnd-dragged element
    // physically moves to the target position and provides the insertion feedback.
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(0);

    await drop();
  });

  test('ghost disappears after drop', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');
    const drop = await pointerDragHold(page, source, page.locator('#column-waiting-list'));

    // Ghost is visible during drag
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(1);

    await drop();

    // Ghost is gone after drop
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(0);
  });
});

test.describe('Drag and Drop Cross-Column (Deterministic)', () => {
  // One test per target column (#544): the three drags differ only in where the card lands
  for (const target of [
    { name: 'Open (empty target)', list: 'open' },
    { name: 'Progress (empty target)', list: 'progress' },
    { name: 'Done', list: 'done' },
  ] as const) {
    test(`drag from Waiting to ${target.name}`, async ({ page, baseURL }) => {
      await seedBoard(page, baseURL, [
        { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
      ]);

      const source = page.locator('.task-wrapper[data-task-id="wait-1"]');
      await expect(source).toBeVisible();

      await pointerDrag(page, source, page.locator(`#column-${target.list}-list`));

      await expect(page.locator(`#column-${target.list}-list .task-wrapper[data-task-id="wait-1"]`)).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#column-waiting-list .task-wrapper[data-task-id="wait-1"]')).toHaveCount(0);
    });
  }

  test('drag same card back to previous column', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const openList = page.locator('#column-open-list');
    const waitingList = page.locator('#column-waiting-list');

    // Open -> Waiting
    await pointerDrag(page, page.locator('.task-wrapper[data-task-id="open-1"]'), waitingList);
    await expect(waitingList.locator('.task-wrapper[data-task-id="open-1"]')).toBeVisible({ timeout: 5000 });
    await expect(openList.locator('.task-wrapper[data-task-id="open-1"]')).toHaveCount(0);

    // Waiting -> Open
    await pointerDrag(page, page.locator('.task-wrapper[data-task-id="open-1"]'), openList);
    await expect(openList.locator('.task-wrapper[data-task-id="open-1"]')).toBeVisible({ timeout: 5000 });
    await expect(waitingList.locator('.task-wrapper[data-task-id="open-1"]')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ghost / placeholder visual reliability tests
// These nail down the STRs for ghost placeholder behavior during drag:
//  A. Source placeholder (kando-dnd-dragged) renders correctly in source column
//  B. Source ghost becomes transparent when hovering an empty target column
//  C. Source ghost restores when moving from empty → non-empty hover target
//  D. Target ghost appears in the bottom area (ColumnDropZone) of any column
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts a drag from source and moves to a specific pixel target without releasing.
 * Returns a cleanup function that drops.
 */
async function pointerDragHoldTo(
  page: Page,
  source: Locator,
  targetX: number,
  targetY: number,
): Promise<() => Promise<void>> {
  const sourceBox = (await source.boundingBox())!;
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
  await page.waitForTimeout(300);
  await page.mouse.move(targetX, targetY, { steps: 40 });
  await page.waitForTimeout(300);

  return async () => {
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
}

test.describe('Ghost / Placeholder Reliability', () => {
  /**
   * Scenario A: Ghost placeholder in destination column during cross-column drag (non-empty → non-empty).
   * When dragging from Open and hovering over a sortable task in Waiting, dnd-kit's clone
   * feedback physically moves the element to the destination column and marks it with
   * kando-dnd-dragged. The source column (Open) no longer holds the element.
   */
  test('ghost placeholder appears in destination column when hovering a sortable task', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'open-2', title: 'Open 2', status: 0, priority: 2, timeSpentSeconds: 0, custom: {} },
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');
    const waitingTask = page.locator('.task-wrapper[data-task-id="wait-1"]');
    await expect(source).toBeVisible();
    await expect(waitingTask).toBeVisible();

    // Drag open-1 and hover directly over the upper half of the waiting task card.
    // Using the upper half ensures open-1 is inserted BEFORE wait-1 (pointer above midpoint),
    // so open-1 is at index 0 (not the last item) and the "end of column" logic doesn't trigger.
    const taskBox = (await waitingTask.boundingBox())!;
    const drop = await pointerDragHoldTo(
      page, source,
      taskBox.x + taskBox.width / 2,
      taskBox.y + taskBox.height * 0.25,  // upper quarter — insert before wait-1
    );

    // dnd-kit clone feedback moves the element to the destination — ghost should be in Waiting list
    await expect(page.locator('#column-waiting-list .task-wrapper.kando-dnd-dragged')).toHaveCount(1);
    // Source column no longer holds the element (it moved to destination)
    await expect(page.locator('#column-open-list .task-wrapper.kando-dnd-dragged')).toHaveCount(0);

    await drop();
  });

  /**
   * Scenario B: Target ghost visible when hovering empty target column.
   * When hovering the ColumnDropZone of an empty column, the ghost placeholder appears
   * and the source wrapper remains in the source column (dnd-kit clone feedback).
   */
  test('target ghost visible when hovering empty column', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');
    await expect(source).toBeVisible();

    // Hover over the Waiting column drop zone (Waiting is empty)
    const drop = await pointerDragHold(page, source, page.locator('#column-waiting-list'));

    // Target ghost should appear in empty Waiting column
    await expect(page.locator('#column-waiting .column-drop-zone__ghost')).toHaveCount(1);
    // Source wrapper still exists in DOM (layout preserved)
    await expect(page.locator('#column-open-list .task-wrapper.kando-dnd-dragged')).toHaveCount(1);

    await drop();
  });

  /**
   * Scenario C: Ghost appears in empty column and disappears when moving to non-empty column.
   * After hovering Open (empty) and seeing the ghost, moving to Done (which has a task)
   * should hide the ghost from Open and show no ColumnDropZone ghost (sortable handles it).
   */
  test('ghost appears in empty column then disappears when moving to non-empty column', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'done-1', title: 'Done 1', status: 3, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="wait-1"]');
    const doneTask = page.locator('.task-wrapper[data-task-id="done-1"]');
    await expect(source).toBeVisible();
    await expect(doneTask).toBeVisible();

    const sourceBox = (await source.boundingBox())!;
    const sx = sourceBox.x + sourceBox.width / 2;
    const sy = sourceBox.y + sourceBox.height / 2;

    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
    await page.waitForTimeout(300);

    // Step 1: hover over Open column drop zone (Open is empty — wait-1 is in Waiting)
    const openDropZone = page.locator('#column-open-list .column-drop-zone');
    const dzBox = (await openDropZone.boundingBox())!;
    await page.mouse.move(dzBox.x + dzBox.width / 2, dzBox.y + dzBox.height / 2, { steps: 30 });
    await page.waitForTimeout(300);

    // Ghost should appear in empty Open column
    await expect(page.locator('#column-open .column-drop-zone__ghost')).toHaveCount(1);

    // Step 2: now move to the Done task card (a sortable item in a non-empty column)
    const doneBox = (await doneTask.boundingBox())!;
    await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2, { steps: 30 });
    await page.waitForTimeout(300);

    // ColumnDropZone ghost should be gone — sortable handles the insertion preview
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(0);

    await page.mouse.up();
    await page.waitForTimeout(300);
  });

  /**
   * Scenario D: Sortable insertion feedback visible in non-empty column.
   * The .kando-dnd-dragged element moves physically into the target column and
   * is visible (muted-gray box) — no ColumnDropZone ghost needed. ColumnDropZone
   * only provides a ghost for truly empty columns.
   */
  test('sortable insertion placeholder visible in destination non-empty column', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');
    await expect(source).toBeVisible();

    const waitingTask = page.locator('.task-wrapper[data-task-id="wait-1"]');
    const taskBox = (await waitingTask.boundingBox())!;
    const drop = await pointerDragHoldTo(
      page, source,
      taskBox.x + taskBox.width / 2,
      taskBox.y + taskBox.height * 0.25, // upper quarter — insert before wait-1
    );

    // The dragged element's .kando-dnd-dragged clone is now in the Waiting list
    await expect(page.locator('#column-waiting-list .task-wrapper.kando-dnd-dragged')).toHaveCount(1);
    // No ColumnDropZone ghost — sortable handles insertion feedback
    await expect(page.locator('.column-drop-zone__ghost')).toHaveCount(0);

    await drop();
  });

  /**
   * Scenario E: After drop, no stale kando-dnd-dragged marker remains anywhere on the board.
   */
  test('no stale source placeholder after completed cross-column drop', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'wait-1', title: 'Waiting 1', status: 2, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);

    const source = page.locator('.task-wrapper[data-task-id="open-1"]');
    await pointerDrag(page, source, page.locator('#column-waiting-list'));

    // After drop completes, no kando-dnd-dragged should remain
    await expect(page.locator('.kando-dnd-dragged')).toHaveCount(0);
    // Board dragging class should be gone
    await expect(page.locator('.board.dragging')).toHaveCount(0);
  });
});

test.describe('WIP limit on drop (Jetzt holds one task)', () => {
  test('dropping on an occupied Jetzt column keeps the card where it was', async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, [
      { id: 'open-1', title: 'Open 1', status: 0, priority: 1, timeSpentSeconds: 0, custom: {} },
      { id: 'prog-1', title: 'Progress 1', status: 1, priority: 1, timeSpentSeconds: 0, custom: {} },
    ]);
    const card = page.locator('.task-wrapper[data-task-id="open-1"]');
    const occupant = page.locator('#column-progress-list .task-wrapper[data-task-id="prog-1"]');
    await expect(occupant).toBeVisible();

    const box = (await card.boundingBox())!;
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.move(sx + 10, sy + 10, { steps: 3 });
    await page.waitForTimeout(300);
    const ob = (await occupant.boundingBox())!;
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2, { steps: 40 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(400);

    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(1);
    await expect(page.locator('#column-open-list .task-wrapper[data-task-id="open-1"]')).toHaveCount(1);
  });
});
