# Sourced by the per-edit and Stop hooks (eslint-file.sh, impeccable-worktree.sh, verify.sh): which checkout an
# edited file belongs to. A session started in the main checkout that edits a worktree of the same repository (a
# sibling `git worktree add ../x`, an Orca workspace, `.claude/worktrees/*`) got no lint, no Impeccable design hook
# and no Stop verification for it, because every hook keyed on $CLAUDE_PROJECT_DIR. Now each hook works in the
# file's own checkout, and the Stop hook verifies every checkout the session edited.

# Hook input is read through hook-input.sh (jq, else perl; kd#9), for this file and for every hook that sources it.
# shellcheck source=hook-input.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-input.sh"

# kando_toplevel <dir>: the checkout root of <dir>, or nothing.
kando_toplevel() { git -C "$1" rev-parse --show-toplevel 2>/dev/null; }

# kando_edit_root <project_dir> <file>: the checkout of this repository that holds <file> (the main checkout or one of
# its worktrees), or nothing for a file outside the repository.
kando_edit_root() {
  local dir root common project_common
  dir=$(dirname "$2")
  while [ ! -d "$dir" ] && [ "$dir" != / ]; do dir=$(dirname "$dir"); done
  root=$(kando_toplevel "$dir") || return 0
  [ -n "$root" ] || return 0
  common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  project_common=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  [ "$common" = "$project_common" ] && printf '%s\n' "$root"
  return 0
}

# Checkouts other than the session's own that this session edited, one per line.
kando_roots_file() { printf '%s/kando-roots-%s\n' "${TMPDIR:-/tmp}" "${1:-unknown}"; }
# Check-then-append is not atomic (two PostToolUse hooks record the same root at once), so duplicates are possible in
# the file and removed on read.
kando_record_root() {
  local file
  file=$(kando_roots_file "$1")
  grep -qxF "$2" "$file" 2>/dev/null || printf '%s\n' "$2" >>"$file"
}
kando_recorded_roots() { [ -f "$(kando_roots_file "$1")" ] && sort -u "$(kando_roots_file "$1")"; return 0; }

# --- Files an Edit, Write or Bash tool call changed (#650) ---------------------------------------------------------
# `PostToolUse` matching `Edit|Write` never fires for `sed -i`, a heredoc or a script run through Bash, so the per-edit
# hooks are also registered for `Bash` and ask here which files the command touched. `FileChanged` cannot do this job:
# it has no channel back to Claude (exit 2 reaches the user only) and watches literal filenames in the working
# directory. `tool_response.bashEditDiff` is best effort, public beta and recorded in every permission mode only with
# the user-level `bashEditDiffEnabled`, so it is used when present and an mtime scan covers the rest.

KANDO_BASH_EDIT_CAP=40
# Commands that move the working tree rewrite files nobody authored: no lint --fix on those.
KANDO_TREE_MOVING_RE='(^|[;&|({[:space:]])git[[:space:]]+(-[Cc][[:space:]]+[^[:space:]]+[[:space:]]+|-[^[:space:]]+[[:space:]]+)*(checkout|switch|pull|merge|rebase|stash|reset|restore|cherry-pick|revert|clone|worktree)([[:space:]]|$)'

# kando_mtime <file>: modification time in epoch seconds (GNU stat, then BSD stat). GNU first: GNU `stat -f %m` is a
# valid filesystem query that prints `?` and exits 0, so a BSD-first chain never reached the GNU form on Linux (CI).
kando_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }

# kando_checkable_ext <file>: success for a source file the per-edit hooks check.
kando_checkable_ext() {
  case "$1" in
    *.vue | *.ts | *.mjs | *.js | *.css) ;;
    *) return 1 ;;
  esac
  case "$1" in
    */node_modules/* | */.nuxt/* | */.output/* | */dist/* | */src-tauri/*) return 1 ;;
  esac
  return 0
}

# kando_bash_changed_files <payload> <state> <cwd> <duration_ms>: the checkable files a Bash call changed; nothing on
# any doubt. <state> (skip|none|diff|...) and the rest come from the single hook_fields call of kando_edited_files.
# Hot path (every Bash call, two hooks, nearly always nothing changed): no process beyond that one jq and one
# `git ls-files`. `-- :/` lists the whole checkout but prints paths relative to <cwd> (`../x` outside it), so neither
# `rev-parse --show-toplevel` nor the command text is needed until a candidate exists.
kando_bash_changed_files() {
  local input=$1 state=$2 cwd=$3 dur=$4 cmd now window f m list
  case "$state" in
    skip) return 0 ;;
    diff)
      list=$(hook_changed_files "$input")
      ;;
    *)
      # No diff recorded: dirty files of the command's checkout whose mtime lies inside the command's run.
      [ -d "$cwd" ] || return 0
      case "$dur" in '' | *[!0-9]*) window=10 ;; *) window=$((dur / 1000 + 3)) ;; esac
      now=""
      list=""
      while IFS= read -r -d '' f; do
        kando_checkable_ext "$f" || continue
        m=$(kando_mtime "$cwd/$f") || continue
        [ -n "$now" ] || now=$(date +%s)
        [ -n "$m" ] && [ $((now - m)) -le "$window" ] && list="${list}${cwd}/${f}"$'\n'
      done < <(git -C "$cwd" ls-files -m -o --exclude-standard -z -- :/ 2>/dev/null)
      ;;
  esac
  [ -n "$list" ] || return 0
  cmd=$(hook_get "$input" tool_input.command) || return 0
  [[ "$cmd" =~ $KANDO_TREE_MOVING_RE ]] && return 0
  # Candidates only: resolve `cwd/../x` to the real absolute path.
  local dir
  while IFS= read -r f; do
    [ -n "$f" ] && kando_checkable_ext "$f" && [ -f "$f" ] || continue
    dir=$(cd "${f%/*}" 2>/dev/null && pwd -P) && printf '%s/%s\n' "$dir" "${f##*/}"
  done <<<"$list"
  return 0
}

# kando_edited_files <payload>: absolute paths the tool call changed, one per line (a Bash call that changed more than
# KANDO_BASH_EDIT_CAP files, a bulk operation, yields none: the Stop hook still covers it).
kando_edited_files() {
  local fields file tool state cwd dur
  fields=$(hook_fields "$1") || return 0
  { read -r file; read -r tool; read -r state; read -r cwd; read -r dur; } <<<"$fields"
  if [ -n "$file" ]; then
    printf '%s\n' "$file"
  elif [ "$tool" = Bash ]; then
    local files count
    files=$(kando_bash_changed_files "$1" "$state" "$cwd" "$dur")
    [ -n "$files" ] || return 0
    count=$(printf '%s\n' "$files" | wc -l)
    [ "$count" -le "$KANDO_BASH_EDIT_CAP" ] && printf '%s\n' "$files"
  fi
  return 0
}
