//! Backup store of the data file (#224, ADR 011): file names, retention, listing and the matching of
//! cloud-sync conflict copies. Everything here is a pure function over names and bytes or a small
//! file operation, so `cargo test` covers it without a clock or a GUI.
//!
//! A backup is a verbatim copy of the data file in `<folder>/backups/`, named
//! `<UTC yyyymmddThhmmssZ>-<kind>-<device6>.json`. The device suffix makes names unique per device, so
//! backups written by two machines never conflict in a synced folder.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{parse_envelope, write_atomic, Parsed, FILE_NAME};

/// Directory inside the data folder that holds the backups.
pub const BACKUP_DIR: &str = "backups";
/// How many `daily` backups a device keeps.
pub const DAILY_KEEP: usize = 14;
/// How many backups of every other kind a device keeps.
pub const OTHER_KEEP: usize = 10;
const NAME_SUFFIX: &str = ".json";
const STAMP_LEN: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackupKind {
    /// The previous on-disk state, before the first write of a local day.
    Daily,
    Manual,
    PreMigration,
    PreRestore,
    PreReplace,
    PreUpdate,
    /// The other device's file, kept when "Diese Version behalten" overwrites it (or a conflict copy was filed away).
    Conflict,
    /// This app's in-memory state that was not saved because of a conflict.
    Unsaved,
}

impl BackupKind {
    pub const ALL: [BackupKind; 8] = [
        BackupKind::Daily,
        BackupKind::Manual,
        BackupKind::PreMigration,
        BackupKind::PreRestore,
        BackupKind::PreReplace,
        BackupKind::PreUpdate,
        BackupKind::Conflict,
        BackupKind::Unsaved,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            BackupKind::Daily => "daily",
            BackupKind::Manual => "manual",
            BackupKind::PreMigration => "pre-migration",
            BackupKind::PreRestore => "pre-restore",
            BackupKind::PreReplace => "pre-replace",
            BackupKind::PreUpdate => "pre-update",
            BackupKind::Conflict => "conflict",
            BackupKind::Unsaved => "unsaved",
        }
    }

    pub fn parse(text: &str) -> Option<BackupKind> {
        BackupKind::ALL.into_iter().find(|kind| kind.as_str() == text)
    }

    /// Backups the webview may ask for through `data_backup`; the others are taken by Rust itself.
    pub fn requestable(self) -> bool {
        matches!(self, BackupKind::Manual | BackupKind::PreMigration | BackupKind::PreUpdate)
    }

    /// Mandatory backups block their operation when they fail; `daily` and `manual` never block saving.
    pub fn mandatory(self) -> bool {
        matches!(
            self,
            BackupKind::PreMigration | BackupKind::PreRestore | BackupKind::PreReplace | BackupKind::PreUpdate
        )
    }

    /// How many a device keeps; `None` for the kinds that can be the only copy of something (the other
    /// device's file, edits that never reached the file, the state before a migration, an update or a
    /// folder replace). Those are rare, user-visible events, so they are never rotated away: growth is one
    /// verbatim data file per event, and the files in `<folder>/backups/` can be removed by hand
    /// (ADR 011, consequences).
    fn keep(self) -> Option<usize> {
        match self {
            BackupKind::Daily => Some(DAILY_KEEP),
            BackupKind::Manual | BackupKind::PreRestore => Some(OTHER_KEEP),
            BackupKind::PreMigration | BackupKind::PreReplace | BackupKind::PreUpdate | BackupKind::Conflict | BackupKind::Unsaved => None,
        }
    }
}

/// The parts a backup file name encodes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupName {
    pub unix_secs: u64,
    pub kind: BackupKind,
    pub device6: String,
}

/// First six characters of the device id (lower-case alphanumerics), padded so the name stays well formed.
pub fn device6(device_id: &str) -> String {
    let mut short: String = device_id.chars().filter(char::is_ascii_alphanumeric).take(6).collect::<String>().to_lowercase();
    while short.len() < 6 {
        short.push('0');
    }
    short
}

