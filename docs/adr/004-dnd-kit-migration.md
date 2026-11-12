# ADR: Migration from FormKit DnD to @dnd-kit/vue

**Status:** Completed  
**Date:** 2025-03-28  
**Authors:** Julius Wüstefeld, Cascade AI Assistant  

## Context

The Kan-Do board used `@formkit/drag-and-drop` for Kanban drag-and-drop functionality. This library relied on native HTML5 drag events which caused issues with:

- Pointer event handling in specific column layouts (Progress column overflow)
- Inconsistent visual placeholder positioning
- Limited control over collision detection (WIP limit enforcement)

We migrated to `@dnd-kit/vue` which uses PointerSensor by default and provides Reactivity-first APIs better aligned with Vue 3 Composition API patterns.

## Decisions

### 1. DragOverlay vs Native Drag Image

**Decision:** Use `@dnd-kit/vue`'s `<DragOverlay>` component for custom drag previews instead of `setDragImage` or cloning DOM elements.

**Rationale:**

- Renderless overlay allows Vue-controlled styling during drag
- Better performance (single moving element, not repainting source)  
- Consistent with dnd-kit best practices

### 2. Reactive Watchers vs Custom Events

**Decision:** Replace `kando:dnd-start` / `kando:dnd-end` custom event dispatches with reactive watchers on `useBoardDragState().isDragging`.

**Rationale:**

- Eliminates race conditions between DOM events and Vue reactivity
- `Board.vue`, `TaskStack.vue`, and `useCelebration.ts` now watch `dragState.isDragging` directly
- Cleaner dependency graph (no window event listeners for internal state)

### 3. Per-Item Sortable Registration

**Decision:** Each task card registers individually with `useSortable()` via `SortableTaskWrapper.vue`.

**Rationale:**

- Aligns with dnd-kit's composable-first design
- Enables fine-grained reactivity (individual `isDragging` states)
- Allows mixing sortable and non-sortable items in same column

### 4. Legacy CSS Cleanup

**Decision:** Remove `#column-progress { pointer-events: none }` and related pointer-events hacks.

**Rationale:**

- dnd-kit's PointerSensor works correctly with standard DOM stacking
- FormKit required these workarounds for its collision detection
- Simplifies styling and removes visual artifacts

### 5. Collapsed stacks are sortables (#150)

**Decision:** A collapsed stack (`TaskStack.vue`) registers as ONE sortable through `useColumnSortable`. Its id is the **front task's id** (that card is inert and not a sortable, so the id is unique) and its `data.stack` carries `{ key, label, taskIds }`. The stack root is the sortable element (it includes the caption), the keyboard control is its `handle`. `getRenderedTaskOrder.draggableIds` lists a collapsed stack by its front task, so sortable indices stay dense (the expanded header row consumes none).

