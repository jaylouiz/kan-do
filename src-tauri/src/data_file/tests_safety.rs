//! Tests for the safety layer of #224 (ADR 011): conflict detection, backups, restore, the unavailable
//! folder, conflict copies and the carry-over fixes from the #222 review. They drive the state machine
//! through a `tempfile` folder; the watcher is stepped by hand (`check_now`) so nothing waits for a timer.

use super::tests::{folder_is_read_only_effective, initialised, read_json, stores, wait_for, Fixture, FAST};
use super::backup::{backup_name, OTHER_KEEP};
use super::*;
use serde_json::json;
use std::os::unix::fs::PermissionsExt;
use std::sync::Mutex as StdMutex;

const OCT_24_NOON: u64 = 1_792_843_200;
const DAY: u64 = 86_400;

fn envelope_bytes(written_by: &str, tasks: &[&str]) -> Vec<u8> {
    serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1,
        "writtenAt": "2026-10-24T09:12:00.000Z",
        "writtenBy": written_by,
        "appVersion": "1.0.0",
        "stores": { "tasks-store": { "tasks": tasks } },
    }))
    .unwrap()
}

type SharedMoment = Arc<StdMutex<Moment>>;

fn clock(secs: u64, offset: i64) -> SharedMoment {
    Arc::new(StdMutex::new(Moment { unix_secs: secs, utc_offset_secs: offset }))
}

fn set_clock(clock: &SharedMoment, secs: u64) {
    clock.lock().unwrap().unix_secs = secs;
}

fn data_file_at(fixture: &Fixture, moment: &SharedMoment, timing: Timing) -> DataFile {
    let events = Arc::clone(&fixture.events);
    let moment = Arc::clone(moment);
    DataFile::with_clock(
        fixture.config.clone(),
        fixture.folder.clone(),
        "9.9.9".into(),
        timing,
        Box::new(move || *moment.lock().unwrap()),
        Box::new(move |payload| events.lock().unwrap().push(payload.clone())),
    )
}

/// A first-run state on a controllable clock, with the first file written.
fn initialised_at(fixture: &Fixture, moment: &SharedMoment, timing: Timing) -> DataFile {
    let data = data_file_at(fixture, moment, timing);
    assert!(data.load().needs_init);
    data.init(stores(&[("tasks-store", json!({ "tasks": [] }))])).unwrap();
    data
}

fn backup_names_of(fixture: &Fixture, kind: BackupKind) -> Vec<String> {
    backup_names(&backup_dir(&fixture.folder))
        .unwrap()
        .into_iter()
        .filter(|name| parse_backup_name(name).is_some_and(|parts| parts.kind == kind))
        .collect()
}

/// Puts a file where the `backups/` directory would be, so every backup fails.
fn block_backups(folder: &Path) {
    let _ = fs::remove_dir_all(backup_dir(folder));
    fs::write(backup_dir(folder), b"in the way").unwrap();
}

fn backup_bytes(fixture: &Fixture, name: &str) -> Vec<u8> {
    fs::read(backup_dir(&fixture.folder).join(name)).unwrap()
}

/// An external writer replaced the file; the app has edits of its own waiting.
fn conflicted(fixture: &Fixture, timing: Timing) -> (DataFile, Vec<u8>) {
    let data = initialised(fixture, timing);
    data.set("tasks-store", json!({ "tasks": ["mine"] })).unwrap();
    data.flush().unwrap();
    let theirs = envelope_bytes("other-device", &["a", "b", "c"]);
    fs::write(fixture.file(), &theirs).unwrap();
    data.set("tasks-store", json!({ "tasks": ["mine", "more"] })).unwrap();
    assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::Conflict }));
    (data, theirs)
}

// --- conflict detection -------------------------------------------------------------------------

#[test]
fn a_foreign_change_blocks_the_write_and_becomes_a_conflict() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, Timing { debounce: Duration::from_secs(60), ..FAST });
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs, "their file is untouched");

    let conflict = data.status().conflict.unwrap();
    assert!(conflict.local_changes);
    assert_eq!(conflict.mine_task_count, Some(2));
    assert_eq!(conflict.theirs.task_count, Some(3));
    assert_eq!(conflict.theirs.written_by.as_deref(), Some("other-device"));
    assert!(conflict.theirs.readable);
    assert!(!conflict.auto_reload);
    thread::sleep(FAST.max_wait * 2);
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs, "the writer never retries over a conflict");
}

#[test]
fn identical_bytes_rewritten_by_a_sync_client_are_not_a_conflict() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
    data.flush().unwrap();

    let same = fs::read(fixture.file()).unwrap();
    fs::write(fixture.file(), &same).unwrap();
    data.set("tasks-store", json!({ "tasks": [1, 2] })).unwrap();
    data.flush().unwrap();
    assert_eq!(data.status().status, Status::Ok);
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!([1, 2]));
}

#[test]
fn a_hand_edit_without_a_header_change_is_caught_by_the_hash() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    data.set("tasks-store", json!({ "tasks": ["x"] })).unwrap();
    data.flush().unwrap();
    let mut edited = fs::read_to_string(fixture.file()).unwrap();
    edited = edited.replace("\"x\"", "\"y\"");
    fs::write(fixture.file(), &edited).unwrap();

    data.set("tasks-store", json!({ "tasks": ["z"] })).unwrap();
    assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::Conflict }));
    assert_eq!(fs::read_to_string(fixture.file()).unwrap(), edited);
}

#[test]
fn the_watcher_finds_a_change_before_the_next_edit() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    fs::write(fixture.file(), envelope_bytes("other-device", &["a"])).unwrap();

    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    let conflict = payload.conflict.unwrap();
    assert!(!conflict.local_changes, "no edits of mine");
    assert!(!conflict.auto_reload);
    assert!(fixture.events.lock().unwrap().iter().any(|event| event.status == Status::Conflict));
}

#[test]
fn a_file_that_is_still_syncing_is_not_a_conflict_yet() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let file = fixture.file();
    let writer = thread::spawn({
        let file = file.clone();
        move || {
            thread::sleep(Duration::from_millis(30));
            fs::write(file, envelope_bytes("other-device", &["a", "b", "c", "d"])).unwrap();
        }
    });
    let slow = Timing { settle: Duration::from_millis(200), ..FAST };
    let found = probe(&file, None, false, slow.io_timeout, slow.settle);
    writer.join().unwrap();
    assert!(matches!(found, Probe::Syncing), "size and mtime moved between the two stats");
    drop(data);
}

#[test]
fn a_foreign_file_that_does_not_parse_is_a_conflict_with_an_unreadable_other_side() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    fs::write(fixture.file(), b"{ half a sync").unwrap();
    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    assert!(!payload.conflict.unwrap().theirs.readable);
}

// --- conflict resolution ------------------------------------------------------------------------

