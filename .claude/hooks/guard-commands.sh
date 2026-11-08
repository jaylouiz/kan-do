#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash): blocks the zero-exception commands that used to be prose in CLAUDE.md (#387).
# Exit 2 with a one-line reason that names the allowed alternative; everything else exits 0 untouched.
#   - `pkill` of nuxt                  -> stop your own server by its port's PID
#   - `tauri dev` with the real app identity (npm run tauri:dev, cargo tauri dev, tauri dev) -> sandbox recipe
#   - `npm run release` without --dry-run, `gh workflow run release` -> --dry-run only, /prepare-release
#   - `npm install|i|ci` (and `npx npm@<other version> install`) -> `npx npm@11.19.0 install`
#   - `npm run terms:approve` (also `run-script`, `-s|--silent` before or after `run`), `node scripts/copy-terms.mjs approve`
#                                       -> only the user approves decided UI terms (#472)
#   - `osascript` that sets `frontmost`/`activate`s, sends `keystroke`/`key code`, or picks a System Events process
#     other than by `unix id`; a bare full-screen `screencapture` (no `-l`/`-R`); `pkill`/`killall` of the desktop app by name,
#     `kill $(pgrep ...)` (#629)
#                                       -> never touch the user's production app or steal focus (#623)
# Only real invocations count (start of a command segment, optionally behind VAR=val words): separators inside
# quotes and heredoc bodies are neutralised first, so a commit message or comment naming a command passes.
# The analysis is a perl program in its own file next to this hook (guard-commands.pl, #654), so no shell quoting limits what it may contain.
# Not a sandbox: it guards Claude's accidental direct calls, not wrappers (`bash -c`, `xargs`, `cargo +stable`,
# flags before the subcommand such as `npm --silent install`; only `terms:approve` unwraps npm flags and `run-script`). Accepted trade-off: wrappers are not unwrapped.

input=$(cat)
# shellcheck source=hook-input.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-input.sh"
shopt -s nocasematch
if ! cmd=$(hook_command "$input"); then
  # Neither jq nor perl's JSON::PP could read the input (kd#2): block anything the guard's own pre-filter would look at.
  case "$input" in
    *pkill*|*killall*|*pgrep*|*tauri*|*release*|*npm*|*copy-terms*|*osascript*|*screencapture*)
      echo "guard-commands: cannot read the hook input (no working jq, and perl's JSON::PP failed), and it may hold a guarded command. Install jq (brew install jq), then retry." >&2
      exit 2 ;;
  esac
  exit 0
fi
case "$cmd" in
  *pkill*|*killall*|*pgrep*|*tauri*|*release*|*npm*|*copy-terms*|*osascript*|*screencapture*) ;;
  *) exit 0 ;;
esac

parser="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/guard-commands.pl"
# A missing or broken analysis file must not switch every protection off silently: perl exits non-zero then (code review of #671).
# Its stderr is kept apart from the reason: a harmless warning (locale) on a successful run must not block anything.
errfile=$(mktemp)
reason=$(printf '%s' "$cmd" | perl -0777 -n "$parser" 2>"$errfile") || {
  echo "guard-commands: perl failed on $parser (file missing, not valid perl, or it died on this command): $(cat "$errfile")" >&2
  rm -f "$errfile"
  exit 2
}
rm -f "$errfile"

[ -z "$reason" ] && exit 0
echo "guard-commands: $reason" >&2
exit 2
