//! Persistent log file (#225). Release builds write `~/Library/Logs/io.github.jaylouiz.kan-do/kan-do.log`
//! (five rotated files of about 1 MB); dev builds also log to stdout at `Debug`.
//!
//! What gets logged is decided at the call sites: status names, versions and error kinds. Never
//! tokens, and never task titles or other user content.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{Builder, RotationStrategy, Target, TargetKind};

const FILE_NAME: &str = "kan-do";
const MAX_FILE_BYTES: u128 = 1_000_000;
const KEPT_FILES: usize = 5;

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let dev = cfg!(debug_assertions);
    let mut targets = vec![Target::new(TargetKind::LogDir { file_name: Some(FILE_NAME.into()) })];
    if dev {
        targets.push(Target::new(TargetKind::Stdout));
    }
    Builder::new()
        .clear_targets()
        .targets(targets)
        .level(if dev { log::LevelFilter::Debug } else { log::LevelFilter::Info })
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_FILES))
        .max_file_size(MAX_FILE_BYTES)
        .build()
}

/// Upper bounds for `log_tail`: the report body must stay small enough for an issue and a prefilled link.
const TAIL_MAX_LINES: usize = 100;
const TAIL_MAX_BYTES: usize = 8_000;

/// Markers of credentials. A line containing one is dropped from the tail, so the feedback report
/// never carries a token even if one slipped into the log.
const SECRET_MARKERS: [&str; 13] = [
    "ghp_", "gho_", "ghs_", "github_pat_", "bearer ", "authorization",
    "ntn_", "secret_", "api_key", "apikey", "password", "token=", "token:",
];

/// Todoist tokens have no prefix: any run of this many hex characters looks like one.
const HEX_RUN_MIN: usize = 32;

fn has_hex_run(line: &str) -> bool {
    let mut run = 0;
    for c in line.chars() {
        run = if c.is_ascii_hexdigit() { run + 1 } else { 0 };
        if run >= HEX_RUN_MIN {
            return true;
        }
    }
    false
}

fn looks_secret(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    SECRET_MARKERS.iter().any(|marker| lower.contains(marker)) || has_hex_run(line)
}

/// The last `lines` lines of `content` (at most `TAIL_MAX_LINES` and `TAIL_MAX_BYTES`), without lines
/// that look like they hold a credential.
fn tail_lines(content: &str, lines: usize) -> String {
    let wanted = lines.min(TAIL_MAX_LINES);
    let mut kept: Vec<&str> = content
        .lines()
        .rev()
        .filter(|line| !looks_secret(line))
        .take(wanted)
        .collect();
    kept.reverse();
    let mut out = kept.join("\n");
    if out.len() > TAIL_MAX_BYTES {
        let mut cut = out.len() - TAIL_MAX_BYTES;
        while !out.is_char_boundary(cut) {
            cut += 1;
        }
        out = out[cut..].to_owned();
    }
    out
}

/// The last `TAIL_MAX_BYTES * 4` bytes of `path` (a log file can be about 1 MB; the report needs a few
/// lines). The cut can land inside a line or a character: the first, partial line is dropped and bad
/// UTF-8 is replaced. `Ok(None)` when the file does not exist.
fn read_tail(path: &Path) -> std::io::Result<Option<String>> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let window = (TAIL_MAX_BYTES * 4) as u64;
    let len = file.metadata()?.len();
    let start = len.saturating_sub(window);
    file.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity((len - start) as usize);
    file.read_to_end(&mut bytes)?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if start == 0 {
        return Ok(Some(text));
    }
    // Mid-file start: the first line is probably cut.
    Ok(Some(text.split_once('\n').map(|(_, rest)| rest.to_owned()).unwrap_or_default()))
}

/// The newest rotated file (`kan-do_<date>.log`, see tauri-plugin-log `KeepSome`); the date suffix sorts
/// chronologically. The active `kan-do.log` has no `_` after the name and is excluded.
fn newest_rotated(dir: &Path) -> Option<PathBuf> {
    let prefix = format!("{FILE_NAME}_");
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let name = path.file_name()?.to_string_lossy().into_owned();
            (name.starts_with(&prefix) && name.ends_with(".log")).then_some((name, path))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, path)| path)
}

