//! Cloud upload state of the data file (#271, ADR 011).
//!
//! With the data folder in iCloud Drive the file stays writable offline and iCloud uploads it later, so
//! no status of the state machine ever fires. This module only *reports* whether the latest save has
//! reached the cloud: the watcher asks a [`CloudReader`] on every tick and a [`CloudTracker`] turns the
//! answers into the non-blocking `cloudSync` field of the status payload. It never changes `Status`,
//! never gates a write and is iCloud only: every other folder answers [`CloudProbe::NotCloud`].
//!
//! The reader is injectable (`Shared::cfg.cloud_reader`) so tests need no iCloud; the real one reads the
//! ubiquitous-item attributes of the file through `NSURL` on macOS and is a stub elsewhere.

use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;

/// `error` / `uploading` / `pending` stay quiet (`visible: false`) this long after the first not-uploaded look.
pub const CLOUD_GRACE_SECS: u64 = 300;

/// What one look at the file's cloud attributes found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudProbe {
    /// Not an iCloud file (or a provider that answers nothing): nothing is reported.
    NotCloud,
    Uploaded,
    Uploading,
    /// Not uploaded and not uploading (offline, waiting for a slot).
    Pending,
    /// iCloud's own reason why the upload failed.
    Error(String),
}

/// Reads the cloud attributes of a path. An `Err` means "could not tell": the previous value stays.
pub type CloudReader = dyn Fn(&Path) -> io::Result<CloudProbe> + Send + Sync;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudSyncState {
    Uploading,
    Pending,
    Error,
    Uploaded,
}

/// The `cloudSync` field of the status payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSync {
    pub state: CloudSyncState,
    /// iCloud's reason, set for `error` only.
    pub message: Option<String>,
    /// ISO time of the first not-uploaded look; `None` once uploaded.
    pub since: Option<String>,
    /// The notice may show it: `error`, `uploading` and `pending` after the grace, `uploaded` never.
    /// The data page shows the live state regardless.
    pub visible: bool,
}

/// Turns the answers of the reader into the payload field and owns the grace period.
#[derive(Debug, Default)]
pub struct CloudTracker {
    current: Option<CloudSync>,
    /// First not-uploaded look; cleared only by `uploaded` (or not-cloud), so continuous offline
    /// editing does not postpone the notice.
    unsynced_at: Option<Instant>,
}

impl CloudTracker {
    /// The value for the payload.
    pub fn current(&self) -> Option<CloudSync> {
        self.current.clone()
    }

    /// Applies one answer; true when the payload value changed. `stamp` renders the wall-clock time of
    /// the first not-uploaded look and runs only for that one.
    pub fn observe(&mut self, probe: CloudProbe, now: Instant, grace: Duration, stamp: impl FnOnce() -> String) -> bool {
        let next = match probe {
            CloudProbe::NotCloud => {
                self.unsynced_at = None;
                None
            }
            CloudProbe::Uploaded => {
                self.unsynced_at = None;
                Some(CloudSync { state: CloudSyncState::Uploaded, message: None, since: None, visible: false })
            }
            unsynced => {
                let first = *self.unsynced_at.get_or_insert(now);
                let since = self.current.as_ref().and_then(|current| current.since.clone()).unwrap_or_else(stamp);
                let (state, message) = match unsynced {
                    CloudProbe::Uploading => (CloudSyncState::Uploading, None),
                    CloudProbe::Pending => (CloudSyncState::Pending, None),
                    CloudProbe::Error(message) => (CloudSyncState::Error, Some(message)),
                    CloudProbe::NotCloud | CloudProbe::Uploaded => unreachable!("handled above"),
                };
                let visible = now.saturating_duration_since(first) >= grace;
                Some(CloudSync { state, message, since: Some(since), visible })
            }
        };
        let changed = next != self.current;
        self.current = next;
        changed
    }
}

/// The reader the app uses.
pub fn system_reader(path: &Path) -> io::Result<CloudProbe> {
    read_system(path)
}

/// Reads `NSURLIsUbiquitousItemKey` and the upload keys of `path`. A fresh `NSURL` is built for every
/// read: resource values are cached per instance. A plain file answers `nil` for every key.
#[cfg(target_os = "macos")]
fn read_system(path: &Path) -> io::Result<CloudProbe> {
    use objc2_foundation::{
        NSArray, NSError, NSNumber, NSString, NSURLIsUbiquitousItemKey, NSURLUbiquitousItemIsUploadedKey,
        NSURLUbiquitousItemIsUploadingKey, NSURLUbiquitousItemUploadingErrorKey, NSURL,
    };

    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    // SAFETY: the keys are immutable `NSString` constants that live for the whole process.
    let (ubiquitous, uploaded, uploading, failure) = unsafe {
        (
            NSURLIsUbiquitousItemKey,
            NSURLUbiquitousItemIsUploadedKey,
            NSURLUbiquitousItemIsUploadingKey,
            NSURLUbiquitousItemUploadingErrorKey,
        )
    };
    let keys = NSArray::from_slice(&[ubiquitous, uploaded, uploading, failure]);
    let values = url
        .resourceValuesForKeys_error(&keys)
        .map_err(|error| io::Error::other(error.localizedDescription().to_string()))?;
    let flag = |key| values.objectForKey(key).and_then(|value| value.downcast::<NSNumber>().ok()).map(|number| number.as_bool());
    let failure = values.objectForKey(failure).and_then(|value| value.downcast::<NSError>().ok());
    Ok(classify(
        flag(ubiquitous),
        flag(uploaded),
        flag(uploading),
        failure.map(|error| error.localizedDescription().to_string()),
    ))
}

