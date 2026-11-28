# shellcheck shell=bash
# issue-workflow config for kan-do: executable project facts for the agent-workflow orchestrate scripts
# (spec.sh, merge-pr.sh, guard.sh; template: agent-workflow reference/project-config.sh). Prose facts: issue-workflow.md.

# One port per concurrent worker (max 5 workers: dev-server ports, Playwright CPU, shared visual baselines).
WF_PORTS=3101-3105
WF_MAX_WORKERS=5

# GitHub's issue status carries the phase alone (#909, agent-workflow docs/phase-label-cutover.md): no phase:* labels.
WF_PHASE_LABELS=off

# Risk areas (issue-workflow.md "Risk areas"): PRs touching these get a separate reviewer worker.
WF_RISK_GLOBS=(
  'store/**' composables/useTaskSync.ts 'integrations/**' 'server/**'
  composables/useBoardDndKit.ts composables/useBoardDragState.ts composables/useHeldWhileDragging.ts
  composables/useColumnStackCollapse.ts composables/useStackExpansion.ts
  lib/dataStorage.ts lib/secrets.ts 'utils/dataFile/**' composables/useWebDataTransfer.ts 'src-tauri/**'
  app.config.ts assets/css/main.css DESIGN.md
  'tests/e2e/snapshots/**'
)
WF_IGNORE_GLOBS=(package-lock.json 'tests/e2e/snapshots/**' '*.md' 'docs/**')
WF_REVIEW_LINES=400
WF_HOLD_LABELS="on-hold-after-spec do-not-merge"
WF_NO_WAIT_CI=1   # owner decision 2026-11-12: never wait for PR CI
WF_CHECKS_TSV="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/agent-ledgers/checks.tsv"

# cwd: the PR worktree (base merged in).
wf_verify() { npm run verify; }
wf_build_needed() { git diff --name-only "$1"...HEAD | grep -Eq '^(nuxt\.config\.ts|package\.json|app\.config\.ts|server/)'; }
wf_build() { npm run build; }
# every prep: a UI diff runs tests/config (ratchets, lock-in); fix workers' `vitest --changed` misses them (main red after PR 712)
wf_prep_check() { if git diff --name-only "$1"...HEAD | grep -Eq '\.(vue|css)$|^app\.config\.ts$'; then npx vitest run tests/config; fi; }
# Orca worktrees have their own node_modules; the lockfile rewrite of a local install is never committed (CLAUDE.md).
wf_install() { npx npm@11.19.0 install --no-audit --no-fund && git checkout -- package-lock.json; }

# cwd: the main checkout. Only when it is on main (never git pull); dependency installs via npm 11.19 (CLAUDE.md).
wf_after_merge() {
  if [ "$(git branch --show-current)" != main ]; then echo "main checkout not on main: skipped the fast-forward"; else
    local before; before=$(git rev-parse HEAD)
    git fetch -q origin main && git merge -q --ff-only origin/main || { echo "ff-only to origin/main failed"; return 1; }
    if git diff --name-only "$before" HEAD | grep -qx package.json; then npx npm@11.19.0 install; fi
  fi
  .claude/hooks/cleanup-merged.sh
}

# Cloudflare Workers Builds deploy of main (ADR 021; the Vercel deployment is gone, #747), read from its GitHub check run
# "Workers Builds: kando" on origin/main (cwd: main checkout, after the fast-forward); not green -> file an inbox issue.
# Then the feedback relay's state (wf_relay_check below).
wf_deploy_check() {
  local sha run
  sha=$(git rev-parse origin/main)
  run=$(gh api "repos/{owner}/{repo}/commits/$sha/check-runs" --jq '[.check_runs[] | select(.name | startswith("Workers Builds"))][0] | "\(.status) \(.conclusion)"') || { echo "deploy: lookup failed"; return 0; }
  case "$run" in
    "null null"|"") echo "deploy: Workers Builds not started yet for main (${sha:0:7}); check again later" ;;
    "completed success") echo "deploy: Workers Builds success" ;;
    completed*) echo "deploy: Workers Builds ${run#completed }"; echo "deploy not green: file an inbox issue" ;;
    *) echo "deploy: Workers Builds ${run%% *}" ;;
  esac
  wf_relay_check
}