/// Calendar parts of a Unix timestamp in UTC: `(year, month, day, hour, minute, second)`.
pub fn civil_from_unix(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_index + 2) / 5 + 1) as u32;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day, (rest / 3_600) as u32, (rest % 3_600 / 60) as u32, (rest % 60) as u32)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let month_shifted = i64::from(if month > 2 { month - 3 } else { month + 9 });
    let day_of_year = (153 * month_shifted + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// `<yyyymmddThhmmssZ>-<kind>-<device6>.json`
pub fn backup_name(unix_secs: u64, kind: BackupKind, device6: &str) -> String {
    let (year, month, day, hour, minute, second) = civil_from_unix(unix_secs);
    format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z-{}-{device6}{NAME_SUFFIX}", kind.as_str())
}

/// Inverse of [`backup_name`]; `None` for any other file name.
pub fn parse_backup_name(name: &str) -> Option<BackupName> {
    let stem = name.strip_suffix(NAME_SUFFIX)?;
    let stamp = stem.get(..STAMP_LEN)?;
    let rest = stem.get(STAMP_LEN..)?.strip_prefix('-')?;
    let (kind_text, device6) = rest.rsplit_once('-')?;
    let kind = BackupKind::parse(kind_text)?;
    if device6.len() != 6 || !device6.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) {
        return None;
    }
    let bytes = stamp.as_bytes();
    if bytes[8] != b'T' || bytes[15] != b'Z' {
        return None;
    }
    let number = |range: std::ops::Range<usize>| stamp.get(range)?.parse::<u32>().ok();
    let (year, month, day) = (i64::from(number(0..4)?), number(4..6)?, number(6..8)?);
    let (hour, minute, second) = (number(9..11)?, number(11..13)?, number(13..15)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 59 {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let unix_secs = u64::try_from(days).ok()? * 86_400 + u64::from(hour) * 3_600 + u64::from(minute) * 60 + u64::from(second);
    Some(BackupName { unix_secs, kind, device6: device6.to_string() })
}

/// Local calendar day of a timestamp as days since the epoch; `offset_secs` is the local UTC offset.
pub fn local_day(unix_secs: u64, offset_secs: i64) -> i64 {
    (unix_secs as i64 + offset_secs).div_euclid(86_400)
}

/// Names to delete after a backup: per kind, everything but the newest 14 (`daily`) or 10 (`manual`,
/// `pre-restore`); the kinds without a limit (see `BackupKind::keep`) are never selected. Only `device6`'s
/// own backups are considered, so two devices never prune each other's files, and the newest backup of a
/// kind always stays.
pub fn select_for_pruning(names: &[String], device6: &str) -> Vec<String> {
    let mut parsed: Vec<(BackupName, &String)> = names
        .iter()
        .filter_map(|name| parse_backup_name(name).map(|parts| (parts, name)))
        .filter(|(parts, _)| parts.device6 == device6)
        .collect();
    parsed.sort_by(|a, b| b.0.unix_secs.cmp(&a.0.unix_secs).then_with(|| b.1.cmp(a.1)));
    let mut seen = std::collections::HashMap::<BackupKind, usize>::new();
    let mut doomed = Vec::new();
    for (parts, name) in parsed {
        let Some(keep) = parts.kind.keep() else { continue };
        let count = seen.entry(parts.kind).or_insert(0);
        *count += 1;
        if *count > keep {
            doomed.push(name.clone());
        }
    }
    doomed
}

/// A `kan-do-data*.json` next to the data file that a sync client (or the user) left behind: Dropbox
/// "conflicted copy", iCloud `kan-do-data 2.json`, Syncthing `.sync-conflict-`.
pub fn is_conflict_copy_name(name: &str) -> bool {
    name != FILE_NAME && !name.starts_with('.') && name.starts_with("kan-do-data") && name.ends_with(NAME_SUFFIX)
}

/// True for a bare file name: no separators, no parent references.
pub fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', '\0'])
}

/// What the page shows about a conflict copy or a backup after parsing it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSummary {
    pub written_at: String,
    pub written_by: String,
    pub task_count: Option<usize>,
    pub schema_version: u64,
}

