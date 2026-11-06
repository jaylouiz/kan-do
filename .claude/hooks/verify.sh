#!/usr/bin/env bash
# Stop hook: block Claude from finishing while lint / typecheck / design scans / unit tests fail.
# Exit 2 feeds stderr back to Claude so it keeps working; exit 0 lets it stop.
# Mirrors `npm run verify` (plus the rendered design scan); E2E runs in the pre-merge hook.
# Testing mode (#693, .claude/testing-mode, read per checkout): `quality` (default, also for a missing or unknown value) runs
# everything below; `fast` keeps lint, typecheck and design:detect, runs only the unit tests of changed code
# (`vitest run --changed origin/main`) and skips the rendered design scan.
#
# Verifies the session's own checkout and every other checkout of this repository the session edited (recorded by
# the per-edit hooks, edit-root.sh): a session started in the main checkout that works in a worktree is verified
# there, not waved through because the main checkout is clean.

project_dir="${CLAUDE_PROJECT_DIR:-.}"
cd "$project_dir" || exit 0
. "$(dirname "$0")/edit-root.sh"

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "unknown"')

# Cap consecutive blocks so an unfixable failure can't loop forever.
counter="${TMPDIR:-/tmp}/kando-verify-${session_id}"
blocks=$(cat "$counter" 2>/dev/null || echo 0)
if [ "$blocks" -ge 3 ]; then
  rm -f "$counter"
  echo '{"systemMessage":"verify hook: still failing after 3 attempts, letting Claude stop"}'
  exit 0
fi

# One row per run for the workflow retro (agent-workflow `workflow-retro`, profile "Retro"): date, hook, ref, tier, specs, seconds, result, flaky.
log_check() {
  local f
  f="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/agent-ledgers/checks.tsv" || return 0
  mkdir -p "${f%/*}" && (IFS=$'\t'; printf '%s\t%s\n' "$(date '+%F %T')" "$*") >>"$f"
}

main=$(kando_toplevel "$project_dir")
messages=()
SECONDS=0

# verify_root <root>: the checks in one checkout; exits 2 on the first failure.
verify_root() {
  local root=$1 where="" branch ahead
  cd "$root" || return 0
  [ "$root" = "$main" ] || where=" in $root"
  branch=$(git branch --show-current 2>/dev/null)

  # Prototype branches (proto/*, /design-gh-issue) are throwaway and never merged.
  case "$branch" in proto/*) return 0 ;; esac

  # Nothing to verify: clean tree and no commits ahead of origin/main.
  ahead=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
  if [ -z "$(git status --porcelain)" ] && [ "$ahead" = "0" ]; then
    return 0
  fi

  # Fresh worktrees have no node_modules; don't block on a missing install.
  if [ ! -d node_modules ]; then
    messages+=("verify hook skipped${where}: node_modules missing: worktree symlink absent, see worktree.symlinkDirectories, then npx nuxt prepare")
    return 0
  fi
  [ -d .nuxt ] || npx nuxt prepare >/dev/null 2>&1

  # Anything but the single word `fast` is quality: a typo can only make the checks stricter.
  # checks.tsv tier column: `fast` in fast mode, `-` in quality (unchanged rows).
  local mode=quality tier=-
  [ "$(tr -d '[:space:]' <.claude/testing-mode 2>/dev/null)" = fast ] && mode=fast tier=fast

  run() {
    local label=$1
    shift
    local out
    if ! out=$("$@" 2>&1); then
      echo $((blocks + 1)) >"$counter"
      log_check verify "${branch:--}" "$tier" - "$SECONDS" "fail:$label" -
      {
        echo "Verification failed${where} at: $label ($*)"
        echo "Fix the problems below, then finish again."
        echo "$out" | tail -40
      } >&2
      exit 2
    fi
  }

  run lint npm run lint:ci
  run typecheck npm run typecheck
  run design-detect npm run design:detect
  if [ "$mode" = fast ]; then
    # `--changed origin/main` runs the tests that import a changed file; with no origin/main vitest selects nothing, so run all.
    if git rev-parse --verify --quiet origin/main >/dev/null; then run unit-tests npx vitest run --changed origin/main --passWithNoTests
    else run unit-tests npx vitest run; fi
  else
    run unit-tests npx vitest run
  fi
  # Rendered Impeccable scan (contrast, tiny text) when a design-path file changed and was not scanned as it is now.
  # Exit 2 = the scan could not run (no Chromium, failed build, server timeout): not a finding, so it warns and does not block.
  if [ "$mode" != fast ] && [ -f scripts/design-scan.mjs ]; then
    local scan_out scan_rc=0
    scan_out=$(node scripts/design-scan.mjs 2>&1) || scan_rc=$?
    case "$scan_rc" in
      0) ;;
      2) messages+=("verify hook${where}: rendered design scan could not run, skipped: $(printf '%s' "$scan_out" | tail -5)") ;;
      *)
        echo $((blocks + 1)) >"$counter"
        log_check verify "${branch:--}" "$tier" - "$SECONDS" fail:design-scan -
        {
          echo "Verification failed${where} at: design-scan (node scripts/design-scan.mjs)"
          echo "Fix the problems below, then finish again."
          echo "$scan_out" | tail -40
        } >&2
        exit 2
        ;;
    esac
  fi
  log_check verify "${branch:--}" "$tier" - "$SECONDS" pass -
}

roots=("$main")
while IFS= read -r root; do
  [ -n "$root" ] && [ "$root" != "$main" ] && [ -d "$root" ] && roots+=("$root")
done < <(kando_recorded_roots "$session_id")

for root in "${roots[@]}"; do verify_root "$root"; done

rm -f "$counter"
if [ ${#messages[@]} -gt 0 ]; then
  jq -n --arg m "$(printf '%s\n' "${messages[@]}")" '{systemMessage: $m}'
fi
exit 0
