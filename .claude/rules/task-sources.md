---
paths:
  - "composables/useTaskSync.ts"
  - "composables/useTaskMove*.ts"
  - "composables/useAddTarget.ts"
  - "composables/useSourceConnections.ts"
  - "composables/useSavePending.ts"
  - "composables/useUndoWindow.ts"
  - "composables/useTaskDeletion.ts"
  - "composables/useTrash.ts"
  - "store/trash.ts"
  - "lib/trash.ts"
  - "composables/useTaskSources.ts"
  - "integrations/**"
  - "store/remindersConfig.ts"
  - "lib/remindersSource.ts"
  - "lib/taskSources.ts"
  - "lib/taskMoveEvents.ts"
  - "store/tasks.ts"
  - "store/board.ts"
  - "pages/tasks/add.vue"
  - "pages/tasks.vue"
  - "components/task/TaskCard.vue"
  - "components/task/AddTargetSwitch.vue"
  - "components/task/TaskSourceIcon.vue"
  - "utils/sourceFields.ts"
  - "utils/groupingOptions.ts"
  - "utils/dataFile/migrations.ts"
  - "tests/e2e/{mixed-board*,task-move-source,add-task-source,pending-sync,source-*,sources-settings}.spec.ts"
---
# Task source rules (ADR 015)

How each mechanism works is in the doc comment of the code named here and in ADR 015 and its addenda; read those before changing it. This file lists only the contracts that span files. `tests/config/task-source-contracts.test.ts` enforces four more: Notion pages are created only through `NotionSource.create`, the only writers of `sourceNotPlanned`, the one `mergeTasks` caller with `fetchStartedAt` and `pushing`, and that `boardConfig` is written only in the board store.

- **Identity:** every `Task` has `source` and `externalId`; `id` never changes and keys statistics, order, carry-over, archive, timers and routes. Integrations get `externalIdOf(task)`, never `id`. Route by `task.source`, never by the default source, and ask a capability through `sourceCan(source, …)` (`lib/taskSources.ts`), never by the source's name: a new place that creates, deletes, moves or edits a task's text asks `sourceCan` first (Reminders is read-only).
- **Sources config:** read `boardConfig.sources` through `boardStore.defaultSource` / `isIntegrationConnected`; connect and disconnect through `useSourceConnections` (fetch, flush, credentials). Old data goes through the normalisers in `lib/taskSources.ts`.
- **Every write goes through `useTaskSync`:** create through `createTask(draft, source)`, planning through `planTask(s)` / `unplanTask(s)`, a column change of a not-planned task through the status path (`markerSurvives`), a snapshot into another column through `inStatus()`. Never push a moved task while `isMoveHeld` or its create is outstanding (`runSync` routes it).
- **A new push loop** over a source's tasks checks `isRateLimited(source)` and leaves every task it does not send with its marker (#529).
- **A new path that puts a change aside** without a request calls `informUnreachable`; never toast an unreachable source per action (#851).
- **A new create or restore of a page** wraps it in `beginSourceWrite` and calls `tasksStore.dropLandedDuplicates` before it adds or completes the task; a new removal asks `removalVerdict` before `adapter.remove` (#528, #555, #578; mechanism: `useTaskSync`, `lib/createLookup.ts`).
- **Reminders dates** are written only by `writePlanning` on the user's plan (#553).
- **Not planned:** "on today's board" means the column getters or `isNotPlanned()`; "a task kan-do holds" (`tasks`, counts, `hasMultipleSources`) includes not-planned tasks. Not the same as `isUnplanned` (ad-hoc work).
- **A Notion capped or two-part list** reaches `mergeTasks` with `partialNotPlanned` and `readInParts` from the adapter's `FetchedTasks`; never merge it without them (the merge would drop held tasks with unpushed edits).
