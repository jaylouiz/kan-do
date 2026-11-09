//! One-time move from the bundle identifier `com.julius.kan-do` to `io.github.jaylouiz.kan-do` (#42, ADR 019).
//!
//! macOS keys the app's folders on the identifier and kan-do reuses it as the Keychain service, so an updated app would
//! otherwise find an empty data folder and no tokens. Two independent steps run in `setup`, before `DataFile` is managed
//! and before any command can be served:
//!
//! 1. **Data**: the legacy app folder (`data-location.json`, `kan-do-data.json`, `backups/`) is **copied** to the new one,
//!    every file verified by SHA-256. The legacy folder is never written, moved or deleted. A failure falls back to the
//!    legacy folder for that session (the previous version's behaviour) and retries at the next start; it never lets the
//!    webview start a first run with an empty board.
//! 2. **Keychain**: the four entries are **moved** to the new service (write, read back, compare, then delete the legacy
//!    entry). The new service is checked first (a value there wins, the legacy entry is not read); unresolved entries are
//!    retried for [`MAX_SECRET_ATTEMPTS`] starts, then the step gives up. Only for the production identifier: the service
//!    is a fixed constant and sandbox runs must never read or create real entries.
//!
//! Debug builds with the production identifier (`tauri dev`) run neither step. Until a release has finished a step they keep
//! using the legacy folder and Keychain service; afterwards they follow the marker, read-only, and use the folder and
//! service the installed app uses, see [`run_gated`] and [`secrets_settled`] (#60).
//!
//! Progress lives in `identifier-migration.json` in the new config dir (states only, never a value). Token values never
//! reach a log line, an error or that file. Log lines name steps and counts, never paths with user content.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::data_file::{sha256_hex, write_atomic, FILE_NAME, LOCATION_FILE};
use crate::secrets::{Backend, SecretEntry};

/// The identifier releases up to 0.11.0 shipped with.
pub const LEGACY_IDENTIFIER: &str = "com.julius.kan-do";
/// The identifier of the production app. The Keychain step runs only for this one.
pub const PRODUCTION_IDENTIFIER: &str = "io.github.jaylouiz.kan-do";
const STATE_FILE: &str = "identifier-migration.json";
const BACKUPS_DIR: &str = "backups";
/// Names the app's own writer leaves behind (`data_file`: `.kan-do-data.json.tmp*`, `.kan-do-probe*`); never copied.
const TEMP_PREFIXES: [&str; 2] = [".kan-do-data.json.tmp", ".kan-do-probe"];

/// Where the app keeps its data: the config dir holds the pointer, the default folder holds file and backups (the same
/// directory on macOS).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dirs {
    pub config_dir: PathBuf,
    pub default_folder: PathBuf,
}

/// The legacy sibling of a Tauri per-identifier directory (`…/Application Support/<id>` → `…/<legacy id>`).
fn legacy_sibling(dir: &Path) -> Option<PathBuf> {
    Some(dir.parent()?.join(LEGACY_IDENTIFIER))
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    /// `in-progress`, `done` or `skipped` (the destination already held data and no migration was running).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    /// `done` once all four entries are resolved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    secrets: Option<String>,
    /// Starts that ended with an unresolved Keychain entry (a denied prompt, an error); the step gives up at
    /// [`MAX_SECRET_ATTEMPTS`] so a denial is not asked again at every start.
    #[serde(default, skip_serializing_if = "is_zero")]
    secrets_attempts: u32,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// Starts that may end with an unresolved entry before the Keychain step stops asking. The tokens stay under the legacy
/// service; the user re-enters them in the settings (the new service then wins).
pub const MAX_SECRET_ATTEMPTS: u32 = 3;

const IN_PROGRESS: &str = "in-progress";
const DONE: &str = "done";
const SKIPPED: &str = "skipped";

fn read_state(config_dir: &Path) -> Result<State, String> {
    match fs::read(config_dir.join(STATE_FILE)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| format!("{STATE_FILE} is not readable")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(State::default()),
        Err(error) => Err(format!("{STATE_FILE}: {}", error.kind())),
    }
}

fn write_state(config_dir: &Path, state: &State) -> io::Result<()> {
    fs::create_dir_all(config_dir)?;
    let mut bytes = serde_json::to_vec_pretty(state).map_err(io::Error::other)?;
    bytes.push(b'\n');
    write_atomic(&config_dir.join(STATE_FILE), &bytes)
}

// ---------------------------------------------------------------------------------------------
// Data step

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataOutcome {
    /// No legacy data, or the migration is already done: nothing to do.
    NotNeeded,
    /// The destination already holds data and no migration was running: nothing copied, never mixed.
    Skipped,
    /// Copied and verified.
    Migrated,
    /// Run from the legacy folder this session; retry at the next start.
    FallBackToLegacy(String),
}

/// The pointer file: the same two fields `data_file::Location` writes. Parsed only to tell the default-folder case from a
/// custom folder; a custom pointer is copied byte for byte.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Pointer {
    folder: String,
    device_id: String,
}