#[test]
fn keep_mine_files_their_version_and_writes_mine() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, FAST);

    let payload = data.resolve_conflict(ConflictChoice::Mine).unwrap();
    assert_eq!(payload.status, Status::Ok);
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["mine", "more"]));
    let filed = backup_names_of(&fixture, BackupKind::Conflict);
    assert_eq!(filed.len(), 1);
    assert_eq!(backup_bytes(&fixture, &filed[0]), theirs, "their file survives verbatim");
    // Saving works again.
    data.set("tasks-store", json!({ "tasks": ["after"] })).unwrap();
    data.flush().unwrap();
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["after"]));
}

#[test]
fn load_theirs_keeps_my_state_as_unsaved_and_leaves_their_file_alone() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, FAST);
    let generation = data.shared.lock().generation;

    let payload = data.resolve_conflict(ConflictChoice::Theirs).unwrap();
    assert_eq!(payload.status, Status::Conflict, "the reload that follows settles the state");
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);
    let kept = backup_names_of(&fixture, BackupKind::Unsaved);
    assert_eq!(kept.len(), 1);
    assert_eq!(serde_json::from_slice::<Value>(&backup_bytes(&fixture, &kept[0])).unwrap()["stores"]["tasks-store"]["tasks"], json!(["mine", "more"]));
    assert!(data.shared.lock().generation > generation, "the old webview's writes are fenced");

    let loaded = data.load();
    assert_eq!(loaded.state.status, Status::Ok);
    assert_eq!(loaded.envelope.unwrap()["stores"]["tasks-store"]["tasks"], json!(["a", "b", "c"]));
    assert_eq!(backup_names_of(&fixture, BackupKind::Unsaved).len(), 1, "the reload adds no second copy");
}

#[test]
fn load_theirs_aborts_when_my_state_cannot_be_kept() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, FAST);
    block_backups(&fixture.folder);

    assert!(matches!(data.resolve_conflict(ConflictChoice::Theirs), Err(DataError::BackupFailed { .. })));
    assert_eq!(data.status().status, Status::Conflict);
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);
}

#[test]
fn keep_mine_aborts_when_their_version_cannot_be_kept() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, FAST);
    block_backups(&fixture.folder);

    assert!(matches!(data.resolve_conflict(ConflictChoice::Mine), Err(DataError::BackupFailed { .. })));
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs, "their file is not overwritten without a copy");
}

#[test]
fn keep_mine_needs_edits_and_a_schema_this_build_knows() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let theirs = envelope_bytes("other-device", &["a"]);
    fs::write(fixture.file(), &theirs).unwrap();
    data.check_now();
    assert_eq!(data.resolve_conflict(ConflictChoice::Mine), Err(DataError::Invalid), "no edits of mine to keep");
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);

    let newer = serde_json::to_vec(&json!({ "schemaVersion": 99, "writtenAt": "t", "writtenBy": "o", "appVersion": "9", "stores": {} })).unwrap();
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
    data.flush().unwrap();
    fs::write(fixture.file(), &newer).unwrap();
    data.set("tasks-store", json!({ "tasks": [2] })).unwrap();
    let _ = data.flush();
    assert_eq!(data.status().status, Status::Conflict);
    assert_eq!(data.status().conflict.unwrap().theirs.schema_version, Some(99));
    assert_eq!(data.resolve_conflict(ConflictChoice::Mine), Err(DataError::Blocked { status: Status::ReadOnlyNewerSchema }));
    assert_eq!(fs::read(fixture.file()).unwrap(), newer);
}

#[test]
fn quitting_with_an_unresolved_conflict_keeps_mine_as_unsaved_and_never_the_main_file() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, FAST);
    data.flush_on_exit(false);
    data.flush_on_exit(true);

    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);
    let kept = backup_names_of(&fixture, BackupKind::Unsaved);
    assert_eq!(kept.len(), 1, "one copy, however often the exit path runs");
    assert_eq!(
        serde_json::from_slice::<Value>(&backup_bytes(&fixture, &kept[0])).unwrap()["stores"]["tasks-store"]["tasks"],
        json!(["mine", "more"])
    );
}

#[test]
fn a_reload_keeps_edits_the_blocked_state_could_not_save() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, FAST);
    let loaded = data.load();
    assert_eq!(loaded.state.status, Status::Ok);
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);
    assert_eq!(backup_names_of(&fixture, BackupKind::Unsaved).len(), 1, "L10: edits are not silently dropped");
}

#[test]
fn edits_made_during_a_conflict_are_announced() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    fs::write(fixture.file(), envelope_bytes("other-device", &["a"])).unwrap();
    data.check_now();
    let before = fixture.events.lock().unwrap().len();
    data.set("tasks-store", json!({ "tasks": ["edit"] })).unwrap();
    let events = fixture.events.lock().unwrap();
    assert!(events.len() > before);
    assert!(events.last().unwrap().conflict.as_ref().unwrap().local_changes);
}

// --- backups -------------------------------------------------------------------------------------

#[test]
fn the_previous_state_is_copied_once_per_local_day() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let data = initialised_at(&fixture, &moment, FAST);
    let first_state = fs::read(fixture.file()).unwrap();

    data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
    data.flush().unwrap();
    let daily = backup_names_of(&fixture, BackupKind::Daily);
    assert_eq!(daily.len(), 1);
    assert_eq!(backup_bytes(&fixture, &daily[0]), first_state, "the previous on-disk state, not the new one");

    data.set("tasks-store", json!({ "tasks": [1, 2] })).unwrap();
    data.flush().unwrap();
    assert_eq!(backup_names_of(&fixture, BackupKind::Daily).len(), 1, "the same day adds no second daily");

    set_clock(&moment, OCT_24_NOON + DAY);
    data.set("tasks-store", json!({ "tasks": [1, 2, 3] })).unwrap();
    data.flush().unwrap();
    assert_eq!(backup_names_of(&fixture, BackupKind::Daily).len(), 2, "the next day adds one");
}

#[test]
fn the_local_day_decides_not_the_utc_day() {
    let fixture = Fixture::new();
    // UTC+1: 22:30 UTC is 23:30 local, 23:30 UTC is 00:30 local on the next day, one hour later.
    let moment = clock(1_792_881_000, 3_600);
    let data = initialised_at(&fixture, &moment, FAST);
    data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
    data.flush().unwrap();
    assert_eq!(backup_names_of(&fixture, BackupKind::Daily).len(), 1);

    set_clock(&moment, 1_792_884_600);
    data.set("tasks-store", json!({ "tasks": [2] })).unwrap();
    data.flush().unwrap();
    assert_eq!(backup_names_of(&fixture, BackupKind::Daily).len(), 2, "across local midnight");
}

#[test]
fn a_restart_does_not_take_a_second_daily_backup_on_the_same_day() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let first = initialised_at(&fixture, &moment, FAST);
    first.set("tasks-store", json!({ "tasks": [1] })).unwrap();
    first.flush().unwrap();
    drop(first);

    let second = data_file_at(&fixture, &moment, FAST);
    second.load();
    second.set("tasks-store", json!({ "tasks": [2] })).unwrap();
    second.flush().unwrap();
    assert_eq!(backup_names_of(&fixture, BackupKind::Daily).len(), 1);
}

