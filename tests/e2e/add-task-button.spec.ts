import { test, expect } from '@playwright/test';
import { seedLocalBoard } from './helpers/seed';

test.describe('Add Task Button Visibility', () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    // One task in Open to verify positioning. Seeded before page JS runs (no goto + evaluate + reload, #512).
    await seedLocalBoard(context, [
      { id: 'task-1', title: 'Existing Task', status: 0, priority: 0, timeSpentSeconds: 0, timeBoxSeconds: null, custom: {} },
    ]);
    await page.goto(baseURL!);
    await expect(page.locator('#column-open .task-wrapper').first()).toBeVisible();
    await page.mouse.move(0, 0);
    // Also try moving to bottom right to be safe
    const viewport = page.viewportSize();
    if (viewport) {
        await page.mouse.move(viewport.width - 10, viewport.height - 10);
    }
  });

  test('Open column button is persistent (no hover needed)', async ({ page }) => {
    const openColumn = page.locator('#column-open');
    const addButton = openColumn.locator('.add-task-button');

    // Mouse is parked away from the column: the button is still fully visible.
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveCSS('opacity', '1');
    await expect(addButton).toContainText('Aufgabe hinzufügen');

    // Its card-sized slot (#125) lives inside the task list, below the existing card.
    await expect(addButton.locator('..')).toHaveClass(/add-task-slot/);
    await expect(addButton.locator('../..')).toHaveClass(/task-list/);
  });

  test('Progress column button behavior (when empty)', async ({ page }) => {
    const progressColumn = page.locator('#column-progress');
    // Ensure it's empty (our seed only put a task in Open)
    
    const addButton = progressColumn.locator('.add-task-button');
    
    // 1. Verify button exists but is not visible at rest (pointer device)
    await expect(addButton).toHaveCSS('opacity', '0');

    // 2. Hovering anywhere in the Jetzt section (here: the corner of the content area) reveals it (#125)
    await progressColumn.locator('.progress-column-content-wrapper').hover({ position: { x: 10, y: 10 } });

    // 3. Verify button becomes visible
    await expect(addButton).toHaveCSS('opacity', '1');
  });

  test('Progress column button should be hidden during drag', async ({ page }) => {
    const openTask = page.locator('#column-open .task-wrapper').first();
    const progressColumn = page.locator('#column-progress');
    const addButton = progressColumn.locator('.add-task-button');

    // 1. Verify initial state: Button exists (v-if="isEmpty && !isDragging")
    // Initially not dragging, and empty -> v-if=true.
    await expect(addButton).toBeAttached();
    
    // 2. Start Dragging a task from Open
    const taskBox = (await openTask.boundingBox())!;
    const targetBox = (await progressColumn.boundingBox())!;

    await page.mouse.move(taskBox.x + taskBox.width / 2, taskBox.y + taskBox.height / 2);
    await page.mouse.down();
    
    // Move to trigger drag start
    await page.mouse.move(taskBox.x + taskBox.width / 2 + 10, taskBox.y + taskBox.height / 2 + 10, { steps: 5 });
    
    // Move over progress column
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
    
    // Wait for Vue to react to isDragging prop
    await page.waitForTimeout(100);

    // 3. Assert: Button should be removed from DOM (v-if becomes false)
    await expect(addButton).not.toBeAttached();

    // 4. Drop to finish interaction
    await page.mouse.up();
  });

  test('Open column drop zone expands and the add slot hides (keeping its box) during drag', async ({ page }) => {
    const openColumn = page.locator('#column-open');
    const taskList = openColumn.locator('.task-list');
    const addButton = openColumn.locator('.add-task-button');
    const task = openColumn.locator('.task-wrapper').first(); // Assumes at least one task from seed

    // 1. Initial State
    // Button should be attached (v-if is true)
    await expect(addButton).toBeAttached();
    // Task list should NOT have flex-1 initially (compact mode)
    await expect(taskList).not.toHaveClass(/flex-1/);

    // 2. Start Dragging a task
    const taskBox = (await task.boundingBox())!;
    // Move to center of task
    await page.mouse.move(taskBox.x + taskBox.width / 2, taskBox.y + taskBox.height / 2);
    await page.mouse.down();
    
    // Move to trigger drag start
    await page.mouse.move(taskBox.x + taskBox.width / 2 + 10, taskBox.y + taskBox.height / 2 + 10, { steps: 5 });
    
    // Wait for Vue to react
    await page.waitForTimeout(100);

    // 3. Verify Dragging State
    // Task list SHOULD have flex-1 now (expanded drop zone)
    await expect(taskList).toHaveClass(/flex-1/);
    
    // Add slot stays in the DOM but is hidden, so collision rects do not shift (#125)
    await expect(addButton).toBeAttached();
    await expect(addButton).toBeHidden();

    // 4. End Drag
    await page.mouse.up();

    // 5. Verify Post-Drag State
    // Wait for state reset
    await page.waitForTimeout(100);
    
    // Button should return
    await expect(addButton).toBeVisible();
    // Task list should revert to compact (no flex-1)
    await expect(taskList).not.toHaveClass(/flex-1/);
  });
});
