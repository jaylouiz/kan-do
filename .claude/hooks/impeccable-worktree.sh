#!/usr/bin/env bash
# PostToolUse (Edit|Write|Bash) and Stop hook: Impeccable's design hook for files in another checkout of this repository.
#
# The plugin's own hook judges a file only inside $CLAUDE_PROJECT_DIR: a session started in the main checkout that
# edits a worktree (a sibling `git worktree add`, an Orca workspace, `.claude/worktrees/*`) got no per-edit finding
# and no Stop deep pass for it (measured 2026-11-05: silent, nothing recorded). This hook runs the same detector hook
# (the pinned `impeccable` devDependency, `impeccable hook`) inside the file's own checkout, so that checkout's
# DESIGN.md, `.impeccable/config.json` and hook cache apply. For the session's own checkout it does nothing on
# Edit|Write: the plugin hook covers that, and running both would report every finding twice. A Bash call (sed -i, a
# heredoc; #650) never reaches the plugin hook (its matcher is Edit|Write), so there the own checkout is judged here.

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$project_dir" || exit 0
. "$(dirname "$0")/edit-root.sh"

input=$(cat)
event=$(hook_get "$input" hook_event_name)
# Cheap exit first: a Bash call that changed nothing (nearly all of them) must cost two jq (or perl) calls and one git, before the
# checkout root and session id are looked up.
files=""
if [ "$event" = PostToolUse ]; then
  files=$(kando_edited_files "$input")
  [ -n "$files" ] || exit 0
fi
session_id=$(hook_get "$input" session_id)
: "${session_id:=unknown}"
main=$(kando_toplevel "$project_dir")

# run_hook <root> <payload>: Impeccable's hook in <root>; prints its additionalContext, if any.
run_hook() {
  local bin="$1/node_modules/.bin/impeccable"
  [ -x "$bin" ] || bin="$main/node_modules/.bin/impeccable"
  [ -x "$bin" ] || return 0
  (cd "$1" && printf '%s' "$2" | CLAUDE_PROJECT_DIR="$1" "$bin" hook 2>/dev/null) |
    hook_additional_context
}

case "$event" in
  PostToolUse)
    # Edit|Write: one file, other checkouts only (the plugin's own hook covers the session's checkout). Bash (#650): the
    # files a sed/heredoc/script changed; the plugin's hook matches Edit|Write only, so the session's checkout is
    # judged here too.
    tool=$(hook_get "$input" tool_name)
    context=""
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      root=$(kando_edit_root "$project_dir" "$file")
      [ -n "$root" ] || continue
      if [ "$root" != "$main" ]; then
        kando_record_root "$session_id" "$root"
      elif [ "$tool" != Bash ]; then
        continue
      fi
      part=$(run_hook "$root" "$(hook_retarget "$input" "$root" "$file")")
      [ -n "$part" ] && context="${context:+$context
}$part"
    done < <(printf '%s\n' "$files" | sort -u)
    ;;
  Stop)
    context=""
    while IFS= read -r root; do
      [ -n "$root" ] && [ "$root" != "$main" ] && [ -d "$root" ] || continue
      part=$(run_hook "$root" "$(hook_retarget "$input" "$root")")
      [ -n "$part" ] && context="${context:+$context

}[worktree $root]
$part"
    done < <(kando_recorded_roots "$session_id")
    ;;
  *) exit 0 ;;
esac

[ -n "$context" ] || exit 0
hook_context_json "$event" "$context"
exit 0
