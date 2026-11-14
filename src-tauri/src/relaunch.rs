//! Relaunch after an installed update without a second copy of the app (#276).
//!
//! Tauri's `AppHandle::restart` runs `open -n <bundle>` on macOS while this process is still alive
//! and then ends it with a bare `exit(0)` inside the event loop. For a moment two kan-do processes
//! exist, and the old one, whose bundle the updater has just swapped away, can leave an orphaned
//! Dock icon behind. Here the old process quits through the normal event loop exit (so `RunEvent::Exit`
//! still flushes the data file) and a detached helper opens the bundle once that process is gone,
//! without `-n`: there is only ever one instance.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The helper polls every 100 ms and gives up waiting after this many polls (30 s); it opens the
/// bundle anyway, and a still running old instance then only receives the single-instance hand-over.
const MAX_POLLS: u32 = 300;

/// The `.app` directory around an executable at `<bundle>.app/Contents/MacOS/<binary>`; `None` for a
/// binary outside a bundle (`tauri dev`, `cargo run`).
pub fn bundle_root(executable: &Path) -> Option<PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let is = |path: &Path, name: &str| path.file_name().is_some_and(|n| n == name);
    let is_app = bundle.extension().is_some_and(|ext| ext == "app");
    (is(macos, "MacOS") && is(contents, "Contents") && is_app).then(|| bundle.to_path_buf())
}

/// The helper: wait until `pid` has exited (at most [`MAX_POLLS`] polls), then open `bundle`.
/// PID and path are positional arguments, never part of the script text, so no quoting is involved.
pub fn helper_command(pid: u32, bundle: &Path) -> Command {
    let script = format!(
        "i=0; while kill -0 \"$1\" 2>/dev/null && [ \"$i\" -lt {MAX_POLLS} ]; do sleep 0.1; i=$((i+1)); done; exec /usr/bin/open \"$2\""
    );
    let mut command = Command::new("/bin/sh");
    command
        .arg("-c")
        .arg(script)
        .arg("kan-do-relaunch")
        .arg(pid.to_string())
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group: the helper outlives this process and is not taken down with it.
        command.process_group(0);
    }
    command
}

/// Starts the helper for `executable`'s bundle. `false` when the binary is not inside a bundle or the
/// helper could not be started; the caller then falls back to Tauri's own restart.
pub fn spawn_helper(executable: &Path) -> bool {
    let Some(bundle) = bundle_root(executable) else {
        log::warn!("relaunch: the binary is not inside an .app bundle");
        return false;
    };
    match helper_command(std::process::id(), &bundle).spawn() {
        Ok(_) => true,
        Err(error) => {
            log::error!("relaunch: could not start the helper: {error}");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn bundle_root_finds_the_app_around_its_binary() {
        assert_eq!(
            bundle_root(Path::new("/Applications/kan-do.app/Contents/MacOS/kan-do")),
            Some(PathBuf::from("/Applications/kan-do.app"))
        );
        assert_eq!(
            bundle_root(Path::new("/Users/me/Apps/my app.app/Contents/MacOS/app")),
            Some(PathBuf::from("/Users/me/Apps/my app.app"))
        );
    }

    #[test]
    fn bundle_root_is_none_outside_a_bundle() {
        for path in [
            "/Users/me/kan-do/src-tauri/target/debug/kan-do",
            "/Applications/kan-do/Contents/MacOS/kan-do",
            "/Applications/kan-do.app/Contents/Resources/kan-do",
            "/Applications/kan-do.app/MacOS/kan-do",
            "kan-do",
        ] {
            assert_eq!(bundle_root(Path::new(path)), None, "{path}");
        }
    }

    #[test]
    fn helper_passes_pid_and_bundle_as_arguments_not_script_text() {
        let command = helper_command(4242, Path::new("/Applications/it's \"odd\".app"));
        assert_eq!(command.get_program(), "/bin/sh");
        let args: Vec<_> = command.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args[0], "-c");
        assert!(!args[1].contains("4242") && !args[1].contains("odd"), "{}", args[1]);
        assert!(args[1].contains("exec /usr/bin/open \"$2\""), "{}", args[1]);
        assert!(!args[1].contains("-n"), "no second instance: {}", args[1]);
        assert_eq!(&args[2..], ["kan-do-relaunch", "4242", "/Applications/it's \"odd\".app"]);
    }

    /// Runs the real script with `open` swapped for `echo`, against a child process that exits later:
    /// the helper must wait for it, then hand over the bundle path.
    #[test]
    fn helper_waits_for_the_process_to_exit_before_opening() {
        let mut sleeper = Command::new("/bin/sleep").arg("0.5").spawn().unwrap();
        let pid = sleeper.id();
        let command = helper_command(pid, Path::new("/tmp/x y.app"));
        let args: Vec<String> = command.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        let script = args[1].replace("exec /usr/bin/open", "exec echo");
        let reaper = std::thread::spawn(move || sleeper.wait());
        let started = Instant::now();
        let output = Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .args(&args[2..])
            .output()
            .unwrap();
        reaper.join().unwrap().unwrap();
        assert!(started.elapsed() >= Duration::from_millis(400), "returned after {:?}", started.elapsed());
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "/tmp/x y.app");
    }
}
