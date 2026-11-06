---
paths:
  - "src-tauri/**"
  - "tests/e2e/helpers/tauriStub.ts"
  - "tests/e2e/{desktop-*,feedback*,data-safety,data-settings,github-settings,settings-github-link,updates,whats-new}.spec.ts"
  - "tests/config/{tauri-*,csp-*}.test.ts"
  - "lib/feedback/**"
  - "components/feedback/**"
  - "composables/useFeedback.ts"
  - "composables/useElementPicker.ts"
  - "composables/useScreenshotCapture.ts"
  - "lib/dataBackendTauri.ts"
  - "app.vue"
  - "lib/nativeMenu.ts"
  - "composables/useNativeMenu.ts"
  - "plugins/desktop-shell.client.ts"
---
# Desktop (Tauri) rules: desktop E2E stub, CSP, in-app feedback

Running the desktop app or rendering desktop-only pages: the `desktop-verify` skill. Data file and `cargo test`: `.claude/rules/persistence.md`.

- **Desktop (Tauri) E2E**: specs fake IPC via `tests/e2e/helpers/tauriStub.ts` (`mockIPC` cannot run in `addInitScript`); `installTauriStub` fakes the `data_*` commands, no real file; a desktop spec that needs a board puts it into the stub's data envelope, which wins over seeded localStorage. Keep the stub in step with the Rust commands it fakes; `tests/config/tauri-stub-contract.test.ts` fails when a command in `generate_handler![...]` has no stub branch.
- Desktop CSP (`docs/adr/012-desktop-csp.md`): a new host the *webview* calls needs a `connect-src` entry in `csp` and `devCsp` (plus `capabilities/default.json` when it goes through the http plugin) and a `tests/config/tauri-csp.test.ts` update; GitHub and release hosts are Rust-side and must stay out. CSP breakage shows only in the built bundle.
- In-app feedback (desktop, #227): palette "Feedback senden" → `FeedbackDialog` + element picker (`useFeedback`, `useElementPicker`, `lib/feedback/`); sends through `github_request` only, memory-only draft, component names from the `data-component` marker plugin; optional screenshot (#247): native `feedback_capture` (`src-tauri/src/capture.rs`) → `useScreenshotCapture` (mask `[data-private]` for the capture only) → `FeedbackAnnotator` canvas → upload to the orphan `feedback-assets` branch; Rust pins the feedback token's writes to issues and that branch — see `docs/adr/010-in-app-feedback.md` and `docs/adr/014-feedback-screenshots.md`.
- **Native menu bar and overscroll** (#614, `docs/adr/018-native-menu-and-overscroll.md`): macOS menu from `src-tauri/src/menu.rs` (`menu_install(labels)`, labels = i18n `menu.*`, custom clicks as the event `menu://action`), mapped in `lib/nativeMenu.ts` / `composables/useNativeMenu.ts`; a new item needs its id in Rust `MENU_ACTIONS` and `MENU_ACTION_IDS` (`tests/config/native-menu-contract.test.ts`) and must not take a shortcut the web app handles. Desktop-only CSS keys on `html[data-shell="desktop"]` (`plugins/desktop-shell.client.ts`). The window has no title bar (`titleBarStyle: Overlay`, traffic lights in the app bar row); the `.titlebar` strip in `app.vue` is the drag area and needs `data-tauri-drag-region` plus the `core:window:allow-start-dragging` permission (`tests/config/tauri-window-chrome.test.ts`); full-screen layers cover the strip, so a press in the bar row on a Nuxt UI scrim (`data-slot="overlay"`) or on the empty area of a custom layer marked `data-window-drag-layer` (NewDayRecap; set it on any new full-screen layer) starts the drag from `plugins/desktop-shell.client.ts` (`lib/windowDrag.ts`), and desktop content must not sit in that row under the strip (the welcome notice starts below it). `native-menu.spec.ts` plays `menu://action` through `emitTauriEvent`; the real menu bar contents need a frontmost window, so they stay a manual check.
