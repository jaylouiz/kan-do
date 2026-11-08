---
name: desktop-verify
description: Check kan-do desktop (Tauri) behaviour as an agent - render the desktop-only pages (/settings/data, /settings/github) as screenshots through the Tauri stub, or run a sandboxed `tauri dev` smoke run that never touches the user's data folder or Keychain. Use when a desktop change needs screenshots or a real window (Rust behaviour, window events).
---

# Desktop verify

Agents never run `tauri dev` with the real identity `io.github.jaylouiz.kan-do`: it touches the user's data folder and
Keychain (`.claude/hooks/guard-commands.sh` blocks it). Pick the lightest step that answers the question.

## 1. Desktop-only pages (no Tauri)

`/settings/data` and `/settings/github` render through `installTauriStub` at desktop and 390px. The spec is
opt-in, skipped unless `DESKTOP_SHOTS_DIR` is set; never write a throwaway spec for this.

```bash
DESKTOP_SHOTS_DIR=<scratchpad dir> PORT=<free port> npm run test:e2e -- tests/e2e/desktop-pages-shots.spec.ts
```

`DESKTOP_SHOTS_ROUTES=/settings/data` narrows the routes.

## 2. Desktop E2E spec

Most desktop behaviour is answered by a spec with `installTauriStub` (`.claude/rules/desktop.md`).

## 3. Sandboxed `tauri dev` (Rust behaviour, window events)

Only when 1 and 2 cannot answer it. Follow `docs/testing/tauri-dev-sandbox.md` exactly (the source of the
recipe): throwaway `HOME`, identifier `io.github.jaylouiz.kan-do.sandbox-<port>` (own dev server port; the identifier names the single-instance socket, so runs do not hand over to each other), no secret commands,
stop only your own PIDs, then prove the real data folder is untouched.

The user runs the production app on this machine while you work. Two standing rules (#623; the guard hook
blocks the commonest forms of the commands and its message names the way, but it is a guard rail: the rules bind
beyond it):

1. **Never touch the production app.** No `pkill`/`killall` by name, no keystrokes, no `osascript` against it,
   no full-screen `screencapture`. Several processes are named `app` (other workers' windows too): act on a
   process only by PID, after `lsof -a -p <pid> -d cwd` shows your own worktree's `src-tauri`.
2. **Never interrupt the user's other work.** The recipe starts the window invisible and unfocused
   (`visible:false`, `focus:false`, `KANDO_SANDBOX_BACKGROUND=1` so the app does not activate at launch).
   Never `set frontmost`, `activate`, `set_focus()` or `show()`. When a picture of the window is needed, the doc's
   "Capturing the window" section starts it behind everything and captures only that window
   (`screencapture -x -l <window id>`, window id from your verified PID).

A check that needs the frontmost app (the macOS menu bar contents) is skipped: say so in the PR, rely on the
stub tests (`native-menu.spec.ts`) and leave the user a one-line note to look.