#[test]
fn a_daily_backup_is_never_taken_from_a_blocked_or_corrupt_file() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    drop(initialised_at(&fixture, &moment, FAST));
    fs::write(fixture.file(), b"{ truncated").unwrap();
    let data = data_file_at(&fixture, &moment, FAST);
    assert_eq!(data.load().state.status, Status::ReadOnlyCorrupt);
    data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
    let _ = data.flush();
    assert!(backup_names_of(&fixture, BackupKind::Daily).is_empty());
    assert_eq!(data.backup(BackupKind::Manual), Err(DataError::Blocked { status: Status::ReadOnlyCorrupt }));
}

#[test]
fn a_failing_daily_backup_never_blocks_saving() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let data = initialised_at(&fixture, &moment, FAST);
    block_backups(&fixture.folder);

    data.set("tasks-store", json!({ "tasks": [1] })).unwrap();
    data.flush().unwrap();
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!([1]), "the save landed");
    assert!(data.status().backup_error.is_some(), "the data page shows the orange line");
    assert_eq!(data.status().status, Status::Ok);
}

#[test]
fn a_manual_backup_copies_the_saved_state_after_flushing_edits() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let data = initialised_at(&fixture, &moment, Timing { debounce: Duration::from_secs(60), ..FAST });
    data.set("tasks-store", json!({ "tasks": ["fresh"] })).unwrap();
    let name = data.backup(BackupKind::Manual).unwrap();
    assert_eq!(backup_bytes(&fixture, &name), fs::read(fixture.file()).unwrap());
    assert!(String::from_utf8(backup_bytes(&fixture, &name)).unwrap().contains("fresh"));
    let listed = data.list_backups().unwrap();
    let manual = listed.iter().find(|entry| entry.kind == BackupKind::Manual).unwrap();
    assert_eq!(manual.name, name);
    assert_eq!(manual.task_count, Some(1));
    assert!(manual.own_device);
    assert!(manual.readable);
}

#[test]
fn a_backup_of_a_file_that_changed_underneath_is_a_conflict_not_a_backup() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    fs::write(fixture.file(), envelope_bytes("other-device", &["a"])).unwrap();
    assert_eq!(data.backup(BackupKind::PreUpdate), Err(DataError::Blocked { status: Status::Conflict }));
    assert!(backup_names_of(&fixture, BackupKind::PreUpdate).is_empty());
}

#[test]
fn a_mandatory_backup_failure_is_reported_to_the_caller() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    block_backups(&fixture.folder);
    assert!(matches!(data.backup(BackupKind::PreUpdate), Err(DataError::BackupFailed { .. })));
    assert!(data.status().backup_error.is_none(), "the caller shows the inline error, not the page line");
}

#[test]
fn retention_runs_after_a_backup_and_keeps_the_newest() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let data = initialised_at(&fixture, &moment, FAST);
    for n in 0..13 {
        set_clock(&moment, OCT_24_NOON + n);
        data.backup(BackupKind::Manual).unwrap();
    }
    let kept = backup_names_of(&fixture, BackupKind::Manual);
    assert_eq!(kept.len(), OTHER_KEEP);
    assert!(kept.contains(&backup_name(OCT_24_NOON + 12, BackupKind::Manual, &device6(&data.status().device_id))));
    assert!(!kept.contains(&backup_name(OCT_24_NOON, BackupKind::Manual, &device6(&data.status().device_id))));
}

#[test]
fn backups_taken_in_the_same_second_get_distinct_names() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let data = initialised_at(&fixture, &moment, FAST);
    let first = data.backup(BackupKind::Manual).unwrap();
    let second = data.backup(BackupKind::Manual).unwrap();
    assert_ne!(first, second);
    assert_eq!(backup_names_of(&fixture, BackupKind::Manual).len(), 2);
}

#[test]
fn the_backup_list_marks_unreadable_files_and_other_devices() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let dir = backup_dir(&fixture.folder);
    fs::create_dir(&dir).unwrap();
    fs::write(dir.join(backup_name(OCT_24_NOON, BackupKind::Daily, "abc123")), envelope_bytes("another-device", &["a", "b"])).unwrap();
    fs::write(dir.join(backup_name(OCT_24_NOON + 5, BackupKind::Manual, "abc123")), b"garbage").unwrap();
    fs::write(dir.join("notes.txt"), b"not a backup").unwrap();

    let listed = data.list_backups().unwrap();
    assert_eq!(listed.len(), 2, "foreign files are ignored");
    assert_eq!(listed[0].kind, BackupKind::Manual, "newest first");
    assert!(!listed[0].readable);
    assert_eq!(listed[1].task_count, Some(2));
    assert!(!listed[1].own_device);
}

// --- restore -------------------------------------------------------------------------------------

#[test]
fn restore_backs_up_the_current_state_and_replaces_the_file() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let data = initialised_at(&fixture, &moment, FAST);
    data.set("tasks-store", json!({ "tasks": ["old"] })).unwrap();
    let old = data.backup(BackupKind::Manual).unwrap();
    set_clock(&moment, OCT_24_NOON + 60);
    data.set("tasks-store", json!({ "tasks": ["old", "new"] })).unwrap();
    let generation = data.shared.lock().generation;

    let payload = data.restore(&old).unwrap();
    assert_eq!(payload.status, Status::Ok);
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["old"]));
    let before = backup_names_of(&fixture, BackupKind::PreRestore);
    assert_eq!(before.len(), 1);
    assert!(String::from_utf8(backup_bytes(&fixture, &before[0])).unwrap().contains("\"new\""), "pending edits are in it");
    assert!(data.shared.lock().generation > generation);

    // The restore can itself be reverted from the list.
    data.restore(&before[0]).unwrap();
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["old", "new"]));
}

#[test]
fn restore_refuses_newer_schemas_unreadable_files_and_foreign_paths() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let dir = backup_dir(&fixture.folder);
    fs::create_dir(&dir).unwrap();
    let newer = backup_name(OCT_24_NOON, BackupKind::Manual, "abc123");
    fs::write(dir.join(&newer), serde_json::to_vec(&json!({ "schemaVersion": 99, "stores": {} })).unwrap()).unwrap();
    let garbage = backup_name(OCT_24_NOON + 1, BackupKind::Manual, "abc123");
    fs::write(dir.join(&garbage), b"nope").unwrap();
    let before = fs::read(fixture.file()).unwrap();

    assert_eq!(data.restore(&newer), Err(DataError::NewerSchema));
    assert_eq!(data.restore(&garbage), Err(DataError::Unreadable));
    assert_eq!(data.restore("../kan-do-data.json"), Err(DataError::Invalid));
    assert_eq!(data.restore("notes.txt"), Err(DataError::Invalid));
    assert_eq!(data.restore(&backup_name(OCT_24_NOON + 2, BackupKind::Manual, "abc123")), Err(DataError::Invalid));
    assert_eq!(fs::read(fixture.file()).unwrap(), before);
    assert!(backup_names_of(&fixture, BackupKind::PreRestore).is_empty(), "nothing was replaced, nothing backed up");
}

