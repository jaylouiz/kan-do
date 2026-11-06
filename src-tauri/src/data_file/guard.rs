//! Guard around the data file (#224, ADR 011): bounded I/O, the change probe that decides between
//! "unchanged", "syncing", "gone", "unreachable" and "changed", and the conflict types the UI shows.
//!
//! Every read of the data folder runs on its own thread with a deadline. A cloud client that is
//! downloading an evicted file can block a read for minutes; the state machine must never wait that long
//! with the lock held, and a late completion must never write.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, SystemTime};

use serde::Serialize;

use super::backup::{summarise, task_count};
use super::{parse_envelope, sha256_hex, Parsed};

/// Why a bounded I/O call did not produce a value.
#[derive(Debug)]
pub enum IoFailure {
    /// The deadline passed (a cloud file being downloaded, a hung network volume).
    TimedOut,
    Failed(io::Error),
}

impl IoFailure {
    pub fn message(&self) -> String {
        match self {
            IoFailure::TimedOut => "timed out".to_string(),
            IoFailure::Failed(error) => error.to_string(),
        }
    }

    pub fn is_not_found(&self) -> bool {
        matches!(self, IoFailure::Failed(error) if error.kind() == io::ErrorKind::NotFound)
    }

    /// A [`write_guarded`] call found the file other than expected and wrote nothing.
    pub fn is_changed(&self) -> bool {
        matches!(self, IoFailure::Failed(error) if error.kind() == io::ErrorKind::Other && error.to_string() == CHANGED)
    }
}

const CHANGED: &str = "the data file changed underneath";

/// Runs `op` on a helper thread and waits at most `timeout`. The operation receives a flag that is set
/// when the deadline passed; a write must check it right before its commit step (the rename) and give up,
/// so a call that finishes late can never land after the state machine declared the folder unavailable.
pub fn run_timed<T: Send + 'static>(
    timeout: Duration,
    op: impl FnOnce(Arc<AtomicBool>) -> io::Result<T> + Send + 'static,
) -> Result<T, IoFailure> {
    let abandoned = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&abandoned);
    let (sender, receiver) = mpsc::channel();
    thread::Builder::new()
        .name("kan-do-data-io".into())
        .spawn(move || {
            let _ = sender.send(op(flag));
        })
        .map_err(IoFailure::Failed)?;
    match receiver.recv_timeout(timeout) {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(IoFailure::Failed(error)),
        Err(_) => {
            abandoned.store(true, Ordering::SeqCst);
            Err(IoFailure::TimedOut)
        }
    }
}

/// Reads a file with a deadline.
pub fn read_timed(path: &Path, timeout: Duration) -> Result<Vec<u8>, IoFailure> {
    let path = path.to_path_buf();
    run_timed(timeout, move |_| fs::read(path))
}

/// `write_atomic` with a deadline; the rename is skipped when the deadline already passed.
pub fn write_timed(path: &Path, bytes: Vec<u8>, timeout: Duration) -> Result<(), IoFailure> {
    let path = path.to_path_buf();
    run_timed(timeout, move |abandoned| {
        super::write_atomic_with(&path, &bytes, || {
            if abandoned.load(Ordering::SeqCst) {
                Err(io::Error::new(io::ErrorKind::TimedOut, "abandoned after the deadline"))
            } else {
                Ok(())
            }
        })
    })
}

/// What a replacing write may find at its target right before it commits.
pub enum Expect {
    /// The target must not exist: a file that reappeared meanwhile was never read.
    Absent,
    /// The target must still hold exactly these bytes (the ones just copied to `backups/`).
    Bytes(Vec<u8>),
}

/// `write_timed` that re-checks the target in the commit step, right before the rename, so a file that
/// appeared or changed since the caller looked is never replaced unread. Narrows the window to the rename.
pub fn write_guarded(path: &Path, bytes: Vec<u8>, expect: Expect, timeout: Duration) -> Result<(), IoFailure> {
    let path = path.to_path_buf();
    run_timed(timeout, move |abandoned| {
        super::write_atomic_with(&path, &bytes, || {
            if abandoned.load(Ordering::SeqCst) {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "abandoned after the deadline"));
            }
            let found = match &expect {
                Expect::Absent => fs::metadata(&path).map(|_| None),
                Expect::Bytes(_) => fs::read(&path).map(Some),
            };
            match (found, &expect) {
                (Err(error), Expect::Absent) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                (Ok(Some(now)), Expect::Bytes(was)) if now == *was => Ok(()),
                (Err(error), _) if error.kind() != io::ErrorKind::NotFound => Err(error),
                _ => Err(io::Error::other(CHANGED)),
            }
        })
    })
}

/// Size and modification time of the data file: what a cheap `stat` can tell about a change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    pub len: u64,
    pub modified: Option<SystemTime>,
}

