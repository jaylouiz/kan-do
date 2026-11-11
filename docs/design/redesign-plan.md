# UI redesign plan

The living plan for getting from today's UI to a redesigned one that follows the owner's look and feel and rests on a small, consistent design system. It says what is done, what comes next, who does it and where the result lands.

**Keeping it current (every agent):** when you finish, start, re-scope or drop a step, update the status table and add one line to the change log at the bottom, in the same PR or commit as the work. Decisions are recorded where the project already keeps them (the issue body, `DESIGN.md`); this file only points to them. If the procedure itself changes, edit the step and say why in the change log.

- Owner issue of the visual direction: kd#1 "Visual UI Re-Design" (`gh issue view 1`).
- Bare `#n` in the older audit documents means the private archive; issues of this repo are written `kd#n` here.

## Goal

A redesigned UI that
1. carries the owner's direction (warmer, more colour, clearer separation between components; kd#1),
2. uses one component and one variant per user job wherever the jobs are the same,
3. has tuned foundations (type, spacing, colour roles, elevation, radius, motion, density) that every component derives from,
4. has consistent interaction mechanics (hover, focus, press, disabled, loading, transitions, keyboard),
5. is described by a `DESIGN.md` that is shorter than today's and holds only what code and checks cannot tell.

**Measure of success: deletion.** The redesign ends with fewer variants and fewer written rules than it started with. Starting numbers (2026-11-11): 110 component files, `DESIGN.md` 373 lines (the Components section alone 84), 37 guard tests in `tests/config/`.

## Status

