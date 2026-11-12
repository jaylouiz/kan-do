# Impeccable gate: critique procedure and detector notes

Read before running the design gate of a UI PR (`.claude/issue-workflow.md` "Design quality" points here; moved out of the always-read profile in #667, wording unchanged).

## Critique procedure

The gate of a UI PR is one design review of the built result (reduced 2026-11-13 by the owner: across 38 UI PRs the before and after scores moved by a mean of +1 of 40, inside their own noise, while the review's findings led to a fix in about one PR of three).

- When: as soon as the change renders, before the first full E2E pass (findings change CSS; a later run repeats the E2E set).
- What: `/impeccable critique <target>`, its design-review assessment (A in the plugin's `reference/critique.md`) as one isolated sub-agent that inherits the session model and gets the after screenshots at 1280 and 390 as required input. No valid screenshots = recapture, never review; warm the route first and check that the shots show the changed state. Inline with the `⚠️ DEGRADED: single-context` banner only when no `Agent` tool exists.
- Not part of the gate: a run on `origin/main`, scores and their trend, the scored `/impeccable audit`, a separate detector assessment. `npm run design:detect`, axe and the rendered scan already run in the Stop hook and the merge gate.
- Unattended (worker or orchestrated): one bounded pass, no browser overlay, no live server.
- Fix every P0 and P1 the PR introduced, except one that restates a spec `Accepted trade-offs` entry (cite it). A finding that `main` already has becomes an `inbox` issue. List P2/P3 in the PR.
- A review that cannot happen is reported with the concrete error, never "not feasible unattended"; its box stays unticked.

## Detector notes

- `.vue` files get regex rules only. `detector.extensions: [{ext: ".vue", engine: "html"}]` was tried and rejected (it reads raw templates without CSS and reports every text node as `rgb(0,0,0)`: 42 false positives), so element rules come from the rendered-URL scan (`tests/e2e/design-detect.spec.ts`, the Stop hook's `scripts/design-scan.mjs`).
- `docs/design/baseline.json` is the accepted source-scan state (currently empty).
- Ignored rule `cream-palette` (`.impeccable/config.json`, kd#176): the detector reads a warm off-white page as a reflex choice. The paper canvas `oklch(0.953 0.013 86)` is the owner's decision of 2026-11-11 (Paper Desk, kd#1 `## UX decision`, `DESIGN.md` "Colour"); the rule has no value to ignore, so the whole rule is off.
- Since 4.8.0 audit's touch-target and contrast checks follow WCAG 2.2 AA (24px target, SC 2.5.8), so a target under 44px that meets 24px (or the spacing exception) is not an AA failure and not a P1.
- Upgrading: bump the devDependency, run `npx impeccable --list-rules` and `npm run design:detect`.
