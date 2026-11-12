#!/usr/bin/env bash
# Removes local worktrees and branches whose GitHub PR is merged, and the proto/<n>-* branches
# (local worktree, local branch, origin branch) of closed issues.
# Runs as a SessionStart hook; also safe to run by hand: .claude/hooks/cleanup-merged.sh [--dry-run]
# Remote branches of merged PRs are deleted by GitHub itself (repo setting "Automatically delete head
# branches"); proto branches are never PR'd, so this script deletes their origin branch.
#
# Safety rules:
# - a branch is only touched if a merged PR has it as head AND the local tip is contained in
#   that PR's head commit (no commits were added after the merge)
# - worktrees with any uncommitted or untracked changes are skipped, except a modified
#   package-lock.json alone: worktree setup (`npm install` with local npm 11.6) rewrites it,
#   it is never part of the PR, so it is discarded
# - Orca-managed worktrees are removed via `orca worktree rm` so Orca's sidebar stays in sync
# - proto/<n>-* branches (throwaway design prototypes, never merged) go once issue #<n> is closed;
#   those of open issues stay as the Design record. Never merged, so instead of a merge check a
#   local tip missing from origin (unpushed commits) is skipped and reported.
# - the main checkout and `main` itself are never touched, nor a worktree somebody works in (kd#203): the
#   caller's own working directory (taken before the cd to the project root) or that of a running `claude` process
# - every failure is non-fatal; the hook never blocks a session

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# Directories in use, one per line: where the caller stood, and the cwd of every running claude session. A session
# whose working directory disappears can run no further command.
IN_USE="$(pwd -P)"
pids="$(pgrep -x claude 2>/dev/null | paste -sd, -)"
[ -n "$pids" ] && IN_USE="$IN_USE
$(lsof -a -d cwd -p "$pids" -Fn 2>/dev/null | sed -n 's/^n//p')"
in_use() { # $1 = real path of a worktree: true when a directory in use is that path or lies below it
  local d
  while IFS= read -r d; do
    case "$d/" in "$1"/*) return 0 ;; esac
  done <<< "$IN_USE"
  return 1
}

ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0
command -v gh >/dev/null 2>&1 || exit 0

MAIN_WT="$(git worktree list --porcelain | awk '/^worktree /{print substr($0,10); exit}')"
HERE="$(pwd -P)"

git fetch --quiet --prune origin 2>/dev/null || exit 0
MERGED="$(gh pr list --state merged --limit 300 --json headRefName,headRefOid \
  -q '.[] | .headRefName + " " + .headRefOid' 2>/dev/null)" || exit 0

run() { if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] $*" >&2; else "$@" >/dev/null 2>&1; fi; }

# branch -> worktree path (bash 3 compatible, no associative arrays)
WT_MAP="$(git worktree list --porcelain | awk '/^worktree /{wt=substr($0,10)} /^branch /{sub("refs/heads/","",$2); print $2 "\t" wt}')"
worktree_of() { printf '%s\n' "$WT_MAP" | awk -F'\t' -v b="$1" '$1==b{print $2; exit}'; }

removed=()
skipped=()

branch_exists() { git show-ref --verify --quiet "refs/heads/$1"; }

# Orca 1.4.246+ keeps the local branch on `orca worktree rm` (its `--delete-branch` deletes only what Orca itself can
# prove merged; this script proved the merge already), so git deletes it. Right after the rm, Orca may not have
# unregistered the worktree yet and `git branch -D` fails with "used by worktree": retry for up to 5 s. A branch
# that is already gone (an older Orca deleted it itself) counts as deleted.
delete_branch() {
  local i
  [ "$DRY_RUN" = 1 ] && { run git branch -D "$1"; return 0; }
  for i in $(seq 10); do
    branch_exists "$1" || return 0
    git branch -D "$1" >/dev/null 2>&1 && return 0
    perl -e 'select(undef, undef, undef, 0.5)'
  done
  ! branch_exists "$1"
}

# Removes the worktree of $1 if it has one. Returns 1 (and records why) when it must stay.
free_worktree() {
  local branch="$1" wt wt_real dirty
  wt="$(worktree_of "$branch")"
  [ -n "$wt" ] || return 0
  wt_real="$(cd "$wt" 2>/dev/null && pwd -P)"
  if [ "$wt" = "$MAIN_WT" ] || [ "$wt_real" = "$HERE" ]; then
    skipped+=("$branch (checked out here)"); return 1
  fi
  if [ -n "$wt_real" ] && in_use "$wt_real"; then
    skipped+=("$branch (a session works in $wt)"); return 1
  fi
  if [ -d "$wt" ]; then
    dirty="$(git -C "$wt" status --porcelain 2>/dev/null)"
    if [ "$dirty" = " M package-lock.json" ]; then
      run git -C "$wt" checkout -- package-lock.json
    elif [ -n "$dirty" ]; then
      skipped+=("$branch (uncommitted changes in $wt)"); return 1
    fi
  fi
  if command -v orca >/dev/null 2>&1 && orca worktree show --worktree "path:$wt" >/dev/null 2>&1; then
    run orca worktree rm --worktree "path:$wt" || { skipped+=("$branch (worktree removal failed)"); return 1; }
  else
    run git worktree remove "$wt" || { skipped+=("$branch (worktree removal failed)"); return 1; }
  fi
}
while read -r branch oid; do
  [ -n "$branch" ] && [ "$branch" != "main" ] || continue
  local_sha="$(git rev-parse --verify --quiet "refs/heads/$branch")"
  [ -n "$local_sha" ] || continue
  git cat-file -e "$oid^{commit}" 2>/dev/null || continue
  if ! git merge-base --is-ancestor "$local_sha" "$oid" 2>/dev/null; then
    skipped+=("$branch (new commits after merge)"); continue
  fi

  free_worktree "$branch" || continue
  if delete_branch "$branch"; then removed+=("$branch"); else skipped+=("$branch (branch delete failed)"); fi
done <<< "$MERGED"

# Prototype branches proto/<n>-<slug> of closed issues (local worktree + branch, then origin).
# A local tip that is not on origin (never pushed, or commits after the last push) is skipped.
PROTOS="$( { git for-each-ref --format='%(refname:short)' 'refs/heads/proto/*'
             git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/proto/*' | sed 's|^origin/||'
           } | sort -u)"
CLOSED=""
[ -n "$PROTOS" ] && CLOSED="$(gh issue list --state closed --limit 1000 --json number -q '.[].number' 2>/dev/null)"
if [ -n "$CLOSED" ]; then
  while read -r branch; do
    [ -n "$branch" ] || continue
    n="$(printf '%s' "$branch" | sed -n 's|^proto/\([0-9][0-9]*\)-.*|\1|p')"
    [ -n "$n" ] && printf '%s\n' "$CLOSED" | grep -qx "$n" || continue
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
        git merge-base --is-ancestor "refs/heads/$branch" "refs/remotes/origin/$branch" 2>/dev/null \
          || { skipped+=("$branch (unpushed commits)"); continue; }
      else
        git merge-base --is-ancestor "refs/heads/$branch" refs/remotes/origin/main 2>/dev/null \
          || { skipped+=("$branch (unpushed commits)"); continue; }
      fi
      free_worktree "$branch" || continue
      if branch_exists "$branch"; then
        delete_branch "$branch" || { skipped+=("$branch (branch delete failed)"); continue; }
      fi
    fi
    if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      run git push --quiet origin --delete "$branch" || { skipped+=("$branch (remote delete failed)"); continue; }
    fi
    removed+=("$branch")
  done <<< "$PROTOS"
fi

run git worktree prune

if [ ${#removed[@]} -gt 0 ] || [ ${#skipped[@]} -gt 0 ]; then
  msg="Merged-PR and closed-proto cleanup:"
  [ ${#removed[@]} -gt 0 ] && msg="$msg removed ${removed[*]}."
  [ ${#skipped[@]} -gt 0 ] && msg="$msg skipped ${skipped[*]}."
  if [ "$DRY_RUN" = 1 ]; then echo "$msg"; else printf '{"systemMessage": %s}\n' "$(printf '%s' "$msg" | jq -Rs .)"; fi
fi
exit 0