#[test]
fn restore_stops_when_the_pre_restore_backup_fails() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    fs::write(fixture.folder.join("kan-do-data 2.json"), envelope_bytes("o", &["x"])).unwrap();
    block_backups(&fixture.folder);
    let before = fs::read(fixture.file()).unwrap();
    assert!(matches!(data.restore("kan-do-data 2.json"), Err(DataError::BackupFailed { .. })));
    assert_eq!(fs::read(fixture.file()).unwrap(), before);
}

#[test]
fn restore_is_refused_while_blocked() {
    let fixture = Fixture::new();
    let (data, theirs) = conflicted(&fixture, FAST);
    fs::write(fixture.folder.join("kan-do-data 2.json"), envelope_bytes("o", &["x"])).unwrap();
    assert_eq!(data.restore("kan-do-data 2.json"), Err(DataError::Blocked { status: Status::Conflict }));
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);
}

#[test]
fn an_import_replaces_the_data_after_a_pre_restore_backup() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let imported = envelope_bytes("exporting-device", &["i1", "i2"]);
    assert_eq!(data.import_apply("not json".into()), Err(DataError::Unreadable));
    data.import_apply(String::from_utf8(imported.clone()).unwrap()).unwrap();
    assert_eq!(fs::read(fixture.file()).unwrap(), imported);
    assert_eq!(backup_names_of(&fixture, BackupKind::PreRestore).len(), 1);
    let newer = serde_json::to_string(&json!({ "schemaVersion": 99, "stores": {} })).unwrap();
    assert_eq!(data.import_apply(newer), Err(DataError::NewerSchema));
}

#[test]
fn export_and_import_reading_validate_their_paths() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let target = fixture._root.path().join("kan-do-export-2026-10-27.json");
    let contents = String::from_utf8(envelope_bytes("d", &["a"])).unwrap();

    assert_eq!(data.export_to(Path::new("relative.json"), &contents), Err(DataError::Invalid));
    assert_eq!(data.export_to(&fixture._root.path().join("export.txt"), &contents), Err(DataError::Invalid));
    assert_eq!(data.export_to(&fixture.file(), &contents), Err(DataError::Invalid), "never the data file itself");
    assert_eq!(data.export_to(&target, "{}"), Err(DataError::Invalid), "only an envelope");
    data.export_to(&target, &contents).unwrap();
    assert_eq!(data.read_import(&target).unwrap(), contents);
    assert_eq!(data.read_import(Path::new("rel.json")), Err(DataError::Invalid));
}

// --- conflict copies -----------------------------------------------------------------------------

#[test]
fn cloud_conflict_copies_are_listed_and_filed_away_without_deleting_anything() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let dropbox = "kan-do-data (Julius's MacBook's conflicted copy 2026-10-24).json";
    let icloud = "kan-do-data 2.json";
    let syncthing = "kan-do-data.sync-conflict-20261024-091200-ABCDEFG.json";
    for name in [dropbox, icloud, syncthing] {
        fs::write(fixture.folder.join(name), envelope_bytes("other-device", &["a", "b"])).unwrap();
    }
    fs::write(fixture.folder.join("kan-do-data (broken).json"), b"not an envelope").unwrap();
    fs::write(fixture.folder.join("other.json"), envelope_bytes("o", &[])).unwrap();
    fs::create_dir_all(backup_dir(&fixture.folder)).unwrap();
    fs::write(backup_dir(&fixture.folder).join("kan-do-data 3.json"), envelope_bytes("o", &[])).unwrap();

    let payload = data.check_now();
    let mut names: Vec<_> = payload.conflict_copies.iter().map(|copy| copy.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, vec![dropbox, icloud, syncthing]);
    assert_eq!(payload.conflict_copies[0].summary.task_count, Some(2));
    assert_eq!(payload.status, Status::Ok, "non-blocking");

    let before = fs::read(fixture.folder.join(icloud)).unwrap();
    let payload = data.file_to_backups(icloud).unwrap();
    assert_eq!(payload.conflict_copies.len(), 2);
    assert!(!fixture.folder.join(icloud).exists());
    let filed = backup_names_of(&fixture, BackupKind::Conflict);
    assert_eq!(filed.len(), 1);
    assert_eq!(backup_bytes(&fixture, &filed[0]), before, "the copy moved byte for byte");
    assert_eq!(data.file_to_backups("kan-do-data.json"), Err(DataError::Invalid), "the data file is not a copy");
    assert!(fixture.file().exists());
}

#[test]
fn a_conflict_copy_can_be_restored_and_stays_in_place() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let copy = envelope_bytes("other-device", &["from-copy"]);
    fs::write(fixture.folder.join("kan-do-data 2.json"), &copy).unwrap();
    data.restore("kan-do-data 2.json").unwrap();
    assert_eq!(fs::read(fixture.file()).unwrap(), copy);
    assert!(fixture.folder.join("kan-do-data 2.json").exists(), "nothing is ever deleted");
    assert_eq!(backup_names_of(&fixture, BackupKind::PreRestore).len(), 1);
}

// --- folder unavailable --------------------------------------------------------------------------

fn take_folder_away(fixture: &Fixture) -> PathBuf {
    let parked = fixture._root.path().join("parked");
    fs::rename(&fixture.folder, &parked).unwrap();
    parked
}

fn bring_folder_back(fixture: &Fixture, parked: &Path) {
    fs::rename(parked, &fixture.folder).unwrap();
}

#[test]
fn a_gone_folder_is_unavailable_and_nothing_is_written_or_recreated() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let parked = take_folder_away(&fixture);

    data.set("tasks-store", json!({ "tasks": ["in memory"] })).unwrap();
    assert!(wait_for(|| data.status().status == Status::FolderUnavailable));
    assert!(data.status().error.is_some());
    thread::sleep(FAST.max_wait * 2);
    assert!(!fixture.folder.exists(), "no folder, no file, no temp file");
    assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::FolderUnavailable }));
    assert!(!fixture.folder.exists());
    assert_eq!(data.backup(BackupKind::Manual), Err(DataError::Blocked { status: Status::FolderUnavailable }));
    assert!(!fixture.folder.exists(), "not even a backups directory");
    drop(parked);
}

#[test]
fn the_watcher_notices_a_gone_folder_without_an_edit() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let _parked = take_folder_away(&fixture);
    assert_eq!(data.check_now().status, Status::FolderUnavailable);
    assert!(!fixture.folder.exists());
}

#[test]
fn recovery_with_an_unchanged_file_flushes_the_pending_edits() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let parked = take_folder_away(&fixture);
    data.set("tasks-store", json!({ "tasks": ["held"] })).unwrap();
    assert!(wait_for(|| data.status().status == Status::FolderUnavailable));

    bring_folder_back(&fixture, &parked);
    assert_eq!(data.check_now().status, Status::Ok);
    assert!(wait_for(|| fs::read_to_string(fixture.file()).is_ok_and(|text| text.contains("held"))), "flushed after recovery");
}

