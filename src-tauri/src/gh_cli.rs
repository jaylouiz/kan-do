//! The developer's GitHub CLI login as the feedback token (#280, ADR 007 amendment, ADR 010).
//!
//! Only for the owner, only with an opt-in: the marker file `developer-feedback` in the app config dir. Without it
//! nothing here runs, so no other user's `gh` login is ever touched, and a sandboxed run (own identifier, own config
//! dir) can never reach it. The token comes from `gh auth token --hostname github.com`, a binary found at fixed paths
//! (no `PATH` lookup: a Dock launch has none worth trusting). The value is never logged and never forwarded in an error.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// The marker the developer creates once: `touch "<app config dir>/developer-feedback"`.
pub const MARKER_FILE: &str = "developer-feedback";
/// Where Homebrew puts `gh` (Apple silicon, Intel).
pub const CANDIDATES: [&str; 2] = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"];
pub const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct GhCli {
    marker: PathBuf,
    candidates: Vec<PathBuf>,
    timeout: Duration,
}

impl GhCli {
    /// The production source: the marker in `config_dir`, the Homebrew paths, [`TIMEOUT`].
    pub fn production(config_dir: &Path) -> Self {
        Self::with(config_dir.join(MARKER_FILE), CANDIDATES.iter().map(PathBuf::from).collect(), TIMEOUT)
    }

    pub fn with(marker: PathBuf, candidates: Vec<PathBuf>, timeout: Duration) -> Self {
        Self { marker, candidates, timeout }
    }

    /// The developer opted in.
    pub fn enabled(&self) -> bool {
        self.marker.is_file()
    }

    /// The token of the `gh` login, or `None` (no opt-in, no binary, not logged in, hang, unusable output).
    /// Blocks up to the timeout per candidate; the caller caches the answer for the session.
    pub fn token(&self) -> Option<String> {
        if !self.enabled() {
            return None;
        }
        self.candidates
            .iter()
            .filter(|path| path.is_file())
            .find_map(|path| run(path, self.timeout))
    }
}

/// Longest token accepted (GitHub's own tokens stay under 100 characters).
const MAX_TOKEN_LEN: usize = 255;

/// Runs one `gh auth token`, killing it after `timeout`. stdin is closed, stderr discarded.
fn run(binary: &Path, timeout: Duration) -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let mut child = Command::new(binary)
        .args(["auth", "token", "--hostname", "github.com"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    if !status.success() {
        return None;
    }
    let mut output = Vec::new();
    child.stdout.take()?.take(MAX_TOKEN_LEN as u64 + 2).read_to_end(&mut output).ok()?;
    parse_token(&output)
}

/// One line of token characters (`A-Z a-z 0-9 _ -`), nothing else: the value goes into an `Authorization` header.
fn parse_token(output: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(output).ok()?.trim_end_matches(['\n', '\r']);
    let valid = !text.is_empty()
        && text.len() <= MAX_TOKEN_LEN
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    valid.then(|| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    const TOKEN: &str = "gho_abcDEF1234567890";

    /// A throwaway `gh` that runs `script` (shell) and a config dir with or without the marker.
    fn fixture(script: &str, marker: bool, timeout: Duration) -> (tempfile::TempDir, GhCli) {
        let dir = tempfile::TempDir::new().unwrap();
        let bin = dir.path().join("gh");
        std::fs::write(&bin, format!("#!/bin/sh\n{script}\n")).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let marker_path = dir.path().join(MARKER_FILE);
        if marker {
            std::fs::write(&marker_path, b"").unwrap();
        }
        let cli = GhCli::with(marker_path, vec![dir.path().join("missing-gh"), bin], timeout);
        (dir, cli)
    }

    /// The fake and its directory; the directory must outlive the call (dropping it deletes the fake).
    fn quick(script: &str) -> (tempfile::TempDir, GhCli) {
        fixture(script, true, Duration::from_secs(5))
    }

    #[test]
    fn reads_the_token_with_the_expected_arguments() {
        // The fake only answers for exactly `auth token --hostname github.com`, so a changed call fails here.
        let (_dir, cli) = fixture(
            &format!(r#"[ "$*" = "auth token --hostname github.com" ] && echo {TOKEN} || exit 3"#),
            true,
            Duration::from_secs(5),
        );
        assert_eq!(cli.token().as_deref(), Some(TOKEN));
    }

    #[test]
    fn without_the_marker_gh_is_never_run() {
        let dir = tempfile::TempDir::new().unwrap();
        let ran = dir.path().join("ran");
        let (_bin_dir, cli) = fixture(&format!("touch {}; echo {TOKEN}", ran.display()), false, Duration::from_secs(5));
        assert!(!cli.enabled());
        assert_eq!(cli.token(), None);
        assert!(!ran.exists(), "gh must not run without the opt-in");
    }

    #[test]
    fn unusable_answers_are_no_token() {
        assert_eq!({ let (_d, c) = quick("exit 1"); c.token() }, None, "not logged in");
        assert_eq!({ let (_d, c) = quick("echo ''"); c.token() }, None, "empty");
        assert_eq!({ let (_d, c) = quick("echo 'gho_a b'"); c.token() }, None, "whitespace inside");
        assert_eq!({ let (_d, c) = quick("printf 'gho_a\\nline2\\n'"); c.token() }, None, "two lines");
        assert_eq!({ let (_d, c) = quick("echo 'tok\u{e4}en'"); c.token() }, None, "non-ascii");
        assert_eq!({ let (_d, c) = quick("echo 'gho_a;rm'"); c.token() }, None, "token charset only");
        let long = "a".repeat(300);
        assert_eq!({ let (_d, c) = quick(&format!("echo {long}")); c.token() }, None, "too long");
        let bin_missing = GhCli::with(
            tempfile::TempDir::new().unwrap().path().join(MARKER_FILE),
            vec![PathBuf::from("/nonexistent/gh")],
            TIMEOUT,
        );
        assert_eq!(bin_missing.token(), None);
    }

    #[test]
    fn a_hanging_gh_is_killed_after_the_timeout() {
        let (_dir, cli) = fixture("sleep 30", true, Duration::from_millis(300));
        let started = std::time::Instant::now();
        assert_eq!(cli.token(), None);
        assert!(started.elapsed() < Duration::from_secs(5), "took {:?}", started.elapsed());
    }

    #[test]
    fn stderr_and_a_closed_stdin_do_not_matter() {
        // Reading stdin would block on an open one (the timeout would then give `None`); stderr noise must not leak into the token.
        let (_dir, cli) = quick(&format!("read -r _; echo warning >&2; echo {TOKEN}"));
        assert_eq!(cli.token().as_deref(), Some(TOKEN));
    }

    #[test]
    fn production_paths_are_the_homebrew_ones_and_the_marker_sits_in_the_config_dir() {
        let cli = GhCli::production(Path::new("/cfg"));
        assert_eq!(cli.marker, Path::new("/cfg/developer-feedback"));
        assert_eq!(cli.candidates, vec![PathBuf::from("/opt/homebrew/bin/gh"), PathBuf::from("/usr/local/bin/gh")]);
    }
}