enum LegacyPointer {
    Absent,
    Unreadable,
    /// Raw bytes (copied verbatim for a custom folder) and the parsed form.
    Found(Vec<u8>, Pointer),
}

fn read_legacy_pointer(legacy_config: &Path) -> LegacyPointer {
    match fs::read(legacy_config.join(LOCATION_FILE)) {
        Ok(bytes) => match serde_json::from_slice::<Pointer>(&bytes) {
            Ok(pointer) if !pointer.folder.is_empty() && !pointer.device_id.is_empty() => LegacyPointer::Found(bytes, pointer),
            _ => LegacyPointer::Unreadable,
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => LegacyPointer::Absent,
        Err(_) => LegacyPointer::Unreadable,
    }
}

fn is_temp_name(name: &str) -> bool {
    TEMP_PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

/// Copies `src` to `dst` and verifies the copy by hash. `replace` = the destination is the migration's own earlier
/// (possibly stale) copy and may be replaced; otherwise an existing file is left alone.
fn copy_verified(src: &Path, dst: &Path, replace: bool) -> io::Result<()> {
    let bytes = fs::read(src)?;
    let want = sha256_hex(&bytes);
    if let Ok(existing) = fs::read(dst) {
        if sha256_hex(&existing) == want || !replace {
            return Ok(());
        }
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    write_atomic(dst, &bytes)?;
    if sha256_hex(&fs::read(dst)?) != want {
        let _ = fs::remove_file(dst);
        return Err(io::Error::other("copy does not match its source"));
    }
    Ok(())
}

/// Every regular file below `dir` (no symlinks, no writer leftovers), relative to `dir`, sorted.
fn files_below(dir: &Path) -> io::Result<Vec<PathBuf>> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if is_temp_name(&entry.file_name().to_string_lossy()) {
                continue;
            }
            if kind.is_dir() {
                walk(root, &entry.path(), out)?;
            } else if kind.is_file() {
                out.push(entry.path().strip_prefix(root).unwrap_or(&entry.path()).to_path_buf());
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    match fs::metadata(dir) {
        Ok(meta) if meta.is_dir() => walk(dir, dir, &mut out)?,
        Ok(_) => return Err(io::Error::other("not a directory")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    out.sort();
    Ok(out)
}

fn same_dir(a: &str, b: &Path) -> bool {
    Path::new(a).components().eq(b.components())
}

/// Copies the legacy data into the new directories. See the module doc for the contract.
pub fn migrate_data(legacy_config: &Path, config_dir: &Path, legacy_default: &Path, default_folder: &Path) -> DataOutcome {
    let fail = |reason: String| DataOutcome::FallBackToLegacy(reason);

    let mut state = match read_state(config_dir) {
        Ok(state) => state,
        Err(reason) => return fail(reason),
    };
    if matches!(state.data.as_deref(), Some(DONE | SKIPPED)) {
        return DataOutcome::NotNeeded;
    }

    let pointer = read_legacy_pointer(legacy_config);
    let has_legacy_data = legacy_default.join(FILE_NAME).is_file() || legacy_default.join(BACKUPS_DIR).is_dir();
    if matches!(pointer, LegacyPointer::Absent) && !has_legacy_data {
        return DataOutcome::NotNeeded;
    }
    let pointer_unreadable = matches!(pointer, LegacyPointer::Unreadable);
    if pointer_unreadable {
        // Not a first run: the old version would show read-only-corrupt. Copying a data file next to a pointer that cannot
        // be trusted could hide that, so the old state is kept as it is.
        return fail("legacy data-location.json is not readable".into());
    }

    let resuming = state.data.as_deref() == Some(IN_PROGRESS);
    if !resuming && (config_dir.join(LOCATION_FILE).exists() || default_folder.join(FILE_NAME).exists()) {
        state.data = Some(SKIPPED.into());
        return match write_state(config_dir, &state) {
            Ok(()) => DataOutcome::Skipped,
            Err(error) => fail(format!("cannot write {STATE_FILE}: {}", error.kind())),
        };
    }

    // Everything from here on is the migration's own, so a stale copy from an earlier failed run may be replaced.
    state.data = Some(IN_PROGRESS.into());
    if let Err(error) = write_state(config_dir, &state) {
        return fail(format!("cannot write {STATE_FILE}: {}", error.kind()));
    }

    let result = (|| -> io::Result<()> {
        let default_is_legacy_default = matches!(&pointer, LegacyPointer::Found(_, p) if same_dir(&p.folder, legacy_default));
        let custom = matches!(&pointer, LegacyPointer::Found(..)) && !default_is_legacy_default;
        if !custom {
            // Backups first, the data file next, the pointer last: a crash in between leaves a start that either resumes or
            // adopts the data file from the default folder.
            for relative in files_below(&legacy_default.join(BACKUPS_DIR))? {
                let relative = Path::new(BACKUPS_DIR).join(relative);
                copy_verified(&legacy_default.join(&relative), &default_folder.join(&relative), true)?;
            }
            if legacy_default.join(FILE_NAME).is_file() {
                copy_verified(&legacy_default.join(FILE_NAME), &default_folder.join(FILE_NAME), true)?;
            }
        }
        match &pointer {
            LegacyPointer::Found(bytes, parsed) => {
                let target = config_dir.join(LOCATION_FILE);
                fs::create_dir_all(config_dir)?;
                if default_is_legacy_default {
                    // The same device id, the new default folder.
                    let moved = Pointer { folder: default_folder.to_string_lossy().into_owned(), device_id: parsed.device_id.clone() };
                    let mut out = serde_json::to_vec_pretty(&moved).map_err(io::Error::other)?;
                    out.push(b'\n');
                    write_atomic(&target, &out)?;
                    let back: Pointer = serde_json::from_slice(&fs::read(&target)?).map_err(io::Error::other)?;
                    if back.device_id != parsed.device_id || !same_dir(&back.folder, default_folder) {
                        return Err(io::Error::other("pointer does not match after writing"));
                    }
                } else {
                    // A custom folder: the pointer is the whole migration, copied byte for byte.
                    write_atomic(&target, bytes)?;
                    if fs::read(&target)? != *bytes {
                        return Err(io::Error::other("pointer does not match after writing"));
                    }
                }
            }
            LegacyPointer::Absent | LegacyPointer::Unreadable => {}
        }
        state.data = Some(DONE.into());
        write_state(config_dir, &state)
    })();

    match result {
        Ok(()) => DataOutcome::Migrated,
        Err(error) => fail(format!("{}", error.kind())),
    }
}

// ---------------------------------------------------------------------------------------------
// Keychain step

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryOutcome {
    /// Written to the new service, read back equal; the legacy entry was deleted (or the delete failed, see `legacy_kept`).
    Moved { legacy_kept: bool },
    /// Nothing under the legacy service.
    Absent,
    /// The new service already holds a value: it wins, the legacy entry is left alone.
    KeptNew,
    /// A Keychain error or a read-back mismatch: retried at the next start.
    Failed,
}

impl EntryOutcome {
    fn resolved(self) -> bool {
        !matches!(self, EntryOutcome::Failed)
    }
}

/// Moves the four entries from `legacy` to `current`. Never returns or logs a value.
pub fn migrate_secrets(legacy: &dyn Backend, current: &dyn Backend) -> Vec<(SecretEntry, EntryOutcome)> {
    SecretEntry::ALL
        .into_iter()
        .map(|entry| (entry, migrate_entry(legacy, current, entry)))
        .collect()
}

fn migrate_entry(legacy: &dyn Backend, current: &dyn Backend, entry: SecretEntry) -> EntryOutcome {
    // The new service first: a value there wins and the legacy entry is not read (no prompt for it).
    match current.get(entry) {
        Ok(Some(_)) => return EntryOutcome::KeptNew,
        Ok(None) => {}
        Err(_) => return EntryOutcome::Failed,
    }
    let value = match legacy.get(entry) {
        Ok(Some(value)) => value,
        Ok(None) => return EntryOutcome::Absent,
        Err(_) => return EntryOutcome::Failed,
    };
    if current.set(entry, &value).is_err() {
        return EntryOutcome::Failed;
    }
    // Verified before the legacy entry is touched.
    match current.get(entry) {
        Ok(Some(stored)) if stored == value => {}
        _ => return EntryOutcome::Failed,
    }
    // Deleting is the "move" of D1; a refusal keeps the legacy entry and still counts as moved (the new one is verified).
    let legacy_kept = legacy.delete(entry).is_err();
    EntryOutcome::Moved { legacy_kept }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretsOutcome {
    /// Not the production identifier (sandbox, tests): the Keychain was not touched.
    SkippedNotProduction,
    /// Already done in an earlier start.
    AlreadyDone,
    /// All four entries resolved; the marker is written.
    Done(Vec<(SecretEntry, EntryOutcome)>),
    /// Unresolved entries in [`MAX_SECRET_ATTEMPTS`] starts: the Keychain is not opened any more.
    GaveUp,
    /// At least one entry failed: no marker, retried at the next start (until the attempts run out).
    Incomplete(Vec<(SecretEntry, EntryOutcome)>),
    /// The marker could not be read or written.
    StateError(String),
}

/// Runs the Keychain step for the identifier `identifier`, remembering the result in `config_dir`.
/// `backends` builds `(legacy, current)` lazily, so a skipped or finished step never opens the Keychain.
pub fn run_secrets(
    identifier: &str,
    config_dir: &Path,
    backends: impl FnOnce() -> Option<(Box<dyn Backend>, Box<dyn Backend>)>,
) -> SecretsOutcome {
    if identifier != PRODUCTION_IDENTIFIER {
        return SecretsOutcome::SkippedNotProduction;
    }
    let mut state = match read_state(config_dir) {
        Ok(state) => state,
        Err(reason) => return SecretsOutcome::StateError(reason),
    };
    if state.secrets.as_deref() == Some(DONE) {
        return SecretsOutcome::AlreadyDone;
    }
    if state.secrets_attempts >= MAX_SECRET_ATTEMPTS {
        return SecretsOutcome::GaveUp;
    }
    let Some((legacy, current)) = backends() else {
        return SecretsOutcome::Incomplete(Vec::new());
    };
    let results = migrate_secrets(legacy.as_ref(), current.as_ref());
    if !results.iter().all(|(_, outcome)| outcome.resolved()) {
        // Recorded before the next start can prompt again; a failed write only costs one more prompt round.
        state.secrets_attempts += 1;
        let _ = write_state(config_dir, &state);
        return SecretsOutcome::Incomplete(results);
    }
    state.secrets = Some(DONE.into());
    match write_state(config_dir, &state) {
        Ok(()) => SecretsOutcome::Done(results),
        Err(error) => SecretsOutcome::StateError(format!("cannot write {STATE_FILE}: {}", error.kind())),
    }
}

#[cfg(target_os = "macos")]
fn native_backends() -> Option<(Box<dyn Backend>, Box<dyn Backend>)> {
    use crate::secrets::{KeyringBackend, SERVICE};
    let legacy = KeyringBackend::native_for(LEGACY_IDENTIFIER).ok()?;
    let current = KeyringBackend::native_for(SERVICE).ok()?;
    Some((Box::new(legacy), Box::new(current)))
}

#[cfg(not(target_os = "macos"))]
fn native_backends() -> Option<(Box<dyn Backend>, Box<dyn Backend>)> {
    None
}

// ---------------------------------------------------------------------------------------------
// Entry point

fn log_secrets(outcome: &SecretsOutcome) {
    let counts = |results: &[(SecretEntry, EntryOutcome)]| {
        let count = |wanted: fn(&EntryOutcome) -> bool| results.iter().filter(|(_, o)| wanted(o)).count();
        (
            count(|o| matches!(o, EntryOutcome::Moved { .. })),
            count(|o| matches!(o, EntryOutcome::Absent)),
            count(|o| matches!(o, EntryOutcome::KeptNew)),
            count(|o| matches!(o, EntryOutcome::Failed)),
            count(|o| matches!(o, EntryOutcome::Moved { legacy_kept: true })),
        )
    };
    match outcome {
        SecretsOutcome::SkippedNotProduction => log::info!("identifier migration: Keychain step skipped (not the production identifier)"),
        SecretsOutcome::AlreadyDone => log::debug!("identifier migration: Keychain step already done"),
        SecretsOutcome::Done(results) | SecretsOutcome::Incomplete(results) => {
            let (moved, absent, kept_new, failed, legacy_kept) = counts(results);
            let state = if matches!(outcome, SecretsOutcome::Done(_)) { "done" } else { "incomplete, retried at the next start" };
            log::info!(
                "identifier migration: Keychain step {state}: {moved} moved, {absent} absent, {kept_new} kept new, {failed} failed, {legacy_kept} legacy entries not deleted"
            );
        }
        SecretsOutcome::GaveUp => log::warn!("identifier migration: Keychain step gave up after {MAX_SECRET_ATTEMPTS} starts; the legacy entries stay, tokens are re-entered in the settings"),
        SecretsOutcome::StateError(reason) => log::warn!("identifier migration: Keychain step not run: {reason}"),
    }
}

/// Runs both steps for the running app and returns the directories `DataFile` must use.
pub fn run(app: &tauri::AppHandle) -> Dirs {
    use tauri::Manager;
    let config_dir = app.path().app_config_dir().expect("app config dir");
    let default_folder = app.path().app_data_dir().expect("app data dir");
    let identifier = app.config().identifier.clone();
    run_gated(cfg!(debug_assertions), &identifier, &config_dir, &default_folder, native_backends)
}

/// Whether the release has finished the data step: the new folder is authoritative (`done`, or `skipped` because it
/// already held data). Any other state, an absent or an unreadable marker is "not yet".
fn data_settled(config_dir: &Path) -> bool {
    matches!(read_state(config_dir), Ok(state) if matches!(state.data.as_deref(), Some(DONE | SKIPPED)))
}

/// Whether the release's Keychain step is over: all four entries resolved (`done`) or given up after
/// [`MAX_SECRET_ATTEMPTS`] starts. From then on the installed app uses the new service for good, so a debug build with
/// the production identifier does too (`secrets::service_for`). While the move is pending the tokens still live under the
/// legacy service. Reads the marker only; an absent or unreadable one is "not yet".
pub fn secrets_settled(config_dir: &Path) -> bool {
    matches!(
        read_state(config_dir),
        Ok(state) if state.secrets.as_deref() == Some(DONE) || state.secrets_attempts >= MAX_SECRET_ATTEMPTS
    )
}

/// Runs the migration in a release build; a debug build with the production identifier only follows it. `tauri dev` and
/// debug builds carry the production identifier too, and they never migrate: a dev run that copied the folder or moved
/// the tokens would pre-empt the release, and one that wrote the new folder first would make the release record `skipped`
/// and strand the real data in the legacy folder (#42). So until the release has finished the data step (the marker in
/// the new config dir says `done` or `skipped`) the legacy folder is the data folder, the new folder is never created or
/// written, and (see `secrets::service_for`) the legacy Keychain service is used. Once the marker says so, the new
/// folder is the one the installed app works in, and the dev run uses it as well instead of a frozen copy (#60). The
/// marker is only read, in every state. A sandbox identifier (`docs/testing/tauri-dev-sandbox.md`, a debug build by
/// nature) still runs the data step against its throwaway `HOME`; its Keychain step is skipped by [`run_secrets`].
pub fn run_gated(
    debug_build: bool,
    identifier: &str,
    config_dir: &Path,
    default_folder: &Path,
    backends: impl FnOnce() -> Option<(Box<dyn Backend>, Box<dyn Backend>)>,
) -> Dirs {
    if debug_build && identifier == PRODUCTION_IDENTIFIER {
        if data_settled(config_dir) {
            log::info!("identifier migration: debug build with the production identifier follows the finished migration and uses the new folder");
        } else {
            log::info!("identifier migration: skipped, debug build with the production identifier keeps using the legacy folder until a release has migrated");
            if let (Some(config_dir), Some(default_folder)) = (legacy_sibling(config_dir), legacy_sibling(default_folder)) {
                return Dirs { config_dir, default_folder };
            }
        }
        return Dirs { config_dir: config_dir.to_path_buf(), default_folder: default_folder.to_path_buf() };
    }
    run_with(identifier, config_dir, default_folder, backends)
}

/// [`run`] without a running app, for tests.
pub fn run_with(
    identifier: &str,
    config_dir: &Path,
    default_folder: &Path,
    backends: impl FnOnce() -> Option<(Box<dyn Backend>, Box<dyn Backend>)>,
) -> Dirs {
    let mut dirs = Dirs { config_dir: config_dir.to_path_buf(), default_folder: default_folder.to_path_buf() };
    if let (Some(legacy_config), Some(legacy_default)) = (legacy_sibling(config_dir), legacy_sibling(default_folder)) {
        if legacy_config != config_dir {
            match migrate_data(&legacy_config, config_dir, &legacy_default, default_folder) {
                DataOutcome::NotNeeded => log::debug!("identifier migration: data step not needed"),
                DataOutcome::Skipped => log::info!("identifier migration: data step skipped, the new folder already holds data"),
                DataOutcome::Migrated => log::info!("identifier migration: data copied from the legacy folder and verified (legacy folder untouched)"),
                DataOutcome::FallBackToLegacy(reason) => {
                    log::error!("identifier migration: data step failed ({reason}); running from the legacy folder, retry at the next start");
                    dirs = Dirs { config_dir: legacy_config, default_folder: legacy_default };
                }
            }
        }
    }
    log_secrets(&run_secrets(identifier, config_dir, backends));
    dirs
}

#[cfg(test)]
mod tests;