#[test]
fn recovery_with_a_changed_file_is_a_conflict_not_an_overwrite() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let parked = take_folder_away(&fixture);
    data.set("tasks-store", json!({ "tasks": ["held"] })).unwrap();
    assert!(wait_for(|| data.status().status == Status::FolderUnavailable));

    bring_folder_back(&fixture, &parked);
    let theirs = envelope_bytes("other-device", &["a", "b"]);
    fs::write(fixture.file(), &theirs).unwrap();
    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    assert!(payload.conflict.unwrap().local_changes);
    thread::sleep(FAST.max_wait * 2);
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);

    data.resolve_conflict(ConflictChoice::Mine).unwrap();
    assert_eq!(backup_names_of(&fixture, BackupKind::Conflict).len(), 1);
}

#[test]
fn the_retry_delay_doubles_up_to_its_ceiling_and_resets_on_demand() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let _parked = take_folder_away(&fixture);
    assert_eq!(data.check_now().status, Status::FolderUnavailable);
    assert_eq!(data.shared.lock().backoff, FAST.backoff.0);
    for expected in [FAST.backoff.0 * 2, FAST.backoff.1, FAST.backoff.1] {
        data.shared.watch_tick();
        assert_eq!(data.shared.lock().backoff, expected);
    }
    data.check_now();
    assert_eq!(data.shared.lock().backoff, FAST.backoff.0 * 2, "a manual retry starts the backoff over");
}

#[test]
fn launching_with_the_folder_gone_hydrates_nothing_and_writes_nothing() {
    let fixture = Fixture::new();
    drop(initialised(&fixture, FAST));
    let parked = take_folder_away(&fixture);

    let data = fixture.data_file(FAST);
    let loaded = data.load();
    assert_eq!(loaded.state.status, Status::FolderUnavailable);
    assert!(loaded.envelope.is_none());
    assert!(!loaded.needs_init);
    assert_eq!(data.flush(), Ok(()), "nothing is pending");
    thread::sleep(FAST.max_wait * 2);
    assert!(!fixture.folder.exists());

    // The folder comes back with its file: no store wrote anything, so the window may reload by itself.
    bring_folder_back(&fixture, &parked);
    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    let conflict = payload.conflict.unwrap();
    assert!(!conflict.local_changes);
    assert!(conflict.auto_reload);
    let loaded = data.load();
    assert_eq!(loaded.state.status, Status::Ok, "the reload reads the real file");
    assert!(loaded.envelope.is_some());
    assert!(backup_names_of(&fixture, BackupKind::Unsaved).is_empty(), "nothing was edited, nothing to keep");
}

#[test]
fn edits_made_while_the_launch_folder_was_gone_go_through_the_conflict_choice() {
    let fixture = Fixture::new();
    drop(initialised(&fixture, FAST));
    let parked = take_folder_away(&fixture);
    let data = fixture.data_file(FAST);
    let loaded = data.load();
    data.set_versioned("tasks-store", json!({ "tasks": [] }), loaded.generation, 1).unwrap();
    data.set_versioned("tasks-store", json!({ "tasks": ["typed meanwhile"] }), loaded.generation, 2).unwrap();

    bring_folder_back(&fixture, &parked);
    let real = fs::read(fixture.file()).unwrap();
    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    let conflict = payload.conflict.unwrap();
    assert!(conflict.local_changes);
    assert!(!conflict.auto_reload, "never an automatic reload over edits");
    assert_eq!(fs::read(fixture.file()).unwrap(), real);

    data.resolve_conflict(ConflictChoice::Theirs).unwrap();
    let kept = backup_names_of(&fixture, BackupKind::Unsaved);
    assert_eq!(kept.len(), 1);
    assert!(String::from_utf8(backup_bytes(&fixture, &kept[0])).unwrap().contains("typed meanwhile"));
    assert_eq!(fs::read(fixture.file()).unwrap(), real);
}

#[test]
fn quitting_while_the_folder_stays_gone_creates_nothing() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let _parked = take_folder_away(&fixture);
    data.set("tasks-store", json!({ "tasks": ["lost"] })).unwrap();
    assert!(wait_for(|| data.status().status == Status::FolderUnavailable));
    data.flush_on_exit(true);
    assert!(!fixture.folder.exists());
}

#[test]
fn quitting_after_the_folder_came_back_still_saves_the_edits() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let parked = take_folder_away(&fixture);
    data.set("tasks-store", json!({ "tasks": ["kept"] })).unwrap();
    assert!(wait_for(|| data.status().status == Status::FolderUnavailable));
    bring_folder_back(&fixture, &parked);
    data.flush_on_exit(true);
    assert!(fs::read_to_string(fixture.file()).unwrap().contains("kept"));
}

#[test]
fn a_slow_folder_counts_as_unavailable_and_the_late_write_is_dropped() {
    let fixture = Fixture::new();
    let target = fixture.folder.join("late.json");
    let started = Instant::now();
    let result = run_timed(Duration::from_millis(60), {
        let target = target.clone();
        move |abandoned| {
            thread::sleep(Duration::from_millis(250));
            write_atomic_with(&target, b"late", || {
                if abandoned.load(Ordering::SeqCst) {
                    Err(io::Error::other("abandoned"))
                } else {
                    Ok(())
                }
            })
        }
    });
    assert!(matches!(result, Err(IoFailure::TimedOut)));
    assert!(started.elapsed() < Duration::from_millis(200), "the caller did not wait for the slow call");
    thread::sleep(Duration::from_millis(400));
    assert!(!target.exists(), "a write that finishes after the deadline never lands");
    assert_eq!(fs::read_dir(&fixture.folder).unwrap().count(), 0, "and leaves no temp file");
}

#[test]
fn an_unreadable_data_file_is_the_folder_and_not_a_corrupt_file() {
    let fixture = Fixture::new();
    drop(initialised(&fixture, FAST));
    if !folder_is_read_only_effective(&fixture.folder) {
        return;
    }
    fs::set_permissions(fixture.file(), fs::Permissions::from_mode(0o000)).unwrap();
    if fs::read(fixture.file()).is_ok() {
        fs::set_permissions(fixture.file(), fs::Permissions::from_mode(0o644)).unwrap();
        return;
    }
    let data = fixture.data_file(FAST);
    assert_eq!(data.load().state.status, Status::FolderUnavailable);
    fs::set_permissions(fixture.file(), fs::Permissions::from_mode(0o644)).unwrap();
}

// --- carry-over from the #222 review ---------------------------------------------------------------

#[test]
fn a_first_run_whose_pointer_cannot_be_saved_recovers_instead_of_sticking_in_read_only() {
    let fixture = Fixture::new();
    // The config dir cannot be written: the data file lands, the pointer does not (N5).
    fs::create_dir_all(&fixture.config).unwrap();
    if !folder_is_read_only_effective(&fixture.config) {
        return;
    }
    fs::set_permissions(&fixture.config, fs::Permissions::from_mode(0o555)).unwrap();
    let data = fixture.data_file(FAST);
    assert!(data.load().needs_init);
    let result = data.init(stores(&[("tasks-store", json!({ "tasks": ["first"] }))]));
    assert!(result.is_ok());
    assert_eq!(data.status().status, Status::WriteFailed);
    assert!(fixture.file().exists());

    fs::set_permissions(&fixture.config, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(wait_for(|| data.status().status == Status::Ok), "the retry writes the pointer, not read-only-corrupt");
    assert!(fixture.config.join(LOCATION_FILE).exists());
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["first"]));
}

