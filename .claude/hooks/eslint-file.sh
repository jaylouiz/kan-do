#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|Bash): lint (and auto-fix) the files Claude just edited, wrote or rewrote through a Bash
# command (sed -i, a heredoc, a script; #650), and check their design tokens.
# Exit 2 feeds remaining ESLint errors and undefined `var()` tokens back to Claude; exit 0 otherwise.
# Warnings are ignored (--quiet), matching `npm run lint:ci`.
# Works in each file's own checkout (edit-root.sh): an edit in a worktree is linted with that worktree's config.
# Infra trouble (no jq, git, node_modules, an odd payload) never blocks: it ends in exit 0.

project_dir="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$project_dir" || exit 0
. "$(dirname "$0")/edit-root.sh"

input=$(cat)
# Cheap exit first: a Bash call that changed nothing (nearly all of them) must cost one jq and one git.
files=$(kando_edited_files "$input")
[ -n "$files" ] || exit 0
session_id=$(hook_get "$input" session_id)
: "${session_id:=unknown}"

# check_root <root> <file>...: lint the files of one checkout; appends to $errors.
errors=""
check_root() {
  local root=$1 f out eslint
  shift
  cd "$root" || return 0
  # Prototype branches (proto/*, /design-gh-issue) may use raw strings and skip lint.
  case "$(git branch --show-current 2>/dev/null)" in proto/*) return 0 ;; esac
  # A worktree without node_modules cannot lint; say so once per session instead of skipping silently.
  if [ ! -d node_modules ]; then
    local flag="${TMPDIR:-/tmp}/kando-nolint-${session_id}-$(printf '%s' "$root" | cksum | cut -d' ' -f1)"
    if [ ! -f "$flag" ]; then
      : >"$flag"
      hook_context_json PostToolUse "eslint-file: $root has no node_modules, so edits there are not linted. Link it: ln -s $project_dir/node_modules $root/node_modules"
    fi
    return 0
  fi

  # Design tokens: a `var(--x)` nothing defines renders nothing; a colour, shadow-colour or off-scale radius literal belongs in a token (#69; scripts/lint/design-tokens.mjs).
  local css=()
  for f in "$@"; do case "$f" in *.vue | *.css) css+=("$f") ;; esac; done
  if [ ${#css[@]} -gt 0 ] && [ -f scripts/lint/design-tokens.mjs ] && ! out=$(node scripts/lint/design-tokens.mjs "${css[@]}" 2>&1); then
    errors="${errors:+$errors

}Design token findings in ${css[*]}:
$out"
  fi

  local js=()
  for f in "$@"; do case "$f" in *.vue | *.ts | *.mjs | *.js) js+=("$f") ;; esac; done
  # Call the local binary directly: npx adds ~1s of resolution per edit.
  eslint=node_modules/.bin/eslint
  if [ ${#js[@]} -gt 0 ] && [ -x "$eslint" ] && ! out=$("$eslint" --fix --quiet --no-warn-ignored "${js[@]}" 2>&1); then
    errors="${errors:+$errors

}ESLint errors remain in ${js[*]} (auto-fix already applied):
$(printf '%s\n' "$out" | tail -40)"
  fi
}

# Group the files by checkout (this repository's main checkout or a worktree), outside generated/vendored directories.
main=$(kando_toplevel "$project_dir")
pairs=""
while IFS= read -r file; do
  kando_checkable_ext "$file" || continue
  [ -f "$file" ] || continue
  root=$(kando_edit_root "$project_dir" "$file")
  [ -n "$root" ] || continue
  [ "$root" = "$main" ] || kando_record_root "$session_id" "$root"
  pairs="${pairs}${root}"$'\t'"${file}"$'\n'
done <<<"$files"
[ -n "$pairs" ] || exit 0

while IFS= read -r root; do
  [ -n "$root" ] || continue
  group=()
  while IFS=$'\t' read -r r f; do
    [ "$r" = "$root" ] && group+=("$f")
  done <<<"$pairs"
  check_root "$root" "${group[@]}"
  cd "$project_dir" || exit 0
done < <(printf '%s' "$pairs" | cut -f1 | sort -u)

if [ -n "$errors" ]; then
  printf '%s\n' "$errors" >&2
  exit 2
fi
exit 0