# Feedback relay of the production Worker (#852): one empty probe (never filed) tells a missing FEEDBACK_GITHUB_TOKEN
# secret from a healthy relay. Prints one line, always returns 0. Setting the secret is the user's step: an agent never
# runs `wrangler secret put` and never deploys by hand.
wf_relay_check() {
  local root line rc=0
  root=$(git rev-parse --show-toplevel) || return 0
  [ -f "$root/scripts/feedback-relay-check.mjs" ] || return 0
  line=$(node "$root/scripts/feedback-relay-check.mjs" 2>/dev/null) || rc=$?
  echo "${line:-feedback relay: check did not run}"
  if [ "$rc" -eq 1 ]; then echo "feedback relay not configured: tell the user (the Worker secret is theirs to set) and file an inbox issue unless one is open"; fi
  return 0
}

# Hosted preview of a design prototype (ADR 021 "Prototype previews"): Workers Builds turns every pushed proto/* branch into a
# gated Worker Preview. cwd: any checkout of kan-do. $1 = the branch. Prints the URL once the build of the pushed head
# succeeded (waits up to WF_PREVIEW_WAIT s, default 540: call it with a 10-minute Bash timeout); return 1 = no hosted
# preview (not pushed, failed, still building).
wf_proto_preview_url() {
  local sha run i=0 wait=${WF_PREVIEW_WAIT:-540} root
  root=$(git rev-parse --show-toplevel) || return 1
  sha=$(git ls-remote origin "refs/heads/$1" | cut -f1)
  [ -n "$sha" ] || { echo "preview: $1 is not pushed" >&2; return 1; }
  while :; do
    run=$(gh api "repos/{owner}/{repo}/commits/$sha/check-runs" --jq '[.check_runs[] | select(.name | startswith("Workers Builds"))][0] | "\(.status) \(.conclusion)"' 2>/dev/null) || run=""
    case "$run" in
      "completed success") node "$root/scripts/workers-preview.mjs" url "$1"; return 0 ;;
      completed*) echo "preview: Workers Builds ${run#completed } for $1 (${sha:0:7})" >&2; return 1 ;;
      # no Workers Builds check run for the head after 60 s: none is coming (dashboard steps not done), skip the 540 s wait
      "null null"|"") [ "$i" -lt 60 ] || { echo "preview: no Workers Builds check run for $1 (${sha:0:7}), not configured?" >&2; return 1; } ;;
    esac
    [ $((i += 20)) -le "$wait" ] || { echo "preview: Workers Builds not done after ${wait}s for $1 (${sha:0:7})" >&2; return 1; }
    sleep 20
  done
}
# Removes the Worker Preview of a proto branch (needs `wrangler login` or CLOUDFLARE_API_TOKEN). One that stays is gated,
# files no feedback, and Workers Free evicts the oldest beyond 100 previews.
wf_proto_preview_delete() { node "$(git rev-parse --show-toplevel)/scripts/workers-preview.mjs" delete "$1" >/dev/null 2>&1 || { echo "preview of $1 not deleted (wrangler not logged in?)"; return 1; }; }

# The 'E2E-specs:' line must name every spec the gate selects for the PR head (#699: ui-catalog was missed twice, a rule
# in the profile was not enough). The gate runs on the diff with the PR's own E2E-specs lines removed, so the line cannot
# satisfy itself; tier full / skip / style and anything the gate cannot answer pass (the merge hook decides those).
wf_e2e_selection_check() {
  local root; root=$(git rev-parse --show-toplevel 2>/dev/null)
  [ -n "$root" ] && [ -f "$root/scripts/e2e-gate.mjs" ] && command -v node >/dev/null && command -v jq >/dev/null || return 0
  local files decision named missing spec
  files=$(printf '%s\n' "$2" | jq -R 'select(length > 0) | {path: .}' | jq -s .) || return 0
  decision=$(jq -n --argjson files "$files" --arg head "$(git rev-parse HEAD 2>/dev/null)" '{files: $files, body: "", baseRefName: "main", headRefOid: $head}' \
    | (cd "$root" && node --disable-warning=ExperimentalWarning scripts/e2e-gate.mjs 2>/dev/null)) || return 0
  [ "$(printf '%s' "$decision" | jq -r '.tier // empty')" ] || return 0
  case "$(printf '%s' "$decision" | jq -r .tier)" in targeted|fast) ;; *) return 0 ;; esac
  named=" $(grep '^E2E-specs:' "$1" | sed 's/^E2E-specs://' | tr '\n\r,' '   ' | tr -s ' ') "
  missing=""
  for spec in $(printf '%s' "$decision" | jq -r '.specs[]'); do
    case "$named" in *" $spec "*) ;; *) missing="$missing $spec" ;; esac
  done
  [ -z "$missing" ] || { echo "the 'E2E-specs:' line misses spec(s) the pre-merge gate selects for this diff:$missing. Run them (PORT=<free> npm run test:e2e -- <files>) and add them to the line, or run 'gh pr view <pr> --json files,body,baseRefName,headRefOid | node scripts/e2e-gate.mjs' for the full decision (#699)"; return 1; }
}