impl FileStamp {
    fn of(metadata: &fs::Metadata) -> FileStamp {
        FileStamp { len: metadata.len(), modified: metadata.modified().ok() }
    }
}

fn stat_timed(path: &Path, timeout: Duration) -> Result<FileStamp, IoFailure> {
    let path = path.to_path_buf();
    run_timed(timeout, move |_| fs::metadata(path).map(|metadata| FileStamp::of(&metadata)))
}

/// The stamp of `path` right now, or `None` when it cannot be read quickly.
pub fn stamp_of(path: &Path, timeout: Duration) -> Option<FileStamp> {
    stat_timed(path, timeout).ok()
}

/// What a look at the data file found.
pub enum Probe {
    /// The folder or the file cannot be reached (missing folder, offline volume, permission, timeout).
    Unreachable(String),
    /// The folder is there, the file is not.
    Missing,
    /// Size or mtime moved between two stats `settle` apart: a sync client is still writing.
    Syncing,
    /// Same size and mtime as last time: nothing to read.
    Unchanged,
    /// The file as it is now. `parsed` is `None` when it is not a readable envelope.
    Present { stamp: Option<FileStamp>, hash: String, parsed: Option<Box<Parsed>>, bytes: Vec<u8> },
}

/// Looks at `file`: stat first, hash only when the stamp differs from `last` (or `force_hash`).
pub fn probe(file: &Path, last: Option<FileStamp>, force_hash: bool, timeout: Duration, settle: Duration) -> Probe {
    let Some(folder) = file.parent() else { return Probe::Unreachable("path has no parent".into()) };
    if let Err(failure) = stat_timed(folder, timeout) {
        return Probe::Unreachable(failure.message());
    }
    let stamp = match stat_timed(file, timeout) {
        Ok(stamp) => stamp,
        Err(failure) if failure.is_not_found() => return Probe::Missing,
        Err(failure) => return Probe::Unreachable(failure.message()),
    };
    if !force_hash && last == Some(stamp) {
        return Probe::Unchanged;
    }
    if !settle.is_zero() {
        thread::sleep(settle);
        match stat_timed(file, timeout) {
            Ok(again) if again == stamp => {}
            Ok(_) => return Probe::Syncing,
            Err(failure) if failure.is_not_found() => return Probe::Missing,
            Err(failure) => return Probe::Unreachable(failure.message()),
        }
    }
    match read_timed(file, timeout) {
        Ok(bytes) => Probe::Present {
            stamp: Some(stamp),
            hash: sha256_hex(&bytes),
            parsed: parse_envelope(&bytes).map(Box::new),
            bytes,
        },
        Err(failure) if failure.is_not_found() => Probe::Missing,
        Err(failure) => Probe::Unreachable(failure.message()),
    }
}

/// The other side of a conflict: what the file on disk says about itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TheirVersion {
    /// False when the file on disk does not parse (a half-synced file): it cannot be loaded.
    pub readable: bool,
    pub written_at: Option<String>,
    pub written_by: Option<String>,
    pub task_count: Option<usize>,
    pub schema_version: Option<u64>,
}

impl TheirVersion {
    pub fn from_parsed(parsed: Option<&Parsed>) -> TheirVersion {
        match parsed.map(summarise) {
            Some(summary) => TheirVersion {
                readable: true,
                written_at: Some(summary.written_at),
                written_by: Some(summary.written_by),
                task_count: summary.task_count,
                schema_version: Some(summary.schema_version),
            },
            None => TheirVersion { readable: false, written_at: None, written_by: None, task_count: None, schema_version: None },
        }
    }
}

/// Stored while the status is `conflict`. It follows the file on disk: the watcher refreshes it, and
/// "Diese Version behalten" only acts on the version it describes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConflictState {
    pub theirs: TheirVersion,
    /// SHA-256 and stamp of the file `theirs` was read from; what the next look compares against.
    pub hash: Option<String>,
    pub stamp: Option<FileStamp>,
    /// The file appeared after a launch that could not read it: with no edits of mine the window
    /// reloads on its own.
    pub after_launch: bool,
}

/// The `conflict` field of the status payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub theirs: TheirVersion,
    /// This app holds edits that are not in the file.
    pub local_changes: bool,
    pub mine_task_count: Option<usize>,
    /// Reload without asking: the file came back after a launch without data and nothing was edited.
    pub auto_reload: bool,
}

impl ConflictInfo {
    pub fn new(state: &ConflictState, local_changes: bool, stores: &serde_json::Map<String, serde_json::Value>) -> ConflictInfo {
        ConflictInfo {
            theirs: state.theirs.clone(),
            local_changes,
            mine_task_count: task_count(stores),
            auto_reload: state.after_launch && !local_changes,
        }
    }
}
