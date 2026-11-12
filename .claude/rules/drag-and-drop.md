---
paths:
  - "composables/useBoardDndKit.ts"
  - "composables/useColumnSortable.ts"
  - "composables/useStack*.ts"
  - "components/board/**"
  - "components/task/TaskStack*.vue"
  - "assets/css/dnd.css"
  - "assets/css/board.css"
  - "tests/e2e/{drag-*,dnd-*,stack-*,done-drop,grouped-dnd,sorting,jetzt-*}.spec.ts"
  - "tests/e2e/helpers/dnd.ts"
  - "tests/components/board/**"
  - "docs/testing/e2e-dnd-patterns.md"
---
# Drag-and-drop rules (board, cards, stacks; `@dnd-kit/vue`)

Uses `@dnd-kit/vue`, orchestrated by `useBoardDndKit.ts`. Key invariants:
- All per-item registration via `useColumnSortable()` through `SortableTaskWrapper.vue` (cards) and `TaskStack.vue` (collapsed stacks)
- Floating preview rendered by `<DragOverlay>` in `Board.vue` — no native `setDragImage`
- Store updates only in `onDragEnd`, never in `onDragOver`
- CSS class API: `kando-dnd-dragged` (placeholder), `kando-dnd-preview` (floating card)
- `DragOverlay` is viewport-fixed (outside `.board-container`); any CSS transition on `.board` during drag will desync the overlay from the placeholder — always suppress board transitions with `.board.dragging { transition: none }`
- Ghost placeholder: `ColumnDropZone` (`collisionPriority: 0`) shows a ghost only on empty columns via `isDropTarget`; on non-empty columns dnd-kit's `.kando-dnd-dragged` sortable element provides insertion feedback by physically moving to the destination
- **Back over the origin (#372):** a card pulled out of its column and back is judged by the column the drag started in (`source.initialGroup`), never by `source.group`, which follows it into every column it was sorted into (the WIP check in `onDragOver` reads `initialGroup`). A column whose only card is the dragged one renders none while the node sits elsewhere, so `ColumnDropZone` calls it empty by its list's DOM, not the store. At 390px `refreshDroppableShapes` re-measures the droppables after an edge-scroll page switch: dnd-kit keeps no shape for a droppable that scrolled out of view and does not re-measure it when it returns at the same rect
- **A drag that ends resets its sortable (#424):** `useColumnSortable` sets `group`/`index` back to the item's own column and rendered index once the drag is over, because @dnd-kit/vue re-syncs them only when the input changes and a drop back over the origin or a cancel never remounts the wrapper; a stale `group` makes the next drag read a foreign origin and `restoreDraggedElement` removes the node. A canceled drag restores the node itself (`onDragEnd`): dnd-kit's revert needs a sibling in the origin list, which the sole card of a column (Jetzt) has none of
- **No gap behind a dragged card (#393):** over an empty column dnd-kit leaves the placeholder in its source list; while the ghost shows, `dnd.css` takes it out of the layout (absolute, zero-sized; `display: none` would drop keyboard focus) if other cards remain there. A list holding only the placeholder keeps it hit-testable (#372)
- **Clone feedback moves DOM**: during cross-column drag, `.kando-dnd-dragged` physically relocates to the destination column — E2E tests must assert its presence in the *destination* list, not the source
- **Stacks are declarative** (#147, #150): a group of 2+ is a collapsed `TaskStack` until `useStackExpansion` expands it, then `BoardColumn` renders the members as ordinary `SortableTaskWrapper` cards. A collapsed stack is **one sortable (id = its front task)**; `onDragEnd` moves the members snapshotted at drag start as one block. Never move stack nodes by hand. Jetzt always refuses a block; Erledigt gives one undo toast. Details: ADR 004 decision 5
- **One root node per list item**: `BoardColumnItem` renders each item as a single element, never a `<template v-for>` fragment around sortables. dnd-kit moves the dragged wrapper next to its target, and Vue removes a fragment by walking its anchors, which sweeps the dragged node away with it (#146). `restoreDraggedElement` in `useBoardDndKit` restores the node from store data after a drop
- **The end of a drag is motion only (kd#181, `useDropMotion`):** `Board.vue` calls `land` right after `onDragEnd`; the overlay keeps its content from `landingTaskId` while it glides, the real card holds the slot (`kando-dnd-landing`), and the end of the drop animation sets `setDownTaskId` for one animation (`kando-dnd-set-down`). The glide is our own drop animation function: dnd-kit pins the overlay's `translate` with `!important` unless the element carries `data-dnd-dropping`, so the function sets and removes that attribute around its animation. Never bind overlay content to `draggedTaskId` alone (it is cleared at release), and never trigger the set-down by watching classes. E2E: measure a card's box only after `dropSettled(page)`, the set-down scales it for 200 ms

Mobile swipe and edge-scroll: `.claude/rules/mobile-board.md`. E2E drag simulation: `.claude/rules/e2e.md`.
