---
paths:
  - "components/board/Board.vue"
  - "composables/useBoardSwipe.ts"
  - "tests/e2e/mobile-*.spec.ts"
  - "assets/css/app-nav.css"
  - "tests/e2e/stack-mobile.spec.ts"
  - "tests/composables/useBoardSwipe.test.ts"
---
# Mobile board rules (≤767px: swipe between pages, edge-scroll during drag)

- Swipe between pages: `composables/useBoardSwipe.ts` (pointer events, touch only) locks a touch to one axis after ~10px; vertical stays native scroll (`touch-action: pan-y` on `.board-container` **and** each column page, since touch-action ends at the nearest scroll container), horizontal sets a transient `offsetPx` (class `.board.swiping { transition: none }`) and commits on >25% width or >0.4px/ms. It stands down via `isEnabled` while `isDragging`; never `preventDefault` touches (dnd-kit needs them)
- **No tabs, no dock (#470, ADR 017):** the phone board has no column tabs and no action dock. Swipe and the drag edge-scroll are the only ways between the three column pages; `.board` carries `data-mobile-page="0|1|2"` (Offen, Jetzt + Wartet, Erledigt), and `focusin` on a control of an off-screen page makes that page active (the keyboard / screen-reader path the tabs were). The board opens on page 1 while a task sits in Jetzt, else on page 0 (kd#191; read once at setup in `Board.vue`). The page bottom padding, the sticky add-task bar, the Erledigt CTA (`.column-footer`: on the phone not sticky since #297, it follows the list at the cards' width; the page's own bottom padding clears the bar, so the offset is not added again; desktop keeps `position: sticky; bottom: 0`) and the toasts clear the floating app bar by `--phone-bar-offset` (`assets/css/app-nav.css`); the bar fades out and ignores pointers while a card is dragged. A touch that starts on the bar never swipes the board (the bar is outside `.board-container`)
- Edge-scroll during drag: pointer dwelling ≥650ms in the 72px edge zone triggers a column switch; constants `EDGE_HOLD_MS` / `EDGE_ZONE_PX` in `Board.vue`