/// Number of tasks in the `tasks-store` entry (`tasks` is an array).
pub fn task_count(stores: &Map<String, Value>) -> Option<usize> {
    stores.get("tasks-store")?.get("tasks")?.as_array().map(Vec::len)
}

pub fn summarise(parsed: &Parsed) -> FileSummary {
    FileSummary {
        written_at: parsed.written_at.clone(),
        written_by: parsed.written_by.clone(),
        task_count: task_count(&parsed.stores),
        schema_version: parsed.schema_version,
    }
}

/// One row of `data_backup_list`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub name: String,
    pub kind: BackupKind,
    /// ISO-8601 UTC time from the file name.
    pub ts: String,
    pub device6: String,
    /// The file's `writtenBy` is this device. `false` when unreadable.
    pub own_device: bool,
    pub task_count: Option<usize>,
    pub schema_version: Option<u64>,
    /// The file parses as an envelope; an unreadable one is listed but cannot be restored.
    pub readable: bool,
}

/// A conflict copy found next to the data file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCopy {
    pub name: String,
    #[serde(flatten)]
    pub summary: FileSummary,
}

pub type Reader<'a> = &'a dyn Fn(&Path) -> io::Result<Vec<u8>>;

pub fn backup_dir(folder: &Path) -> PathBuf {
    folder.join(BACKUP_DIR)
}

/// Names of the files in `dir` ordered newest first; an absent directory is an empty list.
pub fn backup_names(dir: &Path) -> io::Result<Vec<String>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| parse_backup_name(name).is_some())
        .collect();
    names.sort_by(|a, b| {
        let (a_parts, b_parts) = (parse_backup_name(a), parse_backup_name(b));
        b_parts.map(|p| p.unix_secs).cmp(&a_parts.map(|p| p.unix_secs)).then_with(|| b.cmp(a))
    });
    Ok(names)
}

pub fn list_backups(dir: &Path, device_id: &str, read: Reader<'_>) -> io::Result<Vec<BackupEntry>> {
    Ok(backup_names(dir)?
        .into_iter()
        .filter_map(|name| {
            let parts = parse_backup_name(&name)?;
            let parsed = read(&dir.join(&name)).ok().and_then(|bytes| parse_envelope(&bytes));
            Some(BackupEntry {
                ts: super::iso_from_unix(parts.unix_secs, 0),
                device6: parts.device6,
                kind: parts.kind,
                own_device: parsed.as_ref().is_some_and(|p| p.written_by == device_id),
                task_count: parsed.as_ref().and_then(|p| task_count(&p.stores)),
                schema_version: parsed.as_ref().map(|p| p.schema_version),
                readable: parsed.is_some(),
                name,
            })
        })
        .collect())
}

/// Lists conflict copies next to the data file: top level only, never `backups/`, only files that parse
/// as an envelope.
pub fn scan_conflict_copies(folder: &Path, read: Reader<'_>) -> io::Result<Vec<ConflictCopy>> {
    let mut copies = Vec::new();
    for entry in fs::read_dir(folder)?.flatten() {
        let Ok(name) = entry.file_name().into_string() else { continue };
        if !is_conflict_copy_name(&name) || !entry.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        if let Some(parsed) = read(&entry.path()).ok().and_then(|bytes| parse_envelope(&bytes)) {
            copies.push(ConflictCopy { name, summary: summarise(&parsed) });
        }
    }
    copies.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(copies)
}

