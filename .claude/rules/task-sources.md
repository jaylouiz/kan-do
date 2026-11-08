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
# Task source rules (ADR 015: sources, add target, pending sync, move, mixed board, merge)

Task identity (`id` vs `externalId`) and routing by `task.source`: root `CLAUDE.md` "State Management".

- **`boardConfig.sources`** (`{ connected, default } | null`; Local implicit, `null` = never onboarded) replaced `taskService`: read it through `boardStore.defaultSource` / `isIntegrationConnected(id)`, write it through `setSources` / `setSingleSource` (the one-source flows, which switch) or `connectIntegration` / `disconnectIntegration` (via `useSourceConnections`, which also fetches, flushes and clears credentials; a connect never sets `pendingSourceSwitch`; ADR 015 "Connect and disconnect"). Old data is mapped by the idempotent normalisers in `lib/taskSources.ts` (hydrate-time in the stores' `afterHydrate`, plus the desktop envelope migration 1 -> 2 using the same functions).
- **Add target (#321):** `pages/tasks/add.vue` creates through `useTaskSync().createTask` in `useAddTarget().targetSource` (reset to the default source each time the sheet opens; the ad-hoc add always uses the default and shows no switch). The "Speichern in" line is `AddTargetSwitch`, registered as the sheet footer's `lead` (`useModalFooter`); form rows come from `utils/sourceFields.ts` (`fieldsForSource`), so a source's missing fields are neither shown, saved nor mirrored to the draft, while typed values stay in the form. A create while the source needs attention or the browser is offline never calls the adapter: the task is made with a `local_…` id, `externalId: null` and `pendingSync`, and the next push creates it (`pushTask`). A Local topic's colour is derived on read (`useTopicColor`), never stored.
- **Pending sync (#319, ADR 015 addendum):** a non-Local task with changes its source does not hold carries `task.pendingSync { since, attempts, lastError }`; `useTaskSync.runSync` sets it before every write and clears it on success (`clearPendingSync(id, revision)`, so an edit during the push keeps it), `syncPendingChanges` retries it. Tracked time still queues in `pendingTimeUpdates` (only for sources that store time, `sourceSyncsTime`), and `isSyncPending(id)` covers both. The card cloud shows while the source is not healthy or the task's own push was refused (`pendingSync.lastError`); a push in flight without an error shows none (`useSavePending`).
- **Move between sources (#322, ADR 015 addendum):** "Verschieben nach …" (card menu, detail dropdown, palette "Verbindung" group; one list from `useTaskMoveTargets`) runs `useTaskMove().moveTaskToSource`: local re-assignment at once (`tasksStore.reassignSource`, `pendingMove`), undo toast through the shared `useUndoWindow` (delete uses its toastless `beginTimed` mode), and only after the toast closed `useTaskSync.commitTaskMove` creates in the target, then removes the origin copy. `pendingMove` with `externalId === null` = create outstanding, with an `externalId` = origin removal queued; a rejected create reverts and raises `lib/taskMoveEvents` (failure toast with retry). Never push a moved task through `pushTask`/`adapter.update` while `isMoveHeld` or its create is outstanding (`runSync` routes it).
- **Mixed board (#323):** `tasksStore.hasMultipleSources` (distinct `task.source` among the stored tasks `>= 2`, derived, not from `sources.connected`) turns on the 16px `TaskSourceIcon` at the start of every card footer (Erledigt too, never the add-sheet draft) and drops Notion `custom:*` grouping options (topic, activity and priority stay) (`utils/groupingOptions.ts`; `pages/tasks.vue` falls a persisted `custom:*` key back to topic). Footer width rule: the comment at the card footer in `TaskCard.vue`. Seeds: `WORST_CASE_FOOTER_TASKS` (`tests/e2e/helpers/seed.ts`).
- **Features on a mixed board (#325):** every per-task path follows `task.source`, never the default source: delete (`PendingTaskDelete.task.source`, the carry-over label), "Gesehen" (`syncArchiveStatusForTasks`), the sheet (`customList` is Notion's, empty for a Local task). Statistics, day close and the palette are source-blind; export/import carry `source`/`externalId` and `boardConfig.sources`, tokens never, so an imported Notion source is `broken` until reconnected. Sequence specs: `tests/e2e/mixed-board-features.spec.ts`, the requirements walk `mixed-board-requirements.spec.ts`.
- **Trash and delete (#422, ADR 015 addendum):** a delete (`useTaskDeletion.deleteTaskWithUndo`) takes the task out of `tasks` at once and keeps its slot as a gap (`pendingDeletes[id].slot`, rendered by `TaskDeletedGap` from `useDeletedGaps`, never inside `SortableTaskWrapper`) for the 5 s window (`useUndoWindow.beginTimed`, paused by hover/focus). `closeDelete` moves the snapshot into `store/trash.ts` and commits upstream as before (a commit that fails for good restores the task and drops the entry); the entry exists from the window's close, also while the commit is queued offline. Restore is `useTaskSync.restoreTask`: `TaskSourceAdapter.restore` first (Local re-add, Notion un-archive or create, Todoist create with a new `externalId`, same `id`), then one synchronous step (`undeleteTask`, add, `restoreGuard`, carry-over, entry removal); a still-queued delete is cancelled instead. A task from Jetzt restores into Offen. Remove-forever and "Papierkorb leeren" never touch the source. `restoreGuard` (transient) makes `mergeTasks` keep a restored task a stale fetch lacks.
- `mergeTasks(source, fetched)` replaces only that source's tasks (matched by `(source, externalId)`), and must preserve local time tracking and pending updates when reconciling external data. Time keeps the larger of local and fetched, except a total the user set in the sheet (kd#4, `tasksStore.setTimeSpent`): its queued entry carries `absolute: true`, so the local total wins until a push carried it, and that push writes the Notion time property even at 0 (`adapter.update(task, { timeEdited: true })`)
