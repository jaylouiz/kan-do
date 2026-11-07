#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash): GitHub CI runs no E2E on PRs (only lint, typecheck, unit tests), so run the Playwright E2E tier the
# PR needs locally before a merge (`gh pr merge`, or the REST merge `gh api -X PUT .../pulls/<n>/merge` that cloud sessions
# use because their GitHub proxy rejects GraphQL): docs-only and style-only (#375) skip, E2E_GATE=full (manual override, no
# label or glob selects it, #446) runs the full suite, anything else runs the smoke set + the specs mapped to the
# changed files (risk areas included) + specs importing a changed helper + touched specs + the `E2E-specs:` line
# (scripts/e2e-gate.mjs, .claude/hooks/e2e-gate.json). A pass is stamped per PR head SHA and tier, so an unchanged PR is only
# tested once. Exit 2 blocks the merge and feeds the failure back to Claude. A run that exceeds its own
# budget (E2E_GATE_BUDGET_SECONDS, default 1500 s) also blocks, with result `timeout` in checks.tsv (#415).

input=$(cat)
# shellcheck source=hook-input.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-input.sh"
if ! cmd=$(hook_command "$input"); then
  # Neither jq nor perl's JSON::PP could read the input (#2): never wave a possible merge through.
  printf '%s' "$input" | grep -Eq 'gh.*merge' && { echo "e2e-before-merge: cannot read the hook input (no working jq, and perl's JSON::PP failed), and it mentions the merge command. Install jq (brew install jq), then retry." >&2; exit 2; }
  exit 0
fi
# Only a real invocation counts, not text inside a commit message or heredoc (#506). The command is tokenised the way
# guard-commands.sh does it, in one left-to-right pass: quoted strings have their separators neutralised, comments are
# dropped, and a heredoc operator outside quotes drops its body (so a quoted `<<EOF` opens none, #516; an apostrophe inside a
# comment opens no quote). The rest is split into command segments (; && || | & newline, and `(`, `)`, backtick, so a
# subshell, `$(...)` and `out=$(...)` start one), and a segment counts when it starts (behind VAR=val words, wrappers with
# their options, also called by path (`/usr/bin/env`, #659), such as `env -i`, `sudo -u x`, `doas`, `time -p`, `timeout -k 5 60`, `nice -n 5`, `stdbuf -oL`, `ionice -c 3`,
# `xargs`, `setsid`, `caffeinate`, `chronic`, `unbuffer`, `if`, ..., a quoted, escaped or encoded word such as `\gh`, `"gh"`,
# `$"gh"` or `$'\x67h'` (ANSI-C escapes are decoded, #596), and an absolute path to gh, then gh options such as
# `-R o/r`, `--repo x`, `--repo=x`) with `pr merge`, or with `api` aimed at `pulls/<n>/merge` with method PUT (the REST merge
# of cloud sessions, whose proxy rejects GraphQL; a GET on that path is no merge). Prints three lines: "<1 if E2E_GATE=full
# is a prefix word>", the repository (-R/--repo, else the `repos/<owner>/<repo>` of the REST path, else an inline
# `GH_REPO=` prefix, else a `GH_REPO` assigned in an earlier segment (`export GH_REPO=o/r; gh pr merge 5`, the nearest one wins,
# `unset`, `export -n` and `declare +x` drop it, `declare`/`local`/`readonly` without -x set it only when it is exported
# already by an earlier segment or by the environment the hook inherited, #596 #608), else empty: GH_REPO of the hook or origin, #533 #535; `:origin` when an `unset`, `export -n` or empty inline value dropped the GH_REPO the hook itself inherited, so gh uses origin, #622; `$:wrapper`, which the hook refuses, when a wrapper that may strip it (`env -i/-u`, `sudo`, `doas`, `exec -c`) runs gh while the hook inherited one or an inline value stands in front of the wrapper and nothing names the repository, #637), and the arguments after `merge` (value-taking
# options such as -R/-b/-t removed, redirections removed) for that segment. For the REST form the argument is the PR number
# from the path, or REST:unresolved when that segment is not plain digits (a variable or substitution, also one holding
# `|`/`;`/`&&`, which the gate cannot resolve: blocked below); `xargs` gets XARGS:unresolved (the PR comes from stdin).
# A heredoc body ends at its bare terminator line only (`<<-`: tabs allowed before it); in an unquoted heredoc the body's
# `$(...)` and backticks still run, so they are parsed as commands. Nothing when there is no merge command, "multi" for more than one (the gate checks one PR per
# command). The parser is a perl program in its own file next to this hook (e2e-merge-parse.pl, #640), so no shell quoting limits what it may contain. Not a sandbox: `bash -c`, `eval` and `$(...)` inside double quotes are not unwrapped.
parser="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e-merge-parse.pl"
parsed=$(printf '%s' "$cmd" | perl -0777 -n "$parser")
parse_status=$?
if [ "$parse_status" -ne 0 ]; then
  # The parser failed (perl missing or broken): never wave a possible merge through.
  gh_opts='(-[^[:space:]]+[[:space:]]+([^-[:space:]][^[:space:]]*[[:space:]]+)?)*' # `-R o/r`, `--repo=x`, `--hostname h`
  printf '%s' "$cmd" | grep -Eq "gh[\"']?[[:space:]]+${gh_opts}(pr[[:space:]]+${gh_opts}merge|api[[:space:]].*pulls/[^[:space:]]+/merge)" && { echo "e2e-before-merge: cannot parse the command (perl failed, exit $parse_status), and it mentions the merge command. Run it as a plain merge call with a literal PR number ('gh pr merge <n>', or the REST form with <n> in the path)." >&2; exit 2; }
  exit 0
