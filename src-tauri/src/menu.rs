//! Native macOS menu bar (#614). Tauri's default menu is English-only and has no Settings entry, so the
//! web app installs its own once it knows the locale: `menu_install` receives the translated labels
//! (i18n keys `menu.*`, so the menu follows the in-app locale), builds the menu and swaps it in. A click on
//! a custom item is forwarded as the event `menu://action` with the item id; the web app maps the id to an
//! action it already has (`composables/useNativeMenu.ts`). Predefined items (Hide, Quit, Edit, ...) stay
//! native, so Cmd+Q still reaches `RunEvent::ExitRequested` (data flush) and text fields keep Undo/Copy/Paste.
//!
//! Only the ids in `MENU_ACTIONS` are ever forwarded; `tests/config/native-menu-contract.test.ts` keeps the
//! list in step with the TypeScript handler map.

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Runtime};

/// Event the web app listens to; the payload is one id of `MENU_ACTIONS`.
pub const MENU_ACTION_EVENT: &str = "menu://action";

/// Custom (non-predefined) menu item ids. Prefix `app.` keeps them apart from predefined ids.
pub const MENU_ACTIONS: &[&str] = &[
  "app.check-updates",
  "app.settings",
  "app.new-task",
  "app.day-close",
  "app.go-today",
  "app.go-statistics",
  "app.go-trash",
  "app.feedback",
  "app.whats-new",
];

/// The translated titles, one per menu entry (camelCase on the wire, i18n `menu.*` on the web side).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct MenuLabels {
  pub app: String,
  pub about: String,
  pub check_updates: String,
  pub settings: String,
  pub services: String,
  pub hide: String,
  pub hide_others: String,
  pub show_all: String,
  pub quit: String,
  pub file: String,
  pub new_task: String,
  pub day_close: String,
  pub close_window: String,
  pub edit: String,
  pub undo: String,
  pub redo: String,
  pub cut: String,
  pub copy: String,
  pub paste: String,
  pub select_all: String,
  pub view: String,
  pub today: String,
  pub statistics: String,
  pub trash: String,
  pub fullscreen: String,
  pub window: String,
  pub minimize: String,
  pub zoom: String,
  pub help: String,
  pub feedback: String,
  pub whats_new: String,
}

/// The id to forward for a clicked item, or None for anything outside the whitelist.
pub fn action_id(menu_id: &str) -> Option<&'static str> {
  MENU_ACTIONS.iter().copied().find(|id| *id == menu_id)
}

/// `Builder::on_menu_event` handler: forwards whitelisted custom ids to the web app.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
  if let Some(id) = action_id(event.id().as_ref()) {
    let _ = app.emit(MENU_ACTION_EVENT, id);
  }
}

/// Replaces the app menu with the one in `labels`. macOS only: other targets keep Tauri's default menu.
#[tauri::command]
pub fn menu_install<R: Runtime>(app: AppHandle<R>, labels: MenuLabels) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let menu = build(&app, &labels).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (&app, &labels);
  }
  Ok(())
}

