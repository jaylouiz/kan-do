use super::*;
use crate::secrets::SecretError;
use crate::data_file::{DataFile, Timing};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

const OLD_FILE: &[u8] = b"{\"schemaVersion\":2,\"writtenAt\":\"t\",\"writtenBy\":\"dev-1\",\"appVersion\":\"0.11.0\",\"stores\":{\"tasks-store\":{\"tasks\":[]}}}\n";

struct Support {
    _root: TempDir,
    old: PathBuf,
    new: PathBuf,
}

impl Support {
    fn new() -> Support {
        let root = TempDir::new().unwrap();
        let old = root.path().join("Application Support").join(LEGACY_IDENTIFIER);
        let new = root.path().join("Application Support").join(PRODUCTION_IDENTIFIER);
        fs::create_dir_all(root.path().join("Application Support")).unwrap();
        Support { _root: root, old, new }
    }

    fn put(&self, relative: &str, bytes: &[u8]) {
        let path = self.old.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn default_pointer(&self) -> Vec<u8> {
        format!("{{\n  \"folder\": {:?},\n  \"deviceId\": \"dev-1\"\n}}", self.old.to_string_lossy()).into_bytes()
    }

    fn seed_default_install(&self) {
        self.put("kan-do-data.json", OLD_FILE);
        self.put("data-location.json", &self.default_pointer());
        self.put("backups/kan-do-data.daily.2026-11-01.json", b"{\"schemaVersion\":2,\"stores\":{}}");
        self.put("backups/kan-do-data.pre-update.2026-11-02.json", b"backup two");
    }

    fn migrate(&self) -> DataOutcome {
        migrate_data(&self.old, &self.new, &self.old, &self.new)
    }
}

/// Every file below `dir` with its SHA-256, for "byte identical before and after".
fn snapshot(dir: &Path) -> BTreeMap<PathBuf, String> {
    let mut out = BTreeMap::new();
    if dir.exists() {
        for relative in files_below(dir).unwrap() {
            out.insert(relative.clone(), sha256_hex(&fs::read(dir.join(&relative)).unwrap()));
        }
    }
    out
}

fn pointer_of(dir: &Path) -> Value {
    serde_json::from_slice(&fs::read(dir.join(LOCATION_FILE)).unwrap()).unwrap()
}

// --- data step ----------------------------------------------------------------------------------

#[test]
fn no_legacy_data_is_not_a_migration_and_leaves_no_file() {
    let t = Support::new();
    assert_eq!(t.migrate(), DataOutcome::NotNeeded);
    assert!(!t.new.exists());
}

#[test]
fn default_folder_install_is_copied_with_the_pointer_rewritten_and_the_device_id_kept() {
    let t = Support::new();
    t.seed_default_install();
    let before = snapshot(&t.old);

    assert_eq!(t.migrate(), DataOutcome::Migrated);

    assert_eq!(fs::read(t.new.join(FILE_NAME)).unwrap(), OLD_FILE);
    assert_eq!(fs::read(t.new.join("backups/kan-do-data.pre-update.2026-11-02.json")).unwrap(), b"backup two");
    assert_eq!(fs::read(t.new.join("backups/kan-do-data.daily.2026-11-01.json")).unwrap().len(), 31);
    let pointer = pointer_of(&t.new);
    assert_eq!(pointer["deviceId"], "dev-1");
    assert_eq!(pointer["folder"], t.new.to_string_lossy().as_ref());
    // The legacy folder is untouched.
    assert_eq!(snapshot(&t.old), before);
}

#[test]
fn a_pointer_to_a_custom_folder_is_copied_verbatim_and_nothing_else() {
    let t = Support::new();
    let custom = t.old.parent().unwrap().join("iCloud/kan-do");
    let pointer = format!("{{\"folder\":{:?},\"deviceId\":\"dev-9\"}}", custom.to_string_lossy()).into_bytes();
    t.put("data-location.json", &pointer);
    // A stale file from before the folder was moved stays behind: it must not become the new default data.
    t.put("kan-do-data.json", OLD_FILE);
    let before = snapshot(&t.old);

    assert_eq!(t.migrate(), DataOutcome::Migrated);

    assert_eq!(fs::read(t.new.join(LOCATION_FILE)).unwrap(), pointer);
    assert!(!t.new.join(FILE_NAME).exists());
    assert!(!custom.exists(), "the custom folder is never touched");
    assert_eq!(snapshot(&t.old), before);
}

#[test]
fn a_data_file_without_a_pointer_is_copied_and_adopted_by_the_next_load() {
    let t = Support::new();
    t.put("kan-do-data.json", OLD_FILE);

    assert_eq!(t.migrate(), DataOutcome::Migrated);

    assert_eq!(fs::read(t.new.join(FILE_NAME)).unwrap(), OLD_FILE);
    assert!(!t.new.join(LOCATION_FILE).exists());
}

#[test]
fn a_migrated_folder_loads_as_ok_with_the_stores_and_no_first_run() {
    let t = Support::new();
    t.seed_default_install();
    assert_eq!(t.migrate(), DataOutcome::Migrated);

    let data = DataFile::new(t.new.clone(), t.new.clone(), "9.9.9".into(), Timing::default(), Box::new(|_| {}));
    let loaded = data.load();
    assert!(!loaded.needs_init);
    assert_eq!(serde_json::to_value(&loaded.state).unwrap()["status"], "ok");
    assert_eq!(serde_json::to_value(&loaded.state).unwrap()["deviceId"], "dev-1");
    assert_eq!(loaded.envelope.unwrap()["stores"]["tasks-store"], json!({ "tasks": [] }));
}

#[test]
fn a_second_run_is_a_no_op_and_never_overwrites_what_the_app_wrote_since() {
    let t = Support::new();
    t.seed_default_install();
    assert_eq!(t.migrate(), DataOutcome::Migrated);
    fs::write(t.new.join(FILE_NAME), b"edited by the new app").unwrap();

    assert_eq!(t.migrate(), DataOutcome::NotNeeded);
    assert_eq!(fs::read(t.new.join(FILE_NAME)).unwrap(), b"edited by the new app");
}

#[test]
fn a_populated_destination_without_a_marker_is_skipped_and_nothing_is_overwritten() {
    let t = Support::new();
    t.seed_default_install();
    fs::create_dir_all(&t.new).unwrap();
    fs::write(t.new.join(FILE_NAME), b"already here").unwrap();
    let before_old = snapshot(&t.old);

    assert_eq!(t.migrate(), DataOutcome::Skipped);

    assert_eq!(fs::read(t.new.join(FILE_NAME)).unwrap(), b"already here");
    assert!(!t.new.join(LOCATION_FILE).exists());
    assert_eq!(snapshot(&t.old), before_old);
    // Remembered: later starts do not look again.
    assert_eq!(t.migrate(), DataOutcome::NotNeeded);
}

#[test]
fn an_interrupted_run_resumes_and_replaces_its_own_stale_copy() {
    let t = Support::new();
    t.seed_default_install();
    // A crash after the data file and before the pointer, then the old app ran on and changed the file.
    fs::create_dir_all(t.new.join("backups")).unwrap();
    fs::write(t.new.join(FILE_NAME), b"stale copy").unwrap();
    write_state(&t.new, &State { data: Some(IN_PROGRESS.into()), ..State::default() }).unwrap();

    assert_eq!(t.migrate(), DataOutcome::Migrated);

    assert_eq!(fs::read(t.new.join(FILE_NAME)).unwrap(), OLD_FILE);
    assert!(t.new.join(LOCATION_FILE).exists());
    assert_eq!(read_state(&t.new).unwrap().data.as_deref(), Some(DONE));
}

#[test]
fn an_unreadable_legacy_pointer_falls_back_to_the_legacy_folder_and_copies_nothing() {
    let t = Support::new();
    t.put("kan-do-data.json", OLD_FILE);
    t.put("data-location.json", b"{ not json");
    let before = snapshot(&t.old);

    assert!(matches!(t.migrate(), DataOutcome::FallBackToLegacy(_)));

    assert!(!t.new.join(FILE_NAME).exists());
    assert_eq!(snapshot(&t.old), before);
}

#[test]
fn a_failed_copy_falls_back_without_a_half_file_and_the_legacy_folder_is_untouched() {
    let t = Support::new();
    t.seed_default_install();
    // A directory where the data file must go makes the copy fail after the backups were copied.
    fs::create_dir_all(t.new.join(FILE_NAME)).unwrap();
    // The destination holds "data" (the directory) and no marker, so force the in-progress path.
    write_state(&t.new, &State { data: Some(IN_PROGRESS.into()), ..State::default() }).unwrap();
    let before = snapshot(&t.old);

    let outcome = t.migrate();

    assert!(matches!(outcome, DataOutcome::FallBackToLegacy(_)), "{outcome:?}");
    assert_eq!(snapshot(&t.old), before);
    assert!(!t.new.join(LOCATION_FILE).exists(), "the pointer is written last");
    assert_eq!(read_state(&t.new).unwrap().data.as_deref(), Some(IN_PROGRESS), "retried at the next start");
}

#[test]
fn the_fallback_directories_are_the_legacy_ones() {
    let t = Support::new();
    t.put("kan-do-data.json", OLD_FILE);
    t.put("data-location.json", b"garbage");
    let dirs = run_with(LEGACY_IDENTIFIER, &t.new, &t.new, || None);
    assert_eq!(dirs, Dirs { config_dir: t.old.clone(), default_folder: t.old.clone() });
    let dirs = run_with("some.other.id", &t.new, &t.new, || None);
    assert_eq!(dirs.config_dir, t.old);
}

#[test]
fn writer_leftovers_are_not_copied() {
    let t = Support::new();
    t.seed_default_install();
    t.put(".kan-do-data.json.tmp-1-2", b"half");
    t.put("backups/.kan-do-probe-1-2", b"probe");
    assert_eq!(t.migrate(), DataOutcome::Migrated);
    assert!(!t.new.join(".kan-do-data.json.tmp-1-2").exists());
    assert!(!t.new.join("backups/.kan-do-probe-1-2").exists());
}

// --- Keychain step ------------------------------------------------------------------------------

#[derive(Default)]
struct Mem {
    values: Mutex<HashMap<SecretEntry, String>>,
    fail_get: Mutex<Vec<SecretEntry>>,
    fail_delete: Mutex<bool>,
    /// `set` stores a different value (a broken Keychain).
    corrupt_set: Mutex<bool>,
    reads: Mutex<usize>,
}

impl Backend for Arc<Mem> {
    fn get(&self, entry: SecretEntry) -> Result<Option<String>, SecretError> {
        *self.reads.lock().unwrap() += 1;
        if self.fail_get.lock().unwrap().contains(&entry) {
            return Err(SecretError::Keychain);
        }
        Ok(self.values.lock().unwrap().get(&entry).cloned())
    }
    fn set(&self, entry: SecretEntry, value: &str) -> Result<(), SecretError> {
        let stored = if *self.corrupt_set.lock().unwrap() { format!("{value}x") } else { value.to_string() };
        self.values.lock().unwrap().insert(entry, stored);
        Ok(())
    }
    fn delete(&self, entry: SecretEntry) -> Result<(), SecretError> {
        if *self.fail_delete.lock().unwrap() {
            return Err(SecretError::Keychain);
        }
        self.values.lock().unwrap().remove(&entry);
        Ok(())
    }
}

fn token(entry: SecretEntry) -> String {
    format!("tok-{}-0123456789", entry.account())
}

fn full_legacy() -> Arc<Mem> {
    let mem = Arc::new(Mem::default());
    for entry in SecretEntry::ALL {
        mem.values.lock().unwrap().insert(entry, token(entry));
    }
    mem
}

fn boxed(mem: &Arc<Mem>) -> Box<dyn Backend> {
    Box::new(mem.clone())
}

#[test]
fn all_four_entries_are_moved_and_the_legacy_ones_deleted() {
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    let results = migrate_secrets(&legacy, &current);
    assert!(results.iter().all(|(_, o)| *o == EntryOutcome::Moved { legacy_kept: false }));
    for entry in SecretEntry::ALL {
        assert_eq!(current.values.lock().unwrap().get(&entry), Some(&token(entry)));
    }
    assert!(legacy.values.lock().unwrap().is_empty());
}

#[test]
fn absent_entries_are_resolved_and_a_present_new_entry_wins_and_keeps_the_legacy_one() {
    let (legacy, current) = (Arc::new(Mem::default()), Arc::new(Mem::default()));
    legacy.values.lock().unwrap().insert(SecretEntry::NotionToken, "old-notion".into());
    current.values.lock().unwrap().insert(SecretEntry::NotionToken, "new-notion".into());
    legacy.values.lock().unwrap().insert(SecretEntry::TodoistToken, "old-todoist".into());
    let results: HashMap<_, _> = migrate_secrets(&legacy, &current).into_iter().collect();
    assert_eq!(results[&SecretEntry::NotionToken], EntryOutcome::KeptNew);
    assert_eq!(results[&SecretEntry::TodoistToken], EntryOutcome::Moved { legacy_kept: false });
    assert_eq!(results[&SecretEntry::GithubUpdates], EntryOutcome::Absent);
    assert_eq!(current.values.lock().unwrap().get(&SecretEntry::NotionToken).unwrap(), "new-notion");
    assert_eq!(legacy.values.lock().unwrap().get(&SecretEntry::NotionToken).unwrap(), "old-notion");
}

#[test]
fn the_new_service_is_checked_first_and_the_legacy_entry_is_not_touched_when_it_holds_a_value() {
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    for entry in SecretEntry::ALL {
        current.values.lock().unwrap().insert(entry, format!("new-{}", entry.account()));
        // Even a legacy entry that would be denied (a Keychain error) must not be read.
        legacy.fail_get.lock().unwrap().push(entry);
    }
    let results = migrate_secrets(&legacy, &current);
    assert!(results.iter().all(|(_, o)| *o == EntryOutcome::KeptNew));
    assert_eq!(*legacy.reads.lock().unwrap(), 0, "the legacy service is never read when the new one holds a value");
    assert_eq!(legacy.values.lock().unwrap().len(), 4);
}

#[test]
fn a_read_back_mismatch_keeps_the_legacy_entry_and_is_not_resolved() {
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    *current.corrupt_set.lock().unwrap() = true;
    let results = migrate_secrets(&legacy, &current);
    assert!(results.iter().all(|(_, o)| *o == EntryOutcome::Failed));
    assert_eq!(legacy.values.lock().unwrap().len(), 4);
}

#[test]
fn a_legacy_read_error_is_not_missing_and_not_resolved() {
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    legacy.fail_get.lock().unwrap().push(SecretEntry::GithubFeedback);
    let results: HashMap<_, _> = migrate_secrets(&legacy, &current).into_iter().collect();
    assert_eq!(results[&SecretEntry::GithubFeedback], EntryOutcome::Failed);
    assert_eq!(results[&SecretEntry::NotionToken], EntryOutcome::Moved { legacy_kept: false });
}

#[test]
fn a_refused_legacy_delete_is_logged_not_fatal_and_the_new_entry_stays() {
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    *legacy.fail_delete.lock().unwrap() = true;
    let results = migrate_secrets(&legacy, &current);
    assert!(results.iter().all(|(_, o)| *o == EntryOutcome::Moved { legacy_kept: true }));
    assert_eq!(current.values.lock().unwrap().len(), 4);
}

#[test]
fn the_step_only_runs_for_the_production_identifier() {
    let t = Support::new();
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    let outcome = run_secrets("io.github.jaylouiz.kan-do.sandbox-3103", &t.new, || Some((boxed(&legacy), boxed(&current))));
    assert_eq!(outcome, SecretsOutcome::SkippedNotProduction);
    assert_eq!(*legacy.reads.lock().unwrap(), 0, "a sandbox run never reads the legacy service");
    assert!(!t.new.exists());
}

#[test]
fn a_finished_step_writes_a_marker_without_values_and_never_reads_the_legacy_service_again() {
    let t = Support::new();
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    let outcome = run_secrets(PRODUCTION_IDENTIFIER, &t.new, || Some((boxed(&legacy), boxed(&current))));
    assert!(matches!(outcome, SecretsOutcome::Done(_)));
    let marker = fs::read_to_string(t.new.join(STATE_FILE)).unwrap();
    assert!(!marker.contains("tok-"));
    let reads = *legacy.reads.lock().unwrap();

    let again = run_secrets(PRODUCTION_IDENTIFIER, &t.new, || panic!("the Keychain must not be opened again"));
    assert_eq!(again, SecretsOutcome::AlreadyDone);
    assert_eq!(*legacy.reads.lock().unwrap(), reads);
}

#[test]
fn an_incomplete_step_writes_no_marker_and_is_retried() {
    let t = Support::new();
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    legacy.fail_get.lock().unwrap().push(SecretEntry::NotionToken);
    let outcome = run_secrets(PRODUCTION_IDENTIFIER, &t.new, || Some((boxed(&legacy), boxed(&current))));
    assert!(matches!(outcome, SecretsOutcome::Incomplete(_)));
    assert!(read_state(&t.new).unwrap().secrets.is_none());

    legacy.fail_get.lock().unwrap().clear();
    let outcome = run_secrets(PRODUCTION_IDENTIFIER, &t.new, || Some((boxed(&legacy), boxed(&current))));
    assert!(matches!(outcome, SecretsOutcome::Done(_)));
    // The already moved entries are not moved twice: they were deleted from the legacy service.
    assert_eq!(current.values.lock().unwrap().len(), 4);
}

#[test]
fn a_denied_prompt_is_recorded_and_the_step_backs_off_after_a_few_starts() {
    let t = Support::new();
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    for entry in SecretEntry::ALL {
        legacy.fail_get.lock().unwrap().push(entry);
    }
    for attempt in 1..=MAX_SECRET_ATTEMPTS {
        let outcome = run_secrets(PRODUCTION_IDENTIFIER, &t.new, || Some((boxed(&legacy), boxed(&current))));
        assert!(matches!(outcome, SecretsOutcome::Incomplete(_)), "attempt {attempt}");
        assert_eq!(read_state(&t.new).unwrap().secrets_attempts, attempt);
    }
    let reads = *legacy.reads.lock().unwrap();
    let outcome = run_secrets(PRODUCTION_IDENTIFIER, &t.new, || panic!("the Keychain must not be opened after the back-off"));
    assert_eq!(outcome, SecretsOutcome::GaveUp);
    assert_eq!(*legacy.reads.lock().unwrap(), reads);
    assert!(read_state(&t.new).unwrap().secrets.is_none(), "giving up is not `done`");
}

#[test]
fn a_debug_build_runs_neither_step_and_touches_neither_folder_nor_keychain() {
    let t = Support::new();
    t.seed_default_install();
    let before = snapshot(&t.old);
    let dirs = run_gated(true, PRODUCTION_IDENTIFIER, &t.new, &t.new, || panic!("a debug build must not open the Keychain"));
    assert_eq!(dirs, Dirs { config_dir: t.new.clone(), default_folder: t.new.clone() });
    assert!(!t.new.exists(), "no state file, no copied data");
    assert_eq!(snapshot(&t.old), before);
}

#[test]
fn a_sandbox_identifier_in_a_debug_build_still_runs_the_data_step_but_never_the_keychain() {
    let t = Support::new();
    t.seed_default_install();
    let dirs = run_gated(true, "io.github.jaylouiz.kan-do.sandbox-3103", &t.new, &t.new, || panic!("sandbox: no Keychain"));
    assert_eq!(dirs.config_dir, t.new);
    assert_eq!(read_state(&t.new).unwrap().data.as_deref(), Some(DONE));
}

#[test]
fn a_release_build_runs_both_steps() {
    let t = Support::new();
    t.seed_default_install();
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    run_gated(false, PRODUCTION_IDENTIFIER, &t.new, &t.new, || Some((boxed(&legacy), boxed(&current))));
    let state = read_state(&t.new).unwrap();
    assert_eq!((state.data.as_deref(), state.secrets.as_deref()), (Some(DONE), Some(DONE)));
}

#[test]
fn a_fresh_install_resolves_to_done_with_nothing_to_move() {
    let t = Support::new();
    let (legacy, current) = (Arc::new(Mem::default()), Arc::new(Mem::default()));
    let outcome = run_secrets(PRODUCTION_IDENTIFIER, &t.new, || Some((boxed(&legacy), boxed(&current))));
    match outcome {
        SecretsOutcome::Done(results) => assert!(results.iter().all(|(_, o)| *o == EntryOutcome::Absent)),
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_data_and_secret_states_are_kept_side_by_side() {
    let t = Support::new();
    t.seed_default_install();
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    run_with(PRODUCTION_IDENTIFIER, &t.new, &t.new, || Some((boxed(&legacy), boxed(&current))));
    let state = read_state(&t.new).unwrap();
    assert_eq!((state.data.as_deref(), state.secrets.as_deref()), (Some(DONE), Some(DONE)));
}

#[test]
fn no_token_value_reaches_a_state_file_or_a_debug_string() {
    let (legacy, current) = (full_legacy(), Arc::new(Mem::default()));
    let results = migrate_secrets(&legacy, &current);
    let debug = format!("{results:?}");
    for entry in SecretEntry::ALL {
        assert!(!debug.contains(&token(entry)));
    }
}
