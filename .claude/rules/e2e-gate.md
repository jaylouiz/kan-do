---
paths:
  - "scripts/e2e-gate.mjs"
  - ".claude/hooks/e2e-*"
  - "scripts/e2e-server.mjs"
---

# Pre-merge E2E gate

The pre-merge hook `.claude/hooks/e2e-before-merge.sh` picks a tier per PR (`scripts/e2e-gate.mjs`, rules in `.claude/hooks/e2e-gate.json`): docs-only and style-only PRs (every file a `.css`, a `.vue` change inside `<style>` or comments, docs or a snapshot, decided from the diff against the merge base; #375) skip E2E, only their changed specs run, plus the `design` specs (rendered Impeccable scan `design-detect`, ARIA state snapshots `state-structure`) when a file lies on a `design` path (a style change is what they judge); any other PR runs a smoke set plus the specs mapped to its files (risk areas have their own `map` rules, `area` says why), the specs importing a changed `tests/e2e/helpers/` file, the specs whose text contains a changed i18n value or `data-testid` (#525), the specs it touches and the ones on its `E2E-specs:` line. No glob and no label selects the whole suite (#446): only `E2E_GATE=full` in the hook's environment does (manual override; `npm run release` runs the full suite itself), plus the fail-safe of an unresolved or ≥100-file list. Testing mode (#693, `.claude/testing-mode`, `fast` or `quality`, default `quality`): in `fast` the non-skip result is tier `fast` = smoke + the `map` rules flagged `risk: true` + touched specs and helper importers + the `E2E-specs:` line; the `design` specs and the label/testid matches are dropped, and a style-only PR runs no E2E. Mark a new rule `risk: true` when its area is in the profile's "Risk areas". Runs retry once (`--retries=1`; a test that passes only on retry is printed as `flaky:`), a `<sha>.<tier>` stamp makes an unchanged head run once.