fi
[ -n "$parsed" ] || exit 0
# Everything below reads GitHub's answers with jq: without it the gate cannot decide, so it blocks (#2).
command -v jq >/dev/null 2>&1 || { echo "e2e-before-merge: jq is missing, so the E2E gate cannot run. Install it (brew install jq), then retry the merge." >&2; exit 2; }
if [ "$(printf '%s' "$parsed" | sed -n 3p)" = REST:unresolved ]; then
  echo "e2e-before-merge: the REST merge path has no literal PR number (a variable, a substitution or not plain digits), so the gate cannot tell which PR it merges. Write the number into the path: gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge ..." >&2
  exit 2
fi
if [ "$(printf '%s' "$parsed" | sed -n 3p)" = XARGS:unresolved ]; then
  echo "e2e-before-merge: 'xargs' takes the PR number from stdin, so the gate cannot tell which PR it merges. Run the merge directly with a literal PR number ('gh pr merge <n>')." >&2
  exit 2
fi
if [ "$parsed" = multi ]; then
  echo "e2e-before-merge: more than one merge command in one call; the E2E gate checks one PR per call. Merge them in separate calls." >&2
  exit 2
fi

# An inline `E2E_GATE=full gh pr merge ...` prefix is the hook's own switch: the hook does not inherit it.
[ "$(printf '%s' "$parsed" | head -1)" = 1 ] && export E2E_GATE=full
repo_flag=$(printf '%s' "$parsed" | sed -n 2p | tr -d "\"'")
merge_args=$(printf '%s' "$parsed" | sed -n 3p)

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# One row per run for the workflow retro (agent-workflow `workflow-retro`, profile "Retro"): date, hook, ref, tier, specs, seconds, result, flaky.
log_check() {
  local f
  f="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)/agent-ledgers/checks.tsv" || return 0
  mkdir -p "${f%/*}" && (IFS=$'\t'; printf '%s\t%s\n' "$(date '+%F %T')" "$*") >>"$f"
}
export PATH="$PATH:${HOMEBREW_PREFIX:-/opt/homebrew}/bin"

# `gh pr merge [<number>|<url>|<branch>] ...`: first non-flag argument after "merge" (the REST form hands over its PR number).
target=$(printf '%s' "$merge_args" | tr ' ' '\n' | grep -v '^-' | grep -v '^$' | head -1)
# PR data over REST only (`gh api`): cloud sessions reject GraphQL (`gh pr view`), REST works in both places.
errf=$(mktemp "${TMPDIR:-/tmp}/kando-e2e-gh.XXXXXX")
origin_repo=$(git remote get-url origin 2>/dev/null | sed -E 's#(\.git)?/*$##; s#.*[:/]([^/:]+/[^/:]+)$#\1#')
repo=${GH_REPO:-$origin_repo}
if [ "$repo_flag" = ':origin' ]; then # GH_REPO was dropped from gh's environment (#622): gh merges in origin, not in the hook's GH_REPO
  repo=$origin_repo