#[test]
fn moving_out_of_a_broken_folder_does_not_need_it_to_be_writable_first() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    if !folder_is_read_only_effective(&fixture.folder) {
        return;
    }
    fs::set_permissions(&fixture.folder, fs::Permissions::from_mode(0o555)).unwrap();
    data.set("tasks-store", json!({ "tasks": ["precious"] })).unwrap();
    assert!(wait_for(|| data.status().status == Status::WriteFailed));
    let target = fixture.other_folder("rescue");

    let result = data.set_location(&target, LocationMode::Move);
    fs::set_permissions(&fixture.folder, fs::Permissions::from_mode(0o755)).unwrap();
    result.unwrap();
    assert_eq!(read_json(&target.join(FILE_NAME))["stores"]["tasks-store"]["tasks"], json!(["precious"]));
    assert_eq!(data.status().status, Status::Ok);
}

#[test]
fn replace_backs_up_the_data_it_overwrites_and_waits_for_that() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let target = fixture.other_folder("cloud");
    let theirs = envelope_bytes("other-device", &["theirs"]);
    fs::write(target.join(FILE_NAME), &theirs).unwrap();

    // A backup that cannot be written stops the replace.
    block_backups(&target);
    assert!(matches!(data.set_location(&target, LocationMode::Replace), Err(DataError::BackupFailed { .. })));
    assert_eq!(fs::read(target.join(FILE_NAME)).unwrap(), theirs);
    fs::remove_file(backup_dir(&target)).unwrap();

    data.set_location(&target, LocationMode::Replace).unwrap();
    let filed: Vec<_> = backup_names(&backup_dir(&target)).unwrap();
    assert_eq!(filed.len(), 1);
    assert_eq!(parse_backup_name(&filed[0]).unwrap().kind, BackupKind::PreReplace);
    assert_eq!(fs::read(backup_dir(&target).join(&filed[0])).unwrap(), theirs);
    assert_ne!(fs::read(target.join(FILE_NAME)).unwrap(), theirs);
}

#[test]
fn start_here_never_rebuilds_a_gone_folder_tree() {
    let fixture = Fixture::new();
    drop(initialised(&fixture, FAST));
    fs::remove_file(fixture.file()).unwrap();
    let data = fixture.data_file(FAST);
    assert_eq!(data.load().state.status, Status::MissingFile);
    let parked = take_folder_away(&fixture);

    assert!(matches!(data.init(Map::new()), Err(DataError::Unavailable { .. })));
    assert!(!fixture.folder.exists(), "L7: the vanished folder is not created again");
    assert_eq!(data.status().status, Status::FolderUnavailable);
    drop(parked);
}

#[test]
fn rendering_borrows_the_stores_and_keeps_the_key_order() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    data.set("zeta", json!({ "b": 1, "a": 2 })).unwrap();
    data.set("alpha", json!(1)).unwrap();
    data.flush().unwrap();
    let text = fs::read_to_string(fixture.file()).unwrap();
    let positions: Vec<usize> = ["\"schemaVersion\"", "\"writtenAt\"", "\"writtenBy\"", "\"appVersion\"", "\"stores\"", "\"zeta\"", "\"alpha\""]
        .iter()
        .map(|key| text.find(key).unwrap())
        .collect();
    assert!(positions.windows(2).all(|pair| pair[0] < pair[1]), "header first, stores in insertion order");
    assert!(text.ends_with("}\n"));
}

// --- fix round 1 (PR #252 review) ---------------------------------------------------------------

/// A healthy device with one manual backup of `["old"]`, then the data file deleted and noticed as gone.
fn gone_with_a_backup(fixture: &Fixture) -> (DataFile, String) {
    let data = initialised(fixture, FAST);
    data.set("tasks-store", json!({ "tasks": ["old"] })).unwrap();
    data.flush().unwrap();
    let name = data.backup(BackupKind::Manual).unwrap();
    fs::remove_file(fixture.file()).unwrap();
    assert_eq!(data.check_now().status, Status::MissingFile);
    (data, name)
}

#[test]
fn m1_restore_out_of_missing_file_never_replaces_a_file_that_reappeared() {
    let fixture = Fixture::new();
    let (data, name) = gone_with_a_backup(&fixture);
    let theirs = envelope_bytes("other-device", &["a", "b"]);
    fs::write(fixture.file(), &theirs).unwrap();

    assert_eq!(data.restore(&name), Err(DataError::Blocked { status: Status::Conflict }));
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs, "the reappeared file was never read by the app, so it is untouched");
    assert_eq!(data.status().status, Status::Conflict, "the user decides between the two");
    assert_eq!(data.import_apply(String::from_utf8(envelope_bytes("x", &["i"])).unwrap()), Err(DataError::Blocked { status: Status::Conflict }));
    assert_eq!(fs::read(fixture.file()).unwrap(), theirs);
}

#[test]
fn m1_a_reappeared_file_that_does_not_parse_is_not_replaced_either() {
    let fixture = Fixture::new();
    let (data, name) = gone_with_a_backup(&fixture);
    fs::write(fixture.file(), b"{ half a sync").unwrap();

    assert_eq!(data.restore(&name), Err(DataError::Blocked { status: Status::ReadOnlyCorrupt }));
    assert_eq!(fs::read(fixture.file()).unwrap(), b"{ half a sync");
}

#[test]
fn m1_a_file_that_came_back_unchanged_is_kept_as_pre_restore_before_it_is_replaced() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    data.set("tasks-store", json!({ "tasks": ["old"] })).unwrap();
    data.flush().unwrap();
    let name = data.backup(BackupKind::Manual).unwrap();
    let known = fs::read(fixture.file()).unwrap();
    fs::remove_file(fixture.file()).unwrap();
    assert_eq!(data.check_now().status, Status::MissingFile);
    fs::write(fixture.file(), &known).unwrap();

    data.restore(&name).unwrap();
    let kept = backup_names_of(&fixture, BackupKind::PreRestore);
    assert_eq!(kept.len(), 1, "the file that was there is copied before it is replaced");
    assert_eq!(backup_bytes(&fixture, &kept[0]), known);
}

#[test]
fn m1_restore_out_of_a_still_missing_file_works() {
    let fixture = Fixture::new();
    let (data, name) = gone_with_a_backup(&fixture);
    let payload = data.restore(&name).unwrap();
    assert_eq!(payload.status, Status::Ok);
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["old"]));
}

/// A conflict whose other side was caught half-written.
fn conflict_with_a_half_written_file(fixture: &Fixture, timing: Timing) -> (DataFile, Vec<u8>) {
    let data = initialised(fixture, timing);
    data.set("tasks-store", json!({ "tasks": ["mine"] })).unwrap();
    data.flush().unwrap();
    let known = fs::read(fixture.file()).unwrap();
    fs::write(fixture.file(), b"{ half a sync").unwrap();
    data.set("tasks-store", json!({ "tasks": ["mine", "more"] })).unwrap();
    assert_eq!(data.flush(), Err(DataError::Blocked { status: Status::Conflict }));
    assert!(!data.status().conflict.unwrap().theirs.readable);
    (data, known)
}

