/**
 * Reproduces and diagnoses the "double placeholder" drag-and-drop bug:
 * When dragging a card from Open into an empty Progress column, two grey
 * placeholder shapes appear simultaneously — the source card placeholder in
 * Open stays visible while the ColumnDropZone ghost appears in Progress.
 *
 * Scenario:
 * 1. Board starts with one task in Progress, two in Open.
 * 2. Drag the Progress task back to Open → Progress is now empty.
 * 3. Drag an Open task toward empty Progress → check mid-drag state.
 *
 * Expected (fixed):  sourceBg === transparent, only ghost in Progress.
 * Before fix:        sourceBg === grey, ghost in Progress → double placeholder.
 */

import { test, expect, type Page, type Locator } from '@playwright/test'
import { seedLocalBoard, type SeedTask as BoardSeedTask } from './helpers/seed'

// ── Seed helpers ─────────────────────────────────────────────────────────────

type SeedTask = { id: string; title: string; status: number; priority: number; timeSpentSeconds: number; custom: Record<string, unknown> }

async function seedBoard(page: Page, baseURL: string | undefined, tasks: SeedTask[]) {
  const base = baseURL || 'http://localhost:3000'
  // addInitScript seeds before page JS runs; no goto + evaluate + reload (#512)
  await seedLocalBoard(page.context(), tasks.map(t => ({ timeBoxSeconds: null, ...t })) as BoardSeedTask[])
  await page.goto(`${base}/tasks`)
  await expect(page.locator('#column-open-list')).toBeVisible()
}

// ── Drag helper ───────────────────────────────────────────────────────────────

async function pointerDrag(page: Page, source: Locator, target: Locator) {
  const srcBox = (await source.boundingBox())!
  const tgtBox = (await target.boundingBox())!
  const sx = srcBox.x + srcBox.width / 2
  const sy = srcBox.y + srcBox.height / 2
  const tx = tgtBox.x + tgtBox.width / 2
  const ty = tgtBox.y + tgtBox.height / 2

  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.waitForTimeout(300)

  const steps = 30
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + (tx - sx) * i / steps, sy + (ty - sy) * i / steps)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(500)
}

// ── Mid-drag state capture (mouse stays DOWN) ─────────────────────────────────

async function startDragToTarget(page: Page, source: Locator, target: Locator) {
  const srcBox = (await source.boundingBox())!
  const tgtBox = (await target.boundingBox())!
  const sx = srcBox.x + srcBox.width / 2
  const sy = srcBox.y + srcBox.height / 2
  const tx = tgtBox.x + tgtBox.width / 2
  const ty = tgtBox.y + tgtBox.height / 2

  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.waitForTimeout(300)

  const steps = 30
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + (tx - sx) * i / steps, sy + (ty - sy) * i / steps)
    await page.waitForTimeout(16)
  }
  // Hold — caller reads state, then calls page.mouse.up()
  await page.waitForTimeout(400)
}

// ── Diagnostic helper ─────────────────────────────────────────────────────────

async function captureDragState(page: Page) {
  return page.evaluate(() => {
    const dragged = document.querySelector('.task-wrapper.kando-dnd-dragged .task') as HTMLElement | null
    const draggedStyle = dragged ? window.getComputedStyle(dragged) : null
    const board = document.querySelector('.board')

    return {
      // Source placeholder: is it in Open? (stays there when target is empty)
      draggedInOpen:     document.querySelectorAll('#column-open-list .task-wrapper.kando-dnd-dragged').length,
      draggedInProgress: document.querySelectorAll('#column-progress-list .task-wrapper.kando-dnd-dragged').length,

      // ColumnDropZone ghost in Progress (shows when empty column is active target)
      ghostInProgress:   document.querySelectorAll('#column-progress-list .column-drop-zone__ghost').length,

      // Computed background of the source placeholder — should be transparent if fix is active
      sourcePlaceholderBg: draggedStyle?.backgroundColor ?? null,

      // Board classes — 'hover-target-is-empty' was the old JS approach (now removed)
      boardClasses: board?.className ?? '',
    }
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const TASKS: SeedTask[] = [
  { id: 'open-1', title: 'Aufgabe Open 1', status: 0, priority: 0, timeSpentSeconds: 0, custom: {} },
  { id: 'open-2', title: 'Aufgabe Open 2', status: 0, priority: 0, timeSpentSeconds: 0, custom: {} },
  { id: 'prog-1', title: 'Aufgabe In Arbeit', status: 1, priority: 0, timeSpentSeconds: 0, custom: {} },
]

test.describe('DnD double-placeholder bug', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await seedBoard(page, baseURL, TASKS)
  })

  test('dragging from Open to an initially-empty Progress shows no double placeholder', async ({ page }) => {
    // Step 1: Move the Progress task back to Open to empty Progress
    const progressCard = page.locator('#column-progress-list .task-wrapper').first()
    const openList     = page.locator('#column-open-list')
    await pointerDrag(page, progressCard, openList)

    // Verify Progress is empty
    await expect(page.locator('#column-progress-list .task-wrapper')).toHaveCount(0)

    // Step 2: Start drag from Open toward empty Progress — capture mid-drag state
    const openCard    = page.locator('#column-open-list .task-wrapper').first()
    const progressDropZone = page.locator('#column-progress-list')
    await startDragToTarget(page, openCard, progressDropZone)

    const state = await captureDragState(page)
    console.log('Mid-drag state:', JSON.stringify(state, null, 2))

    // Ghost must appear in the empty target column
    expect(state.ghostInProgress, 'ghost should appear in empty Progress').toBe(1)

    // Source placeholder must be invisible (transparent background)
    expect(
      state.sourcePlaceholderBg,
      'source placeholder background must be transparent (not grey) — double-placeholder bug'
    ).toBe('rgba(0, 0, 0, 0)')

    // At most one visible placeholder total (ghost in Progress, source invisible)
    const doubleVisible = state.draggedInOpen > 0 && state.ghostInProgress > 0 &&
      state.sourcePlaceholderBg !== 'rgba(0, 0, 0, 0)'
    expect(doubleVisible, 'should NOT show two visible grey placeholders simultaneously').toBe(false)

    await page.mouse.up()
  })

  test('dragging within a non-empty column shows single placeholder (regression)', async ({ page }) => {
    // Open has 2 tasks — drag first one below the second
    const firstCard  = page.locator('#column-open-list .task-wrapper').nth(0)
    const secondCard = page.locator('#column-open-list .task-wrapper').nth(1)
    await startDragToTarget(page, firstCard, secondCard)

    const state = await captureDragState(page)
    console.log('Same-column drag state:', JSON.stringify(state, null, 2))

    // No ghost (not hovering an empty column)
    expect(state.ghostInProgress, 'no ghost when target is non-empty').toBe(0)
    // Source placeholder present somewhere (normal reorder feedback)
    expect(state.draggedInOpen + state.draggedInProgress, 'dragged element should exist in DOM').toBeGreaterThan(0)

    await page.mouse.up()
  })
})