| Step | What | Status | Who decides |
|---|---|---|---|
| 0 | Inventory and visually neutral consolidation | **done** (epic kd#58, closed 2026-11) | – |
| 1 | Gap audit: what step 0 did not look at | **next** | agent runs, owner reads |
| 2 | Rule review of `DESIGN.md` | not started (needs step 1) | owner, per challenged rule |
| 3 | Visual direction on the cleaned kit | blocked on the owner: decision "D2" of kd#1 is unanswered since 2026-10-31 | owner |
| 4 | System definition: foundations and the rewritten `DESIGN.md` | not started (needs 2 and 3) | owner approves |
| 5 | Migration in slices | not started | agents; owner feel-checks |
| 6 | Lock-in: guards, baselines, canvas | not started | agents |

Steps 1 and 3 do not depend on each other and can run in parallel.

## Step 0: what already exists (do not redo)

Epic kd#58 "UI Kit Audit and Cleanup" (19 sub-issues, all closed) was the inventory and the consolidation, done on purpose without changing how anything looks.

| Deliverable | Where | Use in this plan |
|---|---|---|
| Component table with a keep / merge / replace decision per component, duplicate families by user job, hard-coded values, dead code | `docs/design/ui-kit-audit.md` | the inventory; step 1 only measures the delta since commit `2a511228` |
| Rendered review, Nielsen critique, technical audit | `docs/design/audit-2026-11.md`, `docs/design/audit-2026-10.md` | input for steps 1 and 3 |
| `/ui`: dev-only catalog with a Tokens page and a page per component with variant and state samples | `pages/ui.vue`, `catalog/` (seven categories) | the place to see a new direction applied to the whole kit at once (step 3) and to review mechanics (step 1) |
| Manifest of every component by job, kind and category | `npm run ui:manifest`, `npm run ui:find -- <job words>` | data source for step 1 |
| Computed-style fingerprint of `/ui`, pixel baselines of the core flows | `tests/e2e/` (`visual-regression.spec.ts`, the `/ui` specs) | proves a migration slice changed only what it meant to (step 5) |
| FigCraft frames, one per category, desktop and 390 px | the canvas file named in `.claude/ui-canvas.md`; screenshots in `shots-62` beside it | before-state for the owner; re-shot in step 6 |
| Literals moved into tokens (colour, shadow, radius, type, spacing, z-index, motion, breakpoints) | `assets/css/`, `app.config.ts` | a new look is mostly a change of token values (step 5) |
| Merged primitives: `ListRow`, `ChoiceChip`, `PropertyValueTrigger`, `SwatchRadioGroup`, `ResponsiveOverlay`, notices on `UAlert`, tabs on `UTabs` | `components/ui/` | the reduced set step 3 must design with |
| Ratchet guards and the Pattern check | `tests/config/`, `.claude/rules/ui-patterns.md` | already the lock-in mechanism; step 6 tightens it |

**What step 0 left open, by design:**
- It kept every token value and every look. Whether the type scale, spacing scale, elevation model or density are *good* was never asked.
- Its "keep" decisions were made under "nothing may look different". Several keep a variant only because merging would have changed pixels (for example `ListRow` with three densities that copy what each site had, `ChoiceChip` with five shapes, two button sizes used about 50 times each).
- It added rules to `DESIGN.md` (usage guidelines) and removed none.
- Interaction mechanics were not reviewed as a system.
- Layout decisions were parked for the redesign: the transparent app bar row, statistics opening the task sheet as a modal, the page title scale (rows U2, U7, U18 in `docs/design/backlog.md`).
- The two prototype rounds of kd#1 were built before the cleanup, on the old code (branch `proto/423-visual-redesign` on the `archive` remote).

## Step 1: gap audit

One document, `docs/design/redesign-gap-audit.md`, no code change. Four parts:

1. **Foundations as used.** Measure from the rendered `/ui` and the board, sheet and settings screens which font sizes, weights, line heights, spacing values, radii, shadows and durations actually appear, and how often. Compare with the token scales. Report steps nobody uses, values one step apart that do the same job, and places that leave the scale.
2. **Variants that survived only because of the neutral constraint.** Go through the "keep" rows of `ui-kit-audit.md` and the manifest; list per user job every remaining component and variant and mark the ones that could merge now that looks may change.
3. **Mechanics matrix.** For each interactive primitive on `/ui`: resting, hover, focus-visible, pressed, disabled, loading, selected; the transition (property, duration, easing); keyboard behaviour. Record the computed styles, list where two primitives answer the same state differently.
4. **Delta since step 0.** Components and variants added after `2a511228` (105 → 110 files) and whether each went through the Pattern check.

## Step 2: rule review of `DESIGN.md`

Every rule and every per-component paragraph gets one of five labels, with the evidence from step 1:

| Label | Meaning | What happens in step 4 |
|---|---|---|
| principle | direction that guides new decisions | stays |
| foundation | token or scale | stays, as a table |
| pattern | one user job, one solution | stays, one line plus a pointer to `/ui` |
| component detail | a value or trade-off of one component | moves to that component's doc block |
| enforced | a test or lint rule already guarantees it | prose is removed, the guard is named once |
| challenged | step 1 shows it causes inconsistency, or it contradicts the direction of kd#1 | the owner decides: keep, change or drop |

The agent proposes the labels and a recommendation for each challenged rule. Nothing is changed in `DESIGN.md` in this step. The result is a section in the gap audit document.

## Step 3: visual direction

Continues kd#1 through its Design stage. Changes to that issue's plan because of step 0:

- **Rebuild the prototype on the cleaned kit.** Round 3 starts from current `main`, as token values and `app.config.ts` theme changes only, not from the old branch. A direction that needs more than tokens and theme says so; that is its build cost.
- **Show it on `/ui` as well as on the screens.** With a variant switch on `/ui`, each direction is visible on every component and state at once, which also covers the surfaces the earlier rounds never restyled (overlays, toasts, focus, hover, stacks).
- **Anchor screens:** board, task sheet, settings, and one overlay (the end-of-day dialog).
- **Constraint for every variant:** it uses the reduced component set and names which of the mergeable variants from step 1 it removes.
- **The parked layout decisions** (app bar row, statistics task view, page title scale) are answered in this step.
- **Mechanics are part of the direction:** one motion and one state language is proposed per variant and tried in the coded prototype, not on the canvas.

Needs first: the owner's answer to the open decision of kd#1 (which of the seven round-2 variants, or which mix, goes on).

## Step 4: system definition

- Fix the foundations of the chosen direction as token values: type scale, spacing scale, colour roles (including the frozen primary palette, which only the owner may change), elevation, radius, motion, density.
- Close the variant lists of the primitives.
- Rewrite `DESIGN.md` from the labels of step 2. Target: clearly under today's 373 lines; the Components section shrinks the most.
- Each changed principle, token or named rule is a decision request to the owner (the project's rule for one-way decisions).

Result: a spec on kd#1 (or its follow-up issues) through `/specify-gh-issue`.

## Step 5: migration in slices

1. **Foundations first**, one PR: token values and theme. Everything that is token-driven changes at once; baselines and the fingerprint are re-recorded here.
2. **Then one slice per category**, in the order of `/ui`: action, input, navigation, feedback, overlay, display, layout and blocks. Each slice applies the direction to what tokens could not reach, merges the variants marked in step 1, and **deletes what it replaces in the same PR**.
3. **Risk areas last and alone:** drag ghost and drop wash, stacks, the Jetzt focus overlay, the add-task flow.
4. Fonts are bundled for the desktop content security policy before any slice uses them.

## Step 6: lock-in

- Lower the ratchet baselines to the new counts; add a guard for every rule that step 2 labelled "enforced" but that has none yet.
- Re-shoot the FigCraft category frames from `/ui`.
- Close or drop the remaining rows of `docs/design/backlog.md`.
- Compare with the starting numbers under "Goal" and write the result here.

## Who does what

| Work | Agent alone | Agent prepares, owner decides | Owner only |
|---|---|---|---|
| Step 1, all four parts | yes: measured from `/ui`, the manifest and the token files | – | reading the summary |
| Step 2 labels | yes for the five mechanical labels | each challenged rule (expected: a short list) | – |
| Step 3 prototype variants, contrast checks, build sizes, Impeccable scan | yes | which direction; the parked layout decisions | taste; answering the open decision of kd#1 |
| Step 3 mechanics | proposes and implements the state and motion language | – | feeling drag, transitions and touch in the running app, on a real phone and in the desktop app |
| Step 4 tokens, variant lists, `DESIGN.md` draft | yes | every changed principle, token and rule; any change to the primary palette | approving new or changed `decided` copy terms |
| Step 5 slices, tests, baselines, code review | yes, through the Specify and Build lanes | merge if a slice is held | a look at each slice's screenshots; the desktop app check (`npm run tauri:dev`) |
| Step 6 | yes | – | final sign-off |

In short: measuring, tracing, prototyping, rewriting and migrating can be done by agents. The owner's part is about five kinds of input: the direction pick (possibly over two rounds), the challenged rules, the three layout decisions, approval of the rewritten `DESIGN.md`, and feel-checks of the running app.

## Change log

- 2026-11-11: plan created. Procedure changed from the first sketch: the inventory and consolidation steps are replaced by a pointer to epic kd#58, which already did them; what remains of them is the gap audit (step 1). Step 3 now rebuilds the prototype on the cleaned kit and uses `/ui` as a review surface.
