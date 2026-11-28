---
paths:
  - "store/dayRecap.ts"
  - "store/tasks.ts"
  - "composables/useNewDay*.ts"
  - "composables/useTakeOffBoard.ts"
  - "composables/useDayClose*.ts"
  - "utils/recapDay.ts"
  - "lib/dayBegun.ts"
  - "tests/store/{dayRecap,boardNotPlannedOrder,tasks.afterMidnight}.test.ts"
  - "tests/composables/{useNewDay,useDayClose}*.test.ts"
  - "tests/composables/useCommandPalette.dayClose.test.ts"
  - "tests/utils/{recapDay,dayClose}.test.ts"
  - "tests/store/hydrationNoWrite.test.ts"
  - "tests/e2e/{new-day-recap,day-close}.spec.ts"
---
# New day: persisted fields (#356, #387)

Split from `.claude/rules/persistence.md` (#901). The fields (`day-recap-store`: `lastNewDay`, `sentBack`, `noticeClosedDay`, `timeOffer`, `planNoteSeen`; `tasks-store.afterMidnight`) are documented on the store (`store/dayRecap.ts`) and their `valid*` / `sanitize*` readers; all are additive, nothing writes at hydration, no card moves at hydration.

- Data without `lastNewDay` (from before #356) gets its baseline from the first day check, never at hydration: today, or the day of `lastShownDay` when that is earlier.
- The day close (#480) does the fresh start's work through the same take-off (`composables/useTakeOffBoard.ts`) and writes `lastNewDay` / `sentBack` for the next local day (`dayRecap.markDayClosed`), so `lastNewDay` can be one day ahead of the clock: the next morning is then not due (no notice, no second fresh start). The board day count is not taken back at close.
- `planArrival` (`lib/dayBegun.ts`, armed by `useNewDay().freshStart()` / `armPlanNote()`) is runtime only, never stored.
- `firstBackDay`, `backNoteClosed` and `board-store.notPlannedFromWaiting` are no longer read or written: a stored value loads without error and is left out of the next persist.
- The fields travel in the `day-recap-store` / `tasks-store` blobs, so export/import and the app reset carry them.
