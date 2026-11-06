//! File-backed persistence for the desktop app (#222, ADR 008).
//!
//! All persisted store state lives in one readable `kan-do-data.json` in a folder the user can
//! choose. Rust owns the file and the write path: it keeps the authoritative in-memory copy of the
//! `stores` map, writes it debounced (400 ms trailing, 2 s max wait) and atomically (temp file in the
//! same folder, fsync, rename, fsync of the directory), and flushes synchronously on exit. The
//! webview keeps only a synchronous mirror for the `pinia-plugin-persistedstate` adapter.
//!
//! Safety rules, all enforced at the single choke point [`Shared::write_locked`]:
//! - Only a state that is `ok` (or `write-failed`, which retries) may write. A newer schema, an
//!   unreadable file or a file that vanished is never touched: the app runs from memory.
//! - [`data_init`] is the only path that creates the file, and it refuses to overwrite one.
//! - Every write goes through [`write_atomic`]; a crash mid-write leaves the previous valid file.
//!
//! Safety rules added by #224 (ADR 011), all in the same choke point:
//! - [`Shared::gate`] stats the file before every write and, when size/mtime moved, hashes it: a hash
//!   other than `last_seen.hash` means another writer changed it, the status becomes `conflict` and the
//!   write is refused. Bytes a sync client rewrote identically are not a conflict.
//! - A folder that is gone, unreadable or too slow (10 s) is `folder-unavailable`: nothing is written,
//!   not even a temp file, until a look at the folder succeeds again ([`Shared::watch_tick`]).
//! - Backups ([`backup`]) are verbatim copies of the last valid on-disk state; mandatory ones block
//!   their operation when they fail.
//!
//! Left for #225: the `data_flush` command (`DataFile::flush`); `appVersion` is already in the envelope.

pub(crate) mod backup;
mod cloud;
mod guard;

#[cfg(test)]
mod tests_cloud;
#[cfg(test)]
mod tests_safety;

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use self::backup::{
    backup_dir, backup_names, device6, is_conflict_copy_name, is_plain_file_name, list_backups, local_day, parse_backup_name,
    prune, scan_conflict_copies, write_backup, BackupEntry, BackupKind, ConflictCopy,
};
use self::cloud::{system_reader, CloudProbe, CloudReader, CloudSync, CloudTracker, CLOUD_GRACE_SECS};
use self::guard::{
    probe, read_timed, run_timed, stamp_of, write_guarded, write_timed, ConflictInfo, ConflictState, Expect, FileStamp, IoFailure, Probe,
    TheirVersion,
};

/// Name of the data file inside the chosen folder.
pub const FILE_NAME: &str = "kan-do-data.json";
/// Per-device pointer to the chosen folder, stored in the app config dir (never in the synced folder).
pub const LOCATION_FILE: &str = "data-location.json";
/// Highest `schemaVersion` this build understands. Must equal `CURRENT_SCHEMA_VERSION` in
/// `utils/dataFile/envelope.ts` (a Vitest guard compares the two).
pub const SCHEMA_VERSION: u64 = 2;
const TMP_PREFIX: &str = ".kan-do-data.json.tmp";
const PROBE_PREFIX: &str = ".kan-do-probe";
const MAX_KEY_LEN: usize = 128;

/// Health of the data file. Anything but `Ok` and `WriteFailed` blocks every write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Ok,
    /// The file was written by a newer app version: hydrate it, never write, never down-migrate.
    ReadOnlyNewerSchema,
    /// The file exists but cannot be read or parsed: never overwritten.
    ReadOnlyCorrupt,
    /// A configured folder holds no file (never recreated from memory).
    MissingFile,
    /// The last write failed; retried on the next change and every `Timing::retry` while dirty.
    WriteFailed,
    /// The file on disk is not the one this app last read or wrote (another device, a hand edit):
    /// writes stay blocked until the user picks a version (#224).
    Conflict,
    /// The folder is missing, offline, unreadable or too slow: nothing is written, edits stay in memory (#224).
    FolderUnavailable,
}

impl Status {
    fn allows_write(self) -> bool {
        matches!(self, Status::Ok | Status::WriteFailed)
    }
}

/// Debounce timing, injectable so tests do not wait for seconds.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    pub debounce: Duration,
    pub max_wait: Duration,
    pub retry: Duration,
    /// A read or write of the folder that takes longer is an unavailable folder.
    pub io_timeout: Duration,
    /// Cadence of the watcher that looks for changes made elsewhere.
    pub watch: Duration,
    /// Two stats this far apart must agree before a changed file counts as settled (sync still running).
    pub settle: Duration,
    /// Retry delay while the folder is unavailable: starts at the first, doubles up to the second.
    pub backoff: (Duration, Duration),
    /// `uploading` / `pending` stay out of the notice this long after the first not-uploaded look (#271).
    pub cloud_grace: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            debounce: Duration::from_millis(400),
            max_wait: Duration::from_secs(2),
            retry: Duration::from_secs(5),
            io_timeout: Duration::from_secs(10),
            watch: Duration::from_secs(15),
            settle: Duration::from_millis(500),
            backoff: (Duration::from_secs(5), Duration::from_secs(60)),
            cloud_grace: Duration::from_secs(CLOUD_GRACE_SECS),
        }
    }
}

/// Wall-clock reading used for backup names and the "one daily backup per local day" rule.
#[derive(Debug, Clone, Copy)]
pub struct Moment {
    pub unix_secs: u64,
    /// Local UTC offset at that time, in seconds.
    pub utc_offset_secs: i64,
}

pub type Clock = dyn Fn() -> Moment + Send + Sync;

fn system_clock() -> Moment {
    let unix_secs = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    Moment { unix_secs, utc_offset_secs: local_utc_offset(unix_secs) }
}

#[cfg(unix)]
fn local_utc_offset(unix_secs: u64) -> i64 {
    let time = unix_secs as libc::time_t;
    // SAFETY: `localtime_r` only writes into the zeroed `tm` that this frame owns.
    let mut parts: libc::tm = unsafe { std::mem::zeroed() };
    if unsafe { libc::localtime_r(&time, &mut parts) }.is_null() { 0 } else { parts.tm_gmtoff }
}

#[cfg(not(unix))]
fn local_utc_offset(_unix_secs: u64) -> i64 {
    0
}

/// What the file looked like when it was last read or written by this process.
/// `hash` (SHA-256 of the bytes) is what #224's conflict check compares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LastSeen {
    pub hash: String,
    pub written_by: String,
    pub written_at: String,
}

/// Typed error returned to the frontend as `{ kind, ... }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DataError {
    /// The file cannot be written in the current state (read-only, missing, ...).
    Blocked { status: Status },
    /// The chosen folder is not writable.
    NotWritable,
    /// The target folder already holds a data file (mode `move`).
    TargetHasData,
    /// The target folder holds no data file (mode `use`).
    TargetEmpty,
    /// The data file in the target folder is unreadable (mode `use`).
    TargetCorrupt,
    /// The target is the folder already in use.
    SameFolder,
    /// A file already exists where `data_init` would create one.
    Exists,
    /// Unknown mode, bad key or nothing to reveal.
    Invalid,
    Io { message: String },
    /// The folder cannot be reached (missing, offline, permission, or no answer within the deadline).
    Unavailable { message: String },
    /// A mandatory backup failed, so the operation did not run.
    BackupFailed { message: String },
    /// The file to restore or import was written by a newer app version.
    NewerSchema,
    /// The file to restore or import is not a readable data file.
    Unreadable,
    /// The file on disk is no longer the version the user was shown: the choice was not carried out.
    Changed,
}

impl From<io::Error> for DataError {
    fn from(error: io::Error) -> Self {
        DataError::Io { message: error.to_string() }
    }
}

/// How the folder change treats the data in the target folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LocationMode {
    /// Copy my data into an empty folder (the old file stays).
    Move,
    /// Switch to the data already in the target folder.
    Use,
    /// Overwrite the data in the target folder with mine.
    Replace,
}

/// The snapshot the UI shows and the `data-status` event carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub status: Status,
    pub folder: String,
    pub file_path: String,
    pub written_at: Option<String>,
    pub schema_version: Option<u64>,
    pub device_id: String,
    /// Version of this build; written into exports.
    pub app_version: String,
    pub error: Option<String>,
    /// Set while the status is `conflict`: what the other version looks like and whether I hold edits.
    pub conflict: Option<ConflictInfo>,
    /// Cloud-sync conflict copies next to the data file (non-blocking).
    pub conflict_copies: Vec<ConflictCopy>,
    /// The last `daily` or `manual` backup failed (non-blocking).
    pub backup_error: Option<String>,
    /// Whether the latest save reached the cloud; iCloud folders only, `None` otherwise and in every
    /// status but `ok` / `write-failed` (non-blocking, #271).
    pub cloud_sync: Option<CloudSync>,
}

/// Result of [`DataFile::load`]: the raw envelope (un-migrated, for the TypeScript migration chain).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    #[serde(flatten)]
    pub state: StatusPayload,
    pub envelope: Option<Value>,
    /// True on the first run of this device: no location configured and no file yet.
    pub needs_init: bool,
    /// The webview must send this with every `data_set` (see [`DataFile::set_versioned`]).
    pub generation: u64,
}

/// What [`DataFile::inspect_folder`] reports about a candidate folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub writable: bool,
    /// `none`, `valid`, `newer-schema` or `corrupt`.
    pub existing: &'static str,
    pub written_at: Option<String>,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Location {
    folder: String,
    device_id: String,
}

type StatusCallback = dyn Fn(&StatusPayload) + Send + Sync;

struct Config {
    config_dir: PathBuf,
    default_folder: PathBuf,
    app_version: String,
    timing: Timing,
    clock: Box<Clock>,
    cloud_reader: Arc<CloudReader>,
    on_status: Box<StatusCallback>,
}

struct Inner {
    folder: PathBuf,
    device_id: String,
    app_version: String,
    /// True once `data-location.json` exists for this device.
    location_saved: bool,
    stores: Map<String, Value>,
    status: Status,
    error: Option<String>,
    /// Bumped by every `load` and by a successful `use` switch. A `data_set` that carries another
    /// value comes from a webview that has not re-loaded yet and is dropped (see [`DataFile::set_versioned`]).
    generation: u64,
    /// Highest `seq` applied per key in this generation; an older (reordered) `data_set` is dropped.
    applied_seq: HashMap<String, u64>,
    dirty: bool,
    first_dirty: Option<Instant>,
    last_change: Option<Instant>,
    last_attempt: Option<Instant>,
    last_seen: Option<LastSeen>,
    /// Size and mtime of the file when `last_seen` was taken: the cheap "did anything change" test.
    last_stamp: Option<FileStamp>,
    written_at: Option<String>,
    schema_version: Option<u64>,
    shutdown: bool,
    /// Set while the status is `conflict`.
    conflict: Option<ConflictState>,
    conflict_copies: Vec<ConflictCopy>,
    backup_error: Option<String>,
    /// Upload state of the data file in a cloud folder (#271).
    cloud: CloudTracker,
    /// Local day (days since the epoch) of the newest own `daily` backup; `None` until looked up.
    daily_day: Option<i64>,
    daily_scanned: bool,
    daily_attempt: Option<Instant>,
    /// A changed file that is still syncing: the writer looks again at this time.
    retry_at: Option<Instant>,
    /// Current delay of the retry while the folder is unavailable.
    backoff: Duration,
    /// The unsaved-state backup for the exit path was already taken for the current edits.
    exit_saved: bool,
}

impl Inner {
    fn file_path(&self) -> PathBuf {
        self.folder.join(FILE_NAME)
    }

    /// Edits that are not in the file. Every `data_set` is a store mutation (the persistence plugin only
    /// writes on `$subscribe`, never to store defaults at hydration), so after a launch that could not
    /// read the file the first call for a key is as much an edit as a later one: `dirty` is the answer.
    fn local_changes(&self) -> bool {
        self.dirty
    }

    /// States a restore or import may replace the file out of (see [`DataFile::replace_with`]). A corrupt
    /// file is only fair game when the pointer to the folder is fine: an unreadable pointer means the
    /// file next to it may not be the one the user chose.
    fn restorable(&self) -> bool {
        match self.status {
            Status::Ok | Status::WriteFailed | Status::MissingFile => true,
            Status::ReadOnlyCorrupt => self.location_saved,
            Status::ReadOnlyNewerSchema | Status::Conflict | Status::FolderUnavailable => false,
        }
    }

    fn payload(&self) -> StatusPayload {
        let conflict = match (self.status, &self.conflict) {
            (Status::Conflict, Some(state)) => Some(ConflictInfo::new(state, self.local_changes(), &self.stores)),
            _ => None,
        };
        StatusPayload {
            status: self.status,
            folder: self.folder.to_string_lossy().into_owned(),
            file_path: self.file_path().to_string_lossy().into_owned(),
            written_at: self.written_at.clone(),
            schema_version: self.schema_version,
            device_id: self.device_id.clone(),
            app_version: self.app_version.clone(),
            error: self.error.clone(),
            conflict,
            conflict_copies: self.conflict_copies.clone(),
            backup_error: self.backup_error.clone(),
            cloud_sync: self.cloud_sync(),
        }
    }

    /// Only a state that may write reports the cloud: every other notice owns the screen.
    fn cloud_sync(&self) -> Option<CloudSync> {
        if self.status.allows_write() { self.cloud.current() } else { None }
    }

    /// Records the file as this process last read or wrote it.
    fn set_seen(&mut self, seen: LastSeen, stamp: Option<FileStamp>) {
        self.written_at = Some(seen.written_at.clone());
        self.last_seen = Some(seen);
        self.last_stamp = stamp;
    }

    /// Forgets everything that belongs to one load of the file.
    fn reset_session(&mut self) {
        self.conflict = None;
        self.exit_saved = false;
        self.retry_at = None;
    }

    /// State that belongs to the folder in use; a folder switch starts it over.
    fn forget_folder_state(&mut self) {
        self.conflict_copies.clear();
        self.backup_error = None;
        self.cloud = CloudTracker::default();
        self.daily_scanned = false;
        self.daily_day = None;
        self.daily_attempt = None;
    }

    /// When the writer thread should write next; `None` while there is nothing to do.
    fn next_deadline(&self, timing: &Timing) -> Option<Instant> {
        if !self.dirty || !self.status.allows_write() {
            return None;
        }
        if let Some(at) = self.retry_at {
            return Some(at);
        }
        if self.status == Status::WriteFailed {
            if let Some(attempt) = self.last_attempt {
                return Some(attempt + timing.retry);
            }
        }
        let trailing = self.last_change? + timing.debounce;
        let ceiling = self.first_dirty? + timing.max_wait;
        Some(trailing.min(ceiling))
    }
}