# The pre-merge gate adds the specs on this line to its tier. A diff that touches UI source files also needs the
# Pattern-check record (#586; rule: .claude/rules/ui-patterns.md): valid `Pattern:` lines, and for a `diverged from`
# line a `Rule candidate:` line (#587). Skipped, never failed, when git cannot say what the diff touches.
wf_pr_body_check() {
  grep -q '^E2E-specs:' "$1" || { echo "missing the 'E2E-specs: a b c' line (basenames of the E2E specs you ran)"; return 1; }
  [ "$(grep -c '^E2E-specs:' "$1")" -eq 1 ] || { echo "more than one line starts with 'E2E-specs:': keep one and edit it in place (the merge gate reads every such line as spec names)"; return 1; }
  local base lines bad
  bad=$(grep '^E2E-specs:' "$1" | sed 's/^E2E-specs://' | tr ' ' '\n' | grep -Ev '^[A-Za-z0-9_-]*$' | head -1)
  [ -z "$bad" ] || { echo "the 'E2E-specs:' line holds only spec basenames separated by spaces; '$bad' is not one (put results on another line)"; return 1; }
  local root; root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$root" ] && [ -d "$root/tests/e2e" ]; then
    for bad in $(grep '^E2E-specs:' "$1" | sed 's/^E2E-specs://'); do
      [ -n "$(find "$root/tests/e2e" -name "$bad.spec.ts" -print -quit)" ] || { echo "the 'E2E-specs:' line names '$bad', but no tests/e2e/**/$bad.spec.ts exists (a name written from memory escaped three PRs, wave 3)"; return 1; }
    done
  fi
  base=$(git merge-base HEAD origin/main 2>/dev/null) || return 0
  local changed; changed=$(git diff --name-only "$base" HEAD 2>/dev/null)
  wf_e2e_selection_check "$1" "$changed" || return 1
  # Theme and CSS changes (app.config.ts, assets/) are UI too: the design review is a hard gate for them (#342 skipped it).
  printf '%s\n' "$changed" | grep -Eq '^(components/.*\.vue|pages/.*\.vue|layouts/|app\.vue$|app\.config\.ts$|assets/)' || return 0
  local grammar="Pattern grammar (.claude/rules/ui-patterns.md): 'Pattern: <user job> → reused <Element>' | '→ aligned with <Element>' | '→ diverged from <Element>: <reason>' | '→ new (no existing pattern; searched: <terms>)' | 'Pattern: none (<why>)'"
  grep -Eqi '^#+ *Design review' "$1" || { echo "this PR touches UI source files but the body has no '## Design review' section with the review's findings or the concrete error (hard gate, profile 'Design quality')"; return 1; }
  printf '%s\n' "$changed" | grep -Eq '^(components/.*\.vue|pages/.*\.vue|layouts/|app\.vue$)' || return 0
  lines=$(grep -E '^[-* ]*Pattern:' "$1")
  [ -n "$lines" ] || { echo "this PR touches UI source files but the body has no 'Pattern:' line (Pattern check, #586). $grammar"; return 1; }
  bad=$(printf '%s\n' "$lines" | grep -Ev '^[-* ]*Pattern: (none \(.+\)|.+ (→|->) (reused .+|aligned with .+|diverged from .+: *[^ ].*|new \(.+\)))$' | head -1)
  [ -z "$bad" ] || { echo "invalid Pattern line: '$bad'. $grammar"; return 1; }
  if printf '%s\n' "$lines" | grep -Eq '(→|->) diverged from'; then
    grep -Eq '^[-* ]*Rule candidate: (#[0-9]+|none \(.+\))' "$1" || { echo "a 'diverged from' Pattern line needs 'Rule candidate: #<n>' or 'Rule candidate: none (<reason>)' (skill design-rule, #587)"; return 1; }
  fi
}
