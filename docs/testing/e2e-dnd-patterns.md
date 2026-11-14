# E2E Drag and Drop Testing Guide

This guide documents the proven patterns for testing Drag and Drop (DnD) functionality in this application, specifically for the Board component which uses `@dnd-kit/vue` (see [ADR 004](../adr/004-dnd-kit-migration.md) and the project rule `.claude/rules/drag-and-drop.md`).

## Core Strategy

### 1. Avoid `dragTo`

The built-in `locator.dragTo()` method can be unreliable with complex DnD libraries. Prefer the manual mouse pattern below when you see flaky behavior.

### 2. Manual Mouse Event Simulation

Use the `page.mouse` API to simulate distinct steps of a user dragging an item. This ensures all event listeners (mousedown, dragstart, dragover, drop) fire in the correct order.

**Pattern:**

```typescript
const dragAndDrop = async (page: Page, source: Locator, target: Locator) => {
  const sourceBox = (await source.boundingBox())!;
  const targetBox = (await target.boundingBox())!;

  // 1. Move to source center
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  
  // 2. Mouse down and wait for library to register press
  await page.mouse.down();
  await page.waitForTimeout(100);

  // 3. Small move to trigger drag start (overcomes "click" threshold)
  // This helps ensure the browser and the DnD library treat the interaction as a drag
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });

  // 4. Move to target with steps (simulation of movement triggers dragover events)
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
  
  // 5. Wait for drop target activation (hover state)
  await page.waitForTimeout(100);
  
  // 6. Release
  await page.mouse.up();
};
```

### 2a. Shared helpers: `tests/e2e/helpers/dnd.ts`

Specs do not copy the pattern; they import `pickUp`, `hover`, `finger` and `edgeDwell` from `helpers/dnd.ts` (ESLint rejects a local declaration of those names in a spec, #419). They wait on drag state, never on a guessed duration, so a loaded machine only makes them slower:

- `pickUp(page, source)`: first `dropSettled(page)`, then press, move past the activation distance, return once `.board.dragging`, the `.kando-dnd-preview` overlay and one `.kando-dnd-dragged` placeholder exist.
- `dropSettled(page)`: resolves once the previous drop has settled: no `.board.dragging`, no `.task--confirming` (the 1.3 s in-card confirmation after a drop into Erledigt (2.2 s with the faster-than-planned message, #295)) and no running finite animation (the drop's own motion, transitions included; the timebox nudge's countdown is not counted). A press during any of these silently does not start a drag, which is why `pickUp` waits for it itself: a drop followed at once by a pick-up needs no `settleAnimations` or sleep in the spec (#408). Do not call it mid-drag.
- `finger(cdp, page)`: the touch counterpart, one finger as real `Input.dispatchTouchEvent` calls (`start`, `moveTo`, `end`). `start` runs `dropSettled` first; specs import it instead of declaring their own.
- `hover(page, target, { fromTop? })`: move onto the target's centre (or `fromTop` px below its top edge) and return once the target's column carries `.dragover`. Assert the state you expect afterwards with `expect` / `expect.poll`; a negative assertion ("no ghost") is only meaningful after this positive signal.
- `showColumnPage(page, 0|1|2)` (390px): real touch swipes to a column page (the tabs are gone, #470); `activeColumnPage(page)` reads `data-mobile-page`.
- `edgeDwell(page, 'left' | 'right')` (390px): dwell in the edge zone for `EDGE_HOLD_DWELL_MS` (`helpers/constants.ts`, derived from `EDGE_HOLD_MS` in `Board.vue` with margin, pinned by `tests/e2e-constants/edge-hold.test.ts`), wait for `data-mobile-page` on `.board` to name the neighbouring page (`activeColumnPage`), then return the pointer to the middle. The dwell is the only fixed sleep (via `dwell()`).

A sibling spec that needs a variation (a different pickup point, say) extends the helper instead of forking it.

### 3. Selector Specificity

Always target the exact draggable element container. In our case, tasks are wrapped in `.task-wrapper`.

- **Bad:** `page.locator('[data-task-id="1"]')` (Might match inner card or other elements)
- **Good:** `page.locator('.task-wrapper[data-task-id="1"]')`

### 4. Stack expand/collapse motion (#197)

Expanding or collapsing a stack plays a 220 ms visual beat; the DOM is already final. While it runs the column's `.task-list` carries `data-stack-animating="expand|collapse"`. Call `settleAnimations(page)` (`helpers/settle.ts`) *after* the triggering action, before reading coordinates; assert the attribute is gone for a deterministic end state. Do not call it mid-drag (a paused finite animation never finishes). A `pointerdown` cancels the beat, so a drag that starts right after an expand needs no wait. To assert mid-motion geometry, pause every script animation (skip `CSSTransition`/`CSSAnimation`) and set `currentTime` to `0` (or `endTime - 1`), then compare the *card* rect (`.task`, not its wider `.task-wrapper`) with the collapsed face rect; see `stack-motion.spec.ts` "frame 0".
