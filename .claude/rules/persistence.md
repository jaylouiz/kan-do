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

- `appStorage` (`lib/dataStorage.ts`, installed in `plugins/pinia.ts`; stores do not name a storage): `localStorage` on web, on desktop a synchronous mirror of `kan-do-data.json` that Rust owns (debounced atomic writes, flush on exit, ADR 008). Persisted keys live in `PERSISTED_KEYS` (`tasks-store`, `board-store`, `integration-health-store`, `taskStatistics`, `notionConfig`, `propertyOptions`, `settings-store`, `day-recap-store`, `trash-store`, `topic-styles`; a Vitest guard fails when a store is missing); `kando-locale` and `statistics-backfill-state` stay in `localStorage`. The writer strips `SECRET_STATE_PATHS` itself (ADR 007).
- **`taskStatistics` extra fields (#537):** `dayEndInFlight` (`Record<YYYY-MM-DD, number>`, written by `useDayEndTracking`) and `discardedTime` (`{ taskId, deletedAt: epoch ms, seconds }[]`, written when a not-done task's delete reaches the trash, removed on restore) are additive: stored state without them hydrates to `{}` / `[]`, readers skip malformed entries, a wrongly shaped field (`null`, string, array for the map) falls back to the default in `afterHydrate`, both prune at 120 days. `workSessions` (#600, `{ start, end }` epoch ms, written by `composables/useWorkSessionTracking`: open on a timer arm, `end` by a 60 s heartbeat, never per tick; 120-day prune) follows it too. A new field of a persisted store follows the same rule (default in the setup store, tolerant reader, a hydrate test like `tests/store/taskStatisticsLegacy.test.ts`).
- **`board-store.focus` (#161):** `{ topic, day }`, the board's topic focus, additive: older data hydrates to `null`, a malformed value is dropped in memory by `afterHydrate` (`sanitizeFocus`, no write), and `activeFocusTopic` ignores a focus of an earlier local day, so it ends with its day without a write. Tests: `tests/store/boardFocus.test.ts`
- `afterHydrate` (pinia-plugin-persistedstate) runs even when nothing is stored: never `$persist()` there unconditionally, it writes `data_set` and an offline desktop launch counts as edited (#273)
- Desktop data safety (ADR 011): the guard lives in Rust's single write path (`src-tauri/src/data_file.rs`, `data_file/backup.rs`, `data_file/guard.rs`): a SHA-256 check before every write turns a foreign change into the blocking `conflict` status, an unreachable or slow (10 s) folder is `folder-unavailable` (nothing written, edits held in memory), backups are verbatim copies in `<folder>/backups/` (`daily` per local day, mandatory `pre-*` kinds block their operation). Never write the data path while `last_seen` is `None` or the status blocks; both versions go to `backups/` on every conflict choice. Export/import strip `SECRET_STATE_PATHS` in `utils/dataFile/exportImport.ts`. Web has the same export/import on `localStorage` (`composables/useWebDataTransfer.ts`, `utils/dataFile/webReplace.ts`, #238): replace-and-reload, this browser's tokens kept; `/settings/data` on web shows only that section.
- **App reset (kd#227, ADR 011 "App reset")**: `composables/useAppReset.ts` replaces the data with an empty envelope (desktop: `importApply`, so Rust's mandatory `pre-restore` backup comes first; web: `commitReset` removes every `PERSISTED_KEYS` blob, tokens included; never `planReplace`, it keeps tokens), calls `freezeWrites()` right after the replace (`appStorage.setItem` and `syncPendingChanges` do nothing), deletes every `SECRET_ENTRIES` Keychain entry and `reloadApp('/welcome')`. The erased set derives from `PERSISTED_KEYS` and `SECRET_ENTRIES`; `kando-locale`, `kando-last-seen-version` and the folder location are kept. A failed Keychain deletion keeps the question open; a retry skips the second replace, and closing it (Abbrechen, Esc, leaving the page) reloads the current page from the replaced file, because the frozen window must never outlive the reset.
- **Data status payload**: `emptyDataStatus(overrides?)` (`lib/dataStatus.ts`) is the single empty/ok `DataStatusPayload`; app state, `fakeDataBackend` and `tauriStub` start from it, so a new field is edited there and in `types/dataFile.ts` only.
- **Bundle identifier migration** (#42, ADR 019, `src-tauri/src/identifier_migration.rs`): runs in `setup` before `DataFile` exists; copies the legacy `com.julius.kan-do` folder (never writes it) and moves the four Keychain entries (production identifier, release builds only: a `tauri dev` debug build never migrates and only reads the marker, legacy folder/service until the release has finished a step, the new ones after, kd#60). A change to the identifier, the pointer or the backup layout keeps its tests (`cargo test --lib identifier_migration`) and never lets a failed copy become a first run.
- **Rust**: `npm run verify` has no cargo step; a change under `src-tauri/` runs `cargo test --lib` there (3-5 times when it adds a timing test; prefer gates such as `mpsc`/`Condvar` over short timeouts).