- **Block move.** `useBoardDndKit` snapshots the members in `onDragStart` and moves them as one contiguous block in `onDragEnd`: `saveRenderedOrder` takes `taskIds[]`, removes them, places the block at the previewed slot, and grouping decides the rest. Members that no longer exist or left the source column are skipped; nothing left is a no-op. Status changes run through `useTaskSync().updateTaskStatuses` (all members change locally at once, upstream writes one after another, a failing write does not stop the others).
- **Jetzt is always refused**, empty or not: `checkWipMove` takes a `taskCount`, a block of 2+ never fits (`stackTooLarge`). The refusal is the same path as a card over the WIP limit (`onDragOver` `preventDefault`, `isDropBlocked`, no placeholder, snap-back, no toast); `ColumnDropZone` hides its ghost while a drop is blocked. `onDragEnd` re-checks it. (Since kd#162 a single card from Offen or Wartet over a Jetzt that holds one task is no longer refused: the running card shows the swap state and the drop swaps the two, `useTaskSwap`; a block of 2+ and a card from Erledigt stay refused as described here.)
- **Erledigt: one undo toast for the whole stack**, a deliberate exception to #136 (no toast on the drag path): after a merge the reverse drag would also move tasks that were done before. `useCompletionUndo` has a multi-snapshot variant (`captureCompletionSnapshots`, `notifyCompletedBlock`, `undoCompletions`, restore in ascending previous index). Every moved card still gets `startConfirmation`; the collapsed stack's front card plays the layer. Dragging a stack out of Erledigt is a plain block move without a toast.
- **Preview and placeholder.** `DragOverlay` renders `TaskStack` in `preview` mode (the collapsed face as it rests: front card, peek layers, caption; no control, no sortable). The source keeps the stack's footprint as one grey slot (`.task-stack.kando-dnd-dragged`: front card greyed, layers and caption invisible).
- **Keyboard.** Space picks the stack up (arrows move, Space drops, Esc cancels), Enter expands; this replaced #147's "Space expands". Role description, instructions and the pick-up announcement are stack-specific (`board.dnd.stack*`, `pickedUpStack`).
- **Mouse.** dnd-kit starts a mouse drag on a *handle* without any activation constraint, which would turn every click on the control into a drag. `useBoardAnnouncements().sensors` gives a stack the constraints dnd-kit uses for a drag off the handle (read from `PointerSensor.defaults`, not copied) whenever the defaults would return none, so a click still expands. Touch and pen already get a constraint from the defaults.
- **Declarative expansion (#147).** A group of 2+ is a collapsed `TaskStack` until `useStackExpansion` (in-memory, per column and group key) expands it; `BoardColumn` then renders a header row and the members as ordinary `SortableTaskWrapper` cards (`data-from-stack`). `getRenderedTaskOrder`, `draggableIndexById` and `saveRenderedOrder` all take the expanded keys, so sortable indices stay dense (a collapsed stack counts once, the header row not at all). `buildColumnItems` takes each item's `sortableIndex` from that same order; an id missing from it warns in dev and goes past the end instead of colliding with index 0.
- **Event-scoped gesture guards (#154).** No stack guard uses a timer. The click that ends a drag is the first click event after `isDragging` turns false, matched by event identity (`TaskStack` passes its `MouseEvent` to `expand`, so the stack's handler and the document listener agree) and cleared by the next `pointerdown`/`keyup`; the Escape that cancels a keyboard drag is the keydown that arrived while the drag ran. A pointer expand arms a flag in `useStackExpansion` that blocks a card open only for `click.detail >= 2` (the rest of the double-click or double-tap) until a `mousedown` with `detail < 2` starts a new sequence; keyboard expands never arm it.
- **Opening a card is a single click (kd#25, supersedes #111's desktop rule).** Until kd#25 a desktop click on a card was ignored and only a double-click (or Enter, as a synthetic `dblclick`) opened the sheet; touch already opened on tap. Now every pointer opens on `click`: `TaskCard` has one open handler, `dblclick` is gone, and Enter dispatches a non-bubbling `click` (`detail` 0) on the card, so the board's outside-click listeners never see a key press. The guards above are unchanged and now read the click: a card in a collapsed stack never opens (`data-stack-index`), `shouldBlockModal` blocks the second click of the sequence that expanded a stack, and a collapsed stack still expands on click. A drag release opens nothing for two reasons: dnd-kit captures the pointer on `body` and swallows the click that follows a started drag (`suppressClick`; E2E counts the clicks that reach a card after each release and expects none), and `TaskCard` ignores a click while `isDragging`. A double-click opens once because a click on the card whose sheet is already open (`spotlightTaskId`) does nothing; the sheet is a side drawer and the card stays under the pointer. Hover: cards lift to `--shadow-task-hover` under `@media (hover: hover)`, never inside a stack, on a trash entry, on the add-sheet draft or while dragging.
- **Assistive-tech layer (#154).** The stack control is named "<front title>, <group>, <n> tasks" (label in name, WCAG 2.5.3); members of an expanded group carry a hidden "n of m in <group>" description; the header row is a labelled `role="group"`; the live region hint differs by input (Esc for keyboard, "Use Close" for pointer and touch). Expansion survives a mobile tab switch, because the edge-scroll switch happens mid-drag.
- **Expand/collapse motion (#197).** Visual only: the state change is instant and final, nothing waits for an animation, and `useStackExpansion`, `TaskStack` and `BoardColumnItem` are untouched. `useStackMotion` (Web Animations API) is called by the two gesture paths in `BoardColumn` (`expandStack`, `closeStacks`), never by `prune`, the `collapseAll` watcher, drag end or a tab switch: `capture()` before the state change, `play()` after `nextTick`. Expand animates the real member wrappers out of the collapsed face (FLIP for the items below). Collapse animates `aria-hidden`, `inert`, id-free clones of the members in one layer that is a child of the `.column`, outside `.task-list` (so `list.children`, dnd-kit and `[data-task-id]` locators never see them; not `position: fixed`, the mobile board is transformed). Retained wrappers (`TransitionGroup`) were rejected: a leaving wrapper keeps the front task's sortable id alive next to the new stack. A drag start, a `pointerdown` and unmount cancel every running animation and remove the layer, so dnd-kit never measures a transformed element; no animation starts while dragging or under `prefers-reduced-motion` (read at `capture()` and again at `play()`). `data-stack-animating="expand|collapse"` on the `.task-list` is the E2E hook.
- **Block members at drag start.** `onDragEnd` moves the members snapshotted when the drag began (minus any that were deleted or left the column meanwhile), and the Jetzt check counts that snapshot: a stack picked up as a block of 2+ stays refused even if sync shrinks it to one task mid-drag.
- **Upstream writes.** All members change locally at once; `useTaskSync().updateTaskStatuses` writes upstream one member after another. Status writes are also chained per task (`statusWritesInFlight`), and a write sends the task as it is after its wait, so an undo reaches upstream after the completion it reverts and a task edit made while a write was queued is not overwritten. The sync-merge pin (`lockTaskStatus`) is owned by a token: the newest lock wins and only its owner releases it, so an older write finishing later cannot drop the undo's lock. A rejection that escapes the chain goes through `handleSyncError`, like the single-card path.

**Rejected:** a plain draggable (no landing slot, no keyboard story) and expand-then-multi-drag (dnd-kit has no multi-drag).

## Changes Summary

### Deleted Files

| File | Reason |
|------|--------|
| `composables/useColumnDragAndDrop.ts` | Replaced by `useBoardDndKit.ts` |
| `composables/useBoardDndFormkit.ts` | Empty file, not used |
| `plugins/directives.dnd.ts` | `v-dnd-toggle-dragging` no longer needed (reactive class binding replaces it) |
| `plugins/dnd.client.ts` | Plugin registration removed (directives deleted) |
| `utils/dndConstants.ts` | Dead code, zero imports |
| `tests/plugins/directives.dnd.test.ts` | Tests for deleted directive |

### New Files

| File | Purpose |
|------|---------|
| `composables/useBoardDndKit.ts` | Central dnd-kit event handlers (`dragStart`, `dragOver`, `dragEnd`), WIP limit enforcement, block moves of whole stacks (#150) |
| `composables/useColumnSortable.ts` | Per-item sortable registration for tasks and collapsed stacks (`data`, `handle`) |
| `components/board/SortableTaskWrapper.vue` | Wraps task cards with `useSortable()`, applies `kando-dnd-dragged` class during drag |

### Modified Files

| File | Changes |
|------|---------|
| `nuxt.config.ts` | Removed plugin registrations for deleted `directives.dnd` and `dnd.client` |
| `composables/useBoardDragState.ts` | Removed `sourceColumnEl` dead field from `DragState` interface |
| `components/board/Board.vue` | Replaced `v-dnd-toggle-dragging` directive with reactive `:class="{ dragging: isDragging }"` |
| `components/task/TaskStack.vue` | Replaced `kando:dnd-start/end` event listeners with `watch(() => dragState.isDragging, ...)` |
| `composables/useCelebration.ts` | Same watcher pattern; uses `dragState.sourceStatus` directly instead of DOM attribute lookup |
| `components/board/BoardColumnProgressContent.vue` | Removed `pointer-events: none` from wrapper and child overrides |
| `assets/css/main.css` | Removed `#column-progress { pointer-events: none; overflow: hidden }` and related legacy hacks |
| `tests/composables/useColumnDragAndDrop.test.ts` | Updated mock `dragState` (removed `sourceColumnEl`) |
| `tests/e2e/dnd-sample.spec.ts` | Fixed B→C transfer test: target specific item instead of empty list center |
| `tests/e2e/dnd-visuals.spec.ts` | All tests passing (board `dragging` class, cross-column transfer, reorder) |
| `tests/e2e/task-detail.spec.ts` | Fixed topic/activity select tests: seed options via `tasks-store` `afterRestore` hook instead of broken `propertyOptions` key |
| `tests/e2e/modal-style.spec.ts` | Fixed background color assertion to accept `oklch(0.985 ...)` (actual bg-elevated value) |
| `tests/e2e/stack-cursor-issue.spec.ts` | Skipped 1 test: drag from expanded stack card not wired to dnd-kit (`.task` moved out of `.task-wrapper` by DOM manipulation) |
| `tests/e2e/stack-fast-double-click.spec.ts` | Skipped 1 test: same root cause as above |
| `tests/e2e/done-celebration.spec.ts` | Skipped 1 test: collapsed `TaskStack` has no `SortableTaskWrapper`, dnd-kit never fires `onDragEnd` |
| `.devin/rules/07-performance-and-dnd.md` | Removed stale references to custom event dispatches and `v-dnd-toggle-dragging` |

## Dependencies

**Removed:**

- `@formkit/drag-and-drop` (package not in use anymore)

**Kept:**

- `@formkit/auto-animate` — different package, handles CSS animations (not DnD)

**Added:**

- `@dnd-kit/vue@^0.3.2` — new drag-and-drop library

## Test Results

| Suite | Result |
|-------|--------|
| Unit tests | All passing |
| E2E tests | **77 passed, 3 skipped, 0 failed** |

### Skipped Tests (Known Limitations)

None left. The three specs skipped at migration time are resolved: expanding a stack is declarative (#147, its members are ordinary sortables, both stack specs were rewritten), and a collapsed stack is a sortable itself (#150). `done-celebration.spec.ts` was deleted with the celebration overlay (#124); its successor is the stack-into-Erledigt test in `done-drop.spec.ts` (#150).

## Architectural Impact

### State Flow (New)

1. **Drag start:** `PointerSensor` detects mousedown+move → dnd-kit updates internal state → `onDragStart` updates `useBoardDragState`
2. **During drag:** `OptimisticSortingPlugin` physically moves DOM; reactive `dragState.isDragging` triggers `Board.vue` class, `TaskStack.vue` watcher, `useCelebration.ts` watcher
3. **Drag end:** `onDragEnd` checks `isSortable(source)` → if cross-group, calls `useTaskSync().updateTaskStatus` (one card) or `updateTaskStatuses` (a stack's members) and places the card or block with `saveRenderedOrder` → if same-group, calls `saveRenderedOrder` only
4. **Done confirmation:** When `status === Done`, `boardStore.startConfirmation(id)` flags every dropped card for the in-card confirmation (#124); a dropped stack also gets one undo toast (decision 5)

### Collision Detection

- **Progress column WIP limit:** Enforced in `onDragOver` via `event.preventDefault()` when `tasksProgress.length >= 1`
- **Empty columns:** `ColumnDropZone.vue` provides invisible collision target (no visual styles)

### CSS Hooks

| Class | Applied By | Purpose |
|-------|-----------|---------|
| `.board.dragging` | `Board.vue` reactive `:class` | Dim headers, suppress hover effects |
| `.kando-dnd-dragged` | `SortableTaskWrapper.vue` | Grey placeholder styling on source item |
| `.task-stack.kando-dnd-dragged` | `TaskStack.vue` | One grey slot of the stack's footprint while a collapsed stack is the source (#150) |
| `.kando-dnd-preview` | `DragOverlay` slot content | Visual styling for floating drag card; `.kando-dnd-preview.task-stack` is the collapsed face of a dragged stack |

## Verification Commands

```bash
# Run all E2E tests
npm run test:e2e

# Run specific DnD-related tests
npx playwright test tests/e2e/dnd-sample.spec.ts tests/e2e/dnd-visuals.spec.ts -c tests/e2e/playwright.config.ts --reporter=line

# Run unit tests
npm test
```

## References

- Migration plan: `.devin/plans/dndkit-migration-06d785.md`
- DnD rule file: `.devin/rules/07-performance-and-dnd.md`
- `@dnd-kit/vue` docs: <https://docs.dndkit.com/>