#[test]
fn m2_a_conflict_seen_mid_download_is_refreshed_when_the_file_is_complete() {
    let fixture = Fixture::new();
    let (data, _) = conflict_with_a_half_written_file(&fixture, FAST);
    fs::write(fixture.file(), envelope_bytes("other-device", &["a", "b", "c"])).unwrap();

    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    let theirs = payload.conflict.unwrap().theirs;
    assert!(theirs.readable, "the modal can offer their version now");
    assert_eq!(theirs.task_count, Some(3));
    assert_eq!(theirs.written_by.as_deref(), Some("other-device"));
}

#[test]
fn m2_a_conflict_that_dissolves_clears_itself() {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    data.set("tasks-store", json!({ "tasks": ["mine"] })).unwrap();
    data.flush().unwrap();
    let known = fs::read(fixture.file()).unwrap();
    fs::write(fixture.file(), envelope_bytes("other-device", &["a"])).unwrap();
    assert_eq!(data.check_now().status, Status::Conflict);

    fs::write(fixture.file(), &known).unwrap();
    let payload = data.check_now();
    assert_eq!(payload.status, Status::Ok, "the file is the one this app knows again");
    assert!(payload.conflict.is_none());
}

#[test]
fn m2_a_conflict_does_not_reread_a_file_that_did_not_change() {
    let fixture = Fixture::new();
    let (data, _) = conflicted(&fixture, FAST);
    let before = fixture.events.lock().unwrap().len();
    data.check_now();
    data.check_now();
    assert_eq!(fixture.events.lock().unwrap().len(), before, "nothing new to announce");
}

#[test]
fn m2_keep_mine_checks_the_schema_of_the_file_as_it_is_now() {
    let fixture = Fixture::new();
    let (data, _) = conflict_with_a_half_written_file(&fixture, FAST);
    let newer = serde_json::to_vec(&json!({ "schemaVersion": 99, "writtenAt": "t", "writtenBy": "o", "appVersion": "9", "stores": {} })).unwrap();
    fs::write(fixture.file(), &newer).unwrap();

    assert_eq!(data.resolve_conflict(ConflictChoice::Mine), Err(DataError::Blocked { status: Status::ReadOnlyNewerSchema }));
    assert_eq!(fs::read(fixture.file()).unwrap(), newer, "an older build never writes over a newer schema");
    assert!(backup_names_of(&fixture, BackupKind::Conflict).is_empty());
}

#[test]
fn m2_keep_mine_refuses_a_file_that_is_not_the_one_the_modal_showed() {
    let fixture = Fixture::new();
    let (data, _) = conflicted(&fixture, FAST);
    let changed = envelope_bytes("third-device", &["x", "y", "z", "w"]);
    fs::write(fixture.file(), &changed).unwrap();

    assert_eq!(data.resolve_conflict(ConflictChoice::Mine), Err(DataError::Changed));
    assert_eq!(fs::read(fixture.file()).unwrap(), changed);
    let shown = data.status().conflict.unwrap().theirs;
    assert_eq!(shown.task_count, Some(4), "the modal now shows the current version");
    assert_eq!(shown.written_by.as_deref(), Some("third-device"));

    // A second click acts on what is displayed now, and files exactly that version.
    data.resolve_conflict(ConflictChoice::Mine).unwrap();
    let filed = backup_names_of(&fixture, BackupKind::Conflict);
    assert_eq!(filed.len(), 1);
    assert_eq!(backup_bytes(&fixture, &filed[0]), changed);
}

#[test]
fn m3_the_first_edit_of_a_key_after_an_unavailable_launch_is_an_edit() {
    let fixture = Fixture::new();
    drop(initialised(&fixture, FAST));
    let parked = take_folder_away(&fixture);
    let data = fixture.data_file(FAST);
    let loaded = data.load();
    assert_eq!(loaded.state.status, Status::FolderUnavailable);
    // A store with no stored value does not write defaults: the user's first change is the first call.
    data.set_versioned("tasks-store", json!({ "tasks": ["typed first"] }), loaded.generation, 1).unwrap();

    bring_folder_back(&fixture, &parked);
    let real = fs::read(fixture.file()).unwrap();
    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    let conflict = payload.conflict.unwrap();
    assert!(conflict.local_changes);
    assert!(!conflict.auto_reload, "an automatic reload would drop the edit");
    assert_eq!(fs::read(fixture.file()).unwrap(), real);

    data.resolve_conflict(ConflictChoice::Theirs).unwrap();
    let kept = backup_names_of(&fixture, BackupKind::Unsaved);
    assert_eq!(kept.len(), 1);
    assert!(String::from_utf8(backup_bytes(&fixture, &kept[0])).unwrap().contains("typed first"));
}

fn corrupt_on_launch(fixture: &Fixture) -> (DataFile, String, Vec<u8>) {
    let data = initialised(fixture, FAST);
    data.set("tasks-store", json!({ "tasks": ["good"] })).unwrap();
    data.flush().unwrap();
    let name = data.backup(BackupKind::Manual).unwrap();
    let garbage = b"{ not a data file".to_vec();
    fs::write(fixture.file(), &garbage).unwrap();
    assert_eq!(data.load().state.status, Status::ReadOnlyCorrupt);
    (data, name, garbage)
}

#[test]
fn m4_restore_works_out_of_a_corrupt_file_and_keeps_that_file_verbatim() {
    let fixture = Fixture::new();
    let (data, name, garbage) = corrupt_on_launch(&fixture);
    let generation = data.shared.lock().generation;

    let payload = data.restore(&name).unwrap();
    assert_eq!(payload.status, Status::Ok);
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["good"]));
    let kept = backup_names_of(&fixture, BackupKind::PreRestore);
    assert_eq!(kept.len(), 1);
    assert_eq!(backup_bytes(&fixture, &kept[0]), garbage, "the unreadable file is kept as it was");
    assert!(data.shared.lock().generation > generation);
    data.set("tasks-store", json!({ "tasks": ["after"] })).unwrap();
    data.flush().unwrap();
    assert_eq!(read_json(&fixture.file())["stores"]["tasks-store"]["tasks"], json!(["after"]), "saving works again");
}

#[test]
fn m4_restore_out_of_a_corrupt_file_stops_when_the_copy_cannot_be_kept() {
    let fixture = Fixture::new();
    let (data, name, garbage) = corrupt_on_launch(&fixture);
    // The backup being restored lives in `backups/`; make new backups fail by filling the one slot with a file.
    let source = fixture.folder.join("kan-do-data 2.json");
    fs::write(&source, envelope_bytes("o", &["x"])).unwrap();
    block_backups(&fixture.folder);
    let _ = name;

    assert!(matches!(data.restore("kan-do-data 2.json"), Err(DataError::BackupFailed { .. })));
    assert_eq!(fs::read(fixture.file()).unwrap(), garbage);
}

