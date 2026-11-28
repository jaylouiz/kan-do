---
paths:
  - "store/**"
  - "lib/dataStorage.ts"
  - "lib/dataBackend*"
  - "lib/dataStatus.ts"
  - "lib/secrets*.ts"
  - "plugins/00.data-storage*"
  - "plugins/pinia.ts"
  - "plugins/secrets.client.ts"
  - "utils/dataFile/**"
  - "composables/useWebDataTransfer.ts"
  - "types/dataFile.ts"
  - "src-tauri/**"
  - "tests/store/{persistedKeys,hydrationNoWrite,secretPersistence}.test.ts"
  - "tests/e2e/{data-safety,data-settings,web-data-transfer}.spec.ts"
  - "composables/useAppReset.ts"
---
# Persistence rules (`appStorage`, desktop data file, export/import)

The one-adapter rule (`appStorage`, never capture a storage at import time): root `CLAUDE.md` "State Management".

- `appStorage` (`lib/dataStorage.ts`, installed in `plugins/pinia.ts`; stores do not name a storage): `localStorage` on web, on desktop a synchronous mirror of `kan-do-data.json` that Rust owns (ADR 008). A persisted key belongs in `PERSISTED_KEYS` (a Vitest guard fails when a store is missing); `kando-locale` and `statistics-backfill-state` stay in `localStorage`. The writer strips `SECRET_STATE_PATHS` itself (ADR 007).
- **A new field of a persisted store is additive:** default in the setup store, a tolerant reader (a `sanitize*` / `valid*` helper next to the type, run in `afterHydrate` in memory), a doc comment on the field saying what older data reads as, and a hydrate test like `tests/store/taskStatisticsLegacy.test.ts`. The field's own shape and defaults live in its type and doc comment, not here.
- `afterHydrate` (pinia-plugin-persistedstate) runs even when nothing is stored: never `$persist()` there unconditionally, it writes `data_set` and an offline desktop launch counts as edited (#273). Write back only when stored data really changed (`healthNeedsWriteBack`, `dropStaleMarkers`); `tests/store/hydrationNoWrite.test.ts` guards it.
- **Marker stamp (#793):** `tasks-store.markerModel` (`MARKER_MODEL`, `lib/taskPlanning.ts`) stamps data written under the current "not planned" rule; an export carries it, and a seed that holds a waiting task off today must write it (`buildTasksStore` does).
- **New day fields** (`day-recap-store`, `tasks-store.afterMidnight`): `.claude/rules/new-day.md`.
- **Floating focus timer (#383, ADR 020):** the pill window's position is machine-local (`overlay-window.json` in the app config dir, not in the data file), and every `data_*` command refuses a window other than `main` (`ensure_main_window`).
- Desktop data safety (ADR 011): the guard lives in Rust's single write path (`src-tauri/src/data_file.rs`, `data_file/backup.rs`, `data_file/guard.rs`): a SHA-256 check before every write turns a foreign change into the blocking `conflict` status, an unreachable or slow (10 s) folder is `folder-unavailable` (nothing written, edits held in memory), backups are verbatim copies in `<folder>/backups/` (`daily` per local day, mandatory `pre-*` kinds block their operation). Never write the data path while `last_seen` is `None` or the status blocks; both versions go to `backups/` on every conflict choice. Export/import strip `SECRET_STATE_PATHS` in `utils/dataFile/exportImport.ts`. Web has the same export/import on `localStorage` (`composables/useWebDataTransfer.ts`, `utils/dataFile/webReplace.ts`, #238): replace-and-reload, this browser's tokens kept.
- **App reset (kd#227, ADR 011 "App reset")**, `composables/useAppReset.ts`: never `planReplace` (it keeps tokens); `freezeWrites()` right after the replace; the erased set derives from `PERSISTED_KEYS` and `SECRET_ENTRIES`; `kando-locale`, `kando-last-seen-version` and the folder location are kept; a retry skips the second replace, and closing the question reloads the page, because the frozen window must never outlive the reset.
- **Data status payload**: `emptyDataStatus(overrides?)` (`lib/dataStatus.ts`) is the single empty/ok `DataStatusPayload`; app state, `fakeDataBackend` and `tauriStub` start from it, so a new field is edited there and in `types/dataFile.ts` only.
- **Bundle identifier migration** (#42, ADR 019, `src-tauri/src/identifier_migration.rs`): a change to the identifier, the pointer or the backup layout keeps its tests (`cargo test --lib identifier_migration`) and never lets a failed copy become a first run; `npm run tauri:dev` runs under its own `.dev` identifier and never migrates (#413). The dev seed (`?seed=`) writes into the data file only while it is empty.
- **Rust**: `npm run verify` has no cargo step; a change under `src-tauri/` runs `cargo test --lib` there (3-5 times when it adds a timing test; prefer gates such as `mpsc`/`Condvar` over short timeouts).