elif [ -n "$repo_flag" ]; then # `gh -R <[host/]owner/repo> pr merge`: the PR lives in that repo
  if ! printf '%s' "$repo_flag" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
    case "$repo_flag" in
      '$:subshell') why="GH_REPO was changed inside a subshell, \$(...) or backticks, which may or may not reach the merge" ;;
      '$:wrapper') why="a wrapper (env -i/-u, sudo, doas, exec -c) may strip GH_REPO from the environment of gh" ;;
      *) why="the repository '$repo_flag' (-R/--repo, GH_REPO= or the REST path) is not a literal repository (a variable or substitution)" ;;
    esac
    echo "e2e-before-merge: $why, so the gate cannot tell which repository's PR it merges. Write it out: gh pr merge <n> -R owner/repo, or repos/<owner>/<repo>/pulls/<n>/merge" >&2
    exit 2
  fi
  repo=$(printf '%s' "$repo_flag" | sed -E 's#^.*/([^/]+/[^/]+)$#\1#') # [HOST/]OWNER/REPO -> OWNER/REPO
fi
num="" branch=""
case "$target" in
  '') branch=$(git branch --show-current 2>/dev/null) ;;
  *[!0-9]*) case "$target" in
      */pull/*) num=${target##*/pull/} && num=${num%%[!0-9]*} ;;
      *) branch=$target ;;
    esac ;;
  *) num=$target ;;
esac
[ -z "$num" ] && [ -n "$branch" ] &&
  num=$(gh api "repos/$repo/pulls?head=${repo%%/*}:$branch&state=open" -q '.[0].number // empty' 2>"$errf")
if [ -z "$num" ] || ! pr=$(gh api "repos/$repo/pulls/$num" 2>"$errf") ||
  ! sha=$(printf '%s' "$pr" | jq -r '.head.sha // empty' 2>>"$errf") || [ -z "$sha" ]; then
  echo "e2e-before-merge: cannot resolve the PR head SHA (gh api repos/$repo/pulls/${num:-?} failed: $(tr '\n' ' ' <"$errf")). Pass the PR number explicitly ('gh pr merge <n>'), or run E2E manually, then retry." >&2
  exit 2
fi

# Run in the worktree that has the PR head checked out (the main checkout may be elsewhere); its copy of the
# gate script and config is the PR's own. Without one the decision uses this checkout (enough for a skip).
wt=""
while read -r path head; do
  [ "$head" = "$sha" ] && wt=$path && break
done < <(git worktree list --porcelain | awk '/^worktree /{p=$2} /^HEAD /{print p, $2}')
gate_dir=${wt:-$(pwd)}

# files and body decide the tier, in the shape of `gh pr view --json files,body,baseRefName,headRefOid`;
# a failed files call leaves '{}' and the gate then runs everything.
if files=$(gh api --paginate "repos/$repo/pulls/$num/files" -q '.[].filename' 2>/dev/null); then
  pr_json=$(printf '%s' "$pr" | jq --arg files "$files" \
    '{files: ($files | split("\n") | map(select(length > 0) | {path: .})), body: (.body // ""), baseRefName: .base.ref, headRefOid: .head.sha}') || pr_json='{}'
else
  pr_json='{}'
fi
if ! decision=$(printf '%s' "$pr_json" | node --disable-warning=ExperimentalWarning "$gate_dir/scripts/e2e-gate.mjs" 2>"$errf") || [ -z "$decision" ]; then
  echo "e2e-before-merge: the gate script failed ($(tr '\n' ' ' <"$errf")). Fix scripts/e2e-gate.mjs or run E2E manually, then retry." >&2
  exit 2
fi
tier=$(printf '%s' "$decision" | jq -r .tier)
reason=$(printf '%s' "$decision" | jq -r .reason)
key=$(printf '%s' "$decision" | jq -r .key)
unmapped=$(printf '%s' "$decision" | jq -r '.unmapped | join(" ")')
unknown=$(printf '%s' "$decision" | jq -r '.unknown | join(" ")')
nspecs=$(printf '%s' "$decision" | jq -r '[.args[] | select(endswith(".spec.ts"))] | length')
[ "$tier" = full ] && nspecs=$(printf '%s' "$decision" | jq -r '.specs | length')

if [ "$tier" = skip ]; then
  echo "e2e-before-merge: tier=skip ($reason), every file of the PR is docs-only (docs/**, **/*.md, .claude/**)." >&2
  log_check e2e-gate "$sha" skip 0 0 pass -
  exit 0
fi
if [ "$tier" = style ]; then
  echo "e2e-before-merge: tier=style ($reason), no E2E: every file is a stylesheet, a .vue change inside <style> or comments, docs or a snapshot, and no spec changed." >&2
  log_check e2e-gate "$sha" style 0 0 pass -
  exit 0