struct Shared {
    inner: Mutex<Inner>,
    cv: Condvar,
    cfg: Config,
    writes: AtomicUsize,
    /// Wakes the watcher early (window focus, "Erneut versuchen").
    poke: Mutex<bool>,
    poke_cv: Condvar,
}

/// The persisted state of the desktop app. One instance is managed by Tauri.
pub struct DataFile {
    shared: Arc<Shared>,
}

impl Drop for DataFile {
    fn drop(&mut self) {
        self.shared.lock().shutdown = true;
        self.shared.cv.notify_all();
        self.shared.poke_cv.notify_all();
    }
}

/// What a look at the file in front of a write (or a backup) found.
enum Gate {
    /// Fine to go on. Carries the file's bytes when they were read (the daily backup needs them).
    Open(Option<Vec<u8>>),
    /// The file changed and is still changing (a sync client at work): look again shortly.
    Settling,
    Block(Status),
}

/// A failed `daily` backup is retried at most this often.
const DAILY_RETRY: Duration = Duration::from_secs(60);

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn emit(&self, inner: &Inner) {
        (self.cfg.on_status)(&inner.payload());
    }

    fn now(&self) -> Moment {
        (self.cfg.clock)()
    }

    /// Moves to `status` and announces it when it changed.
    fn enter(&self, inner: &mut Inner, status: Status) {
        if inner.status == status {
            return;
        }
        inner.status = status;
        if status == Status::FolderUnavailable {
            inner.backoff = self.cfg.timing.backoff.0;
        }
        if status != Status::Conflict {
            inner.conflict = None;
        }
        self.emit(inner);
    }

    fn set_backup_error(&self, inner: &mut Inner, error: Option<String>) {
        if inner.backup_error != error {
            inner.backup_error = error;
            self.emit(inner);
        }
    }

    /// Looks at the file on disk and compares it with what this process last saw: the guard in front of
    /// every write and every backup. `force_hash` reads the bytes even when size and mtime are unchanged.
    fn inspect(&self, inner: &mut Inner, force_hash: bool) -> Gate {
        let timing = &self.cfg.timing;
        match probe(&inner.file_path(), inner.last_stamp, force_hash, timing.io_timeout, timing.settle) {
            // A configured folder we cannot reach: nothing is written. (A first run creates its folder.)
            Probe::Unreachable(reason) if inner.location_saved => {
                inner.error = Some(reason);
                Gate::Block(Status::FolderUnavailable)
            }
            Probe::Unreachable(_) | Probe::Unchanged => Gate::Open(None),
            // The file vanished since we last saw it: no recreate-from-memory.
            Probe::Missing if inner.last_seen.is_some() => Gate::Block(Status::MissingFile),
            Probe::Missing => Gate::Open(None),
            Probe::Syncing => Gate::Settling,
            Probe::Present { stamp, hash, parsed, bytes } => match &inner.last_seen {
                // Same bytes (a sync client rewrote them): not a conflict.
                Some(seen) if seen.hash == hash => {
                    inner.last_stamp = stamp;
                    Gate::Open(Some(bytes))
                }
                // Someone else wrote it.
                Some(_) => {
                    inner.conflict = Some(ConflictState {
                        theirs: TheirVersion::from_parsed(parsed.as_deref()),
                        hash: Some(hash),
                        stamp,
                        after_launch: false,
                    });
                    Gate::Block(Status::Conflict)
                }
                // Never read (or forgotten by a failed init), yet something is there: it is not ours to
                // replace. Creating the file is fine; replacing an unknown one is not.
                None => Gate::Block(Status::ReadOnlyCorrupt),
            },
        }
    }

    /// True when the first write of a new local day is about to happen and the previous on-disk state
    /// still has to be copied as `daily`.
    fn daily_due(&self, inner: &mut Inner) -> bool {
        if inner.last_seen.is_none() {
            return false;
        }
        let now = self.now();
        let today = local_day(now.unix_secs, now.utc_offset_secs);
        if !inner.daily_scanned {
            let dir = backup_dir(&inner.folder);
            let own = device6(&inner.device_id);
            // A folder that does not answer is the gate's business; any other listing problem is
            // "no daily known", and the attempt below surfaces it on the data page.
            let names = match run_timed(self.cfg.timing.io_timeout, move |_| backup_names(&dir)) {
                Ok(names) => names,
                Err(IoFailure::TimedOut) => return false,
                Err(IoFailure::Failed(_)) => Vec::new(),
            };
            inner.daily_scanned = true;
            inner.daily_day = names
                .iter()
                .filter_map(|name| parse_backup_name(name))
                .find(|parts| parts.kind == BackupKind::Daily && parts.device6 == own)
                .map(|parts| local_day(parts.unix_secs, now.utc_offset_secs));
        }
        inner.daily_day != Some(today) && inner.daily_attempt.map_or(true, |at| at.elapsed() >= DAILY_RETRY)
    }

    /// Copies the previous on-disk state as `daily`. Best effort: a failure shows on the data page and
    /// never blocks saving.
    fn take_daily(&self, inner: &mut Inner, bytes: Vec<u8>) {
        let now = self.now();
        inner.daily_attempt = Some(Instant::now());
        match self.write_backup_timed(inner, BackupKind::Daily, bytes) {
            Ok(_) => {
                inner.daily_day = Some(local_day(now.unix_secs, now.utc_offset_secs));
                inner.daily_attempt = None;
                self.set_backup_error(inner, None);
            }
            Err(message) => self.set_backup_error(inner, Some(message)),
        }
    }

    /// `write_backup` plus pruning, with the folder deadline.
    fn write_backup_timed(&self, inner: &Inner, kind: BackupKind, bytes: Vec<u8>) -> Result<String, String> {
        let folder = inner.folder.clone();
        let own = device6(&inner.device_id);
        let secs = self.now().unix_secs;
        run_timed(self.cfg.timing.io_timeout, move |_| {
            let name = write_backup(&folder, kind, &own, secs, &bytes)?;
            prune(&folder, &own);
            Ok(name)
        })
        .map_err(|failure| failure.message())
    }

    /// Saves edits that never reached the file as an `unsaved` backup. For callers that cannot refuse
    /// (a reload, quitting); the failure shows as `backup_error`. True when nothing is left unsaved.
    fn preserve_unsaved(&self, inner: &mut Inner) -> bool {
        if !inner.dirty || !inner.local_changes() || inner.exit_saved || inner.stores.is_empty() {
            return true;
        }
        let bytes = render(inner, &self.cfg.app_version, &iso_now());
        match self.write_backup_timed(inner, BackupKind::Unsaved, bytes) {
            Ok(_) => {
                inner.exit_saved = true;
                true
            }
            Err(message) => {
                self.set_backup_error(inner, Some(message));
                false
            }
        }
    }

    /// Copies the data file as it is on disk into `backups/`. Refuses unless the bytes are the ones this
    /// process last read or wrote: a changed file is a conflict, not something to back up as "mine".
    fn backup_current(&self, inner: &mut Inner, kind: BackupKind) -> Result<String, DataError> {
        self.backup_current_bytes(inner, kind).map(|(name, _)| name)
    }

    /// [`DataFile::backup_current`] that also returns the bytes it copied, for a caller that commits a
    /// write guarded by exactly those bytes (`replace_with`).
    fn backup_current_bytes(&self, inner: &mut Inner, kind: BackupKind) -> Result<(String, Vec<u8>), DataError> {
        if !matches!(inner.status, Status::Ok | Status::WriteFailed | Status::ReadOnlyNewerSchema) {
            return Err(DataError::Blocked { status: inner.status });
        }
        let bytes = match self.inspect(inner, true) {
            Gate::Open(Some(bytes)) => bytes,
            Gate::Open(None) => return Err(DataError::BackupFailed { message: "there is no data file to copy yet".into() }),
            Gate::Settling => return Err(DataError::Io { message: "the data file is still being synced".into() }),
            Gate::Block(status) => {
                self.enter(inner, status);
                return Err(DataError::Blocked { status });
            }
        };
        self.write_backup_timed(inner, kind, bytes.clone())
            .map(|name| (name, bytes))
            .map_err(|message| DataError::BackupFailed { message })
    }

    /// A conflict copy that is gone from the folder (a sync client moved or deleted it since the last
    /// scan) leaves the list at once, without waiting for the watcher. Other names are not copies.
    fn forget_vanished_copy(&self, name: &str) {
        if !is_conflict_copy_name(name) {
            return;
        }
        let mut inner = self.lock();
        let before = inner.conflict_copies.len();
        inner.conflict_copies.retain(|copy| copy.name != name);
        if inner.conflict_copies.len() != before {
            self.emit(&inner);
        }
    }

    /// Pending edits that a restore is about to replace go to `backups/` first (`pre-restore`, mandatory).
    fn keep_memory_as_pre_restore(&self, inner: &Inner) -> Result<(), DataError> {
        if !inner.dirty || inner.stores.is_empty() {
            return Ok(());
        }
        let state = render(inner, &self.cfg.app_version, &iso_now());
        self.write_backup_timed(inner, BackupKind::PreRestore, state)
            .map(|_| ())
            .map_err(|message| DataError::BackupFailed { message })
    }

    /// A restore out of `missing-file` looks at the path once more before it writes: a file that came
    /// back since the last watcher tick is classified like any other change (conflict, corrupt, or the
    /// known file, which returns the state to `ok`) and the restore does not run over it.
    fn recheck_missing(&self, inner: &mut Inner) -> Result<(), DataError> {
        let timing = &self.cfg.timing;
        match probe(&inner.file_path(), None, true, timing.io_timeout, timing.settle) {
            Probe::Missing => Ok(()),
            Probe::Unreachable(reason) => {
                inner.error = Some(reason.clone());
                self.enter(inner, Status::FolderUnavailable);
                Err(DataError::Unavailable { message: reason })
            }
            Probe::Syncing => Err(DataError::Io { message: "the data file is still being synced".into() }),
            Probe::Unchanged => Err(DataError::Blocked { status: inner.status }),
            found @ Probe::Present { .. } => {
                self.apply_probe(inner, found);
                if inner.status == Status::Ok { Ok(()) } else { Err(DataError::Blocked { status: inner.status }) }
            }
        }
    }

    /// Writes the in-memory copy if it is dirty and the state allows it. The caller holds the lock.
    /// Updates `status` and emits `data-status` when it changes.
    fn write_locked(&self, inner: &mut Inner) -> Result<(), DataError> {
        inner.last_attempt = Some(Instant::now());
        inner.retry_at = None;
        if !inner.status.allows_write() {
            return Err(DataError::Blocked { status: inner.status });
        }
        let due = self.daily_due(inner);
        match self.inspect(inner, due) {
            Gate::Open(bytes) => {
                if let Some(bytes) = bytes.filter(|_| due) {
                    self.take_daily(inner, bytes);
                }
            }
            Gate::Settling => {
                inner.retry_at = Some(Instant::now() + self.cfg.timing.settle);
                return Err(DataError::Io { message: "the data file is still being synced".into() });
            }
            Gate::Block(status) => {
                self.enter(inner, status);
                return Err(DataError::Blocked { status });
            }
        }
        let written_at = iso_now();
        let bytes = render(inner, &self.cfg.app_version, &written_at);
        let hash = sha256_hex(&bytes);
        let file = inner.file_path();
        let timeout = self.cfg.timing.io_timeout;
        match write_timed(&file, bytes, timeout) {
            Ok(()) => {
                self.writes.fetch_add(1, Ordering::SeqCst);
                let seen = LastSeen { hash, written_by: inner.device_id.clone(), written_at };
                inner.set_seen(seen, stamp_of(&file, timeout));
                inner.schema_version = Some(SCHEMA_VERSION);
                // The file has landed; only then does the pointer matter. A failing pointer keeps the
                // state dirty so the writer retries it, but the file is already known (no read-only
                // dead end on the next attempt).
                let located = if inner.location_saved {
                    Ok(())
                } else {
                    save_location(&self.cfg.config_dir, &inner.folder, &inner.device_id)
                };
                match located {
                    Ok(()) => {
                        inner.location_saved = true;
                        inner.dirty = false;
                        inner.first_dirty = None;
                        inner.error = None;
                        inner.status = Status::Ok;
                        // Every successful write is announced: the UI shows "last saved".
                        self.emit(inner);
                        Ok(())
                    }
                    Err(error) => Err(self.write_failed(inner, error.to_string())),
                }
            }
            Err(IoFailure::TimedOut) => {
                inner.error = Some("timed out".into());
                self.enter(inner, Status::FolderUnavailable);
                Err(DataError::Unavailable { message: "timed out".into() })
            }
            Err(IoFailure::Failed(error)) => Err(self.write_failed(inner, error.to_string())),
        }
    }

    fn write_failed(&self, inner: &mut Inner, message: String) -> DataError {
        let changed = inner.status != Status::WriteFailed || inner.error.as_deref() != Some(&message);
        inner.status = Status::WriteFailed;
        inner.error = Some(message.clone());
        // The max-wait window of this attempt is spent. Without the reset every later change would
        // find the ceiling already past and retry immediately instead of after the debounce.
        inner.first_dirty = None;
        if changed {
            self.emit(inner);
        }
        DataError::Io { message }
    }

    /// One look at the folder: change detection, recovery from `folder-unavailable` and the scan for
    /// cloud-sync conflict copies. All I/O runs without the lock; the result is applied only when the
    /// state did not move meanwhile. Called by the watcher thread, on window focus and by "Erneut versuchen".
    fn watch_tick(&self) {
        let timing = &self.cfg.timing;
        let (generation, status, file, folder, last_stamp, seen_hash) = {
            let inner = self.lock();
            if inner.shutdown || !inner.location_saved {
                return;
            }
            // In a conflict the file is compared with the version the modal shows, not the one this app wrote.
            let stamp = match (&inner.status, &inner.conflict) {
                (Status::Conflict, Some(state)) => state.stamp.or(inner.last_stamp),
                _ => inner.last_stamp,
            };
            let seen_hash = inner.last_seen.as_ref().map(|seen| seen.hash.clone());
            (inner.generation, inner.status, inner.file_path(), inner.folder.clone(), stamp, seen_hash)
        };
        let main = matches!(
            status,
            Status::Ok
                | Status::WriteFailed
                | Status::FolderUnavailable
                | Status::MissingFile
                | Status::ReadOnlyCorrupt
                | Status::Conflict
        );
        let file_for_cloud = file.clone();
        let mut found = main.then(|| probe(&file, last_stamp, false, timing.io_timeout, timing.settle));
        // A file that disappears must stay gone for two looks: sync clients replace files by delete + create.
        if matches!(found, Some(Probe::Missing)) && matches!(status, Status::Ok | Status::WriteFailed) {
            thread::sleep(timing.settle);
            found = Some(probe(&file, last_stamp, false, timing.io_timeout, timing.settle));
        }
        let copies = if matches!(found, Some(Probe::Unreachable(_))) {
            None
        } else {
            let scan_folder = folder.clone();
            run_timed(timing.io_timeout, move |_| scan_conflict_copies(&scan_folder, &|path| fs::read(path))).ok()
        };
        // Cloud upload state (#271): only while the file is in use (`ok` / `write-failed`) and the probe
        // saw it. A read that times out or fails leaves the previous value; it is never a status.
        let cloud = (status.allows_write() && !matches!(found, Some(Probe::Unreachable(_) | Probe::Missing))).then(|| {
            let reader = Arc::clone(&self.cfg.cloud_reader);
            run_timed(timing.io_timeout, move |_| reader(&file_for_cloud)).ok()
        });

        let mut inner = self.lock();
        // Also dropped when this process wrote the file meanwhile: the probe may describe our own older write.
        let seen_moved = inner.last_seen.as_ref().map(|seen| &seen.hash) != seen_hash.as_ref();
        if inner.generation != generation || inner.status != status || inner.folder != folder || inner.shutdown || seen_moved {
            return;
        }
        if let Some(found) = found {
            self.apply_probe(&mut inner, found);
        }
        if let Some(copies) = copies {
            if copies != inner.conflict_copies {
                inner.conflict_copies = copies;
                self.emit(&inner);
            }
        }
        // The probe above may have moved the status (a conflict, a vanished file): then the cloud
        // answer is not reported, the notice for that status owns the screen. The tracker starts over,
        // so neither a stale value nor a spent grace greets the file when it returns to use.
        if !inner.status.allows_write() {
            inner.cloud = CloudTracker::default();
        } else if let Some(Some(answer)) = cloud {
            self.apply_cloud(&mut inner, answer);
        }
    }

    /// Feeds one answer of the cloud reader to the tracker; announces only a changed payload.
    fn apply_cloud(&self, inner: &mut Inner, answer: CloudProbe) {
        let unix_secs = self.now().unix_secs;
        let grace = self.cfg.timing.cloud_grace;
        if inner.cloud.observe(answer, Instant::now(), grace, || iso_from_unix(unix_secs, 0)) {
            self.emit(inner);
        }
    }

    fn apply_probe(&self, inner: &mut Inner, found: Probe) {
        match found {
            Probe::Unreachable(reason) => {
                inner.error = Some(reason);
                if inner.status == Status::FolderUnavailable {
                    inner.backoff = (inner.backoff * 2).min(self.cfg.timing.backoff.1);
                } else {
                    self.enter(inner, Status::FolderUnavailable);
                }
            }
            Probe::Missing => match inner.status {
                Status::Ok | Status::WriteFailed if inner.last_seen.is_some() => self.enter(inner, Status::MissingFile),
                Status::FolderUnavailable | Status::ReadOnlyCorrupt => {
                    inner.error = None;
                    self.enter(inner, Status::MissingFile);
                }
                _ => {}
            },
            Probe::Syncing => {}
            Probe::Unchanged => {
                if inner.status == Status::FolderUnavailable {
                    self.recover(inner);
                }
            }
            Probe::Present { stamp, hash, parsed, .. } => match inner.status {
                Status::Ok | Status::WriteFailed => match &inner.last_seen {
                    Some(seen) if seen.hash == hash => inner.last_stamp = stamp,
                    Some(_) => self.raise_conflict(inner, parsed.as_deref(), hash, stamp, false),
                    None => {}
                },
                // The other side of a conflict moves on (a download finishes, a third device writes) and
                // can return to the version this app knows: the modal follows, or the conflict is gone.
                Status::Conflict => match &inner.last_seen {
                    Some(seen) if seen.hash == hash => {
                        inner.last_stamp = stamp;
                        self.recover(inner);
                    }
                    _ => self.refresh_conflict(inner, parsed.as_deref(), hash, stamp),
                },
                Status::FolderUnavailable | Status::MissingFile | Status::ReadOnlyCorrupt => {
                    let seen_hash = inner.last_seen.as_ref().map(|seen| seen.hash.clone());
                    match (parsed, seen_hash) {
                        (None, _) => {
                            inner.error = Some("the data file cannot be read".into());
                            self.enter(inner, Status::ReadOnlyCorrupt);
                        }
                        (Some(_), Some(known)) if known == hash && inner.status != Status::ReadOnlyCorrupt => {
                            inner.last_stamp = stamp;
                            self.recover(inner);
                        }
                        (Some(theirs), seen) => self.raise_conflict(inner, Some(&theirs), hash, stamp, seen.is_none()),
                    }
                }
                _ => {}
            },
        }
    }

    fn raise_conflict(&self, inner: &mut Inner, theirs: Option<&Parsed>, hash: String, stamp: Option<FileStamp>, after_launch: bool) {
        inner.conflict = Some(ConflictState { theirs: TheirVersion::from_parsed(theirs), hash: Some(hash), stamp, after_launch });
        inner.error = None;
        self.enter(inner, Status::Conflict);
    }

    /// Updates what a standing conflict says about the other side and announces it when it differs.
    fn refresh_conflict(&self, inner: &mut Inner, theirs: Option<&Parsed>, hash: String, stamp: Option<FileStamp>) {
        let Some(state) = inner.conflict.as_mut() else { return };
        let shown = TheirVersion::from_parsed(theirs);
        let changed = state.hash.as_deref() != Some(hash.as_str()) || state.theirs != shown;
        state.stamp = stamp;
        if changed {
            state.theirs = shown;
            state.hash = Some(hash);
            self.emit(inner);
        }
    }

    /// The folder is back and holds the file this process knows: pending edits are written again.
    fn recover(&self, inner: &mut Inner) {
        inner.error = None;
        inner.backoff = self.cfg.timing.backoff.0;
        inner.last_attempt = None;
        inner.retry_at = None;
        self.enter(inner, Status::Ok);
        self.cv.notify_all();
    }
}