/// Tail of the log in `dir`; right after a rotation the current file is short, so the newest rotated
/// file tops it up to the wanted number of lines.
fn tail_from_dir(dir: &Path, lines: usize) -> Result<String, String> {
    let wanted = lines.min(TAIL_MAX_LINES);
    let current = read_tail(&dir.join(format!("{FILE_NAME}.log"))).map_err(|_| "log unreadable".to_owned())?;
    let mut content = current.unwrap_or_default();
    if content.lines().filter(|line| !looks_secret(line)).count() < wanted {
        if let Some(Ok(Some(older))) = newest_rotated(dir).map(|path| read_tail(&path)) {
            content = if content.is_empty() { older } else { format!("{}\n{content}", older.trim_end()) };
        }
    }
    Ok(tail_lines(&content, lines))
}

/// The tail of the log for the feedback report (#227). An absent file is an empty tail.
#[tauri::command]
pub async fn log_tail<R: Runtime>(app: AppHandle<R>, lines: usize) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|_| "log dir unavailable".to_owned())?;
    tail_from_dir(&dir, lines)
}

/// The folder the log files live in, for display on the updates page.
#[tauri::command]
pub async fn log_location<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    app.path()
        .app_log_dir()
        .map(|dir| dir.to_string_lossy().into_owned())
        .map_err(|_| "log dir unavailable".to_owned())
}

/// Opens the log folder in the Finder.
#[tauri::command]
pub async fn log_reveal<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().map_err(|_| "log dir unavailable".to_owned())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|_| "could not open the log folder".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_last_lines_in_order() {
        assert_eq!(tail_lines("a\nb\nc\nd", 2), "c\nd");
        assert_eq!(tail_lines("a\nb", 30), "a\nb");
        assert_eq!(tail_lines("", 5), "");
    }

    #[test]
    fn caps_lines_and_bytes() {
        let many = (0..500).map(|n| n.to_string()).collect::<Vec<_>>().join("\n");
        assert_eq!(tail_lines(&many, 10_000).lines().count(), TAIL_MAX_LINES);
        let wide = "é".repeat(TAIL_MAX_BYTES);
        let out = tail_lines(&wide, 1);
        assert!(out.len() <= TAIL_MAX_BYTES);
        assert!(out.chars().all(|c| c == 'é'));
    }

    #[test]
    fn drops_lines_that_look_like_credentials() {
        let log = "ok 1\nsent with ghp_abcdef123456\nAuthorization: Bearer xyz\nGITHUB_PAT_11AAA\nok 2";
        assert_eq!(tail_lines(log, 30), "ok 1\nok 2");
    }

    #[test]
    fn drops_notion_todoist_and_generic_credential_lines() {
        let hex = "a".repeat(40);
        let log = format!(
            "ok 1\nntn_abc\nSECRET_xyz\napi_key set\nApiKey=1\npassword x\ntoken=abc\ntoken: abc\nTodoist {hex}\nstatus token present\nok 2"
        );
        assert_eq!(tail_lines(&log, 30), "ok 1\nstatus token present\nok 2");
        let short_hex = "b".repeat(31);
        assert_eq!(tail_lines(&short_hex, 30), short_hex);
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kando-logging-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_only_the_end_of_a_large_file() {
        let dir = temp_dir("large");
        let content: String = (0..200_000).map(|n| format!("line {n}\n")).collect();
        std::fs::write(dir.join("kan-do.log"), &content).unwrap();
        let out = tail_from_dir(&dir, 3).unwrap();
        assert_eq!(out, "line 199997\nline 199998\nline 199999");
        let read = read_tail(&dir.join("kan-do.log")).unwrap().unwrap();
        assert!(read.len() <= TAIL_MAX_BYTES * 4);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn tops_up_from_the_newest_rotated_file() {
        let dir = temp_dir("rotated");
        std::fs::write(dir.join("kan-do.log"), "new 1\nnew 2\n").unwrap();
        std::fs::write(dir.join("kan-do_2026-01-01_10-00-00.log"), "ancient\n").unwrap();
        std::fs::write(dir.join("kan-do_2026-02-01_10-00-00.log"), "old 1\nold 2\nold 3\n").unwrap();
        assert_eq!(tail_from_dir(&dir, 4).unwrap(), "old 2\nold 3\nnew 1\nnew 2");
        // Enough lines in the current file: the rotated one stays untouched.
        assert_eq!(tail_from_dir(&dir, 2).unwrap(), "new 1\nnew 2");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_files_give_an_empty_tail() {
        let dir = temp_dir("missing");
        assert_eq!(tail_from_dir(&dir, 5).unwrap(), "");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