fi
echo "e2e-before-merge: tier=$tier ($reason), $nspecs spec files${unmapped:+, unmapped: $unmapped}" >&2
if [ -n "$unknown" ]; then
  echo "e2e-before-merge: unknown spec name(s) on the 'E2E-specs:' line of the PR body: $unknown (basenames of tests/e2e/*.spec.ts without .spec.ts). Fix the PR body ('gh pr edit'; in a cloud session 'gh api -X PATCH repos/$repo/pulls/$num -f body=...'), then retry." >&2
  exit 2
fi

# A full stamp satisfies any tier; a targeted stamp only the same spec list.
stamp_dir="$(git rev-parse --path-format=absolute --git-common-dir)/kando-e2e-pass"
[ -f "$stamp_dir/$sha.full" ] && exit 0
[ -f "$stamp_dir/$sha.$key" ] && exit 0

if [ -z "$wt" ]; then
  echo "e2e-before-merge: no worktree has PR head $sha checked out. Check the branch out (or fetch and 'git worktree add'), then retry." >&2
  exit 2
fi

# Worktrees outside Claude's own (symlinkDirectories) may lack node_modules: reuse the main checkout's.
[ -e "$wt/node_modules" ] || ln -s "$(pwd)/node_modules" "$wt/node_modules"

port=$((3200 + RANDOM % 700))
log=$(mktemp "${TMPDIR:-/tmp}/kando-e2e.XXXXXX")
SECONDS=0
run_args=$(printf '%s' "$decision" | jq -r '.args | join(" ")') # flags and spec paths, no spaces
# Own time budget (#415), below the hook timeout in .claude/settings.json (1800 s): a PreToolUse hook that is
# killed by that timeout does not block, so the merge would go through unchecked. E2E_GATE_BUDGET_SECONDS overrides it.
budget=${E2E_GATE_BUDGET_SECONDS:-1500}
case $budget in '' | *[!0-9]*) budget=1500 ;; esac
# macOS has no `timeout`: run the suite in its own process group (perl setpgrp) so the watchdog can stop the whole tree.
perl -e 'setpgrp(0, 0); exec @ARGV' bash -c 'cd "$1" && PORT=$2 npm run test:e2e -- $3' _ "$wt" "$port" "$run_args" >"$log" 2>&1 &
e2e_pid=$!
timed_out=0
while kill -0 "$e2e_pid" 2>/dev/null; do
  if [ "$SECONDS" -ge "$budget" ]; then
    timed_out=1
    kill -TERM -- "-$e2e_pid" 2>/dev/null
    sleep 3
    kill -KILL -- "-$e2e_pid" 2>/dev/null
    lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null # the run's own server (random port)
    break
  fi
  sleep 1
done
{ wait "$e2e_pid"; } 2>/dev/null
e2e_status=$?
if [ "$timed_out" = 1 ]; then
  {
    echo "E2E TIMEOUT for PR head $sha (tier $tier, $nspecs spec files): the run did not finish within its ${budget} s budget (hook timeout 1800 s), so the merge is blocked and no pass stamp was written. This is not a test failure."
    echo "Rerun the merge on a quieter machine (fewer parallel workers), or raise the budget once: E2E_GATE_BUDGET_SECONDS=<s> (stay below 1800 s). Partial log: $log"
    tail -20 "$log"
  } >&2
  log_check e2e-gate "$sha" "$tier" "$nspecs" "$SECONDS" timeout -
  exit 2
fi
if [ "$e2e_status" -ne 0 ]; then
  {
    echo "E2E failed for PR head $sha (tier $tier, worktree $wt, full log $log). Fix the failures, then retry the merge."
    echo "If the failing spec is not one this PR touches, rerun it once alone (PORT=<free> npx playwright test -c tests/e2e/playwright.config.ts <file>); a pass there is a load flake."
    tail -60 "$log"
  } >&2
  log_check e2e-gate "$sha" "$tier" "$nspecs" "$SECONDS" fail -
  exit 2
fi

# A test that passed only on retry does not block, but is reported (an inbox issue if it repeats).
flaky=$(node "$gate_dir/scripts/e2e-gate.mjs" summary "$log" 2>/dev/null | jq -r '.flaky[]?' 2>/dev/null)
[ -n "$flaky" ] && printf '%s\n' "$flaky" | sed 's/^/flaky: /' >&2

log_check e2e-gate "$sha" "$tier" "$nspecs" "$SECONDS" pass "$(printf '%s' "$flaky" | paste -sd, -)"
mkdir -p "$stamp_dir" && touch "$stamp_dir/$sha.$key"
exit 0