fn writer_loop(shared: Arc<Shared>) {
    let mut guard = shared.lock();
    loop {
        if guard.shutdown {
            return;
        }
        match guard.next_deadline(&shared.cfg.timing) {
            None => {
                guard = shared.cv.wait(guard).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            Some(deadline) => {
                let now = Instant::now();
                if now >= deadline {
                    let _ = shared.write_locked(&mut guard);
                } else {
                    guard = shared
                        .cv
                        .wait_timeout(guard, deadline - now)
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .0;
                }
            }
        }
    }
}

/// Takes a backup of the data file in `target`'s folder before `data_set_location` overwrites it.
/// Mandatory: when it fails the replace does not happen. The bytes are copied verbatim, readable or not.
fn before_replace(shared: &Shared, device_id: &str, target: &Path) -> Result<(), DataError> {
    let folder = target.parent().map(Path::to_path_buf).ok_or(DataError::Invalid)?;
    let bytes = read_timed(target, shared.cfg.timing.io_timeout)
        .map_err(|failure| DataError::BackupFailed { message: failure.message() })?;
    let own = device6(device_id);
    let secs = (shared.cfg.clock)().unix_secs;
    run_timed(shared.cfg.timing.io_timeout, move |_| {
        let name = write_backup(&folder, BackupKind::PreReplace, &own, secs, &bytes)?;
        prune(&folder, &own);
        Ok(name)
    })
    .map(|_| ())
    .map_err(|failure| DataError::BackupFailed { message: failure.message() })
}

/// The envelope as it is written; borrows the stores so a write does not clone them under the lock.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeRef<'a> {
    schema_version: u64,
    written_at: &'a str,
    written_by: &'a str,
    app_version: &'a str,
    stores: &'a Map<String, Value>,
}

fn render(inner: &Inner, app_version: &str, written_at: &str) -> Vec<u8> {
    let envelope = EnvelopeRef {
        schema_version: SCHEMA_VERSION,
        written_at,
        written_by: &inner.device_id,
        app_version,
        stores: &inner.stores,
    };
    let mut bytes = serde_json::to_vec_pretty(&envelope).unwrap_or_default();
    bytes.push(b'\n');
    bytes
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to `path` so that a crash at any point leaves either the old or the new file:
/// temp file in the same folder, fsync, rename over the target, fsync the directory.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomic_with(path, bytes, || Ok(()))
}

pub(crate) fn write_atomic_with(path: &Path, bytes: &[u8], before_rename: impl FnOnce() -> io::Result<()>) -> io::Result<()> {
    let dir = path.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    let tmp = dir.join(format!("{TMP_PREFIX}-{}-{}", std::process::id(), TMP_COUNTER.fetch_add(1, Ordering::SeqCst)));
    let staged = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        before_rename()?;
        fs::rename(&tmp, path)
    })();
    if let Err(error) = staged {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    // Best effort: the rename is done, a directory that cannot be fsynced must not fail the write.
    if let Ok(handle) = File::open(dir) {
        let _ = handle.sync_all();
    }
    Ok(())
}

fn save_location(config_dir: &Path, folder: &Path, device_id: &str) -> io::Result<()> {
    fs::create_dir_all(config_dir)?;
    let location = Location { folder: folder.to_string_lossy().into_owned(), device_id: device_id.to_string() };
    let bytes = serde_json::to_vec_pretty(&location).map_err(io::Error::other)?;
    write_atomic(&config_dir.join(LOCATION_FILE), &bytes)
}

/// What `data-location.json` holds. `Unreadable` is not a first run: the pointer exists but cannot
/// be trusted, so nothing may be imported or written until the user picks a folder.
enum LocationState {
    Absent,
    Unreadable(String),
    Found(Location),
}

fn read_location(config_dir: &Path) -> LocationState {
    let bytes = match fs::read(config_dir.join(LOCATION_FILE)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return LocationState::Absent,
        Err(error) => return LocationState::Unreadable(error.to_string()),
    };
    match serde_json::from_slice::<Location>(&bytes) {
        Ok(location) if !location.folder.is_empty() && !location.device_id.is_empty() => LocationState::Found(location),
        Ok(_) => LocationState::Unreadable(format!("{LOCATION_FILE} has an empty folder or device id")),
        Err(error) => LocationState::Unreadable(format!("{LOCATION_FILE}: {error}")),
    }
}

