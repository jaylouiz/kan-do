# Impeccable gate: critique procedure and detector notes

Read before running the design gate of a UI PR (`.claude/issue-workflow.md` "Design quality" points here; moved out of the always-read profile in #667, wording unchanged).

## Critique procedure

`/impeccable audit <target>` runs as written. `/impeccable critique <target>` follows the plugin's `reference/critique.md`:

- Assessments A and B always run as two isolated sub-agents (A: design review, inherits the session model and gets the 1280 and 390 screenshots as required input, no valid screenshots = recapture, never review; B: detector and browser evidence, `model: haiku`); inline with the `⚠️ DEGRADED: single-context` banner only when no `Agent` tool exists.
- Unattended (worker or orchestrated): one bounded pass, no browser overlay, no live server; the run ends with the literal line `Questions skipped: unattended worker`.
- Calibration stays outside A (critique.md: A is unanchored, `ignore.md` is its only prior-run input): the after-run is persisted (`critique-storage write`, committed with the PR; the before-run on the `origin/main` worktree is not) and its trend line goes into the PR. In synthesis, a heuristic that moved 2+ points or a total that moved 4+ against the last stored run of the same slug without a rendering change in the diff names the evidence for the move, else the parent re-scores that heuristic against critique.md's scoring guide.
- Real before/after scores for both in the PR (before = the same pass on an `origin/main` worktree; a motion-only or one-frame change may give a code-level estimate, marked); a later fix round without rendering change reuses them (say so).
- Fix every P0 and P1 except one that restates a spec `Accepted trade-offs` entry (cite it). List P2/P3 in the PR.
- A run that cannot happen is reported with the concrete error, never "not feasible unattended"; its box stays unticked.

## Detector notes

- `.vue` files get regex rules only. `detector.extensions: [{ext: ".vue", engine: "html"}]` was tried and rejected (it reads raw templates without CSS and reports every text node as `rgb(0,0,0)`: 42 false positives), so element rules come from the rendered-URL scan (`tests/e2e/design-detect.spec.ts`, the Stop hook's `scripts/design-scan.mjs`).
- `docs/design/baseline.json` is the accepted source-scan state (currently empty); the Todoist label palette in `integrations.css` is ignored file-scoped (`design-system-color "*"`) via `.impeccable/config.json`.
- Since 4.8.0 audit's touch-target and contrast checks follow WCAG 2.2 AA (24px target, SC 2.5.8), so a target under 44px that meets 24px (or the spacing exception) is not an AA failure and not a P1.
- Upgrading: bump the devDependency, run `npx impeccable --list-rules` and `npm run design:detect`.
