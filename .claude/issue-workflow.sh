# shellcheck shell=bash
# issue-workflow config for kan-do: executable project facts for the agent-workflow orchestrate scripts
# (spec.sh, merge-pr.sh, guard.sh; template: agent-workflow reference/project-config.sh). Prose facts: issue-workflow.md.

# One port per concurrent worker (max 5 workers: dev-server ports, Playwright CPU, shared visual baselines).
WF_PORTS=3101-3105
WF_MAX_WORKERS=5

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
wf_build_needed() { git diff --name-only "$1"...HEAD | grep -Eq '^(nuxt\.config\.ts|package\.json|app\.config\.ts|server/|vercel\.json)'; }
wf_build() { npm run build; }
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

# Vercel Production deployment of main (cwd: main checkout, after the fast-forward); not green -> file an inbox issue.
wf_deploy_check() {
  local dep sha state
  dep=$(gh api 'repos/{owner}/{repo}/deployments?environment=Production&per_page=1' --jq '.[0] | "\(.id) \(.sha)"') || { echo "deploy: lookup failed"; return 0; }
  sha=${dep#* }
  if [ "$sha" != "$(git rev-parse origin/main)" ]; then echo "deploy: Production not started yet for main (latest ${sha:0:7}); check again later"; return 0; fi
  state=$(gh api "repos/{owner}/{repo}/deployments/${dep%% *}/statuses" --jq '.[0].state // "pending"')
  echo "deploy: Production $state"
  case "$state" in success|in_progress|queued|pending) ;; *) echo "deploy not green: file an inbox issue" ;; esac
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
  base=$(git merge-base HEAD origin/main 2>/dev/null) || return 0
  git diff --name-only "$base" HEAD 2>/dev/null | grep -Eq '^(components/.*\.vue|pages/.*\.vue|layouts/|app\.vue$)' || return 0
  local grammar="Pattern grammar (.claude/rules/ui-patterns.md): 'Pattern: <user job> → reused <Element>' | '→ aligned with <Element>' | '→ diverged from <Element>: <reason>' | '→ new (no existing pattern; searched: <terms>)' | 'Pattern: none (<why>)'"
  grep -Eqi '^#+ *Design review' "$1" || { echo "this PR touches UI source files but the body has no '## Design review' section with the review's findings or the concrete error (hard gate, profile 'Design quality')"; return 1; }
  lines=$(grep -E '^[-* ]*Pattern:' "$1")
  [ -n "$lines" ] || { echo "this PR touches UI source files but the body has no 'Pattern:' line (Pattern check, #586). $grammar"; return 1; }
  bad=$(printf '%s\n' "$lines" | grep -Ev '^[-* ]*Pattern: (none \(.+\)|.+ (→|->) (reused .+|aligned with .+|diverged from .+: *[^ ].*|new \(.+\)))$' | head -1)
  [ -z "$bad" ] || { echo "invalid Pattern line: '$bad'. $grammar"; return 1; }
  if printf '%s\n' "$lines" | grep -Eq '(→|->) diverged from'; then
    grep -Eq '^[-* ]*Rule candidate: (#[0-9]+|none \(.+\))' "$1" || { echo "a 'diverged from' Pattern line needs 'Rule candidate: #<n>' or 'Rule candidate: none (<reason>)' (skill design-rule, #587)"; return 1; }
  fi
}
