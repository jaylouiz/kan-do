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

The one-adapter rule (`appStorage`, never capture a storage at import time): root `CLAUDE.md` "State Management". How each field reads old or malformed data is in the doc comment at its definition (the store, its `sanitize*` / `valid*` / `normalize*` reader) and in the store's hydrate test; this file lists only what spans files.

- **Storage:** stores never name a storage (`plugins/pinia.ts` installs `appStorage`, `lib/dataStorage.ts`). A persisted store is listed in `PERSISTED_KEYS` (`tests/store/persistedKeys.test.ts` fails when one is missing); `kando-locale` and `statistics-backfill-state` stay in `localStorage`. The writer strips `SECRET_STATE_PATHS` itself (ADR 007).
- **A new field of a persisted store is additive:** a default in the setup store, a tolerant reader (malformed reads as none or the default, in memory), a hydrate test beside the store's other ones (like `tests/store/taskStatisticsLegacy.test.ts`), and a doc line at the field. `tests/store/persistedDefaults.test.ts` holds that older data hydrates to a fresh install's state and `tests/store/hydrationNoWrite.test.ts` that hydrating writes nothing. A field that old data would misread gets a stamp that `beforeHydrate` clears (`markerModel`, `MARKER_MODEL`); a seed or an export must carry it.
- `afterHydrate` (pinia-plugin-persistedstate) runs even when nothing is stored: never `$persist()` there unconditionally, it writes `data_set` and an offline desktop launch counts as edited (#273).
- **Day fields** (`day-recap-store`, `tasks-store.afterMidnight`): `.claude/rules/new-day.md`; read it before touching one of them from another file.
- **Desktop data safety (ADR 011):** the guard lives in Rust's single write path (`src-tauri/src/data_file.rs`, `data_file/backup.rs`, `data_file/guard.rs`): a SHA-256 check before every write turns a foreign change into the blocking `conflict` status, an unreachable or slow (10 s) folder is `folder-unavailable` (nothing written, edits held in memory), backups are verbatim copies in `<folder>/backups/` (mandatory `pre-*` kinds block their operation). Never write the data path while `last_seen` is `None` or the status blocks; both versions go to `backups/` on every conflict choice. Export/import strip `SECRET_STATE_PATHS` in `utils/dataFile/exportImport.ts`; web has the same on `localStorage` (`composables/useWebDataTransfer.ts`, #238).
- **App reset (kd#227, ADR 011):** `composables/useAppReset.ts` (its header has the order and the frozen-window rule). Never `planReplace` there: it keeps tokens.
- **Data status payload:** a new field is edited in `emptyDataStatus` (`lib/dataStatus.ts`) and `types/dataFile.ts` only; app state, `fakeDataBackend` and `tauriStub` start from it.
- **Bundle identifier migration** (#42, ADR 019, `src-tauri/src/identifier_migration.rs`): a change to the identifier, the pointer or the backup layout keeps `cargo test --lib identifier_migration` and never lets a failed copy become a first run. `npm run tauri:dev` runs under its own `.dev` identifier and never migrates (#413).
- **Floating focus timer (ADR 020):** the pill window's position is machine-local (`overlay-window.json` in the app config dir, not the data file), and every `data_*` command refuses a window other than `main` (`ensure_main_window`; `tests/config/overlay-contract.test.ts`).
- **Rust:** `npm run verify` has no cargo step; a change under `src-tauri/` runs `cargo test --lib` there (3-5 times when it adds a timing test; prefer gates such as `mpsc`/`Condvar` over short timeouts).
