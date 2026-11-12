# UI redesign plan

The living plan for getting from today's UI to a redesigned one that follows the owner's look and feel and rests on a small, consistent design system. It says what is done, what comes next, who does it and where the result lands.

**Keeping it current (every agent):** when you finish, start, re-scope or drop a step, update the status table and add one line to the change log at the bottom, in the same PR or commit as the work. Decisions are recorded where the project already keeps them (the issue body, `DESIGN.md`); this file only points to them. If the procedure itself changes, edit the step and say why in the change log.

- Owner issue of the visual direction: kd#1 "Visual UI Re-Design" (`gh issue view 1`).
- Bare `#n` in the older audit documents means the private archive; issues of this repo are written `kd#n` here.

## Where we are (start here)

*As of 2026-11-12. Update this block whenever a slice changes state.*

**Steps 0 to 4 are done, and step 5 has merged slices 1 to 5; slice 1b (kd#190) is in a PR.** Slices 2, 3 and 4 (kd#177, kd#178, kd#179; PRs 197, 198, 199) are on `main`: two button heights with soft and ghost by rule, 36 px fields with one choice chip and one card picker, one task sheet for the board and statistics, the title scale and list rows as links. Slice 1 (kd#176, PR 193, merged 2026-11-11) puts Paper Desk on `main` wherever tokens and the theme reach: the paper canvas, white sheets with the warm shadow, forest green, Fraunces headings, the marker on Jetzt, the flat app bar pills and the state language. `DESIGN.md` is the approved new text; `docs/design/DESIGN.next.md` is gone. Old variants still exist and keep working until their slice merges them.

**Do next**, in this order:
1. kd#190 (slice 1b, the line heights of interface text) is built and in a PR; it moved every baseline and waits for the owner's look at its screenshots (board, task sheet with multi-line notes, a settings page, a dialog; 1280 and 390 px) and the merge.
2. Then kd#181 (slice 6, the board) alone, then kd#182 (lock-in).
3. Side findings of slices 1 to 4: kd#195, kd#200 and kd#201 are built in one PR (see the change log, 2026-11-12); kd#191 and kd#192 wait in the `inbox` for triage. None blocks a slice.

**Read before building** (a slice's issue links them too):

| What | Where |
|---|---|
| The decision on the look, the user criteria, the slice tracker | kd#1 (`gh issue view 1`) |
| The design file in force | `DESIGN.md` |
| Token values (before the redesign against new), closed variant lists, where each paragraph of the old `DESIGN.md` went, what the build has to know | `docs/design/redesign-system.md` |
| The measurements and the rule review behind both | `docs/design/redesign-gap-audit.md` |
| The prototype, reference only (rebuild properly, never merge or cherry-pick) | branch `proto/1-visual-redesign`, commit `968c1861`; `PORT=<free port> npm run dev`, then `/tasks?seed=demo&variant=a&type=1&btn=both&drag=1` |

**Type roles in the code (slice 1b, kd#190):** interface text (`--text-sm`) and label text (`--text-xs`, `--text-label`, 12 px) carry 1.3 in their size tokens, reading text is the one `text-body` utility (1.55), and a control's height is explicit everywhere (tabs now too). Still ahead of the code: the phone steps of the type table (15 px body and interface, 16 px title), which no slice owns yet. The detector's sidecar `.impeccable/design.json` still describes the old palette; it is refreshed in the lock-in (kd#182).

**Open for the owner:** nothing that blocks a slice. One optional question from the review of slice 3: should the 44 px floor of fields also hold on touch screens at desktop width (a tablet), not only on a phone? Today it is phone only, as decided. Coming up in step 5: a look at each slice's screenshots, and one check of drag and motion in the desktop app (`npm run tauri:dev`) and on a real phone after slice 6.

**Known limits of the prototype** (so nobody copies them): it overrides the app from one stylesheet outside the layers; its soft-or-ghost rule is approximated in CSS and shows a row's main action as ghost, where the decision is soft; its set-down after a drop watches a class change. The slices build each of these properly.

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
| 1 | Gap audit: what step 0 did not look at | **done** 2026-11-11 (`docs/design/redesign-gap-audit.md`) | agent runs, owner reads |
| 2 | Rule review of `DESIGN.md` | **done** 2026-11-11 ("Step 2: rule review of `DESIGN.md`" in `docs/design/redesign-gap-audit.md`; four challenged rules answered by the owner) | owner, per challenged rule |
| 3 | Visual direction on the cleaned kit | **done** 2026-11-11: Paper Desk with Fraunces and the yellow marker on the Jetzt headline (`## UX decision` in the body of kd#1; prototype branch `proto/1-visual-redesign`, the pick at commit `15b65260`, with the switches of step 4 at `968c1861`) | owner |
| 4 | System definition: foundations and the rewritten `DESIGN.md` | **done** 2026-11-11: `docs/design/redesign-system.md` and `docs/design/DESIGN.next.md`, approved by the owner; kd#1 is the epic with one sub-issue per slice | owner approves |
| 5 | Migration in slices | **running**: kd#175 and slices 1 to 4 (kd#176 to kd#179) merged, four sub-issues to go: kd#180, kd#190, kd#181, kd#182 (table under "Step 5") | agents; owner feel-checks |
| 6 | Lock-in: guards, baselines, canvas | not started (kd#182, after all slices) | agents |

What to do next is in "Where we are" at the top.

## How we work on it

The owner and an agent work through the plan together, one step (or one clearly cut part of a step) per session.

- **A fresh session per step, in step 5 per slice (or per group of slices that can run side by side).** Start it with: "Continue the redesign: read `docs/design/redesign-plan.md` and do the next step." Everything a session needs is in this file and in the documents it points to; nothing is carried in a chat history.
- **A session ends with a handoff here:** "Where we are", the status table, the slice table of step 5, the change log, and any question for the owner under "Open questions for the owner", so questions are answered in one go and not scattered over chats.
- **A session starts with the owner's open questions for its step.** Before any work, the agent reads "Open questions for the owner" and interviews the owner in the session (one question at a time, with a recommendation, through the question dialog) on every question due for what it is about to do. A question about a look is asked with something to look at: a switch on the prototype branch or screenshots side by side. Answers are written back into this file in the same session. A session without the owner present (a worker, a scheduled run) stops at the first due question and hands back.
- **In step 5 the issue is the spec.** A slice's sub-issue holds its scope and criteria; this file holds only the order and the state. The decisions listed below are final: a slice does not reopen them, and a conflict with the code goes to the owner as a question.
- **Two worktrees at once** (the docs branch and the prototype branch): switch between them with `EnterWorktree` and a `path`; write patch scripts as files.
- **Inside a session** the agent works in the conversation with the owner. It uses sub-agents only for work that is wide and independent (measuring many components in step 1, reading references), and the Orca lanes (`/design-gh-issue`, `/specify-gh-issue`, `/build-gh-issue`, `/orchestrate-gh-issues`) for the prototype rounds of step 3 and the slices of step 5.
- **Interactive on purpose:** steps 2, 3 and 4 were conversations with the owner. Steps 5 and 6 run mostly unattended and end with something to look at: each slice's PR carries screenshots at desktop and 390 px.

## Reference material: Mobbin

The owner has a Mobbin Pro account; its connector (`mcp__claude_ai_Mobbin__*`: search screens, flows and website sections of shipped products, read the owner's collections with their comments) is available in local sessions. Use it as evidence, never as a look to copy.

| Step | Use |
|---|---|
| 1, part 2 and 3 | For each user job where kan-do still has several variants (list rows, choice chips, pick-one controls, notices, empty states), look at how three to five well-made products solve that job with one pattern. Record the links beside the finding. |
| 2 | A challenged rule gets references for and against, so the owner decides on examples, not on an agent's opinion. |
| 3 | The owner's inspiration lives in a Mobbin collection; the agent reads it including the comments (a comment is the reason something was saved). The agent may add finds to the collection for the owner to judge. |
| 4 | Benchmarks for foundations that can be read off a screenshot: density, type hierarchy steps, how many surface levels a product uses. |

Limits: iOS and web only (no desktop apps), static screenshots (no motion or feel, so mechanics still need the running prototype), and a session without the connector (cloud sessions, some workers) cannot use it; such a session works from the links already recorded. Screenshots of other products are not committed to this public repository: cite the Mobbin link.

## Open questions for the owner

**No question is open.** A slice that meets something undecided adds it here with the slice it blocks.

### Decided (final; a slice builds on these and does not reopen them)

All by the owner on 2026-11-11. They are written into `docs/design/DESIGN.next.md` and `docs/design/redesign-system.md`; `DESIGN.md` and `PRODUCT.md` change in slice 1 (kd#176).
- The four rule proposals of the brief: a warm neutral canvas, never a saturated one; a muted green as the colour of action, red for exceptions; a serif for headings, the sans for everything read and operated; everything entered or edited sits on a bright lifted sheet, one level only.
- Done may use the accent green. The green is locked with the pick: forest green, hue 152.
- The heading font is Fraunces. The design detector calls it an overused face; the owner chose it knowingly against Newsreader, Young Serif and Besley.
- Text is near-black; shadows are the deeper warm set; the app bar row (parked decision U2) uses flat white pills, no glass.
- A yellow text-marker stroke is an allowed decoration "with slight intentional use"; the Jetzt headline is its first use.
- Statistics opens the same task sheet as the board: one common sheet, one way to open a task (parked decision U7, answered 2026-11-11).
- The four challenged rules of step 2 (answered 2026-11-11, detail in the gap audit, "Asked in this step"): The One Lamp Rule stays as "one solid green button per view; marks, selected options, links and the focus ring are green without being a fill". The three line heights stay and are built into the size tokens. Only sheets cast a shadow, with the app bar's nav pill as the named exception; a control never casts one. The task sheet keeps its two value looks (a select with a chevron, text on a dotted rule) with one row height and one hover, focus and disabled answer.
- The variant lists and two placements, answered at the start of step 4 (2026-11-11):
  - Buttons have two heights: 32 px regular and 36 px for the one main action of a surface. 28 and 24 px go.
  - `ListRow` has one density (cozy) and one hover answer (a surface tint); `SettingsSubpageLink` and `DayCloseTaskRow` become that row.
  - `ChoiceChip` is one chip shape at one height (pill and chip merge, icon is the same chip with only an icon, the board menu's pressed buttons become it); `row` goes and uses the select menu's item; the two card pickers (`LocalSetupFlow`, welcome) become one; `field` stays.
  - Fields are 36 px everywhere: inputs, selects and the value controls of the task sheet's rows. The title field of the task sheet keeps its own size; phones keep the 44 px floor.
  - "Voice and copy" moves to `docs/copy/`, `DESIGN.md` keeps a pointer.
  - A page sheet (settings section, statistics tile) takes the card's radius, 16 px: one surface shape, the radius scale closes at 8, 12 and 16 px plus pill and circle.
  - Neutral buttons keep two looks (decided after a comparison of "soft only" and "both" on the prototype): soft for an action that stands on its own and for the one main action of a row; ghost for further actions inside a row, card, menu or toolbar and for icon-only buttons. `subtle` folds into soft.
  - The heading scale in Fraunces (parked decision U18, decided on three scales shown on the prototype): page titles 36 px like the column names, section headings 22 px, dialog titles and sub-headings 18 px.
  - Drag and drop takes the state language in its gentle form (tried in the running prototype against "as today" and "marked"): the card rises out of its resting pose (2 % larger, the tilt and the shadow grow, 150 ms), the drop glides 200 ms and the card is set down in 200 ms.
- The system definition is approved as a whole (2026-11-11): the nine points of "Approved by the owner" in `docs/design/redesign-system.md`, among them 12 px label text, the eight type sizes, the task title in its sheet at 22 px Fraunces, the warm shadow on menus and toasts, and `docs/design/DESIGN.next.md` with The Marker Rule and The Sheets Cast Shadows Rule.
- Airbnb stays the positive reference; Slack joins the anti-references in `PRODUCT.md` (a saturated block of brand colour as chrome, a dense sidebar, cluttered and dense with many interactive elements at once); principle 3 of `PRODUCT.md` is reworded for the sheets.

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

Continues kd#1 through its Design stage.

**3a. Direction brief (first, with the owner).** Three inputs from the owner:

1. **The favourite** of the round-2 prototypes (they still live on the `archive` remote, branch `proto/423-visual-redesign`; the agent starts it locally so the owner can look again). This answers the open decision "D2" of kd#1.
2. **Inspiration** found on the web: saved into a Mobbin collection with a comment saying what is liked about each, or as links and local screenshots handed to the agent.
3. **General statements** about the look and feel.

The agent turns these into a brief in the body of kd#1: what the favourite keeps, what each piece of inspiration contributes (named as a property: "this density", "this way of separating columns", not "like product X"), the statements as principles, and where inputs contradict each other or `PRODUCT.md`. A statement that carries a reason ("because…", "so that…") goes through the `design-rule` skill as a rule proposal. The owner confirms the brief before any prototype is built.

**3b. Prototype round 3.** Changes to the plan of kd#1 because of step 0:

- **Rebuild the prototype on the cleaned kit.** Round 3 starts from current `main`, as token values and `app.config.ts` theme changes only, not from the old branch. A direction that needs more than tokens and theme says so; that is its build cost.
- **Show it on `/ui` as well as on the screens.** With a variant switch on `/ui`, each direction is visible on every component and state at once, which also covers the surfaces the earlier rounds never restyled (overlays, toasts, focus, hover, stacks).
- **Anchor screens:** board, task sheet, settings, and one overlay (the end-of-day dialog).
- **Constraint for every variant:** it uses the reduced component set and names which of the mergeable variants from step 1 it removes.
- **The parked layout decisions** (app bar row, statistics task view, page title scale) are answered in this step.
- **Mechanics are part of the direction:** one motion and one state language is proposed per variant and tried in the coded prototype, not on the canvas.

The round shows two or three interpretations of the confirmed brief, not seven new directions; the owner picks or mixes, and a further round only refines.

## Step 4: system definition

**Procedure (changed 2026-11-11):** the result is two documents and then the spec, not an edit of `DESIGN.md`. `docs/design/redesign-system.md` holds the token values (today against new), the closed variant lists with the uses that move, where each paragraph of today's `DESIGN.md` goes, and the points the owner still approves. `docs/design/DESIGN.next.md` is the complete rewritten design file; the foundations slice of step 5 moves it over `DESIGN.md` in the same change as the token values. Why: `DESIGN.md` is read by guards, the copy editor, skills and agents as the description of the code that is there; rewriting it on `main` before the tokens change would make every one of them wrong for the length of the migration.

- Fix the foundations of the chosen direction as token values: type scale, spacing scale, colour roles (including the frozen primary palette, which only the owner may change), elevation, radius, motion, density.
- Close the variant lists of the primitives.
- Rewrite `DESIGN.md` from the labels of step 2. Target: clearly under today's 373 lines; the Components section shrinks the most.
- Each changed principle, token or named rule is a decision request to the owner (the project's rule for one-way decisions).

Result: a spec on kd#1 (or its follow-up issues) through `/specify-gh-issue`. Done as an epic: kd#1 is the tracker, the slices of step 5 are its sub-issues.

## Step 5: migration in slices

Each slice is a sub-issue of the epic kd#1 with its scope, acceptance criteria and dependencies; the list below is the procedure, the table the state. Update the table when a slice is specified, merged or re-cut.

| Issue | Slice | Depends on | State |
|---|---|---|---|
| kd#175 | Move "Voice and copy" to `docs/copy/voice.md` | – | merged 2026-11-11 (PR 185) |
| kd#176 | 1 Foundations: tokens, theme, the display face and its roles, state language, the `DESIGN.md` swap | – | merged 2026-11-11 (PR 193) |
| kd#177 | 2 Actions: two button sizes, soft and ghost by rule | 1 | merged 2026-11-12 (PR 197) |
| kd#178 | 3 Inputs: 36 px fields, one choice chip, the task sheet value rows | 1 | merged 2026-11-11 (PR 198) |
| kd#190 | 1b Interface type roles: line heights in the size tokens, `text-body`, 12 px label | 1, 2, 3 (alone while it re-records baselines) | PR open (feat/190-interface-type-roles) |
| kd#179 | 4 Navigation, overlays and notices: one task sheet, titles | 1 | merged 2026-11-12 (PR 199) |
| kd#180 | 5 Display and layout: page sheets, one list row, headings, badges | 1, 2 | merged 2026-11-12 (PR 211) |
| kd#181 | 6 The board: card hover and press, drag motion, stacks, focus overlay, add slot | 1 to 5 (last and alone) | needs-spec |
| kd#182 | 7 Lock-in (step 6) | 1 to 6, 1b | needs-spec |

State is the issue's lane (`needs-spec`, `ready`), then `in build`, `PR <n>` and `merged <date>`.

How a slice runs:

1. **Specify** (`/specify-gh-issue <n>`): its own review of the current state and the technical choices. The scope, the user criteria and the decisions are input.
2. **Build** (`/build-gh-issue <n>`): one PR. It applies the direction to what tokens do not reach, merges the variants its issue names and **deletes what it replaces in the same PR**; baselines and the `/ui` fingerprint are re-recorded and the PR names every baseline that moved.
3. **The owner looks** at the PR's screenshots (desktop and 390 px). Merge follows the usual rule (green and not held).
4. **Handoff:** the slice's row in the table above, "Where we are" and one change log line, in the same PR.

Rules for all slices:

- **Slice 1 carried the swap.** The PR of kd#176 changed the token values and the theme, bundled Fraunces (desktop content security policy, ADR 012), moved `docs/design/DESIGN.next.md` over `DESIGN.md`, updated `PRODUCT.md` and repointed the readers listed in `docs/design/redesign-system.md` ("What step 5 has to know"). `DESIGN.md` is the new text and `DESIGN.next.md` is gone.
- **Slices 2 and 3 set explicit control heights.** Today a desktop control's height follows from the 20 px line of `text-sm` plus padding. Slice 1b changes that line, so kd#177 and kd#178 each carry the criterion that the sizes that stay get an explicit height.
- **`main` is mixed between slice 1 and slice 6:** the new look with some old variants still in it. Accepted for small PRs (kd#1, "Accepted trade-offs"). No agent cuts a desktop release during the migration.
- **The board comes last and alone** (kd#181): drag ghost and drop wash, stacks, the Jetzt focus overlay, the add-task flow. Visuals only, no drop logic (`.claude/rules/drag-and-drop.md`).
- **No slice for feedback and navigation of their own:** the gap audit found nothing to merge there; what tokens do not reach in them is part of slice 4 (kd#179).
- **A slice that turns out too large is cut**, not stretched: a new sub-issue of kd#1, a new row here, a change log line saying why (done once: the interface type roles of kd#176 became slice 1b, kd#190).

## Step 6: lock-in

Tracked as kd#182, after all look slices.

- Lower the ratchet baselines to the new counts; add a guard for each rule that `DESIGN.md` "Guards" lists as stated but not yet checked (line heights from the size tokens only, the icon size scale, one solid green button per view, `aria-current` on exactly one control, no shadow on a control), or drop the rule with a reason.
- Re-shoot the FigCraft category frames from `/ui`.
- Close or drop the remaining rows of `docs/design/backlog.md`.
- Compare with the starting numbers under "Goal" and write the result here.

## Who does what

| Work | Agent alone | Agent prepares, owner decides | Owner only |
|---|---|---|---|
| Step 1, all four parts | yes: measured from `/ui`, the manifest and the token files | – | reading the summary |
| Step 2 labels | yes for the five mechanical labels | each challenged rule (expected: a short list) | – |
| Step 3a brief | writes it from the owner's inputs, restarts the old prototypes, reads the Mobbin collection | confirming the brief | the favourite, the inspiration, the statements |
| Step 3b prototype variants, contrast checks, build sizes, Impeccable scan | yes | which interpretation; the parked layout decisions | taste |
| Step 3 mechanics | proposes and implements the state and motion language | – | feeling drag, transitions and touch in the running app, on a real phone and in the desktop app |
| Step 4 tokens, variant lists, `DESIGN.md` draft | yes | every changed principle, token and rule; any change to the primary palette | approving new or changed `decided` copy terms |
| Step 5 slices, tests, baselines, code review | yes, through the Specify and Build lanes | merge if a slice is held | a look at each slice's screenshots; the desktop app check (`npm run tauri:dev`) |
| Step 6 | yes | – | final sign-off |

In short: measuring, tracing, prototyping, rewriting and migrating can be done by agents. The owner's part is about five kinds of input: the direction (favourite, inspiration and statements, then a pick among the interpretations), the challenged rules, the three layout decisions, approval of the rewritten `DESIGN.md`, and feel-checks of the running app.

## Change log

- 2026-11-11: plan created. Procedure changed from the first sketch: the inventory and consolidation steps are replaced by a pointer to epic kd#58, which already did them; what remains of them is the gap audit (step 1). Step 3 now rebuilds the prototype on the cleaned kit and uses `/ui` as a review surface.
- 2026-11-11: step 1 done: `docs/design/redesign-gap-audit.md` (foundations as rendered, merge candidates per user job, mechanics matrix, delta since step 0). Measured with a throwaway Playwright script against `nuxt dev`; the mechanics use forced pseudo-states, so drag, script-set states and motion feel are not covered and stay with step 3. Step 2 is next and no longer waits; one new owner question (the focus ring).
- 2026-11-11: the focus ring question of step 1 is answered by the owner: one ring, Nuxt UI's soft halo, on every control (`DESIGN.md` "Focus", `--focus-ring-*`). The solid 2 px ink ring and its 3:1 contrast guard are gone on purpose; step 3 may still restyle the ring as part of the state language.
- 2026-11-11: step 3 now starts with a direction brief built from three owner inputs (favourite of the round-2 prototypes, web inspiration, general statements) and round 3 shows interpretations of that brief. Mobbin added as reference material for steps 1 to 4. Added "How we work on it" (a fresh session per step, this file as the handoff) and "Open questions for the owner".
- 2026-11-11: step 3a written: the direction brief is in the body of kd#1, built from the owner's comment (remarks on the round-2 prototypes, five inspiration images, the Mobbin collection "kan-do Redesign"). D2 of kd#1 is answered as a mix of properties, not one favourite; the yellow canvas is no longer the leading idea (calm warm canvas, lifted bright sheets, serif headings, muted green accent). The old prototypes were not restarted: the owner's remarks made that unnecessary. Four rule proposals went through `design-rule` and sit in the brief; the rules they contradict ("type and space, not boxes", The Only Cards Float Rule, one typeface, The Frozen Primary Rule, Done Teal) are input for step 2. Round 3 is planned as three interpretations (Paper and Green, Sand Desk, Ink Edge) and waits for the confirmation.
- 2026-11-11: step 3a confirmed by the owner; step 3b round 3 built and shown. Three interpretations (a Paper and Green, b Sand Desk, c Ink Edge) on branch `proto/1-visual-redesign`, as one stylesheet of token blocks switched by `?variant=` on every route and on `/ui` (the branch ships `/ui` in its preview build). Shared by all three: one green for action and done, white sheets for settings sections and statistics tiles, a serif for headings, one warm shadow colour, one state language (cursor, press, disabled, card hover and press, three durations). Checked: axe contrast 0 failures per variant on five surfaces at 1280 and 390, Impeccable rendered scan 0 findings, production build. Not covered by the round, and said so on the issue: the statistics task view (U7), the look-independent merge candidates of the gap audit (button sizes, `ListRow` density, `ChoiceChip` shapes, field heights), drag and drop motion, the desktop app. The page title scale (U18) is shown only through the column names (36, 32 and 22 px). Step 2 (rule review) is still open and can run next, in parallel to the owner's pick.
- 2026-11-11: round 3 answered, round 4 built and shown. The owner picked a Paper and Green with a slightly darker paper and, from Sand Desk, the near-black text, the flat white pills and the deeper shadows, and asked for one more divergent round: that mix as the new a (Paper Desk), two new interpretations that each leave it in one direction (b Clay Desk: greige canvas, long shadows, a soft heavy serif, the Jetzt task as a deep pine sheet with a terracotta timebox; c Ink and Marker: cream canvas, hairline sheets, lane rules, ink for the primary button and the current place, yellow marker on Jetzt), and the heading font as a separate toggle on every variant (`?font=`: Newsreader, Fraunces, Young Serif, Besley, today's sans). Flat pills and the darker-canvas fill logic moved into the shared block. Checked as in round 3 (axe contrast 0 failures on five surfaces at two widths with each variant's default font, Impeccable rendered scan advisory notes only, production build). Round 3's Sand Desk and Ink Edge remain in the branch history (commit `04aae3eb`); round 4 is `eb3604ae`.
- 2026-11-11: step 3 done. After round 4 the owner chose a Paper Desk with Fraunces and added the yellow marker of c on the Jetzt headline, with the statement that this marker decoration is allowed in the app in slight, intentional use. The final state was shown once more (round 5 on kd#1, contrast check 0 failures at both widths) and written into the body of kd#1 as `## UX decision` with new acceptance criteria; the issue moved from `needs-design` to `needs-spec` and keeps `on-hold` until steps 2 and 4 are through. Rejected: Clay Desk, Ink and Marker except its marker, the other three serifs. Not decided by step 3 and carried on: the statistics task view (U7), the page title scale (U18), the look-independent merge candidates of the gap audit, drag and drop motion. Next: step 2 (rule review), then step 4.
- 2026-11-11: the owner answered parked decision U7: statistics opens the same task sheet as the board, one common sheet. On the owner's request the open questions now carry the step in which they are due, and "How we work on it" says that a session starts its step by interviewing the owner on the questions due for it.
- 2026-11-11: step 2 done: every rule and paragraph of `DESIGN.md` is labelled in the gap audit ("Step 2: rule review of `DESIGN.md`"). Of the 257 body lines roughly 95 are component detail, 35 enforced and 30 duplicates; 17 rules are challenged, 13 of them already answered by the direction decision. The owner answered the other four in the session (One Lamp reworded for green, three line heights built into the size tokens, only sheets cast a shadow with the app bar's nav pill as the exception, two value looks in the task sheet with one height and one behaviour). Three challenged rules stay with the open questions of step 4; two new questions were added there (where "Voice and copy" lives, the radius of a page sheet) and question 2 gained the soft and ghost buttons. Nothing was changed in `DESIGN.md`. Next: step 4.
- 2026-11-11: step 4 drafted. The session opened with the owner interview: button sizes (32 and 36 px), list rows (one density, one hover), choice chips (one chip, one card picker), field heights (36 px everywhere), "Voice and copy" (moves to `docs/copy/`), the sheet radius (16 px) were answered at once. Three questions were answered on the prototype branch, which gained a switch for each (`?type=`, `?btn=`, `?drag=`, commit `968c1861` on `proto/1-visual-redesign`): the heading scale (36 / 22 / 18 px), the neutral button looks (both; the owner asked for a comparison of "soft only" and "both" and then chose both with the row's main action as soft) and drag and drop motion (gentle). Written: `docs/design/redesign-system.md` (token values, closed variant lists, where the text of `DESIGN.md` goes, what step 5 has to know) and `docs/design/DESIGN.next.md` (241 lines against 373). Procedure changed: `DESIGN.md` itself is not edited in step 4; the draft replaces it in the foundations slice of step 5 (reason under "Step 4"). Rows U2, U7 and U18 of `docs/design/backlog.md` are marked decided. Open: the owner's approval of nine points (question 6), then the spec through `/specify-gh-issue`.
- 2026-11-11: step 4 done. The owner approved the nine points of the system definition in the session ("Approved by the owner" in `docs/design/redesign-system.md`). `/specify-gh-issue 1` treated kd#1 as an epic: its body is now the tracker (problem, solution, the UX decision and its user criteria unchanged, the decisions of step 4, the slice table); the direction brief and the design rounds moved into a history comment. Eight sub-issues were created and linked: kd#175 (voice move, `ready`), kd#176 to kd#181 (the six look slices, `needs-spec`, each specified in its own run) and kd#182 (lock-in). Changed against the first plan: seven category slices became six, because feedback and navigation have nothing to merge; the lock-in of step 6 is a sub-issue too. kd#1 lost `on-hold` and `needs-spec` and is `ready` as a tracker. Next: step 5, starting with kd#175 and kd#176.
- 2026-11-11: the plan was brought to the state after step 4 so a fresh session can start from it: a block "Where we are (start here)" at the top (what is decided, what to do next and with which command, what to read, the prototype's limits), "How we work on it" now speaks of a session per slice and says that the issue is the spec in step 5, the decisions are headed as final, and the procedure of step 5 follows the six look slices instead of the seven categories of the first plan. No decision and no state changed.
- 2026-11-11: step 5 started. kd#175 built (PR 185): the wording rules moved to `docs/copy/voice.md` (20 rules, and a guards table for the mechanical part that the registry, `design-patterns.test.ts`, `npm run i18n:check` and ESLint check; the review showed that the registry catches forms to avoid but not when a term is right, so the usage rules stayed as rules against the issue's "not repeated"); `DESIGN.md` keeps a two-line pointer and is 351 lines (was 373); the copy editor's translation agent reads the `## Rules` list of the new file; the references by section name are repointed. Changed against the issue: the note of the decided term `address-du` in `docs/copy/terms.json` was not repointed, because the registry lock pins the note and only the owner runs `npm run terms:approve`; it is listed under "Open questions for the owner" and is due with kd#176. Next: kd#176 (specify, then build).
- 2026-11-11: the open owner action of kd#175 is done: the note of the decided term `address-du` in `docs/copy/terms.json` points to `docs/copy/voice.md`, and the owner approved it with `npm run terms:approve` (lock rewritten, `address-du` the only changed term). No reference by section name is left outside the pointer in `DESIGN.md` and the history documents. Nothing is open for the owner; next is kd#176.
- 2026-11-11: slice 1 specified and built (kd#176, PR 193). Specify measured that desktop control heights are not set anywhere but follow from the 20 px line of `text-sm` plus padding, so line height 1.3 on interface text would have shrunk every control by about 2 px. The slice was therefore cut as its issue foresaw: the line heights of interface, body and label text, `text-body` and the 12 px label are slice 1b (kd#190, after slices 2 and 3, which got the criterion to set explicit heights); the decision is recorded on kd#176. Built in slice 1: `custom-forest` and the warm neutral ramp `custom-paper` (`custom-ink`, `custom-teal` and `stone` are gone), white sheets on paper, the warm shadow set with menus, popovers and toasts on it, Fraunces bundled with the heading roles carrying their line height, numerals moved back to the sans, the state language in the base layer and the theme (hand cursor, press, one disabled look, soft fill on the canvas), the marker on Jetzt, flat app bar pills (the glass code and `app-nav-glass.test.ts` removed), the `DESIGN.md` swap (239 lines against 351), `PRODUCT.md`, the references by section name repointed in 32 files, and the details that left `DESIGN.md` checked against their doc blocks (eight were missing and added). Contrast guards now measure against the white sheet, the fill inside a sheet and the paper. Found while building and fixed: the phone's sticky add bar and the sticky end-of-day button showed cards through the new translucent fill. Left for later slices: `.impeccable/design.json` (lock-in), the hand-written `cursor-pointer` classes and `ChoiceChip`'s own press rules (slices 2 and 3), the statistics verdict surface and tile radius (slice 5).
- 2026-11-11: slice 1 merged (kd#176, PR 193). An independent review found three things the swap had broken and one round fixed them: the press scale also shrank the task sheet's title and notes on click (`InlineEditable` now opts out with `.no-press`), the command palette's active row was close to invisible on the white sheet (now `--fill-on-canvas-hover`), and the stack pill and the expanded stack's close button were lighter than the canvas (now `--fill-on-canvas`). Left open as lows: an opacity transition on raw buttons and links, Fraunces shipped as a 360 kB TTF. kd#177, kd#178 and kd#179 are specified (all technical choices two-way, recorded on the issues; statistics opens the sheet through a child route `/statistics/:id`) and in build side by side; their PRs merge one after the other.
- 2026-11-11: review fixes on slice 1 (kd#176, PR 193). The press scale now has an opt-out, `.no-press`, set on InlineEditable's read-mode trigger so the task sheet's title and notes no longer jump before editing opens; the command palette's active row takes `--fill-on-canvas-hover` (the white modal's `--ui-bg-muted` was about 1.07:1); the stack header's close button and the stack pill take `--fill-on-canvas` (hover `--fill-on-canvas-hover`) like the add slot and the app bar's ⋯, since `--ui-bg-muted` is lighter than the paper; the 50 % disabled look skips `[data-disabled]` (Nuxt UI styles those itself); the end-of-day closing line keeps body line height; stale comments (teal, "accented equals muted", the sheet header weight) corrected. Baselines re-recorded: stack-expanded (both widths) and day-close-1280. Still open from the review: the opacity transition on raw buttons and links, and Fraunces as a 360 kB TTF (woff2 later).
- 2026-11-11: slice 2 specified and built (kd#177). Specify measured that `md` (32 px) and `lg` (36 px) already are the two heights, so the slice is the removal of `sm` (35 `UButton` uses), `xs` (1), `subtle` (1) from the call sites and the explicit heights in the `button` theme (`h-8`, `h-9`; the phone floors `min-h-11` and `min-h-12` stay above them). The soft and ghost uses were re-sorted by the rule of the system definition; the PR lists the sites that changed look. Nuxt UI's `sm`, `xl`, `outline` and `subtle` stay in the merged theme (a theme cannot delete a key; its own components and `/ui`'s whole-theme view still reach them, so their contrast stays guarded) but no template uses them and `button-ladder.test.ts` fails on a new use. `xs` stays at 24 px only for the actions Nuxt UI renders in an alert or toast (their own 44 px phone rule).
- 2026-11-11: slice 3 built (kd#178, PR 198). Fields are one height through the `--field-h` token (36 px, 44 px on a phone): the `input`, `select`, `selectMenu` and `textarea` themes take `lg` as default size with an explicit height, so a call site sets no size (the two title fields excepted; `tests/config/field-size.test.ts`), and the task sheet's value rows, `MinutesField` and the chip use the same token. `ChoiceChip` lost its `shape` and `large` props (one pill, `square` for icon-only); the board menu's group-by buttons joined it, `NewCardOptionList` rows took the select menu's item look as native buttons, and the new `ChoiceCard` replaced the welcome page's raw buttons and the local setup's hand-built radio cards. A field that loads is also `disabled` (a call-site rule, guarded). Read against the issue: `InlineEditable` `fill` stays as the hover look of the title and notes (only its row height went). Not done and left to later slices: the title field is 40 px on a phone (own size).
- 2026-11-11: slice 4 built (kd#179). Statistics opens the board's task sheet through the child route `/statistics/:id`: one `TaskSheetHost` and one `TaskSheetDetail` serve `/tasks/:id`, `/tasks/add` and `/statistics/:id`, `useTaskSheet` leaves to the host page, `TaskDetailModal` is deleted. `PageHeader`'s title is the display role (36 px Fraunces), the new-day recap's title lost its own 24/30 px size and is the 18 px dialog title, menus and popovers take the 16 px radius by theme slots, `ListRow` has a link form (`to`) and `SettingsSubpageLink` is deleted. Measured first: dialog titles, menu and toast shadows, tabs and the nav indicator were already as decided by slice 1; `aria-current` was already on one control per route and is now guarded.
- 2026-11-12: slices 2, 3 and 4 merged (kd#178 in PR 198, kd#179 in PR 199, kd#177 in PR 197, in that order; each later PR merged `main` in and re-recorded its baselines first). Each got an independent review and one or two fix rounds. What the reviews caught: in slice 3 a disabled select of the task sheet dimmed to 75 %, and the 44 px floor had been widened to touch screens at desktop width, which the owner had not decided (it is back to "on a phone"; the wider floor is a possible follow-up for the owner); in slice 4 opening a task on statistics scrolled the page to the top and the page behind the sheet was not dimmed; in slice 2 the Mehr panel's sync button overflowed its box, the catalog still showed the whole button matrix, and buttons set through prop objects kept the removed sizes, which the ladder test now sees. The Impeccable gate ran as isolated assessments on all three (audit 15 to 17, 14 to 16 and 15 to 16 of 20). Left open as lows in the PRs and as inbox issues kd#200 and kd#201 (the desktop task sheet has no visible close control). Next: kd#180 and kd#190, one after the other.
- 2026-11-12: side findings of slices 1 to 4 built in one PR (kd#195, kd#200, kd#201; not a slice). kd#195: a disabled element inside another disabled-looking one stays at 50 % (an unlayered nested reset in `main.css`; it was 25 %), `opacity` left the base layer's state transition (raw buttons and links no longer fade), and Fraunces is a 195 kB woff2 instead of the 360 kB TTF; the `text-lg` line height stays with slice 1b (kd#190). kd#200: a checked `ChoiceCard` is the primary wash with a primary border and mark (not a solid fill: The One Lamp Rule), `ChoiceCard` takes the 12 px corner (it rendered 24 px through `rounded-xl`), and the welcome flow's "Zur Auswahl" is a text button without the arrow (the way back stays, so no flow changed). kd#201: the task sheet shows the shell's close button at 768 px and up (the phone drawer keeps swipe); `:close-button="false"` had no recorded reason. Left for later: the welcome sheet's own 32 px corner (`DESIGN.md`: 16 px for every sheet) is an `inbox` issue.
- 2026-11-12: slice 5 built (kd#180). `PageSheet` (`components/ui/PageSheet.vue`) is the one page surface: 16 px radius, the cards' resting shadow, 24 px padding (32 px from `md`); settings sections and sub-pages, the Notion settings sections, the statistics verdict, tiles and the all-tasks disclosure, the trash header and the topics panel sit on it, never a sheet on a sheet (the trash entries stay the board's cards on the canvas). The welcome sheet takes the same radius (16 px) and shadow. `StatsTile`'s two tones and the verdict's wash are gone. `ListRow` has one density (`min-h-11 py-2`, 44 px) and one hover (`bg-muted`, because `bg-elevated` is white and invisible on a sheet); `DayCloseTaskRow`, the done and deleted rows of the end-of-day dialog and the "more sources" rows are `ListRow`s. `SectionHeader` is the one heading with a closed `size` (`hero`, `display`, `headline`, `sub`, `label`); the `section-heading` utility and the hand-written `font-display` strings are deleted (the column header, the wordmark, the task sheet's title and `/ui` keep their own). One badge size (`md` at 12 px, 20 px high) and `TaskPriorityBadge` without a `size` prop. The radius scale is closed at 8, 12 and 16 px: the 4 px marker and mask corners, the 6 px topic symbol well, the 15 px progress bar chip and the 24, 32 and 48 px surfaces moved; paddings of 10 and 14 px moved (`md` buttons to 12 px, the app bar places to 16 px, stack pill and progress chip to 8 px). Left for kd#181: the board card's own padding (`px-2.5` in the `card` theme) and the 2 px particles of the completion burst. `tests/config/display-layout.test.ts` holds the deleted looks at zero. Next: kd#190 alone, then kd#181, then kd#182.
- 2026-11-12: slice 1b built (kd#190). The interface and label roles carry their line height in the size tokens: `--text-sm` and `--text-xs` 1.3, `--text-label` is 12 px / 1.3 (11 px is gone, also the `text-2xs` utility and the 11 px of the sort control, the stack pill, the carry-over dots and the progress chip, which had a 12 px step on a phone only), and reading text is the one `text-body` utility (`@utility`, 14 px / 1.55; `text-body` is also the `description` slot of the modal, slideover, drawer and alert themes). About 70 `<p>` of settings, statistics, dialog and empty-state copy moved from `text-sm` to `text-body`. Specify measured on `/ui` (726 samples, both widths) that buttons, fields, selects, chips and list rows already kept their height from slices 2, 3 and 5; only the tabs trigger followed its text line (now `h-6` to `h-9` in the `tabs` theme). What still changes height is content: alerts, tables, textareas, notes and wrapped labels get shorter by design (listed in the PR). Hand-written line heights of 1rem, 1.25rem, 1.5rem and 1.75rem became `var(--lh-snug)` with an explicit row height where the box depended on them; the timebox nudge keeps 1.25rem (its rows sit at fixed offsets: `timebox-nudge.spec.ts` hovers the centre of the card). What stays are `var(--lh-*)` next to a scoped `font-size: var(--text-*)` (CSS cannot read the token's line height), `line-height: 1` on single-line boxes of fixed height, and the closing line of the end-of-day dialog. Not done: the phone steps of the type table (15 px and 16 px), see "Where we are". 66 visual baselines and 19 `/ui` fingerprint files re-recorded (only `line-height` and three `font-size` values moved in the fingerprint).
