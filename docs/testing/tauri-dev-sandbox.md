# Sandboxed `tauri dev` smoke run (agents)

A plain `npm run tauri:dev` carries the real app identity `io.github.jaylouiz.kan-do`, and as a debug build it works on the installed app's real data: before a release has migrated, the legacy data folder `com.julius.kan-do` (its `data-location.json` included) and the legacy Keychain service `com.julius.kan-do`; after it (the marker `identifier-migration.json` in the new folder says so), the folder and Keychain service named after the new identifier, like the installed app (ADR 019 D8, #60). A worker run can change the user's first-run import state or write their data. **Agents never run `tauri dev` with the real identity.** Use this recipe, and only when a desktop E2E spec with `installTauriStub` cannot answer the question (Rust behaviour, window events).

## Standing rules (#623)

The user works in an installed production build of kan-do on the same machine, next to other workers' sandboxed windows. `.claude/hooks/guard-commands.sh` blocks the commonest forms of the commands below (`pkill`/`killall` by name, `osascript` with `frontmost`/`activate`/keystrokes or a System Events process picked by name, bare `screencapture`); it is a guard rail, not a sandbox, and its message names the allowed way. The rest is on you.

1. **Never touch the production instance.** No `pkill`/`killall` by name, no keystrokes, no AppleScript, `tell application "kan-do"` or `open -a` against it (the guard does not catch those), no full-screen screenshot (it shows private windows). Several processes are named `app` (other workers' `tauri dev` windows, the production app), so `System Events` selectors such as `first process whose name is "app"` can hit the wrong one. Select a process only by PID, after `lsof -a -p <pid> -d cwd` shows your own worktree's `src-tauri`.
2. **A sandbox run must not interrupt the user's other work.** No focus stealing (`set frontmost`, `activate`), no visible window (the recipe below starts it invisible and without activating the app), no full-screen `screencapture`. A check that needs the window frontmost (macOS menu bar contents: the Accessibility menu reads only work on the frontmost app) is skipped: say so in the PR, rely on unit and stub tests (`native-menu.spec.ts`), and leave the user a note to look.

## Desktop-only pages without Tauri

To look at `/settings/data` or `/settings/github` (screenshots at desktop and 390px) you rarely need a real window: `tests/e2e/desktop-pages-shots.spec.ts` renders them through `installTauriStub` (no data folder, no Keychain). It is opt-in: the spec is skipped unless `DESKTOP_SHOTS_DIR` is set, as in the command below.

```bash
DESKTOP_SHOTS_DIR=<scratchpad dir> PORT=3101 npm run test:e2e -- tests/e2e/desktop-pages-shots.spec.ts
```

`DESKTOP_SHOTS_ROUTES=/settings/data` narrows the routes. Pass options such as a status or a conflict by extending the spec's `installTauriStub` call. The Impeccable rendered scan needs the stub in the page, so it cannot point at a plain dev-server URL for these routes; use the screenshots and the source scan.

## What is isolated

- `app_config_dir` / `app_data_dir` derive from the bundle identifier and `HOME` (`src-tauri/src/data_file.rs`), so `HOME=<tmp>` plus the identifier override puts `data-location.json`, `kan-do-data.json` and `backups/` under `<tmp>/Library/Application Support/io.github.jaylouiz.kan-do.sandbox-<port>`.
- The single-instance socket is `/tmp/<identifier>_si.sock`, so it follows the identifier and not `HOME`. Two runs with the same identifier would share it: the second hands over to the first and exits. The identifier therefore carries the run's dev-server port (`…sandbox-3101`), and every worker uses its own port.
- The Keychain service follows the identifier (`secrets::service_for`, kd#54): a debug build with the production identifier uses the legacy service `com.julius.kan-do` until the release's Keychain step is over (the marker says `secrets: done`) and `secrets::SERVICE` afterwards (the installed app's tokens: only the user's own `tauri dev` does that), a release build `secrets::SERVICE`, and any other identifier is its own service. A `…sandbox-<port>` run therefore reads and writes only `io.github.jaylouiz.kan-do.sandbox-<port>`, which holds no real entry; its log shows `secrets: Keychain service io.github.jaylouiz.kan-do.sandbox-<port>`. Do not run secret commands in a sandbox: under the throwaway `HOME` there is no default Keychain (a write fails or opens a focus-taking dialog), and an entry a rebuilt binary finds again prompts (the ACL is bound to the code signature, ADR 007). The start-up migration from the legacy identifier (#42) moves Keychain entries only when the running identifier is the production one in a release build (a debug build with it skips both steps and only reads the marker to choose the legacy or the new folder and Keychain service), so a `…sandbox-<port>` run skips that step and logs `Keychain step skipped`; its data step does run (see "Seeding a legacy folder").

## Recipe

```bash
REAL_HOME="$HOME"
PORT=3101                                    # your own free port: it also names the sandbox identifier (separate single-instance socket)
SANDBOX="$(mktemp -d)"                       # throwaway HOME, delete afterwards
for ID in io.github.jaylouiz.kan-do com.julius.kan-do; do find "$REAL_HOME/Library/Application Support/$ID" -type f -exec shasum {} \; ; done > "$SANDBOX/before.txt" 2>/dev/null

# 1. Own dev server on a free port (Bash tool: run_in_background), never the user's :3000
PORT=$PORT npm run dev

# 2. The window as invisible and unfocused: the real window config with `visible`/`focus` off (a --config array replaces the whole array)
node -e 'const c=require("./src-tauri/tauri.conf.json");require("fs").writeFileSync(process.argv[1],JSON.stringify({app:{windows:c.app.windows.map(w=>({...w,visible:false,focus:false}))}}))' "$SANDBOX/window.json"

# 3. Tauri against that server, own identity, no beforeDevCommand (step 1 is the server), no app activation
KANDO_SANDBOX_BACKGROUND=1 HOME="${SANDBOX:?}" CARGO_HOME="$REAL_HOME/.cargo" RUSTUP_HOME="$REAL_HOME/.rustup" \
  "$REAL_HOME/.cargo/bin/cargo" tauri dev --no-dev-server-wait \
  --config "{\"identifier\":\"io.github.jaylouiz.kan-do.sandbox-$PORT\",\"build\":{\"devUrl\":\"http://localhost:$PORT\",\"beforeDevCommand\":\"\"}}" \
  --config "$SANDBOX/window.json"
```

Notes:

- `CARGO_HOME` / `RUSTUP_HOME` stay pinned to the real toolchain (otherwise the sandbox `HOME` has no Rust and re-downloads it). `npm run tauri:dev` hardcodes `~/.cargo/bin/cargo` and does not take `--config`, so call cargo directly.
- The first build in a fresh worktree compiles all crates (minutes).
- Start the process with the Bash tool's `run_in_background`; never `nohup` or `( … & )`.
- **No activation:** tao activates the app at launch (`activateIgnoringOtherApps(true)`) and no window config turns that off. `KANDO_SANDBOX_BACKGROUND=1` makes `src-tauri/src/lib.rs` call `activate_ignoring_other_apps(false)` (macOS debug builds only; the release build never reads it), so the app activates only if no other app is active. Together with `visible: false` the run shows nothing and takes no focus. Do not call `window.set_focus()` or `show()` from a check; that activates the app regardless. With the opt-in set, the single-instance callback (`lib.rs`) also skips its `show()`/`set_focus()`, so a second launch that does reach it (same identifier) cannot bring the window forward.
- **Invisible window:** the webview still loads from the dev server and Rust runs (logs under `$SANDBOX/Library/Logs/io.github.jaylouiz.kan-do.sandbox-$PORT`). It cannot be captured: `screencapture -l` needs an on-screen window.

## Seeding a legacy folder (identifier migration, #42)

To watch the start-up migration copy an old install, create the legacy folder in the **sandbox** `HOME` before step 3 (never the real one):

```bash
LEGACY="$SANDBOX/Library/Application Support/com.julius.kan-do"
mkdir -p "$LEGACY/backups"
cp <a fixture kan-do-data.json> "$LEGACY/"                       # e.g. the file a `?seed=local` desktop session wrote, or a hand-made envelope
printf '{"folder":"%s","deviceId":"sandbox-device"}' "$LEGACY" > "$LEGACY/data-location.json"
find "$LEGACY" -type f -exec shasum {} \; > "$SANDBOX/legacy-before.txt"
```

After the run: `find "$LEGACY" -type f -exec shasum {} \; | diff "$SANDBOX/legacy-before.txt" -` must be empty (the legacy folder is never written), the new `$SANDBOX/Library/Application Support/io.github.jaylouiz.kan-do.sandbox-$PORT` holds the same files (pointer rewritten to the new folder, `deviceId` unchanged) plus `identifier-migration.json` with `"data": "done"`, and `$SANDBOX/Library/Logs/io.github.jaylouiz.kan-do.sandbox-$PORT/kan-do.log` contains `data copied from the legacy folder and verified` and `Keychain step skipped`.

## Capturing the window (only when a picture is needed)

Start the window on screen but behind everything else and unfocused: replace `visible:false` with `visible:true,alwaysOnBottom:true` in step 2 (keep `focus:false` and `KANDO_SANDBOX_BACKGROUND=1`). Find the PID of your own process, verify it, then capture that window only:

```bash
pgrep -f 'target/debug/app'                                  # candidates: yours, other workers', never assume one
lsof -a -p <pid> -d cwd                                       # cwd must be YOUR worktree's src-tauri; otherwise it is not yours
swift -e 'import CoreGraphics; let pid = Int(CommandLine.arguments[1])!; for w in CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]] where (w[kCGWindowOwnerPID as String] as? Int) == pid { let b = w[kCGWindowBounds as String] as! [String: Any]; print(w[kCGWindowNumber as String]!, "layer", w[kCGWindowLayer as String]!, "width", b["Width"]!, "height", b["Height"]!) }' <pid>
screencapture -x -l <window id> "<scratchpad>/window.png"     # -l: this window only, even when covered; never a bare screencapture
```

The list is filtered by PID only, not by layer: the `alwaysOnBottom` window sits at layer -1 (tao `BelowNormalWindowLevel`), a `kCGWindowLayer == 0` filter would print nothing. Take the id of the large window (the app's main window, ignore tiny ones).

Never `screencapture` without `-l <id>` (or `-R` for a region you know is yours), and never ask the window to come forward.

## Stopping only your own process

```bash
lsof -ti tcp:$PORT -sTCP:LISTEN | xargs kill      # your dev server: the PORT of the recipe above, never another worker's port
# the tauri window: kill by the PID of the process you started
pgrep -f 'target/debug/app'                       # candidates: yours, other workers', the production app is not among them
lsof -a -p <pid> -d cwd                           # cwd must be YOUR worktree's src-tauri
kill <pid>
```

Never `pkill -f nuxt`, `pkill -f target/debug/app`, `killall app` or `kill $(pgrep -f target/debug/app)`: they hit the user's own `:3000` server and running app (the guard blocks them).

## Check that nothing real changed

```bash
for ID in io.github.jaylouiz.kan-do com.julius.kan-do; do find "$REAL_HOME/Library/Application Support/$ID" -type f -exec shasum {} \; ; done 2>/dev/null | diff "$SANDBOX/before.txt" - && echo untouched
ls "$SANDBOX/Library/Application Support/"      # io.github.jaylouiz.kan-do.sandbox-<port> appears here
```

## Stub drift

The E2E stub (`tests/e2e/helpers/tauriStub.ts`) is checked against `generate_handler![...]` by `tests/config/tauri-stub-contract.test.ts`: a new Rust command fails that test until the stub answers it (or it is listed with a reason in the test's `UNSTUBBED`).

## Verified

Run for #623 (macOS, Tauri 2.12; the recipe then still used the identifier `com.julius.kan-do.sandbox` without the port): with the recipe's invisible window and `KANDO_SANDBOX_BACKGROUND=1` the front application (`lsappinfo front`) was identical before the launch and ten seconds after it, the process's windows reported not on screen, and the real data folder's shasums were unchanged. Without `KANDO_SANDBOX_BACKGROUND` tao activates the app at launch (source: `tao` `app_state.rs`, `launched`), which was not run on purpose. The `alwaysOnBottom` capture variant (visible window, unfocused, behind others) was not run: it would show a window on the user's screen; whoever needs it first should check `lsappinfo front` before and after. Its window-id line was corrected from reading tao's source (`always_on_bottom` sets level -1) and checked only against another process's windows (`pgrep -x Finder`): the line printed ids with layers 0 and -2147483603, so a `layer == 0` filter drops windows; the per-port identifier and the single-instance callback guard are covered by the Rust unit tests for the opt-in parsing, not by a live second launch.

Run once for #256 (macOS): the app started under `HOME=<tmp>` with `Library/Logs/com.julius.kan-do.sandbox` and `Library/Caches/com.julius.kan-do.sandbox` created in the sandbox; shasums of every file in `~/Library/Application Support/com.julius.kan-do` (including `data-location.json`) were identical before and after.