#[cfg(target_os = "macos")]
fn build<R: Runtime>(app: &AppHandle<R>, l: &MenuLabels) -> tauri::Result<tauri::menu::Menu<R>> {
  use tauri::menu::{
    AboutMetadata, Menu, MenuItem, PredefinedMenuItem as P, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
  };

  let item = |id: &str, text: &str, accel: Option<&str>| MenuItem::with_id(app, id, text, true, accel);
  let pkg = app.package_info();
  let about_metadata = AboutMetadata {
    name: Some(pkg.name.clone()),
    version: Some(pkg.version.to_string()),
    ..Default::default()
  };

  let app_menu = Submenu::with_items(
    app,
    &l.app,
    true,
    &[
      &P::about(app, Some(&l.about), Some(about_metadata))?,
      &item("app.check-updates", &l.check_updates, None)?,
      &P::separator(app)?,
      &item("app.settings", &l.settings, Some("CmdOrCtrl+,"))?,
      &P::separator(app)?,
      &P::services(app, Some(&l.services))?,
      &P::separator(app)?,
      &P::hide(app, Some(&l.hide))?,
      &P::hide_others(app, Some(&l.hide_others))?,
      &P::show_all(app, Some(&l.show_all))?,
      &P::separator(app)?,
      &P::quit(app, Some(&l.quit))?,
    ],
  )?;
  let file_menu = Submenu::with_items(
    app,
    &l.file,
    true,
    &[
      &item("app.new-task", &l.new_task, Some("CmdOrCtrl+N"))?,
      &item("app.day-close", &l.day_close, None)?,
      &P::separator(app)?,
      &P::close_window(app, Some(&l.close_window))?,
    ],
  )?;
  let edit_menu = Submenu::with_items(
    app,
    &l.edit,
    true,
    &[
      &P::undo(app, Some(&l.undo))?,
      &P::redo(app, Some(&l.redo))?,
      &P::separator(app)?,
      &P::cut(app, Some(&l.cut))?,
      &P::copy(app, Some(&l.copy))?,
      &P::paste(app, Some(&l.paste))?,
      &P::select_all(app, Some(&l.select_all))?,
    ],
  )?;
  let view_menu = Submenu::with_items(
    app,
    &l.view,
    true,
    &[
      &item("app.go-today", &l.today, Some("CmdOrCtrl+1"))?,
      &item("app.go-statistics", &l.statistics, Some("CmdOrCtrl+2"))?,
      &item("app.go-trash", &l.trash, Some("CmdOrCtrl+3"))?,
      &P::separator(app)?,
      &P::fullscreen(app, Some(&l.fullscreen))?,
    ],
  )?;
  // The ids make macOS treat these as the Window and Help menus (window list, help search).
  let window_menu = Submenu::with_id_and_items(
    app,
    WINDOW_SUBMENU_ID,
    &l.window,
    true,
    &[&P::minimize(app, Some(&l.minimize))?, &P::maximize(app, Some(&l.zoom))?],
  )?;
  let help_menu = Submenu::with_id_and_items(
    app,
    HELP_SUBMENU_ID,
    &l.help,
    true,
    &[&item("app.feedback", &l.feedback, None)?, &item("app.whats-new", &l.whats_new, None)?],
  )?;

  Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn forwards_only_whitelisted_ids() {
    assert_eq!(action_id("app.settings"), Some("app.settings"));
    assert_eq!(action_id("app.unknown"), None);
    assert_eq!(action_id("settings"), None);
    assert_eq!(action_id(""), None);
    // Predefined items carry system ids; they must never be forwarded.
    assert_eq!(action_id("quit"), None);
  }

  #[test]
  fn ids_are_prefixed_and_unique() {
    let mut seen = std::collections::HashSet::new();
    for id in MENU_ACTIONS {
      assert!(id.starts_with("app."), "{id} lacks the app. prefix");
      assert!(seen.insert(*id), "{id} is listed twice");
    }
  }

  fn labels_json(skip: Option<&str>) -> String {
    let fields = [
      "app", "about", "checkUpdates", "settings", "services", "hide", "hideOthers", "showAll", "quit", "file",
      "newTask", "dayClose", "closeWindow", "edit", "undo", "redo", "cut", "copy", "paste", "selectAll", "view",
      "today", "statistics", "trash", "fullscreen", "window", "minimize", "zoom", "help", "feedback", "whatsNew",
    ];
    let body: Vec<String> =
      fields.iter().filter(|f| Some(**f) != skip).map(|f| format!("\"{f}\":\"{f}\"")).collect();
    format!("{{{}}}", body.join(","))
  }

  #[test]
  fn labels_deserialize_from_camel_case() {
    let labels: MenuLabels = serde_json::from_str(&labels_json(None)).expect("all fields present");
    assert_eq!(labels.check_updates, "checkUpdates");
    assert_eq!(labels.whats_new, "whatsNew");
  }

  #[test]
  fn a_missing_label_is_an_error_not_an_empty_title() {
    assert!(serde_json::from_str::<MenuLabels>(&labels_json(Some("quit"))).is_err());
  }
}