#[test]
fn m4_restore_stays_blocked_for_a_newer_schema_a_conflict_and_an_unreadable_pointer() {
    // Newer schema: update the app instead.
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let name = data.backup(BackupKind::Manual).unwrap();
    let newer = serde_json::to_vec(&json!({ "schemaVersion": 99, "writtenAt": "t", "writtenBy": "o", "appVersion": "9", "stores": {} })).unwrap();
    fs::write(fixture.file(), &newer).unwrap();
    assert_eq!(data.load().state.status, Status::ReadOnlyNewerSchema);
    assert_eq!(data.restore(&name), Err(DataError::Blocked { status: Status::ReadOnlyNewerSchema }));
    assert_eq!(fs::read(fixture.file()).unwrap(), newer);

    // Unreadable pointer: the file next to it may not even be the user's chosen folder.
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let name = data.backup(BackupKind::Manual).unwrap();
    fs::write(fixture.config.join(LOCATION_FILE), b"garbage").unwrap();
    assert_eq!(data.load().state.status, Status::ReadOnlyCorrupt);
    let before = fs::read(fixture.file()).unwrap();
    assert_eq!(data.restore(&name), Err(DataError::Blocked { status: Status::ReadOnlyCorrupt }));
    assert_eq!(fs::read(fixture.file()).unwrap(), before);
}

#[test]
fn m5_filing_away_many_conflict_copies_never_deletes_one() {
    let fixture = Fixture::new();
    let moment = clock(OCT_24_NOON, 0);
    let data = initialised_at(&fixture, &moment, FAST);
    for n in 0..(OTHER_KEEP + 3) {
        set_clock(&moment, OCT_24_NOON + n as u64);
        let name = format!("kan-do-data {}.json", n + 2);
        fs::write(fixture.folder.join(&name), envelope_bytes("other-device", &[&format!("device-{n}")])).unwrap();
        data.file_to_backups(&name).unwrap();
    }
    let kept = backup_names_of(&fixture, BackupKind::Conflict);
    assert_eq!(kept.len(), OTHER_KEEP + 3, "each filed copy is the only copy left");
    let all: String = kept.iter().map(|name| String::from_utf8(backup_bytes(&fixture, name)).unwrap()).collect();
    assert!(all.contains("device-0"), "the oldest copy survives later backups");
}

#[test]
fn l1_quitting_keeps_edits_that_a_missing_file_could_not_save() {
    let fixture = Fixture::new();
    let (data, _) = gone_with_a_backup(&fixture);
    data.set("tasks-store", json!({ "tasks": ["typed while gone"] })).unwrap();
    data.flush_on_exit(true);
    assert!(!fixture.file().exists(), "a vanished file is never recreated");
    let kept = backup_names_of(&fixture, BackupKind::Unsaved);
    assert_eq!(kept.len(), 1);
    assert!(String::from_utf8(backup_bytes(&fixture, &kept[0])).unwrap().contains("typed while gone"));
}

// --- #255 low findings --------------------------------------------------------------------------

#[test]
fn n1_a_launch_from_an_unavailable_folder_without_data_set_is_not_edited() {
    let fixture = Fixture::new();
    drop(initialised(&fixture, FAST));
    let parked = take_folder_away(&fixture);
    let data = fixture.data_file(FAST);
    let loaded = data.load();
    assert_eq!(loaded.state.status, Status::FolderUnavailable);
    {
        // The webview applied its Keychain tokens without persisting: Rust saw no `data_set`.
        let inner = data.shared.lock();
        assert!(!inner.dirty);
        assert!(!inner.local_changes());
    }

    bring_folder_back(&fixture, &parked);
    let payload = data.check_now();
    assert_eq!(payload.status, Status::Conflict);
    let conflict = payload.conflict.unwrap();
    assert!(!conflict.local_changes, "nothing of mine, so no 'Mine' option");
    assert!(conflict.auto_reload);
    assert_eq!(data.resolve_conflict(ConflictChoice::Mine), Err(DataError::Invalid));
    assert_eq!(data.shared.lock().status, Status::Conflict);
}

fn vanished_copy_fixture() -> (Fixture, DataFile, &'static str) {
    let fixture = Fixture::new();
    let data = initialised(&fixture, FAST);
    let name = "kan-do-data 2.json";
    fs::write(fixture.folder.join(name), envelope_bytes("other-device", &["a"])).unwrap();
    assert_eq!(data.check_now().conflict_copies.len(), 1);
    fs::remove_file(fixture.folder.join(name)).unwrap();
    (fixture, data, name)
}

#[test]
fn n2_restoring_a_vanished_conflict_copy_forgets_it_at_once() {
    let (_fixture, data, name) = vanished_copy_fixture();
    assert_eq!(data.restore(name), Err(DataError::Invalid), "the error stays as it was");
    assert!(data.status().conflict_copies.is_empty(), "no watcher tick needed");
}

#[test]
fn n2_filing_away_a_vanished_conflict_copy_forgets_it_at_once() {
    let (fixture, data, name) = vanished_copy_fixture();
    assert!(matches!(data.file_to_backups(name), Err(DataError::BackupFailed { .. })));
    assert!(data.status().conflict_copies.is_empty(), "no watcher tick needed");
    assert!(backup_names_of(&fixture, BackupKind::Conflict).is_empty());
}

#[test]
fn n3_a_restore_whose_target_changes_after_the_pre_restore_backup_does_not_commit() {
    let fixture = Fixture::new();
    let armed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let moment = clock(OCT_24_NOON, 0);
    let foreign = envelope_bytes("other-device", &["changed underneath"]);
    let events = Arc::clone(&fixture.events);
    let file = fixture.file();
    let hook = (Arc::clone(&armed), foreign.clone(), Arc::clone(&moment));
    let data = DataFile::with_clock(
        fixture.config.clone(),
        fixture.folder.clone(),
        "9.9.9".into(),
        FAST,
        // The backup reads the clock right after it copied the file: the one place to act in between.
        Box::new(move || {
            if hook.0.swap(false, std::sync::atomic::Ordering::SeqCst) {
                fs::write(&file, &hook.1).unwrap();
            }
            *hook.2.lock().unwrap()
        }),
        Box::new(move |payload| events.lock().unwrap().push(payload.clone())),
    );
    assert!(data.load().needs_init);
    data.init(stores(&[("tasks-store", json!({ "tasks": ["mine"] }))])).unwrap();
    let name = data.backup(BackupKind::Manual).unwrap();
    let current = fs::read(fixture.file()).unwrap();

    armed.store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(data.restore(&name), Err(DataError::Changed));

    assert_eq!(fs::read(fixture.file()).unwrap(), foreign, "the file the sync client wrote is untouched");
    let kept = backup_names_of(&fixture, BackupKind::PreRestore);
    assert_eq!(kept.len(), 1, "the pre-restore backup is kept");
    assert_eq!(backup_bytes(&fixture, &kept[0]), current, "it holds the bytes that were there when it was taken");
}
