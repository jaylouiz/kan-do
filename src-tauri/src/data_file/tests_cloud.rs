//! Tests for the cloud upload state of #271: the watcher asks an injected reader (no iCloud needed) and
//! the payload carries the answer as the non-blocking `cloudSync` field. The watcher is stepped by hand
//! (`check_now`); the grace is `FAST.cloud_grace`.

use super::cloud::CloudSyncState;
use super::tests::{initialised_with_reader, Fixture, FAST};
use super::*;
use serde_json::json;
use std::io;
use std::sync::atomic::AtomicBool;
use std::sync::mpsc;
use std::sync::Mutex as StdMutex;

type Answer = Arc<StdMutex<io::Result<CloudProbe>>>;

fn answer(probe: CloudProbe) -> Answer {
    Arc::new(StdMutex::new(Ok(probe)))
}

fn say(answer: &Answer, probe: CloudProbe) {
    *answer.lock().unwrap() = Ok(probe);
}

fn reader_of(answer: &Answer) -> Arc<CloudReader> {
    let answer = Arc::clone(answer);
    Arc::new(move |_| match &*answer.lock().unwrap() {
        Ok(probe) => Ok(probe.clone()),
        Err(error) => Err(io::Error::new(error.kind(), error.to_string())),
    })
}

fn cloud(data: &DataFile) -> Option<CloudSync> {
    data.status().cloud_sync
}

fn foreign_file() -> Vec<u8> {
    serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1,
        "writtenAt": "2026-10-24T09:12:00.000Z",
        "writtenBy": "other-device",
        "appVersion": "1.0.0",
        "stores": { "tasks-store": { "tasks": ["theirs"] } },
    }))
    .unwrap()
}

#[test]
fn a_plain_folder_reports_nothing() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::NotCloud);
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    assert_eq!(cloud(&data), None);
}

#[test]
fn an_uploaded_file_is_reported_but_never_visible() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Uploaded);
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    let sync = cloud(&data).unwrap();
    assert_eq!((sync.state, sync.visible, sync.since), (CloudSyncState::Uploaded, false, None));
}

#[test]
fn pending_stays_quiet_inside_the_grace_and_turns_visible_after_it() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Pending);
    let data = initialised_with_reader(&fixture, Timing { cloud_grace: Duration::from_millis(300), ..FAST }, reader_of(&said));
    data.check_now();
    let sync = cloud(&data).unwrap();
    assert_eq!((sync.state, sync.visible), (CloudSyncState::Pending, false));
    assert!(sync.since.is_some());
    thread::sleep(Duration::from_millis(350));
    data.check_now();
    assert!(cloud(&data).unwrap().visible);
}

#[test]
fn an_upload_error_stays_quiet_inside_the_grace_and_keeps_the_reason() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Error("The network is offline.".into()));
    let data = initialised_with_reader(&fixture, Timing { cloud_grace: Duration::from_millis(300), ..FAST }, reader_of(&said));
    data.check_now();
    let sync = cloud(&data).unwrap();
    assert_eq!((sync.state, sync.visible, sync.message.as_deref()), (CloudSyncState::Error, false, Some("The network is offline.")));
    thread::sleep(Duration::from_millis(350));
    data.check_now();
    let sync = cloud(&data).unwrap();
    assert_eq!((sync.visible, sync.message.as_deref()), (true, Some("The network is offline.")));
}

#[test]
fn uploaded_after_pending_clears_the_visible_state() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Pending);
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    thread::sleep(FAST.cloud_grace + Duration::from_millis(50));
    data.check_now();
    assert!(cloud(&data).unwrap().visible);
    say(&said, CloudProbe::Uploaded);
    data.check_now();
    let sync = cloud(&data).unwrap();
    assert_eq!((sync.state, sync.visible), (CloudSyncState::Uploaded, false));
}

#[test]
fn a_read_that_fails_keeps_the_previous_value_and_no_status_moves() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Error("offline".into()));
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    *said.lock().unwrap() = Err(io::Error::other("could not read"));
    data.check_now();
    assert_eq!(cloud(&data).unwrap().state, CloudSyncState::Error);
    assert_eq!(data.status().status, Status::Ok);
}

