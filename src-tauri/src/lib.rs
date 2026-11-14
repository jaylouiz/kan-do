mod capture;
mod data_file;
mod gh_cli;
mod github;
mod identifier_migration;
mod logging;
mod menu;
mod relaunch;
mod secrets;
mod updater;

use std::ffi::OsStr;
use tauri::{Manager, RunEvent, WindowEvent};

/// Agent sandbox runs (docs/testing/tauri-dev-sandbox.md, #623) set `KANDO_SANDBOX_BACKGROUND`. Empty and `0` count as
/// unset, so `KANDO_SANDBOX_BACKGROUND=0` is a way to turn it off. The value is only read by debug builds.
fn background_requested(value: Option<&OsStr>) -> bool {
  value.is_some_and(|v| !v.is_empty() && v != OsStr::new("0"))
}

/// True in a debug build started with `KANDO_SANDBOX_BACKGROUND`: the app must neither activate nor bring a window forward.
fn sandbox_background() -> bool {
  cfg!(debug_assertions) && background_requested(std::env::var_os("KANDO_SANDBOX_BACKGROUND").as_deref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  let context = tauri::generate_context!();

  // Agent sandbox runs (docs/testing/tauri-dev-sandbox.md, #623) must not take the user's focus: tao activates the app at
  // launch unless told otherwise, and no window config can turn that off. Debug builds only, never set in a real run.
  #[cfg(all(target_os = "macos", debug_assertions))]
  let builder = if sandbox_background() {
    builder.activate_ignoring_other_apps(false)
  } else {
    builder
  };

  // Registered first: a second launch hands over to the running instance and exits (#222).
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    // A second sandbox run that reaches this callback (same identifier, same socket) must not show or focus the window
    // of the first one; the recipe gives each run its own identifier, this is the second line of defence (#623).
    if sandbox_background() {
      return;
    }
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.show();
      let _ = window.set_focus();
    }
  }));

  // Driven from Rust only: the capabilities carry no `updater:*` permission, so JS cannot call the plugin (#225).
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

  let app = builder
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(updater::UpdaterState::default())
    .invoke_handler(tauri::generate_handler![
      secrets::secret_set,
      secrets::secret_delete,
      secrets::secret_status,
      secrets::secret_get,
      github::github_request,
      capture::feedback_capture,
      data_file::data_load,
      data_file::data_set,
      data_file::data_flush,
      data_file::data_status,
      data_file::data_init,
      data_file::data_inspect_folder,
      data_file::data_set_location,
      data_file::data_reveal,
      updater::update_check,
      updater::update_install,
      updater::update_state,
      menu::menu_install,
      logging::log_location,
      logging::log_reveal,
      logging::log_tail,
      data_file::data_backup,
      data_file::data_backup_list,
      data_file::data_restore,
      data_file::data_resolve_conflict,
      data_file::data_scan_conflict_copies,
      data_file::data_file_to_backups,
      data_file::data_retry,
      data_file::data_export,
      data_file::data_import_read,
      data_file::data_import_apply,
    ])
    .on_menu_event(menu::on_menu_event)
    .on_window_event(|window, event| {
      match event {
        // Closing the window flushes pending edits; the debounce would otherwise hold them for 400 ms.
        WindowEvent::CloseRequested { .. } => window.state::<data_file::DataFile>().flush_on_exit(false),
        // A change made on another device is usually noticed before the next edit (#224).
        WindowEvent::Focused(true) => window.state::<data_file::DataFile>().poke(),
        _ => {}
      }
    })
    .setup(move |app| {
      // The log first, so the migration can report; then the identifier migration (#42, ADR 019): it must finish before
      // `DataFile` exists and before any command is served, so no call sees the pre-migration data or Keychain.
      app.handle().plugin(logging::plugin())?;
      let dirs = identifier_migration::run(app.handle());
      // The Keychain service follows the identifier the app runs under (a sandbox gets its own, kd#54) and, for `tauri dev`,
      // the migration marker (kd#60), which lives in the config dir: so `Secrets` is managed here, after the migration and
      // before the first command is served.
      let config_dir = app.path().app_config_dir().expect("app config dir");
      let keychain_service = secrets::service_for(cfg!(debug_assertions), &app.config().identifier, &config_dir);
      log::info!("secrets: Keychain service {}", keychain_service);
      // The developer's `gh` login serves the feedback entry only with the opt-in marker in this config dir (#280): a
      // sandboxed run has its own dir, so it can never reach it.
      let gh_cli = gh_cli::GhCli::production(&config_dir);
      log::info!("secrets: developer feedback via gh {}", if gh_cli.enabled() { "on" } else { "off" });
      app.manage(secrets::Secrets::native(&keychain_service).with_gh_cli(gh_cli));
      app.manage(data_file::DataFile::for_app(app.handle(), dirs));
      app.state::<data_file::DataFile>().start_watcher();
      Ok(())
    })
    .build(context)
    .expect("error while building tauri application");

  app.run(|handle, event| match event {
    // Cmd+Q and the last window closing both pass here; Exit is the final word.
    RunEvent::ExitRequested { .. } => handle.state::<data_file::DataFile>().flush_on_exit(false),
    RunEvent::Exit => handle.state::<data_file::DataFile>().flush_on_exit(true),
    _ => {}
  });
}

#[cfg(test)]
mod tests {
  use super::background_requested;
  use std::ffi::OsStr;

  #[test]
  fn background_is_off_when_unset_empty_or_zero() {
    assert!(!background_requested(None));
    assert!(!background_requested(Some(OsStr::new(""))));
    assert!(!background_requested(Some(OsStr::new("0"))));
  }

  #[test]
  fn background_is_on_for_any_other_value() {
    assert!(background_requested(Some(OsStr::new("1"))));
    assert!(background_requested(Some(OsStr::new("true"))));
  }
}
