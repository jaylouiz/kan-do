# Retro (issue-workflow profile partial)

<!-- Full text of the profile section "Retro" (`.claude/issue-workflow.md`); read when: Retro. -->

- running log: `.claude/retro-log.md`
- context files: `~/.claude/CLAUDE.md`, `CLAUDE.md`, `.claude/issue-workflow.md` and its partials `.claude/issue-workflow/*.md`, `~/.claude/agent-workflow/skills/*/SKILL.md`, `~/.claude/agent-workflow/reference/issue-rules.md` (every stage loads it; the README is not loaded)
- metric sources: `<git common dir>/agent-ledgers/checks.tsv`, one row per run of the Stop hook (`verify.sh`) and the pre-merge E2E gate: date, hook, branch or PR head, tier, spec count, seconds, result (`pass`, `fail`, `timeout` = the E2E run exceeded its own budget and the merge was blocked, #415, or `busy` = another gate run held the lock and none started, #830), flaky specs. Compare a PR's tier and spec count with its diff; a stamped (cached) gate pass writes no row
- escape (#446): a full release run (`npm run release`) that fails on a spec no PR gate ran since the last release (compare `checks.tsv` with the failing spec) is an `escaped` entry in the retro log: add the missing mapping to `.claude/hooks/e2e-gate.json` (the area whose file changed) and name the PR that should have run it; a spec that names a changed i18n value or `data-testid` is selected by text since #525, so a miss there means the spec asserts neither (a count, a visual state): map it
- edits land: skill method → the agent-workflow checkout (`~/.claude/agent-workflow`, commit + push there); kan-do facts → this file or CLAUDE.md, committed to `main` as `docs(workflow): ...` from a temporary worktree on `origin/main` when the main checkout is not on `main`