/// Writes `bytes` into `<folder>/backups/` under a fresh name (copy, fsync, rename) and returns the name.
/// The directory is created lazily and only one level deep: a vanished data folder is never recreated
/// by a backup.
pub fn write_backup(folder: &Path, kind: BackupKind, device6: &str, now_secs: u64, bytes: &[u8]) -> io::Result<String> {
    let dir = backup_dir(folder);
    match fs::create_dir(&dir) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    // Same kind, same device, same second: move on to the next free second instead of overwriting.
    let mut secs = now_secs;
    let name = loop {
        let candidate = backup_name(secs, kind, device6);
        if !dir.join(&candidate).exists() {
            break candidate;
        }
        secs += 1;
    };
    write_atomic(&dir.join(&name), bytes)?;
    Ok(name)
}

/// Deletes what [`select_for_pruning`] selects. Best effort: a failed delete never fails a backup.
pub fn prune(folder: &Path, device6: &str) {
    let dir = backup_dir(folder);
    let Ok(names) = backup_names(&dir) else { return };
    for name in select_for_pruning(&names, device6) {
        let _ = fs::remove_file(dir.join(name));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const OCT_24: u64 = 1_792_843_200;

    #[test]
    fn names_round_trip_for_every_kind() {
        for kind in BackupKind::ALL {
            let name = backup_name(OCT_24, kind, "abc123");
            assert_eq!(name, format!("20261024T120000Z-{}-abc123.json", kind.as_str()));
            assert_eq!(parse_backup_name(&name), Some(BackupName { unix_secs: OCT_24, kind, device6: "abc123".into() }));
        }
    }

    #[test]
    fn foreign_names_do_not_parse() {
        for name in [
            "kan-do-data.json",
            "20261024T120000Z-daily-abc123.txt",
            "20261024T120000Z-nonsense-abc123.json",
            "20261024T120000Z-daily-ABC123.json",
            "20261024T120000Z-daily-abc12.json",
            "20261324T120000Z-daily-abc123.json",
            "20261024T250000Z-daily-abc123.json",
            "2026-10-24T12:00:00Z-daily-abc123.json",
            ".kan-do-data.json.tmp-1-0",
        ] {
            assert_eq!(parse_backup_name(name), None, "{name}");
        }
    }

    #[test]
    fn the_stamp_survives_leap_days_and_the_epoch() {
        for secs in [0, 951_782_400, 1_709_164_800, 4_102_444_799] {
            let name = backup_name(secs, BackupKind::Manual, "000000");
            assert_eq!(parse_backup_name(&name).unwrap().unix_secs, secs, "{name}");
        }
    }

    #[test]
    fn the_device_suffix_is_six_lowercase_alphanumerics() {
        assert_eq!(device6("F47AC10B-58CC-4372-A567-0E02B2C3D479"), "f47ac1");
        assert_eq!(device6("ab"), "ab0000");
        assert_eq!(device6(""), "000000");
    }

    #[test]
    fn the_local_day_follows_the_offset() {
        let late_utc = OCT_24 + 11 * 3_600 + 1_800; // 23:30 UTC
        assert_eq!(local_day(late_utc, 0), local_day(OCT_24, 0));
        assert_eq!(local_day(late_utc, 3_600), local_day(OCT_24, 0) + 1);
        assert_eq!(local_day(OCT_24, -13 * 3_600), local_day(OCT_24, 0) - 1);
    }

    fn names(spec: &[(u64, BackupKind, &str)]) -> Vec<String> {
        spec.iter().map(|(secs, kind, device)| backup_name(*secs, *kind, device)).collect()
    }

    #[test]
    fn pruning_keeps_14_daily_and_10_of_every_other_kind() {
        let mut spec: Vec<(u64, BackupKind, &str)> = (0..20).map(|n| (OCT_24 + n * 86_400, BackupKind::Daily, "aaaaaa")).collect();
        spec.extend((0..13).map(|n| (OCT_24 + n, BackupKind::Manual, "aaaaaa")));
        spec.extend((0..3).map(|n| (OCT_24 + n, BackupKind::Unsaved, "aaaaaa")));
        let all = names(&spec);
        let doomed = select_for_pruning(&all, "aaaaaa");

        let count = |kind: BackupKind| doomed.iter().filter(|name| parse_backup_name(name).unwrap().kind == kind).count();
        assert_eq!(count(BackupKind::Daily), 6);
        assert_eq!(count(BackupKind::Manual), 3);
        assert_eq!(count(BackupKind::Unsaved), 0);
        let oldest_daily = backup_name(OCT_24, BackupKind::Daily, "aaaaaa");
        let newest_daily = backup_name(OCT_24 + 19 * 86_400, BackupKind::Daily, "aaaaaa");
        assert!(doomed.contains(&oldest_daily));
        assert!(!doomed.contains(&newest_daily), "the newest of a kind is never pruned");
    }

    #[test]
    fn pruning_leaves_other_devices_and_foreign_files_alone() {
        let mut all = names(&(0..12).map(|n| (OCT_24 + n, BackupKind::Manual, "bbbbbb")).collect::<Vec<_>>());
        all.push("notes.txt".into());
        assert!(select_for_pruning(&all, "aaaaaa").is_empty());
        assert_eq!(select_for_pruning(&all, "bbbbbb").len(), 2);
    }

    #[test]
    fn conflict_copies_match_what_sync_clients_produce() {
        for name in [
            "kan-do-data (Julius's MacBook's conflicted copy 2026-10-24).json",
            "kan-do-data 2.json",
            "kan-do-data (1).json",
            "kan-do-data.sync-conflict-20261024-091200-ABCDEFG.json",
        ] {
            assert!(is_conflict_copy_name(name), "{name}");
        }
        for name in [
            "kan-do-data.json",
            ".kan-do-data.json.tmp-1-0",
            ".kan-do-data 2.json",
            "kan-do-export-2026-10-24.json",
            "kan-do-data 2.txt",
            "other.json",
        ] {
            assert!(!is_conflict_copy_name(name), "{name}");
        }
    }

    #[test]
    fn plain_file_names_have_no_separators() {
        assert!(is_plain_file_name("kan-do-data 2.json"));
        for name in ["", ".", "..", "../x.json", "a/b.json", "a\\b.json", "a\0b"] {
            assert!(!is_plain_file_name(name), "{name:?}");
        }
    }

    #[test]
    fn writing_a_backup_creates_one_directory_level_and_never_the_folder() {
        let root = TempDir::new().unwrap();
        let folder = root.path().join("data");
        assert!(write_backup(&folder, BackupKind::Manual, "abc123", OCT_24, b"x").is_err());
        assert!(!folder.exists(), "a vanished data folder is not rebuilt by a backup");

        fs::create_dir(&folder).unwrap();
        let name = write_backup(&folder, BackupKind::Manual, "abc123", OCT_24, b"x").unwrap();
        assert_eq!(fs::read(backup_dir(&folder).join(&name)).unwrap(), b"x");
        let second = write_backup(&folder, BackupKind::Manual, "abc123", OCT_24, b"y").unwrap();
        assert_ne!(name, second, "same second, same kind: the next free name");
        assert_eq!(fs::read(backup_dir(&folder).join(&name)).unwrap(), b"x", "never overwritten");
    }

    #[test]
    fn m5_the_only_copy_kinds_are_never_pruned() {
        let kinds = [BackupKind::Conflict, BackupKind::Unsaved, BackupKind::PreMigration, BackupKind::PreReplace, BackupKind::PreUpdate];
        let spec: Vec<(u64, BackupKind, &str)> =
            kinds.iter().flat_map(|kind| (0..25).map(move |n| (OCT_24 + n, *kind, "aaaaaa"))).collect();
        assert!(select_for_pruning(&names(&spec), "aaaaaa").is_empty());
        // The kinds a user can recreate or that only describe a past action still rotate.
        let rotating: Vec<(u64, BackupKind, &str)> = (0..12).map(|n| (OCT_24 + n, BackupKind::PreRestore, "aaaaaa")).collect();
        assert_eq!(select_for_pruning(&names(&rotating), "aaaaaa").len(), 2);
    }
}