#[test]
fn a_read_that_hangs_leaves_the_value_and_is_not_a_folder_problem() {
    let fixture = Fixture::new();
    // The reader blocks on a gate instead of sleeping: it hangs for exactly as long as the test holds
    // the sender, whatever the load. `FAST.io_timeout` stays untouched, so the first look cannot time out.
    let (release, gate) = mpsc::channel::<()>();
    let gate = Arc::new(StdMutex::new(gate));
    let hang = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&hang);
    let reader: Arc<CloudReader> = Arc::new(move |_| {
        if flag.load(Ordering::SeqCst) {
            let _ = gate.lock().unwrap().recv();
        }
        Ok(CloudProbe::Pending)
    });
    let data = initialised_with_reader(&fixture, FAST, reader);
    data.check_now();
    assert_eq!(cloud(&data).unwrap().state, CloudSyncState::Pending);
    hang.store(true, Ordering::SeqCst);
    let state = data.check_now();
    assert_eq!(state.cloud_sync.unwrap().state, CloudSyncState::Pending);
    assert_eq!(state.status, Status::Ok);
    drop(release);
}

#[test]
fn a_status_excursion_restarts_the_tracker_and_its_grace() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Pending);
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    thread::sleep(FAST.cloud_grace + Duration::from_millis(50));
    data.check_now();
    assert!(cloud(&data).unwrap().visible);
    fs::write(fixture.file(), foreign_file()).unwrap();
    assert_eq!(data.check_now().status, Status::Conflict);
    data.resolve_conflict(ConflictChoice::Theirs).unwrap();
    data.load();
    assert_eq!(data.status().status, Status::Ok);
    assert_eq!(cloud(&data), None, "the value from before the conflict must not be reported again");
    data.check_now();
    let sync = cloud(&data).unwrap();
    assert_eq!((sync.state, sync.visible), (CloudSyncState::Pending, false), "the grace starts over");
}

#[test]
fn a_folder_switch_clears_the_state() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Pending);
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    assert!(cloud(&data).is_some());
    let target = fixture.other_folder("elsewhere");
    data.set_location(&target, LocationMode::Move).unwrap();
    assert_eq!(cloud(&data), None);
}

#[test]
fn blocking_statuses_report_no_cloud_state() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Error("offline".into()));
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    assert!(cloud(&data).is_some());
    fs::write(fixture.file(), foreign_file()).unwrap();
    let state = data.check_now();
    assert_eq!(state.status, Status::Conflict);
    assert_eq!(state.cloud_sync, None);
    // Not even the stored value leaks through while the notice for the status owns the screen.
    assert_eq!(data.status().cloud_sync, None);
}

#[test]
fn a_missing_file_is_not_asked_about_the_cloud() {
    let fixture = Fixture::new();
    let asked = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&asked);
    let reader: Arc<CloudReader> = Arc::new(move |_| {
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(CloudProbe::Pending)
    });
    let data = initialised_with_reader(&fixture, FAST, reader);
    fs::remove_file(fixture.file()).unwrap();
    let state = data.check_now();
    assert_eq!(state.status, Status::MissingFile);
    assert_eq!(state.cloud_sync, None);
    assert_eq!(asked.load(Ordering::SeqCst), 0);
}

#[test]
fn only_a_changed_value_is_announced() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Error("offline".into()));
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    let announced = fixture.events.lock().unwrap().len();
    data.check_now();
    data.check_now();
    assert_eq!(fixture.events.lock().unwrap().len(), announced, "an unchanged answer must not emit");
    say(&said, CloudProbe::Uploaded);
    data.check_now();
    assert_eq!(fixture.events.lock().unwrap().len(), announced + 1);
}

#[test]
fn saving_is_never_blocked_or_delayed_by_a_pending_upload() {
    let fixture = Fixture::new();
    let said = answer(CloudProbe::Error("offline".into()));
    let data = initialised_with_reader(&fixture, FAST, reader_of(&said));
    data.check_now();
    data.set("tasks-store", json!({ "tasks": ["edited offline"] })).unwrap();
    data.flush().unwrap();
    assert_eq!(super::tests::read_json(&fixture.file())["stores"]["tasks-store"]["tasks"][0], "edited offline");
    assert_eq!(data.status().status, Status::Ok);
}
