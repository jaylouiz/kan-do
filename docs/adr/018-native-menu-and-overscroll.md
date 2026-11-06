# ADR 018: Native macOS menu bar, no overscroll bounce and no separate title bar in the desktop app

## Status

Accepted (#614; decisions D1, D2 and D3 on #614). The ADR number was taken as the next free one on `main` and may be renumbered at merge.

## Context

The desktop app (Tauri) showed Tauri's built-in English menu (no Settings entry, no app actions), the web view rubber-banded past the top and bottom of every page, and a separate title bar sat above the app bar. All three read as "a wrapped web page" in an installed Mac app.

## Decision

- **The menu is built in Rust, titled by the web app.** `src-tauri/src/menu.rs` builds the menu with `tauri::menu` (no new crate) when the web app calls `menu_install(labels)`. The labels are the i18n keys `menu.*` (`de.json`, `en.json`), so the menu follows the in-app locale (`?lang`, stored, navigator, `de`) and no copy lives in Rust. The call happens after the locale is resolved and again when it changes (`composables/useNativeMenu.ts`, mounted in `app.vue`). Rejected: a menu from the JS menu API (JS would need `core:menu:*` permissions, clicks arrive over Channels, the E2E stub could not fake it) and a Rust-only DE/EN table keyed by system language (breaks the i18n policy, ignores the in-app locale).
- **Predefined items stay native.** About, Services, Hide, Hide Others, Show All, Quit, Undo/Redo/Cut/Copy/Paste/Select All, Full Screen, Minimize, Zoom and Close Window use Tauri's `PredefinedMenuItem` with translated titles, so Cmd+Q still reaches `RunEvent::ExitRequested` (data flush) and text fields keep their editing commands. Window and Help carry `WINDOW_SUBMENU_ID` / `HELP_SUBMENU_ID` so macOS adds the window list and the help search.
- **A click is one event.** Custom items (`app.settings`, `app.new-task`, ... in `MENU_ACTIONS`) emit `menu://action` with their id; only whitelisted ids are forwarded. `lib/nativeMenu.ts` maps the id to an action the app already has (routes, `useAppUpdater`, `useDayClose`, `useFeedback`, `useWhatsNew`); dialog items do nothing while another dialog is open, and the day-close and feedback items go to the board first because `pages/tasks.vue` mounts those dialogs. `tests/config/native-menu-contract.test.ts` keeps the Rust and TypeScript lists in step. No accelerator duplicates a web shortcut (Cmd+K stays in the palette).
- **No bounce through CSS, scoped to the desktop.** `plugins/desktop-shell.client.ts` sets `<html data-shell="desktop">` when `isTauri()`; `assets/css/utilities.css` sets `overscroll-behavior: none` on it and on every descendant (the property is not inherited). The web build keeps the browser's scrolling. Fallback if a real window still bounces: native scroll elasticity off through `objc2-app-kit` (not built; a later decision).
- **The title bar is an overlay (D3).** `tauri.conf.json` sets `titleBarStyle: "Overlay"`, `hiddenTitle: true` and `trafficLightPosition` (x 20, y 30) so the real traffic lights sit in the 3.5rem app bar row, level with the pills; the pill group is centred and clear of them at the 800px minimum width, so no inset is added, and fullscreen (lights hidden) needs no layout change. The `.titlebar` strip in `app.vue` becomes the drag area: fixed, the height of the bar row, `data-tauri-drag-region`, below the bar so the pills stay clickable and present on routes without the bar. Tauri 2 ignores `-webkit-app-region`, so the capability adds `core:window:allow-start-dragging` (the double-click zoom of the drag script calls `internal_toggle_maximize`, already in `core:default`). Overlay scrims cover the strip, so `plugins/desktop-shell.client.ts` starts the drag itself on a press on a scrim inside the bar row (`lib/windowDrag.ts`); the desktop-only welcome notice starts below the bar row. `tests/config/tauri-window-chrome.test.ts` guards config and permissions. Rejected: `decorations: false` with custom window buttons (fake controls, no native fullscreen behaviour, much more code). Other platforms keep their native bar (the options are macOS-only).

## Consequences

- For the first moments after launch macOS shows Tauri's English default menu, until the web app has installed its own (accepted, see the alternatives above).
- Non-macOS targets keep Tauri's default menu and native title bar; `menu_install` is a no-op there.
- Content scrolled under the transparent bar row is not clickable there, because the drag strip covers the row (as under any sticky header).
- A new custom item needs an id in `MENU_ACTIONS` and `MENU_ACTION_IDS`, a handler and, for a new title, a `MenuLabels` field plus a `menu.*` key in both locales.
- No data model or persisted-shape change; no capability or CSP change.