#[cfg(not(target_os = "macos"))]
fn read_system(_path: &Path) -> io::Result<CloudProbe> {
    Ok(CloudProbe::NotCloud)
}

/// The mapping from the four attributes (`None` = `nil`) to a probe. Pure, so it runs on every target.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn classify(ubiquitous: Option<bool>, uploaded: Option<bool>, uploading: Option<bool>, failure: Option<String>) -> CloudProbe {
    if ubiquitous != Some(true) {
        return CloudProbe::NotCloud;
    }
    // Uploaded outranks a lingering upload error: the key may outlive a successful retry.
    if uploaded == Some(true) {
        return CloudProbe::Uploaded;
    }
    if let Some(message) = failure {
        return CloudProbe::Error(message);
    }
    match uploading {
        Some(true) => CloudProbe::Uploading,
        _ => CloudProbe::Pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRACE: Duration = Duration::from_secs(300);

    fn observe(tracker: &mut CloudTracker, probe: CloudProbe, at: Instant) -> bool {
        tracker.observe(probe, at, GRACE, || "2026-10-27T10:00:00.000Z".to_string())
    }

    #[test]
    fn classify_maps_the_attributes() {
        assert_eq!(classify(None, None, None, None), CloudProbe::NotCloud);
        assert_eq!(classify(Some(false), Some(true), None, None), CloudProbe::NotCloud);
        assert_eq!(classify(Some(true), Some(true), Some(false), None), CloudProbe::Uploaded);
        assert_eq!(classify(Some(true), Some(false), Some(true), None), CloudProbe::Uploading);
        assert_eq!(classify(Some(true), Some(false), Some(false), None), CloudProbe::Pending);
        assert_eq!(classify(Some(true), None, None, None), CloudProbe::Pending);
        assert_eq!(classify(Some(true), Some(false), Some(false), Some("offline".into())), CloudProbe::Error("offline".into()));
        assert_eq!(classify(Some(true), Some(true), Some(false), Some("offline".into())), CloudProbe::Uploaded);
    }

    #[test]
    fn not_cloud_reports_nothing() {
        let mut tracker = CloudTracker::default();
        assert!(!observe(&mut tracker, CloudProbe::NotCloud, Instant::now()));
        assert_eq!(tracker.current(), None);
    }

    #[test]
    fn uploaded_is_reported_but_never_visible() {
        let mut tracker = CloudTracker::default();
        assert!(observe(&mut tracker, CloudProbe::Uploaded, Instant::now()));
        let current = tracker.current().unwrap();
        assert_eq!((current.state, current.visible, current.since), (CloudSyncState::Uploaded, false, None));
    }

    #[test]
    fn pending_is_quiet_inside_the_grace_and_visible_after_it() {
        let mut tracker = CloudTracker::default();
        let start = Instant::now();
        assert!(observe(&mut tracker, CloudProbe::Pending, start));
        assert!(!tracker.current().unwrap().visible);
        assert!(!observe(&mut tracker, CloudProbe::Pending, start + Duration::from_secs(299)));
        assert!(observe(&mut tracker, CloudProbe::Pending, start + GRACE));
        let current = tracker.current().unwrap();
        assert_eq!((current.state, current.visible), (CloudSyncState::Pending, true));
        assert_eq!(current.since.as_deref(), Some("2026-10-27T10:00:00.000Z"));
    }

    #[test]
    fn uploading_and_pending_share_one_grace() {
        let mut tracker = CloudTracker::default();
        let start = Instant::now();
        observe(&mut tracker, CloudProbe::Pending, start);
        observe(&mut tracker, CloudProbe::Uploading, start + Duration::from_secs(200));
        observe(&mut tracker, CloudProbe::Pending, start + GRACE);
        assert!(tracker.current().unwrap().visible, "the grace counts from the first not-uploaded look");
    }

    #[test]
    fn error_follows_the_grace_and_carries_the_reason() {
        let mut tracker = CloudTracker::default();
        let start = Instant::now();
        observe(&mut tracker, CloudProbe::Error("no network".into()), start);
        let current = tracker.current().unwrap();
        assert_eq!((current.state, current.visible, current.message.as_deref()), (CloudSyncState::Error, false, Some("no network")));
        observe(&mut tracker, CloudProbe::Error("no network".into()), start + GRACE);
        let current = tracker.current().unwrap();
        assert_eq!((current.state, current.visible, current.message.as_deref()), (CloudSyncState::Error, true, Some("no network")));
    }

    #[test]
    fn uploaded_after_pending_clears_the_notice_and_restarts_the_grace() {
        let mut tracker = CloudTracker::default();
        let start = Instant::now();
        observe(&mut tracker, CloudProbe::Pending, start);
        observe(&mut tracker, CloudProbe::Pending, start + GRACE);
        assert!(tracker.current().unwrap().visible);
        assert!(observe(&mut tracker, CloudProbe::Uploaded, start + GRACE + Duration::from_secs(15)));
        assert!(!tracker.current().unwrap().visible);
        // A new edit starts a new wait.
        observe(&mut tracker, CloudProbe::Pending, start + GRACE * 2);
        assert!(!tracker.current().unwrap().visible);
    }

    #[test]
    fn real_reader_answers_not_cloud_for_a_plain_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("kan-do-data.json");
        std::fs::write(&file, b"{}").unwrap();
        assert_eq!(system_reader(&file).unwrap(), CloudProbe::NotCloud);
    }
}