fn remove_stale_temp_files(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(TMP_PREFIX) || name.starts_with(PROBE_PREFIX) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// True when a file can be created in `folder` (probed with a throw-away file).
fn is_writable(folder: &Path) -> bool {
    let probe = folder.join(format!("{PROBE_PREFIX}-{}-{}", std::process::id(), TMP_COUNTER.fetch_add(1, Ordering::SeqCst)));
    match File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// A parsed data file.
pub(crate) struct Parsed {
    pub(crate) raw: Value,
    pub(crate) stores: Map<String, Value>,
    pub(crate) schema_version: u64,
    pub(crate) written_by: String,
    pub(crate) written_at: String,
}

enum FileState {
    Missing,
    Corrupt,
    /// The folder or the file cannot be reached (offline volume, permission, no answer in time).
    Unavailable(String),
    Valid { parsed: Box<Parsed>, hash: String },
}

pub(crate) fn parse_envelope(bytes: &[u8]) -> Option<Parsed> {
    let raw: Value = serde_json::from_slice(bytes).ok()?;
    let object = raw.as_object()?;
    let schema_version = object.get("schemaVersion")?.as_u64().filter(|version| *version >= 1)?;
    let stores = object.get("stores")?.as_object()?.clone();
    let text = |key: &str| object.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    Some(Parsed { written_by: text("writtenBy"), written_at: text("writtenAt"), schema_version, stores, raw })
}

fn read_state(path: &Path, timeout: Duration) -> FileState {
    match read_timed(path, timeout) {
        Ok(bytes) => match parse_envelope(&bytes) {
            Some(parsed) => FileState::Valid { parsed: Box::new(parsed), hash: sha256_hex(&bytes) },
            None => FileState::Corrupt,
        },
        // No file in a folder that is itself gone is not "no file": the folder is unavailable.
        Err(failure) if failure.is_not_found() => match path.parent().map(fs::metadata) {
            Some(Err(error)) => FileState::Unavailable(error.to_string()),
            _ => FileState::Missing,
        },
        // A directory or garbage where the file should be is a file problem; everything else
        // (permission, timeout, a volume that went away) is the folder.
        Err(IoFailure::Failed(error)) if matches!(error.kind(), io::ErrorKind::IsADirectory | io::ErrorKind::InvalidData) => {
            FileState::Corrupt
        }
        Err(failure) => FileState::Unavailable(failure.message()),
    }
}

impl DataFile {
    /// Creates the state and starts the writer thread. `on_status` receives every status change.
    pub fn new(
        config_dir: PathBuf,
        default_folder: PathBuf,
        app_version: String,
        timing: Timing,
        on_status: Box<StatusCallback>,
    ) -> DataFile {
        DataFile::with_clock(config_dir, default_folder, app_version, timing, Box::new(system_clock), on_status)
    }

    /// Like [`DataFile::new`] with an injectable clock (backup names, "one daily backup per local day").
    pub fn with_clock(
        config_dir: PathBuf,
        default_folder: PathBuf,
        app_version: String,
        timing: Timing,
        clock: Box<Clock>,
        on_status: Box<StatusCallback>,
    ) -> DataFile {
        DataFile::with_parts(config_dir, default_folder, app_version, timing, clock, Arc::new(system_reader), on_status)
    }

    /// Like [`DataFile::with_clock`] with an injectable reader of the cloud upload state (#271).
    pub fn with_parts(
        config_dir: PathBuf,
        default_folder: PathBuf,
        app_version: String,
        timing: Timing,
        clock: Box<Clock>,
        cloud_reader: Arc<CloudReader>,
        on_status: Box<StatusCallback>,
    ) -> DataFile {
        let inner = Inner {
            folder: default_folder.clone(),
            device_id: String::new(),
            app_version: app_version.clone(),
            location_saved: false,
            stores: Map::new(),
            status: Status::Ok,
            error: None,
            generation: 0,
            applied_seq: HashMap::new(),
            dirty: false,
            first_dirty: None,
            last_change: None,
            last_attempt: None,
            last_seen: None,
            last_stamp: None,
            written_at: None,
            schema_version: None,
            shutdown: false,
            conflict: None,
            conflict_copies: Vec::new(),
            backup_error: None,
            cloud: CloudTracker::default(),
            daily_day: None,
            daily_scanned: false,
            daily_attempt: None,
            retry_at: None,
            backoff: timing.backoff.0,
            exit_saved: false,
        };
        let shared = Arc::new(Shared {
            inner: Mutex::new(inner),
            cv: Condvar::new(),
            cfg: Config { config_dir, default_folder, app_version, timing, clock, cloud_reader, on_status },
            writes: AtomicUsize::new(0),
            poke: Mutex::new(false),
            poke_cv: Condvar::new(),
        });
        let worker = Arc::clone(&shared);
        thread::Builder::new()
            .name("kan-do-data-writer".into())
            .spawn(move || writer_loop(worker))
            .expect("spawn data writer thread");
        DataFile { shared }
    }

    /// Reads the location and the file. Pending changes are flushed first, so a window reload never
    /// loses an edit. Idempotent: the state is re-read from disk on every call.
    ///
    /// Known limit (ADR 011): a reload cannot be vetoed from Rust, and keeping the old in-memory copy
    /// across a load would risk a stale write over a file that changed meanwhile. So edits that could
    /// not be saved are kept as an `unsaved` backup; when even that fails the failure is surfaced as
    /// `backup_error` (not cleared by `load`) and the edits are lost.
    pub fn load(&self) -> LoadResult {
        let shared = &self.shared;
        let mut inner = shared.lock();
        if inner.dirty {
            if inner.status.allows_write() {
                let _ = shared.write_locked(&mut inner);
            }
            // Edits that could not be saved (blocked, failed, conflict) must not vanish with the reload.
            if inner.dirty {
                shared.preserve_unsaved(&mut inner);
            }
        }

        inner.generation += 1;
        inner.applied_seq.clear();
        inner.stores = Map::new();
        inner.dirty = false;
        inner.first_dirty = None;
        inner.last_change = None;
        inner.last_attempt = None;
        inner.last_seen = None;
        inner.last_stamp = None;
        inner.written_at = None;
        inner.schema_version = None;
        inner.error = None;
        inner.reset_session();
        inner.daily_scanned = false;
        inner.daily_day = None;
        inner.daily_attempt = None;

        match read_location(&shared.cfg.config_dir) {
            LocationState::Found(location) => {
                inner.location_saved = true;
                inner.folder = PathBuf::from(location.folder);
                inner.device_id = location.device_id;
            }
            LocationState::Absent => {
                inner.location_saved = false;
                inner.folder = shared.cfg.default_folder.clone();
                if inner.device_id.is_empty() {
                    inner.device_id = uuid::Uuid::new_v4().to_string();
                }
            }
            LocationState::Unreadable(reason) => {
                // Not a first run: the user may have chosen another folder. Touch nothing (no import, no
                // adoption, no stale-temp cleanup) and let them pick a folder again.
                inner.location_saved = false;
                inner.folder = shared.cfg.default_folder.clone();
                if inner.device_id.is_empty() {
                    inner.device_id = uuid::Uuid::new_v4().to_string();
                }
                inner.status = Status::ReadOnlyCorrupt;
                inner.error = Some(reason);
                shared.emit(&inner);
                return LoadResult { state: inner.payload(), envelope: None, needs_init: false, generation: inner.generation };
            }
        }
        let timeout = shared.cfg.timing.io_timeout;
        let state = read_state(&inner.file_path(), timeout);
        if !matches!(state, FileState::Unavailable(_)) {
            remove_stale_temp_files(&inner.folder);
        }

        let mut envelope = None;
        let mut needs_init = false;
        match state {
            FileState::Unavailable(reason) => {
                // Nothing is read, nothing will be written; the watcher retries and the notice says so.
                inner.status = Status::FolderUnavailable;
                inner.error = Some(reason);
                inner.backoff = shared.cfg.timing.backoff.0;
            }
            FileState::Missing if inner.location_saved => inner.status = Status::MissingFile,
            FileState::Missing => {
                inner.status = Status::Ok;
                needs_init = true;
            }
            FileState::Corrupt => inner.status = Status::ReadOnlyCorrupt,
            FileState::Valid { parsed, hash } => {
                inner.status = if parsed.schema_version > SCHEMA_VERSION { Status::ReadOnlyNewerSchema } else { Status::Ok };
                let seen = LastSeen { hash, written_by: parsed.written_by, written_at: parsed.written_at.clone() };
                let stamp = stamp_of(&inner.file_path(), timeout);
                inner.set_seen(seen, stamp);
                inner.schema_version = Some(parsed.schema_version);
                inner.stores = parsed.stores;
                envelope = Some(parsed.raw);
                if !inner.location_saved {
                    // A file in the default folder without a pointer (the pointer was deleted): adopt it.
                    let adopted = save_location(&shared.cfg.config_dir, &inner.folder, &inner.device_id);
                    inner.location_saved = adopted.is_ok();
                }
            }
        }
        shared.emit(&inner);
        LoadResult { state: inner.payload(), envelope, needs_init, generation: inner.generation }
    }

    /// Updates one store in memory and schedules a debounced write, without the ordering guards of
    /// [`DataFile::set_versioned`] (the unit tests drive the state machine with it).
    /// The memory copy is kept in every state, so "start fresh" and a folder move can use it.
    #[cfg(test)]
    pub fn set(&self, key: &str, value: Value) -> Result<(), DataError> {
        self.apply_set(key, value, None).map(|_| ())
    }

    /// The webview's `data_set`. `generation` is the one `load` returned to that webview and `seq` is its
    /// per-page counter, so two guards hold even though the commands run concurrently on the async runtime:
    /// - A stale `generation` (a `use` switch swapped the data underneath, the reload has not happened yet)
    ///   is dropped, so the old device's state cannot land in the newly chosen file.
    /// - A `seq` not above the last applied one for the key (a reordered older call) is dropped, so the
    ///   newest store always wins.
    ///
    /// Returns whether the value was applied; a dropped call is not an error.
    pub fn set_versioned(&self, key: &str, value: Value, generation: u64, seq: u64) -> Result<bool, DataError> {
        self.apply_set(key, value, Some((generation, seq)))
    }

    /// The memory copy is kept in every state, so "start fresh" and a folder move can use it.
    fn apply_set(&self, key: &str, value: Value, version: Option<(u64, u64)>) -> Result<bool, DataError> {
        if key.is_empty() || key.len() > MAX_KEY_LEN {
            return Err(DataError::Invalid);
        }
        let now = Instant::now();
        let mut inner = self.shared.lock();
        if let Some((generation, seq)) = version {
            if generation != inner.generation || inner.applied_seq.get(key).is_some_and(|applied| *applied >= seq) {
                return Ok(false);
            }
            inner.applied_seq.insert(key.to_string(), seq);
        }
        if inner.stores.get(key) == Some(&value) {
            return Ok(true);
        }
        let had_changes = inner.local_changes();
        inner.stores.insert(key.to_string(), value);
        inner.exit_saved = false;
        inner.dirty = true;
        inner.first_dirty.get_or_insert(now);
        inner.last_change = Some(now);
        // A change retries a failed write after the debounce instead of waiting for the retry timer.
        inner.last_attempt = None;
        if inner.status == Status::Conflict && !had_changes && inner.local_changes() {
            // The conflict modal shows whether I hold edits: tell it.
            self.shared.emit(&inner);
        }
        drop(inner);
        self.shared.cv.notify_all();
        Ok(true)
    }

    /// Writes pending changes now. `Ok` when nothing was pending; an error when changes could not be
    /// saved (read-only state, missing file, I/O failure).
    pub fn flush(&self) -> Result<(), DataError> {
        let mut inner = self.shared.lock();
        if !inner.dirty {
            return Ok(());
        }
        self.shared.write_locked(&mut inner)
    }

    /// Best-effort flush for the exit path; never panics and never blocks on a missing folder.
    ///
    /// Edits that cannot go to the main file (a conflict, a folder that stays unavailable, a missing or
    /// unreadable file) are saved as an `unsaved` backup instead; the main file is never touched in those states.
    pub fn flush_on_exit(&self, final_exit: bool) {
        let shared = &self.shared;
        // One last look: a folder that came back (or a file that changed) decides where the edits go.
        let needs_look = {
            let inner = shared.lock();
            inner.dirty && inner.status == Status::FolderUnavailable
        };
        if needs_look {
            shared.watch_tick();
        }
        let mut inner = shared.lock();
        if inner.dirty {
            if inner.status.allows_write() {
                let _ = shared.write_locked(&mut inner);
            }
            // Whatever the write could not take (a conflict, a gone folder or file, a failed or still
            // settling write) is kept; a newer-schema state holds data this build must not re-render.
            if inner.dirty && inner.status != Status::ReadOnlyNewerSchema {
                shared.preserve_unsaved(&mut inner);
            }
        }
        if final_exit {
            inner.shutdown = true;
            drop(inner);
            shared.cv.notify_all();
            shared.poke_cv.notify_all();
        }
    }

    /// Creates the file from `stores`: the first-run import and "start here" after `missing-file`.
    /// The only path that creates the file, and it never overwrites an existing one.
    pub fn init(&self, stores: Map<String, Value>) -> Result<StatusPayload, DataError> {
        let shared = &self.shared;
        let mut inner = shared.lock();
        let first_run = !inner.location_saved && inner.status == Status::Ok;
        if !(first_run || inner.status == Status::MissingFile) {
            return Err(DataError::Blocked { status: inner.status });
        }
        if inner.file_path().exists() {
            return Err(DataError::Exists);
        }
        if inner.device_id.is_empty() {
            inner.device_id = uuid::Uuid::new_v4().to_string();
        }
        let folder = inner.folder.clone();
        // A configured folder is never created again: when it is gone the volume is offline (or the
        // folder was renamed) and "start here" would build a new tree where the real data will return.
        // The folder is unavailable then, and the file stays untouched.
        if inner.status == Status::MissingFile {
            let gone = match fs::metadata(&folder) {
                Ok(metadata) if metadata.is_dir() => None,
                Ok(_) => Some("the data folder is not a folder".to_string()),
                Err(error) => Some(error.to_string()),
            };
            if let Some(message) = gone {
                inner.error = Some(message.clone());
                shared.enter(&mut inner, Status::FolderUnavailable);
                return Err(DataError::Unavailable { message });
            }
        }
        let created = if inner.status == Status::MissingFile { Ok(()) } else { fs::create_dir_all(&folder) };
        // A configured folder that cannot be created (volume gone) stays `missing-file`, untouched:
        // a write-failed state would let the writer replace the real file once the volume returns.
        if let (Status::MissingFile, Err(error)) = (inner.status, &created) {
            return Err(DataError::Io { message: error.to_string() });
        }
        // First run: take the data before anything fallible, so a folder that cannot be created now is
        // retried by the writer thread, which then writes the complete import.
        inner.stores = stores;
        inner.status = Status::Ok;
        inner.last_seen = None;
        inner.dirty = true;
        inner.first_dirty.get_or_insert_with(Instant::now);
        inner.last_change = Some(Instant::now());
        if let Err(error) = created {
            inner.status = Status::WriteFailed;
            inner.error = Some(error.to_string());
            shared.emit(&inner);
            drop(inner);
            shared.cv.notify_all();
            return Err(error.into());
        }
        let _ = shared.write_locked(&mut inner);
        shared.emit(&inner);
        let payload = inner.payload();
        drop(inner);
        shared.cv.notify_all();
        Ok(payload)
    }

    /// Reports whether `folder` can hold the data file and what it already holds.
    pub fn inspect_folder(&self, folder: &Path) -> Result<FolderInfo, DataError> {
        let is_current = {
            let inner = self.shared.lock();
            // Without a saved pointer nothing is "in use" yet; an unreadable pointer to the default
            // folder must stay selectable so the user can repair it with `use`.
            inner.location_saved && inner.folder == folder
        };
        let writable = is_writable(folder);
        let (existing, written_at) = match read_state(&folder.join(FILE_NAME), self.shared.cfg.timing.io_timeout) {
            FileState::Missing => ("none", None),
            FileState::Corrupt => ("corrupt", None),
            FileState::Unavailable(message) => return Err(DataError::Unavailable { message }),
            FileState::Valid { parsed, .. } => {
                let kind = if parsed.schema_version > SCHEMA_VERSION { "newer-schema" } else { "valid" };
                (kind, Some(parsed.written_at))
            }
        };
        Ok(FolderInfo { writable, existing, written_at, is_current })
    }

    /// Switches the data folder. The old file always stays. Only `use` needs pending writes flushed first
    /// (it discards the memory copy) and is refused when that fails; `move` and `replace` copy the memory
    /// copy, so they work out of a folder that can no longer be written.
    pub fn set_location(&self, folder: &Path, mode: LocationMode) -> Result<LoadResult, DataError> {
        let shared = &self.shared;
        let mut inner = shared.lock();
        // Without a saved pointer the folder is not really in use yet: `use` may adopt it again
        // (repairs an unreadable pointer to the default folder). Move/Replace would copy the memory
        // copy, which is near-empty in that state, over the real file.
        if inner.folder == folder && (inner.location_saved || mode != LocationMode::Use) {
            return Err(DataError::SameFolder);
        }
        if !is_writable(folder) {
            return Err(DataError::NotWritable);
        }
        let timeout = shared.cfg.timing.io_timeout;
        let target = folder.join(FILE_NAME);
        let existing = read_state(&target, timeout);
        if let FileState::Unavailable(message) = existing {
            return Err(DataError::Unavailable { message });
        }
        if inner.dirty {
            let flushed = if inner.status.allows_write() {
                shared.write_locked(&mut inner).is_ok()
            } else {
                shared.preserve_unsaved(&mut inner)
            };
            // Best effort for move/replace (the memory copy travels along), required for use (it is discarded).
            if mode == LocationMode::Use && !flushed {
                return Err(DataError::BackupFailed { message: "unsaved changes could not be kept".into() });
            }
        }

        match mode {
            LocationMode::Use => match existing {
                FileState::Missing => Err(DataError::TargetEmpty),
                FileState::Corrupt => Err(DataError::TargetCorrupt),
                FileState::Unavailable(_) => unreachable!("handled above"),
                FileState::Valid { parsed, hash } => {
                    save_location(&shared.cfg.config_dir, folder, &inner.device_id)?;
                    inner.location_saved = true;
                    inner.folder = folder.to_path_buf();
                    inner.status =
                        if parsed.schema_version > SCHEMA_VERSION { Status::ReadOnlyNewerSchema } else { Status::Ok };
                    let seen = LastSeen { hash, written_by: parsed.written_by, written_at: parsed.written_at.clone() };
                    inner.set_seen(seen, stamp_of(&target, timeout));
                    inner.schema_version = Some(parsed.schema_version);
                    inner.stores = parsed.stores;
                    inner.dirty = false;
                    inner.first_dirty = None;
                    inner.error = None;
                    inner.reset_session();
                    inner.forget_folder_state();
                    // The webview still holds the old data until its reload lands and calls `load`: refuse
                    // its `data_set`s meanwhile, they would write the old device's stores into this file.
                    inner.generation += 1;
                    inner.applied_seq.clear();
                    shared.emit(&inner);
                    Ok(LoadResult { state: inner.payload(), envelope: Some(parsed.raw), needs_init: false, generation: inner.generation })
                }
            },
            LocationMode::Move | LocationMode::Replace => {
                // Our memory copy is the source. A newer-schema state must not be copied down.
                if inner.status == Status::ReadOnlyNewerSchema {
                    return Err(DataError::Blocked { status: inner.status });
                }
                match (mode, &existing) {
                    (LocationMode::Move, FileState::Missing) => {}
                    (LocationMode::Move, _) => return Err(DataError::TargetHasData),
                    (_, FileState::Missing) => {}
                    // Replacing data that exists: it is backed up first, and the replace waits for that.
                    _ => before_replace(shared, &inner.device_id, &target)?,
                }
                let written_at = iso_now();
                let bytes = render(&inner, &shared.cfg.app_version, &written_at);
                let hash = sha256_hex(&bytes);
                write_timed(&target, bytes, timeout).map_err(|failure| match failure {
                    IoFailure::TimedOut => DataError::Unavailable { message: failure.message() },
                    IoFailure::Failed(error) => DataError::from(error),
                })?;
                save_location(&shared.cfg.config_dir, folder, &inner.device_id)?;
                shared.writes.fetch_add(1, Ordering::SeqCst);
                inner.location_saved = true;
                inner.folder = folder.to_path_buf();
                inner.status = Status::Ok;
                let seen = LastSeen { hash, written_by: inner.device_id.clone(), written_at };
                inner.set_seen(seen, stamp_of(&target, timeout));
                inner.schema_version = Some(SCHEMA_VERSION);
                inner.dirty = false;
                inner.first_dirty = None;
                inner.error = None;
                inner.reset_session();
                inner.forget_folder_state();
                shared.emit(&inner);
                Ok(LoadResult { state: inner.payload(), envelope: None, needs_init: false, generation: inner.generation })
            }
        }
    }

    /// Current state without touching the disk.
    pub fn status(&self) -> StatusPayload {
        self.shared.lock().payload()
    }

    /// The file to reveal in the Finder (the folder when the file is missing).
    pub fn reveal_target(&self) -> PathBuf {
        let inner = self.shared.lock();
        let file = inner.file_path();
        if file.exists() { file } else { inner.folder.clone() }
    }
}

/// How the user settles a `conflict`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictChoice {
    /// "Diese Version behalten": their file goes to `backups/` as `conflict`, then mine is written.
    Mine,
    /// "Andere Version laden" / "Neu laden": my unsaved state goes to `backups/` as `unsaved`, then the window reloads.
    Theirs,
}

/// Largest file `data_import_read` returns.
const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;

// Backups, restore, conflicts and the watcher (#224).
impl DataFile {
    /// Starts the watcher: a look at the folder every `Timing::watch` (and every backoff step while the
    /// folder is unavailable), plus one on every [`DataFile::poke`]. It only reads and flags, never writes.
    pub fn start_watcher(&self) {
        let worker = Arc::clone(&self.shared);
        thread::Builder::new()
            .name("kan-do-data-watcher".into())
            .spawn(move || watcher_loop(worker))
            .expect("spawn data watcher thread");
    }

    /// Wakes the watcher now (the window gained focus).
    pub fn poke(&self) {
        *self.shared.poke.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        self.shared.poke_cv.notify_all();
    }

    /// One look at the folder right now ("Erneut versuchen"); restarts the backoff.
    pub fn check_now(&self) -> StatusPayload {
        {
            let mut inner = self.shared.lock();
            inner.backoff = self.shared.cfg.timing.backoff.0;
        }
        self.shared.watch_tick();
        self.status()
    }

    /// Copies the data file as it is on disk into `backups/` (pending edits are written first).
    /// Returns the backup's file name.
    pub fn backup(&self, kind: BackupKind) -> Result<String, DataError> {
        let shared = &self.shared;
        let mut inner = shared.lock();
        if inner.dirty && inner.status.allows_write() {
            shared.write_locked(&mut inner)?;
        }
        let result = shared.backup_current(&mut inner, kind);
        // A failing `manual` backup shows on the data page like a failing `daily` one; a mandatory one
        // reports to its caller instead.
        if !kind.mandatory() {
            let error = result.as_ref().err().map(|error| match error {
                DataError::BackupFailed { message } | DataError::Io { message } => message.clone(),
                other => format!("{other:?}"),
            });
            shared.set_backup_error(&mut inner, error);
        }
        result
    }

    /// The backups of the folder in use, newest first.
    pub fn list_backups(&self) -> Result<Vec<BackupEntry>, DataError> {
        let (dir, device_id, timeout) = {
            let inner = self.shared.lock();
            (backup_dir(&inner.folder), inner.device_id.clone(), self.shared.cfg.timing.io_timeout)
        };
        run_timed(timeout, move |_| list_backups(&dir, &device_id, &|path| fs::read(path)))
            .map_err(|failure| DataError::Unavailable { message: failure.message() })
    }

    /// Resolves a backup or conflict-copy name to a path inside the folder in use. Bare names only.
    fn source_path(&self, name: &str) -> Result<PathBuf, DataError> {
        if !is_plain_file_name(name) {
            return Err(DataError::Invalid);
        }
        let inner = self.shared.lock();
        if parse_backup_name(name).is_some() {
            Ok(backup_dir(&inner.folder).join(name))
        } else if is_conflict_copy_name(name) {
            Ok(inner.folder.join(name))
        } else {
            Err(DataError::Invalid)
        }
    }

    /// Replaces the data file with a backup or a cloud conflict copy. The current state is backed up first
    /// (`pre-restore`, mandatory); the caller reloads the window afterwards.
    pub fn restore(&self, name: &str) -> Result<StatusPayload, DataError> {
        let path = self.source_path(name)?;
        let bytes = read_timed(&path, self.shared.cfg.timing.io_timeout).map_err(|failure| match failure {
            IoFailure::TimedOut => DataError::Unavailable { message: failure.message() },
            IoFailure::Failed(error) if error.kind() == io::ErrorKind::NotFound => {
                self.shared.forget_vanished_copy(name);
                DataError::Invalid
            }
            IoFailure::Failed(error) => DataError::from(error),
        })?;
        self.replace_with(bytes)
    }

    /// The same as [`DataFile::restore`] for an import: `contents` is the user's JSON file, already stripped
    /// of secrets by the webview.
    pub fn import_apply(&self, contents: String) -> Result<StatusPayload, DataError> {
        self.replace_with(contents.into_bytes())
    }

    /// Replaces the data file with `bytes`. Allowed out of `ok`, `write-failed`, `missing-file` and
    /// `read-only-corrupt` (the recovery case; not when the pointer to the folder is the unreadable part).
    /// Never replaces a file this process has not read: the current file is copied verbatim first
    /// (`pre-restore`, mandatory) and the write only commits while the target is still those bytes (or
    /// still absent after `missing-file`).
    fn replace_with(&self, bytes: Vec<u8>) -> Result<StatusPayload, DataError> {
        let parsed = parse_envelope(&bytes).ok_or(DataError::Unreadable)?;
        if parsed.schema_version > SCHEMA_VERSION {
            return Err(DataError::NewerSchema);
        }
        let shared = &self.shared;
        let mut inner = shared.lock();
        if !inner.restorable() {
            return Err(DataError::Blocked { status: inner.status });
        }
        if inner.status == Status::MissingFile {
            // The watcher looks every 15 s: a sync client may have put the file back since.
            shared.recheck_missing(&mut inner)?;
        }
        if inner.dirty && inner.status.allows_write() {
            shared.write_locked(&mut inner)?;
        }
        let timeout = shared.cfg.timing.io_timeout;
        let file = inner.file_path();
        let expect = match inner.status {
            Status::MissingFile => {
                // No file to copy; what would be lost is the memory copy.
                shared.keep_memory_as_pre_restore(&inner)?;
                Expect::Absent
            }
            Status::ReadOnlyCorrupt => {
                shared.keep_memory_as_pre_restore(&inner)?;
                match read_timed(&file, timeout) {
                    Ok(current) => {
                        shared
                            .write_backup_timed(&inner, BackupKind::PreRestore, current.clone())
                            .map_err(|message| DataError::BackupFailed { message })?;
                        Expect::Bytes(current)
                    }
                    Err(failure) if failure.is_not_found() => Expect::Absent,
                    Err(failure) => return Err(DataError::BackupFailed { message: failure.message() }),
                }
            }
            _ => {
                // Commit only over the bytes just copied: a change after the backup is a conflict, not
                // something to overwrite.
                let (_, current) = shared.backup_current_bytes(&mut inner, BackupKind::PreRestore)?;
                Expect::Bytes(current)
            }
        };
        let hash = sha256_hex(&bytes);
        write_guarded(&file, bytes, expect, timeout).map_err(|failure| {
            if failure.is_changed() {
                return DataError::Changed;
            }
            match failure {
                IoFailure::TimedOut => {
                    inner.error = Some("timed out".into());
                    shared.enter(&mut inner, Status::FolderUnavailable);
                    DataError::Unavailable { message: failure.message() }
                }
                IoFailure::Failed(error) => DataError::from(error),
            }
        })?;
        shared.writes.fetch_add(1, Ordering::SeqCst);
        let seen = LastSeen { hash, written_by: parsed.written_by, written_at: parsed.written_at };
        inner.set_seen(seen, stamp_of(&file, timeout));
        inner.schema_version = Some(parsed.schema_version);
        inner.stores = parsed.stores;
        inner.dirty = false;
        inner.first_dirty = None;
        inner.error = None;
        inner.status = Status::Ok;
        inner.reset_session();
        // The webview still holds the replaced state until its reload lands: refuse its `data_set`s meanwhile.
        inner.generation += 1;
        inner.applied_seq.clear();
        shared.emit(&inner);
        Ok(inner.payload())
    }

    /// Settles a `conflict`; both versions are in `backups/` afterwards.
    pub fn resolve_conflict(&self, choice: ConflictChoice) -> Result<StatusPayload, DataError> {
        let shared = &self.shared;
        let mut inner = shared.lock();
        if inner.status != Status::Conflict {
            return Err(DataError::Blocked { status: inner.status });
        }
        let timeout = shared.cfg.timing.io_timeout;
        match choice {
            ConflictChoice::Theirs => {
                // Mine goes to the backups first; when that fails the window must not reload.
                if inner.local_changes() && !inner.stores.is_empty() {
                    let state = render(&inner, &shared.cfg.app_version, &iso_now());
                    shared
                        .write_backup_timed(&inner, BackupKind::Unsaved, state)
                        .map_err(|message| DataError::BackupFailed { message })?;
                }
                inner.dirty = false;
                inner.first_dirty = None;
                inner.exit_saved = true;
                // The reload that follows re-reads their file; until then the old webview's writes are refused.
                inner.generation += 1;
                inner.applied_seq.clear();
                Ok(inner.payload())
            }
            ConflictChoice::Mine => {
                if !inner.local_changes() {
                    // Nothing of mine to keep: writing the memory copy would only replace their file with an old one.
                    return Err(DataError::Invalid);
                }
                let file = inner.file_path();
                let theirs = read_timed(&file, timeout).map_err(|failure| DataError::BackupFailed { message: failure.message() })?;
                // Decide on the bytes read now, never on what the modal showed earlier.
                let current = sha256_hex(&theirs);
                let parsed = parse_envelope(&theirs);
                let displayed = inner.conflict.as_ref().and_then(|state| state.hash.as_deref()) == Some(current.as_str());
                if !displayed {
                    shared.refresh_conflict(&mut inner, parsed.as_ref(), current, stamp_of(&file, timeout));
                }
                if parsed.as_ref().is_some_and(|parsed| parsed.schema_version > SCHEMA_VERSION) {
                    return Err(DataError::Blocked { status: Status::ReadOnlyNewerSchema });
                }
                if !displayed {
                    // Not the version the user chose against; the modal shows the current one now.
                    return Err(DataError::Changed);
                }
                shared
                    .write_backup_timed(&inner, BackupKind::Conflict, theirs.clone())
                    .map_err(|message| DataError::BackupFailed { message })?;
                let written_at = iso_now();
                let bytes = render(&inner, &shared.cfg.app_version, &written_at);
                let hash = sha256_hex(&bytes);
                write_guarded(&file, bytes, Expect::Bytes(theirs), timeout).map_err(|failure| {
                    if failure.is_changed() {
                        return DataError::Changed;
                    }
                    match failure {
                        IoFailure::TimedOut => DataError::Unavailable { message: failure.message() },
                        IoFailure::Failed(error) => DataError::from(error),
                    }
                })?;
                shared.writes.fetch_add(1, Ordering::SeqCst);
                let seen = LastSeen { hash, written_by: inner.device_id.clone(), written_at };
                inner.set_seen(seen, stamp_of(&file, timeout));
                inner.schema_version = Some(SCHEMA_VERSION);
                inner.dirty = false;
                inner.first_dirty = None;
                inner.error = None;
                inner.status = Status::Ok;
                inner.reset_session();
                shared.emit(&inner);
                Ok(inner.payload())
            }
        }
    }

    /// "Ablegen": moves a cloud conflict copy into `backups/` as `conflict`. Nothing is deleted before the
    /// copy is safe.
    pub fn file_to_backups(&self, name: &str) -> Result<StatusPayload, DataError> {
        if !is_conflict_copy_name(name) {
            return Err(DataError::Invalid);
        }
        let path = self.source_path(name)?;
        let shared = &self.shared;
        let bytes = read_timed(&path, shared.cfg.timing.io_timeout).map_err(|failure| {
            if failure.is_not_found() {
                shared.forget_vanished_copy(name);
            }
            DataError::BackupFailed { message: failure.message() }
        })?;
        let mut inner = shared.lock();
        shared
            .write_backup_timed(&inner, BackupKind::Conflict, bytes)
            .map_err(|message| DataError::BackupFailed { message })?;
        fs::remove_file(&path)?;
        inner.conflict_copies.retain(|copy| copy.name != name);
        shared.emit(&inner);
        Ok(inner.payload())
    }

    /// Writes the user's export file. `contents` is the JSON the webview built (secrets already stripped);
    /// it must still be a data envelope, and the data file itself is never a valid target.
    pub fn export_to(&self, path: &Path, contents: &str) -> Result<(), DataError> {
        let own = self.shared.lock().file_path();
        let valid_target = path.is_absolute() && path.extension().is_some_and(|ext| ext == "json") && path != own;
        if !valid_target || parse_envelope(contents.as_bytes()).is_none() {
            return Err(DataError::Invalid);
        }
        write_timed(path, contents.as_bytes().to_vec(), self.shared.cfg.timing.io_timeout).map_err(|failure| match failure {
            IoFailure::TimedOut => DataError::Unavailable { message: failure.message() },
            IoFailure::Failed(error) => DataError::from(error),
        })
    }

    /// Reads the file the user picked for an import; the webview validates and strips it.
    pub fn read_import(&self, path: &Path) -> Result<String, DataError> {
        if !path.is_absolute() || fs::metadata(path)?.len() > MAX_IMPORT_BYTES {
            return Err(DataError::Invalid);
        }
        let bytes = read_timed(path, self.shared.cfg.timing.io_timeout).map_err(|failure| match failure {
            IoFailure::TimedOut => DataError::Unavailable { message: failure.message() },
            IoFailure::Failed(error) => DataError::from(error),
        })?;
        String::from_utf8(bytes).map_err(|_| DataError::Unreadable)
    }
}

fn watcher_loop(shared: Arc<Shared>) {
    loop {
        let wait = {
            let inner = shared.lock();
            if inner.shutdown {
                return;
            }
            if inner.status == Status::FolderUnavailable { inner.backoff } else { shared.cfg.timing.watch }
        };
        {
            let mut poked = shared.poke.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if !*poked {
                poked = shared.poke_cv.wait_timeout(poked, wait).unwrap_or_else(|poisoned| poisoned.into_inner()).0;
            }
            *poked = false;
        }
        if shared.lock().shutdown {
            return;
        }
        shared.watch_tick();
    }
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` for the current time.
fn iso_now() -> String {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    iso_from_unix(elapsed.as_secs(), elapsed.subsec_millis())
}

/// Formats a Unix timestamp as UTC ISO-8601.
pub(crate) fn iso_from_unix(secs: u64, millis: u32) -> String {
    let (year, month, day, hour, minute, second) = backup::civil_from_unix(secs);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

// ---------------------------------------------------------------------------------------------
// Tauri glue

use tauri::{AppHandle, Emitter, Manager, State};

/// Event name carrying a [`StatusPayload`].
pub const STATUS_EVENT: &str = "data-status";

impl DataFile {
    /// Builds the state for the running app: location file in the config dir, default folder in the
    /// data dir (on macOS both are `~/Library/Application Support/com.julius.kan-do`).
    pub fn for_app(app: &AppHandle) -> DataFile {
        let config_dir = app.path().app_config_dir().expect("app config dir");
        let default_folder = app.path().app_data_dir().expect("app data dir");
        let handle = app.clone();
        DataFile::new(
            config_dir,
            default_folder,
            app.package_info().version.to_string(),
            Timing::default(),
            Box::new(move |payload| {
                let _ = handle.emit(STATUS_EVENT, payload);
            }),
        )
    }
}

/// Runs a blocking call on the blocking pool: folder I/O may wait up to the deadline.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    call: impl FnOnce(&DataFile) -> Result<T, DataError> + Send + 'static,
) -> Result<T, DataError> {
    tauri::async_runtime::spawn_blocking(move || call(&app.state::<DataFile>()))
        .await
        .map_err(|error| DataError::Io { message: error.to_string() })?
}

#[tauri::command]
pub async fn data_load(app: AppHandle) -> Result<LoadResult, DataError> {
    blocking(app, |data| Ok(data.load())).await
}

#[tauri::command]
pub async fn data_set(
    state: State<'_, DataFile>,
    key: String,
    value: Value,
    generation: u64,
    seq: u64,
) -> Result<(), DataError> {
    state.set_versioned(&key, value, generation, seq).map(|_| ())
}

#[tauri::command]
pub async fn data_flush(app: AppHandle) -> Result<(), DataError> {
    blocking(app, |data| data.flush()).await
}

#[tauri::command]
pub async fn data_status(state: State<'_, DataFile>) -> Result<StatusPayload, DataError> {
    Ok(state.status())
}

#[derive(Debug, Deserialize)]
pub struct InitEnvelope {
    pub stores: Map<String, Value>,
}

#[tauri::command]
pub async fn data_init(app: AppHandle, envelope: InitEnvelope) -> Result<StatusPayload, DataError> {
    blocking(app, move |data| data.init(envelope.stores)).await
}

#[tauri::command]
pub async fn data_inspect_folder(app: AppHandle, folder: String) -> Result<FolderInfo, DataError> {
    blocking(app, move |data| data.inspect_folder(Path::new(&folder))).await
}

#[tauri::command]
pub async fn data_set_location(app: AppHandle, folder: String, mode: LocationMode) -> Result<LoadResult, DataError> {
    blocking(app, move |data| data.set_location(Path::new(&folder), mode)).await
}

#[tauri::command]
pub async fn data_reveal(app: AppHandle, state: State<'_, DataFile>) -> Result<(), DataError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(state.reveal_target())
        .map_err(|error| DataError::Io { message: error.to_string() })
}

/// A backup the webview may ask for (`manual`, `pre-migration`, `pre-update`); returns its file name.
#[tauri::command]
pub async fn data_backup(app: AppHandle, kind: BackupKind) -> Result<String, DataError> {
    if !kind.requestable() {
        return Err(DataError::Invalid);
    }
    blocking(app, move |data| data.backup(kind)).await
}

#[tauri::command]
pub async fn data_backup_list(app: AppHandle) -> Result<Vec<BackupEntry>, DataError> {
    blocking(app, |data| data.list_backups()).await
}

#[tauri::command]
pub async fn data_restore(app: AppHandle, name: String) -> Result<StatusPayload, DataError> {
    blocking(app, move |data| data.restore(&name)).await
}

#[tauri::command]
pub async fn data_resolve_conflict(app: AppHandle, choice: ConflictChoice) -> Result<StatusPayload, DataError> {
    blocking(app, move |data| data.resolve_conflict(choice)).await
}

#[tauri::command]
pub async fn data_scan_conflict_copies(app: AppHandle) -> Result<Vec<ConflictCopy>, DataError> {
    blocking(app, |data| {
        data.check_now();
        Ok(data.status().conflict_copies)
    })
    .await
}

#[tauri::command]
pub async fn data_file_to_backups(app: AppHandle, name: String) -> Result<StatusPayload, DataError> {
    blocking(app, move |data| data.file_to_backups(&name)).await
}

#[tauri::command]
pub async fn data_retry(app: AppHandle) -> Result<StatusPayload, DataError> {
    blocking(app, |data| Ok(data.check_now())).await
}

#[tauri::command]
pub async fn data_export(app: AppHandle, path: String, contents: String) -> Result<(), DataError> {
    blocking(app, move |data| data.export_to(Path::new(&path), &contents)).await
}

#[tauri::command]
pub async fn data_import_read(app: AppHandle, path: String) -> Result<String, DataError> {
    blocking(app, move |data| data.read_import(Path::new(&path))).await
}

#[tauri::command]
pub async fn data_import_apply(app: AppHandle, contents: String) -> Result<StatusPayload, DataError> {
    blocking(app, move |data| data.import_apply(contents)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::Mutex as StdMutex;
    use tempfile::TempDir;

    pub(super) const FAST: Timing = Timing {
        debounce: Duration::from_millis(40),
        max_wait: Duration::from_millis(160),
        retry: Duration::from_millis(80),
        io_timeout: Duration::from_secs(2),
        watch: Duration::from_millis(50),
        settle: Duration::from_millis(20),
        backoff: (Duration::from_millis(20), Duration::from_millis(80)),
        cloud_grace: Duration::from_millis(150),
    };

    pub(super) struct Fixture {
        pub(super) _root: TempDir,
        pub(super) config: PathBuf,
        pub(super) folder: PathBuf,
        pub(super) events: Arc<StdMutex<Vec<StatusPayload>>>,
    }

    impl Fixture {
        pub(super) fn new() -> Fixture {
            let root = TempDir::new().unwrap();
            let config = root.path().join("config");
            let folder = root.path().join("data");
            fs::create_dir_all(&folder).unwrap();
            Fixture { _root: root, config, folder, events: Arc::default() }
        }

        pub(super) fn data_file(&self, timing: Timing) -> DataFile {
            let events = Arc::clone(&self.events);
            DataFile::new(
                self.config.clone(),
                self.folder.clone(),
                "9.9.9".into(),
                timing,
                Box::new(move |payload| events.lock().unwrap().push(payload.clone())),
            )
        }

        pub(super) fn data_file_with_reader(&self, timing: Timing, reader: Arc<CloudReader>) -> DataFile {
            let events = Arc::clone(&self.events);
            DataFile::with_parts(
                self.config.clone(),
                self.folder.clone(),
                "9.9.9".into(),
                timing,
                Box::new(system_clock),
                reader,
                Box::new(move |payload| events.lock().unwrap().push(payload.clone())),
            )
        }

        pub(super) fn file(&self) -> PathBuf {
            self.folder.join(FILE_NAME)
        }

        pub(super) fn other_folder(&self, name: &str) -> PathBuf {
            let folder = self._root.path().join(name);
            fs::create_dir_all(&folder).unwrap();
            folder
        }
    }

    pub(super) fn stores(pairs: &[(&str, Value)]) -> Map<String, Value> {
        pairs.iter().map(|(key, value)| (key.to_string(), value.clone())).collect()
    }

    pub(super) fn read_json(path: &Path) -> Value {
        serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
    }

    pub(super) fn wait_for(mut condition: impl FnMut() -> bool) -> bool {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            if condition() {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        false
    }

    /// A first-run state with a written file.
    pub(super) fn initialised(fixture: &Fixture, timing: Timing) -> DataFile {
        let data = fixture.data_file(timing);
        let loaded = data.load();
        assert!(loaded.needs_init);
        data.init(stores(&[("tasks-store", json!({ "tasks": [] }))])).unwrap();
        data
    }

    /// [`initialised`] with an injected cloud reader (#271).
    pub(super) fn initialised_with_reader(fixture: &Fixture, timing: Timing, reader: Arc<CloudReader>) -> DataFile {
        let data = fixture.data_file_with_reader(timing, reader);
        assert!(data.load().needs_init);
        data.init(stores(&[("tasks-store", json!({ "tasks": [] }))])).unwrap();
        data
    }

    pub(super) fn folder_is_read_only_effective(folder: &Path) -> bool {
        // Root ignores permission bits; skip the permission tests there.
        fs::set_permissions(folder, fs::Permissions::from_mode(0o555)).unwrap();
        let blocked = File::create(folder.join(".probe")).is_err();
        fs::set_permissions(folder, fs::Permissions::from_mode(0o755)).unwrap();
        blocked
    }

    #[test]
    fn formats_iso_timestamps() {
        assert_eq!(iso_from_unix(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_unix(1_700_000_000, 42), "2023-11-14T22:13:20.042Z");
        assert_eq!(iso_from_unix(1_709_164_800, 0), "2024-02-29T00:00:00.000Z");
    }

    #[test]
    fn atomic_write_replaces_the_file() {
        let fixture = Fixture::new();
        let path = fixture.file();
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        assert_eq!(fs::read_dir(&fixture.folder).unwrap().count(), 1, "no temp file is left behind");
    }

    #[test]
    fn atomic_write_keeps_the_old_file_when_it_fails_before_the_rename() {
        let fixture = Fixture::new();
        let path = fixture.file();
        write_atomic(&path, b"previous").unwrap();
        let result = write_atomic_with(&path, b"never lands", || Err(io::Error::other("crash")));
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"previous");
        assert_eq!(fs::read_dir(&fixture.folder).unwrap().count(), 1, "the temp file is cleaned up");
    }

    #[test]
    fn first_run_asks_for_init_and_creates_file_and_location() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        let loaded = data.load();
        assert!(loaded.needs_init);
        assert_eq!(loaded.state.status, Status::Ok);
        assert!(!fixture.file().exists(), "load never creates the file");

        let payload = data.init(stores(&[("board-store", json!({ "columns": [1] }))])).unwrap();
        assert_eq!(payload.status, Status::Ok);
        let file = read_json(&fixture.file());
        assert_eq!(file["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(file["appVersion"], "9.9.9");
        assert_eq!(file["stores"]["board-store"]["columns"][0], 1);
        let location = read_json(&fixture.config.join(LOCATION_FILE));
        assert_eq!(location["deviceId"], file["writtenBy"], "the device id lives in the local location file");
        assert_eq!(location["folder"], fixture.folder.to_string_lossy().as_ref());
        assert!(!fs::read_to_string(fixture.file()).unwrap().contains("deviceId"));
    }

    #[test]
    fn init_refuses_to_overwrite_an_existing_file() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        data.load();
        // The file appears between load and init (another process).
        fs::write(fixture.file(), b"not mine").unwrap();
        assert_eq!(data.init(Map::new()), Err(DataError::Exists));
        assert_eq!(fs::read(fixture.file()).unwrap(), b"not mine");
    }

    #[test]
    fn a_file_without_a_location_is_adopted_not_reinitialised() {
        let fixture = Fixture::new();
        let first = initialised(&fixture, FAST);
        drop(first);
        fs::remove_file(fixture.config.join(LOCATION_FILE)).unwrap();

        let data = fixture.data_file(FAST);
        let loaded = data.load();
        assert!(!loaded.needs_init);
        assert_eq!(loaded.state.status, Status::Ok);
        assert!(loaded.envelope.is_some());
        assert!(fixture.config.join(LOCATION_FILE).exists());
    }

    #[test]
    fn load_returns_the_raw_envelope_and_sets_last_seen_to_the_file_hash() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        let data = fixture.data_file(FAST);
        let loaded = data.load();
        assert_eq!(loaded.envelope.as_ref().unwrap()["stores"]["tasks-store"]["tasks"], json!([]));
        let expected = sha256_hex(&fs::read(fixture.file()).unwrap());
        assert_eq!(data.shared.lock().last_seen.as_ref().unwrap().hash, expected);
    }

    #[test]
    fn own_writes_update_last_seen() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        data.set("board-store", json!({ "v": 2 })).unwrap();
        data.flush().unwrap();
        let seen = data.shared.lock().last_seen.clone().unwrap();
        assert_eq!(seen.hash, sha256_hex(&fs::read(fixture.file()).unwrap()));
        assert_eq!(seen.written_by, data.shared.lock().device_id);
    }

    #[test]
    fn corrupt_file_is_never_overwritten() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        fs::write(fixture.file(), b"{ truncated").unwrap();

        let data = fixture.data_file(FAST);
        assert_eq!(data.load().state.status, Status::ReadOnlyCorrupt);
        data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
        assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::ReadOnlyCorrupt }));
        assert_eq!(data.init(Map::new()), Err(DataError::Blocked { status: Status::ReadOnlyCorrupt }));
        thread::sleep(FAST.max_wait * 2);
        assert_eq!(fs::read(fixture.file()).unwrap(), b"{ truncated");
    }

    #[test]
    fn a_newer_schema_hydrates_read_only_and_blocks_writes() {
        let fixture = Fixture::new();
        let newer = json!({ "schemaVersion": 99, "writtenAt": "x", "writtenBy": "y", "appVersion": "z", "stores": { "tasks-store": { "tasks": [7] } } });
        let bytes = serde_json::to_vec(&newer).unwrap();
        fs::write(fixture.file(), &bytes).unwrap();
        save_location(&fixture.config, &fixture.folder, "device").unwrap();

        let data = fixture.data_file(FAST);
        let loaded = data.load();
        assert_eq!(loaded.state.status, Status::ReadOnlyNewerSchema);
        assert_eq!(loaded.envelope.unwrap()["stores"]["tasks-store"]["tasks"][0], 7, "still hydrates");
        data.set("tasks-store", json!({ "tasks": [] })).unwrap();
        assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::ReadOnlyNewerSchema }));
        thread::sleep(FAST.max_wait * 2);
        assert_eq!(fs::read(fixture.file()).unwrap(), bytes, "nothing was written");
    }

    #[test]
    fn an_older_schema_loads_unmigrated_and_is_rewritten_at_the_current_version_by_a_changed_store() {
        // The webview migrates 1 -> 2 (#326) and hands the migrated stores back: Rust only keeps the
        // file at its own version after a write, and never touches it while nothing differs.
        let fixture = Fixture::new();
        let older = json!({ "schemaVersion": 1, "writtenAt": "x", "writtenBy": "y", "appVersion": "z", "stores": { "board-store": { "boardConfig": { "taskService": "notion" } } } });
        let bytes = serde_json::to_vec(&older).unwrap();
        fs::write(fixture.file(), &bytes).unwrap();
        save_location(&fixture.config, &fixture.folder, "device").unwrap();

        let data = fixture.data_file(FAST);
        let loaded = data.load();
        assert_eq!(loaded.state.status, Status::Ok, "an older file is not read-only");
        assert_eq!(loaded.envelope.unwrap()["stores"]["board-store"]["boardConfig"]["taskService"], "notion", "handed over unmigrated");
        thread::sleep(FAST.max_wait * 2);
        assert_eq!(fs::read(fixture.file()).unwrap(), bytes, "nothing is written while no store differs");

        data.set("board-store", json!({ "boardConfig": { "sources": { "connected": ["notion"], "default": "notion" } } })).unwrap();
        data.flush().unwrap();
        let file = read_json(&fixture.file());
        assert_eq!(file["schemaVersion"], SCHEMA_VERSION);
        assert_eq!(file["stores"]["board-store"]["boardConfig"]["sources"]["default"], "notion");
    }

    #[test]
    fn a_missing_file_is_never_recreated() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        fs::remove_file(fixture.file()).unwrap();

        let data = fixture.data_file(FAST);
        assert_eq!(data.load().state.status, Status::MissingFile);
        data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
        assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::MissingFile }));
        thread::sleep(FAST.max_wait * 2);
        assert!(!fixture.file().exists());
    }

    #[test]
    fn a_file_deleted_while_running_flips_to_missing_and_stays_gone() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        fs::remove_file(fixture.file()).unwrap();

        data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
        assert!(wait_for(|| data.status().status == Status::MissingFile));
        thread::sleep(FAST.max_wait);
        assert!(!fixture.file().exists(), "no recreate-from-memory");
        assert!(fixture.events.lock().unwrap().iter().any(|event| event.status == Status::MissingFile));
    }

    #[test]
    fn start_here_after_a_missing_file_writes_the_memory_copy() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        fs::remove_file(fixture.file()).unwrap();
        let data = fixture.data_file(FAST);
        assert_eq!(data.load().state.status, Status::MissingFile);

        let payload = data.init(stores(&[("tasks-store", json!({ "tasks": [3] }))])).unwrap();
        assert_eq!(payload.status, Status::Ok);
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"][0], 3);
    }

    #[test]
    fn stale_temp_files_are_removed_on_load() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        fs::write(fixture.folder.join(".kan-do-data.json.tmp-1-0"), b"half").unwrap();
        let data = fixture.data_file(FAST);
        data.load();
        assert!(!fixture.folder.join(".kan-do-data.json.tmp-1-0").exists());
        assert!(fixture.file().exists());
    }

    #[test]
    fn a_burst_of_changes_is_one_write() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        let before = data.shared.writes.load(Ordering::SeqCst);
        for n in 0..5 {
            data.set("tasks-store", json!({ "n": n })).unwrap();
            thread::sleep(Duration::from_millis(5));
        }
        assert!(wait_for(|| data.shared.writes.load(Ordering::SeqCst) > before));
        thread::sleep(FAST.debounce * 2);
        assert_eq!(data.shared.writes.load(Ordering::SeqCst), before + 1);
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["n"], 4);
    }

    #[test]
    fn max_wait_stops_a_steady_stream_from_starving_the_write() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        let before = data.shared.writes.load(Ordering::SeqCst);
        // A change every 20 ms never lets the 40 ms trailing debounce expire.
        let start = Instant::now();
        let mut n = 0;
        while start.elapsed() < FAST.max_wait * 3 {
            n += 1;
            data.set("tasks-store", json!({ "n": n })).unwrap();
            thread::sleep(Duration::from_millis(20));
        }
        assert!(data.shared.writes.load(Ordering::SeqCst) > before, "a write landed mid-stream");
    }

    #[test]
    fn flush_writes_pending_changes_synchronously() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, Timing { debounce: Duration::from_secs(60), ..FAST });
        data.set("tasks-store", json!({ "tasks": [9] })).unwrap();
        data.flush_on_exit(true);
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"][0], 9);
    }

    #[test]
    fn load_flushes_pending_changes_first() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, Timing { debounce: Duration::from_secs(60), ..FAST });
        data.set("tasks-store", json!({ "tasks": [5] })).unwrap();
        let loaded = data.load();
        assert_eq!(loaded.envelope.unwrap()["stores"]["tasks-store"]["tasks"][0], 5);
    }

    #[test]
    fn a_failed_write_reports_write_failed_and_recovers() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        if !folder_is_read_only_effective(&fixture.folder) {
            return;
        }
        fs::set_permissions(&fixture.folder, fs::Permissions::from_mode(0o555)).unwrap();
        data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
        assert!(wait_for(|| data.status().status == Status::WriteFailed));
        assert!(data.status().error.is_some());

        fs::set_permissions(&fixture.folder, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(wait_for(|| data.status().status == Status::Ok), "retried without a new change");
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"][0], 1);
    }

    #[test]
    fn move_copies_into_an_empty_folder_and_keeps_the_old_file() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
        let target = fixture.other_folder("cloud");

        let result = data.set_location(&target, LocationMode::Move).unwrap();
        assert_eq!(result.state.status, Status::Ok);
        assert_eq!(read_json(&target.join(FILE_NAME))["stores"]["tasks-store"]["tasks"][0], 1);
        assert!(fixture.file().exists(), "the old file stays");
        assert_eq!(read_json(&fixture.config.join(LOCATION_FILE))["folder"], target.to_string_lossy().as_ref());

        data.set("tasks-store", json!({ "tasks": [2] })).unwrap();
        data.flush().unwrap();
        assert_eq!(read_json(&target.join(FILE_NAME))["stores"]["tasks-store"]["tasks"][0], 2, "writes follow the new folder");
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"][0], 1, "the old copy is not touched");
    }

    #[test]
    fn move_flushes_pending_writes_before_switching() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, Timing { debounce: Duration::from_secs(60), ..FAST });
        data.set("tasks-store", json!({ "tasks": [4] })).unwrap();
        let target = fixture.other_folder("cloud");
        data.set_location(&target, LocationMode::Move).unwrap();
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"][0], 4, "old file got the flush");
    }

    #[test]
    fn move_refuses_a_folder_that_holds_data_and_replace_overwrites_it() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        data.set("tasks-store", json!({ "tasks": ["mine"] })).unwrap();
        let target = fixture.other_folder("cloud");
        let theirs = serde_json::to_vec(&json!({ "schemaVersion": 1, "writtenAt": "t", "writtenBy": "other", "appVersion": "1", "stores": { "tasks-store": { "tasks": ["theirs"] } } })).unwrap();
        fs::write(target.join(FILE_NAME), &theirs).unwrap();

        assert_eq!(data.set_location(&target, LocationMode::Move), Err(DataError::TargetHasData));
        assert_eq!(fs::read(target.join(FILE_NAME)).unwrap(), theirs, "refused move leaves it alone");

        data.set_location(&target, LocationMode::Replace).unwrap();
        assert_eq!(read_json(&target.join(FILE_NAME))["stores"]["tasks-store"]["tasks"][0], "mine");
    }

    #[test]
    fn use_switches_to_the_data_already_there() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        let target = fixture.other_folder("cloud");
        let theirs = json!({ "schemaVersion": 1, "writtenAt": "t", "writtenBy": "other", "appVersion": "1", "stores": { "tasks-store": { "tasks": ["theirs"] } } });
        fs::write(target.join(FILE_NAME), serde_json::to_vec(&theirs).unwrap()).unwrap();

        let result = data.set_location(&target, LocationMode::Use).unwrap();
        assert_eq!(result.envelope.unwrap()["stores"]["tasks-store"]["tasks"][0], "theirs");
        assert_eq!(result.state.status, Status::Ok);
        assert_eq!(data.shared.lock().last_seen.as_ref().unwrap().written_by, "other");
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!([]), "our old file stays");
    }

    #[test]
    fn use_needs_a_readable_file_in_the_target() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        let empty = fixture.other_folder("empty");
        assert_eq!(data.set_location(&empty, LocationMode::Use), Err(DataError::TargetEmpty));
        let corrupt = fixture.other_folder("corrupt");
        fs::write(corrupt.join(FILE_NAME), b"nope").unwrap();
        assert_eq!(data.set_location(&corrupt, LocationMode::Use), Err(DataError::TargetCorrupt));
        assert_eq!(fs::read(corrupt.join(FILE_NAME)).unwrap(), b"nope");
        assert_eq!(data.status().folder, fixture.folder.to_string_lossy().as_ref(), "nothing switched");
    }

    #[test]
    fn set_location_refuses_the_current_folder_and_unwritable_folders() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        assert_eq!(data.set_location(&fixture.folder, LocationMode::Move), Err(DataError::SameFolder));

        let locked = fixture.other_folder("locked");
        if folder_is_read_only_effective(&locked) {
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
            assert_eq!(data.set_location(&locked, LocationMode::Move), Err(DataError::NotWritable));
            assert!(!data.inspect_folder(&locked).unwrap().writable);
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn a_newer_schema_is_never_copied_down_to_another_folder() {
        let fixture = Fixture::new();
        let newer = json!({ "schemaVersion": 99, "writtenAt": "x", "writtenBy": "y", "appVersion": "z", "stores": {} });
        fs::write(fixture.file(), serde_json::to_vec(&newer).unwrap()).unwrap();
        save_location(&fixture.config, &fixture.folder, "device").unwrap();
        let data = fixture.data_file(FAST);
        data.load();
        let target = fixture.other_folder("cloud");
        assert_eq!(
            data.set_location(&target, LocationMode::Move),
            Err(DataError::Blocked { status: Status::ReadOnlyNewerSchema })
        );
        assert!(!target.join(FILE_NAME).exists());
    }

    #[test]
    fn inspect_folder_describes_what_is_there() {
        let fixture = Fixture::new();
        let data = initialised(&fixture, FAST);
        let empty = fixture.other_folder("empty");
        assert_eq!(data.inspect_folder(&empty).unwrap().existing, "none");
        assert!(data.inspect_folder(&empty).unwrap().writable);
        assert_eq!(data.inspect_folder(&fixture.folder).unwrap().existing, "valid");
        assert!(data.inspect_folder(&fixture.folder).unwrap().is_current);
        let corrupt = fixture.other_folder("corrupt");
        fs::write(corrupt.join(FILE_NAME), b"nope").unwrap();
        assert_eq!(data.inspect_folder(&corrupt).unwrap().existing, "corrupt");
        assert!(empty.read_dir().unwrap().next().is_none(), "the writable probe leaves nothing behind");
    }

    #[test]
    fn a_use_switch_drops_sets_from_the_old_webview_until_the_next_load() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        let generation = data.load().generation;
        data.init(stores(&[("tasks-store", json!({ "tasks": ["mine"] }))])).unwrap();
        assert_eq!(data.set_versioned("tasks-store", json!({ "tasks": ["before"] }), generation, 1), Ok(true));

        let target = fixture.other_folder("cloud");
        let theirs = json!({ "schemaVersion": 1, "writtenAt": "t", "writtenBy": "other", "appVersion": "1", "stores": { "tasks-store": { "tasks": ["theirs"] } } });
        let theirs_bytes = serde_json::to_vec(&theirs).unwrap();
        fs::write(target.join(FILE_NAME), &theirs_bytes).unwrap();
        let switched = data.set_location(&target, LocationMode::Use).unwrap();
        assert!(switched.generation > generation, "the switch invalidates the old webview's generation");

        // The old page keeps mutating its stores until the reload lands.
        assert_eq!(data.set_versioned("tasks-store", json!({ "tasks": ["stale"] }), generation, 2), Ok(false));
        assert_eq!(data.set_versioned("board-store", json!({ "stale": true }), generation, 3), Ok(false));
        assert_eq!(data.set_versioned("tasks-store", json!({ "tasks": ["stale"] }), switched.generation - 1, 4), Ok(false));
        assert!(!data.shared.lock().dirty, "nothing became dirty");
        thread::sleep(FAST.max_wait * 2);
        assert_eq!(fs::read(target.join(FILE_NAME)).unwrap(), theirs_bytes, "the chosen file is untouched");
        let _ = data.flush();
        assert_eq!(fs::read(target.join(FILE_NAME)).unwrap(), theirs_bytes);

        // The reloaded page loads again and gets a generation that works.
        let reloaded = data.load();
        assert!(reloaded.generation > switched.generation);
        assert_eq!(reloaded.envelope.unwrap()["stores"]["tasks-store"]["tasks"][0], "theirs");
        assert_eq!(data.set_versioned("tasks-store", json!({ "tasks": ["fresh"] }), reloaded.generation, 1), Ok(true));
        data.flush().unwrap();
        assert_eq!(read_json(&target.join(FILE_NAME))["stores"]["tasks-store"]["tasks"][0], "fresh");
    }

    #[test]
    fn a_move_keeps_the_generation_so_the_live_webview_continues() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        let generation = data.load().generation;
        data.init(stores(&[("tasks-store", json!({ "tasks": [] }))])).unwrap();
        let target = fixture.other_folder("cloud");
        let moved = data.set_location(&target, LocationMode::Move).unwrap();
        assert_eq!(moved.generation, generation);
        assert_eq!(data.set_versioned("tasks-store", json!({ "tasks": [1] }), generation, 1), Ok(true));
    }

    #[test]
    fn reordered_sets_for_one_key_cannot_overwrite_a_newer_store() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        let generation = data.load().generation;
        data.init(Map::new()).unwrap();

        // The runtime hands the newest call to Rust first.
        assert_eq!(data.set_versioned("tasks-store", json!({ "v": 3 }), generation, 3), Ok(true));
        assert_eq!(data.set_versioned("tasks-store", json!({ "v": 2 }), generation, 2), Ok(false));
        assert_eq!(data.set_versioned("tasks-store", json!({ "v": 1 }), generation, 1), Ok(false));
        assert_eq!(data.set_versioned("tasks-store", json!({ "v": 3 }), generation, 3), Ok(false), "a replay is dropped too");
        data.flush().unwrap();
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["v"], 3);
    }

    #[test]
    fn sequence_numbers_are_tracked_per_key() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        let generation = data.load().generation;
        data.init(Map::new()).unwrap();
        assert_eq!(data.set_versioned("tasks-store", json!(1), generation, 5), Ok(true));
        assert_eq!(data.set_versioned("board-store", json!(2), generation, 4), Ok(true), "another key, its own order");
    }

    #[test]
    fn a_new_load_restarts_the_sequence() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        let first = data.load().generation;
        data.init(Map::new()).unwrap();
        assert_eq!(data.set_versioned("tasks-store", json!(1), first, 9), Ok(true));
        let second = data.load().generation;
        assert_eq!(data.set_versioned("tasks-store", json!(2), second, 1), Ok(true), "a fresh page counts from 1");
    }

    #[test]
    fn init_that_cannot_create_the_folder_keeps_the_data_and_the_writer_completes_it() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        data.load();
        // The default folder vanishes and a file takes its place: `create_dir_all` fails.
        fs::remove_dir(&fixture.folder).unwrap();
        fs::write(&fixture.folder, b"in the way").unwrap();

        let result = data.init(stores(&[("tasks-store", json!({ "tasks": ["imported"] }))]));
        assert!(matches!(result, Err(DataError::Io { .. })));
        assert_eq!(data.status().status, Status::WriteFailed);
        assert!(data.status().error.is_some());
        assert_eq!(data.shared.lock().stores.get("tasks-store"), Some(&json!({ "tasks": ["imported"] })));

        // The folder becomes available: the retry writes the full import, not a partial state.
        fs::remove_file(&fixture.folder).unwrap();
        fs::create_dir_all(&fixture.folder).unwrap();
        assert!(wait_for(|| data.status().status == Status::Ok), "retried without a new change");
        assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"][0], "imported");
    }

    #[test]
    fn a_failed_write_retries_after_the_debounce_not_on_every_change() {
        let fixture = Fixture::new();
        let timing = Timing { debounce: Duration::from_secs(30), max_wait: Duration::from_millis(300), retry: Duration::from_secs(30), ..FAST };
        let data = initialised(&fixture, timing);
        if !folder_is_read_only_effective(&fixture.folder) {
            return;
        }
        fs::set_permissions(&fixture.folder, fs::Permissions::from_mode(0o555)).unwrap();
        data.set("tasks-store", json!({ "n": 1 })).unwrap();
        assert!(data.flush().is_err());
        assert_eq!(data.status().status, Status::WriteFailed);
        // The first change is long past its max-wait ceiling; the next change must start a new window.
        thread::sleep(timing.max_wait + Duration::from_millis(100));
        data.set("tasks-store", json!({ "n": 2 })).unwrap();

        let deadline = data.shared.lock().next_deadline(&timing).expect("a retry is scheduled");
        assert!(deadline > Instant::now() + Duration::from_millis(100), "the retry waits instead of firing at once");
        fs::set_permissions(&fixture.folder, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn the_file_keeps_key_order_and_float_precision_across_a_round_trip() {
        let fixture = Fixture::new();
        let raw = r#"{"schemaVersion":1,"writtenAt":"t","writtenBy":"d","appVersion":"1","stores":{"tasks-store":{"zebra":1,"alpha":2,"mid":{"y":0,"b":1},"ratio":0.30000000000000004,"tiny":2.2250738585072014e-308,"third":0.3333333333333333,"big":123456789012345680000.0,"odd":8.41e21}}}"#;
        fs::write(fixture.file(), raw).unwrap();
        save_location(&fixture.config, &fixture.folder, "device").unwrap();
        let data = fixture.data_file(FAST);
        let generation = data.load().generation;
        let loaded: Value = data.shared.lock().stores.get("tasks-store").cloned().unwrap();
        // Force a rewrite of the same store through the real write path.
        assert_eq!(data.set_versioned("tasks-store", json!({ "touch": true }), generation, 1), Ok(true));
        assert_eq!(data.set_versioned("tasks-store", loaded, generation, 2), Ok(true));
        data.flush().unwrap();

        let written = fs::read_to_string(fixture.file()).unwrap();
        let order = |needle: &str| written.find(needle).unwrap_or_else(|| panic!("{needle} missing in {written}"));
        assert!(order("\"zebra\"") < order("\"alpha\"") && order("\"alpha\"") < order("\"mid\""), "keys keep their order");
        assert!(order("\"y\"") < order("\"b\""), "nested keys keep their order");
        let reread: Value = serde_json::from_str(&written).unwrap();
        let stores = &reread["stores"]["tasks-store"];
        for (key, expected) in [("ratio", 0.30000000000000004_f64), ("tiny", 2.2250738585072014e-308), ("third", 1.0 / 3.0), ("odd", 8.41e21)] {
            assert_eq!(stores[key].as_f64().unwrap().to_bits(), expected.to_bits(), "{key} is bit-exact");
        }
    }

    #[test]
    fn an_unreadable_location_file_is_not_a_first_run() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        let previous = fs::read(fixture.file()).unwrap();
        let elsewhere = fixture.other_folder("chosen");
        write_atomic(&elsewhere.join(FILE_NAME), b"{ \"previously\": \"chosen\" }").unwrap();
        for garbage in [&b"{ truncated"[..], b"{\"folder\":\"\",\"deviceId\":\"\"}"] {
            fs::write(fixture.config.join(LOCATION_FILE), garbage).unwrap();

            let data = fixture.data_file(FAST);
            let loaded = data.load();
            assert_eq!(loaded.state.status, Status::ReadOnlyCorrupt);
            assert!(!loaded.needs_init, "no import over the frozen localStorage copy");
            assert!(loaded.envelope.is_none());
            assert!(loaded.state.error.is_some());

            assert_eq!(data.init(stores(&[("tasks-store", json!({ "tasks": ["frozen"] }))])), Err(DataError::Blocked { status: Status::ReadOnlyCorrupt }));
            data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
            assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::ReadOnlyCorrupt }));
            thread::sleep(FAST.max_wait * 2);
            assert_eq!(fs::read(fixture.file()).unwrap(), previous, "the default folder's file is untouched");
            assert_eq!(fs::read(fixture.config.join(LOCATION_FILE)).unwrap(), garbage, "the pointer is not rewritten");
        }
    }

    #[test]
    fn choosing_a_folder_repairs_an_unreadable_location_file() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        fs::write(fixture.config.join(LOCATION_FILE), b"nope").unwrap();
        let chosen = fixture.other_folder("chosen");
        let theirs = json!({ "schemaVersion": 1, "writtenAt": "t", "writtenBy": "other", "appVersion": "1", "stores": { "tasks-store": { "tasks": ["theirs"] } } });
        fs::write(chosen.join(FILE_NAME), serde_json::to_vec(&theirs).unwrap()).unwrap();

        let data = fixture.data_file(FAST);
        assert_eq!(data.load().state.status, Status::ReadOnlyCorrupt);
        let result = data.set_location(&chosen, LocationMode::Use).unwrap();
        assert_eq!(result.state.status, Status::Ok);
        let reloaded = fixture.data_file(FAST).load();
        assert_eq!(reloaded.state.status, Status::Ok);
        assert_eq!(reloaded.state.folder, chosen.to_string_lossy().as_ref());
    }

    /// A configured folder whose volume is gone, then back with the real file in it.
    fn missing_file_state(fixture: &Fixture) -> (DataFile, Vec<u8>) {
        drop(initialised(fixture, FAST));
        fs::write(fixture.config.join(LOCATION_FILE), format!(r#"{{"folder":{:?},"deviceId":"device"}}"#, fixture.folder)).unwrap();
        let real = json!({ "schemaVersion": 1, "writtenAt": "t", "writtenBy": "device", "appVersion": "1", "stores": { "tasks-store": { "tasks": ["real"] } } });
        let real_bytes = serde_json::to_vec(&real).unwrap();
        fs::write(fixture.file(), &real_bytes).unwrap();
        let data = fixture.data_file(FAST);
        data.load();
        fs::remove_file(fixture.file()).unwrap();
        data.load();
        assert_eq!(data.status().status, Status::MissingFile);
        (data, real_bytes)
    }

    #[test]
    fn a_failed_start_here_out_of_missing_file_never_overwrites_the_file_that_comes_back() {
        let fixture = Fixture::new();
        let (data, real_bytes) = missing_file_state(&fixture);
        // The volume is gone: the folder cannot be created.
        fs::remove_dir(&fixture.folder).unwrap();
        fs::write(&fixture.folder, b"in the way").unwrap();

        let result = data.init(stores(&[("tasks-store", json!({ "tasks": ["EMPTY-MEMORY"] }))]));
        assert!(matches!(result, Err(DataError::Unavailable { .. })));
        assert_eq!(data.status().status, Status::FolderUnavailable, "a gone folder is never rebuilt: it is unavailable");

        // The volume returns with the real file; the writer must not replace it.
        fs::remove_file(&fixture.folder).unwrap();
        fs::create_dir_all(&fixture.folder).unwrap();
        fs::write(fixture.file(), &real_bytes).unwrap();
        thread::sleep(FAST.retry * 4);
        assert_eq!(fs::read(fixture.file()).unwrap(), real_bytes, "the real file survives the writer");
        // The next look sees a file this process never read: the user picks a version.
        assert_eq!(data.check_now().status, Status::Conflict);
        assert_eq!(fs::read(fixture.file()).unwrap(), real_bytes);
    }

    #[test]
    fn the_writer_refuses_to_replace_a_file_it_never_read() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        assert!(data.load().needs_init);
        // Another device's file lands in the folder after this one was read as empty.
        let theirs = br#"{"schemaVersion":1,"writtenAt":"t","writtenBy":"other","appVersion":"1","stores":{"tasks-store":{"tasks":["theirs"]}}}"#;
        fs::write(fixture.file(), theirs).unwrap();

        data.set("tasks-store", json!({ "tasks": ["mine"] })).unwrap();
        assert!(matches!(data.flush(), Err(DataError::Blocked { .. })));
        thread::sleep(FAST.max_wait * 2);
        assert_eq!(fs::read(fixture.file()).unwrap(), theirs.as_slice(), "an unknown file is never replaced");
        assert_ne!(data.status().status, Status::Ok);
    }

    #[test]
    fn an_unreadable_location_file_pointing_at_the_default_folder_can_be_repaired_with_use() {
        let fixture = Fixture::new();
        drop(initialised(&fixture, FAST));
        let previous = fs::read(fixture.file()).unwrap();
        fs::write(fixture.config.join(LOCATION_FILE), b"nope").unwrap();

        let data = fixture.data_file(FAST);
        assert_eq!(data.load().state.status, Status::ReadOnlyCorrupt);
        assert!(!data.inspect_folder(&fixture.folder).unwrap().is_current, "the default folder is offered, not 'already in use'");
        // Move and Replace would copy the near-empty memory copy over the real file.
        assert_eq!(data.set_location(&fixture.folder, LocationMode::Replace), Err(DataError::SameFolder));
        assert_eq!(data.set_location(&fixture.folder, LocationMode::Move), Err(DataError::SameFolder));
        assert_eq!(fs::read(fixture.file()).unwrap(), previous);

        let result = data.set_location(&fixture.folder, LocationMode::Use).unwrap();
        assert_eq!(result.state.status, Status::Ok);
        assert_eq!(result.envelope.unwrap()["stores"]["tasks-store"]["tasks"], json!([]));
        let reloaded = fixture.data_file(FAST).load();
        assert_eq!(reloaded.state.status, Status::Ok, "the pointer is rewritten");
        assert!(data.inspect_folder(&fixture.folder).unwrap().is_current);
    }

    #[test]
    fn rejects_bad_keys() {
        let fixture = Fixture::new();
        let data = fixture.data_file(FAST);
        assert_eq!(data.set("", json!(1)), Err(DataError::Invalid));
        assert_eq!(data.set(&"k".repeat(MAX_KEY_LEN + 1), json!(1)), Err(DataError::Invalid));
    }
}
