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
| 1 | Gap audit: what step 0 did not look at | **done** 2026-11-11 (`docs/design/redesign-gap-audit.md`) | agent runs, owner reads |
| 2 | Rule review of `DESIGN.md` | **done** 2026-11-11 ("Step 2: rule review of `DESIGN.md`" in `docs/design/redesign-gap-audit.md`; four challenged rules answered by the owner) | owner, per challenged rule |
| 3 | Visual direction on the cleaned kit | **done** 2026-11-11: Paper Desk with Fraunces and the yellow marker on the Jetzt headline (`## UX decision` in the body of kd#1; prototype branch `proto/1-visual-redesign`, commit `15b65260`) | owner |
| 4 | System definition: foundations and the rewritten `DESIGN.md` | **next** (starts with the three open questions below) | owner approves |
| 5 | Migration in slices | not started | agents; owner feel-checks |
| 6 | Lock-in: guards, baselines, canvas | not started | agents |

Steps 2 and 3 are both done; step 4 builds on the labels of step 2 and the decision of step 3.

## How we work on it

The owner and an agent work through the plan together, one step (or one clearly cut part of a step) per session.

- **A fresh session per step.** Start it with: "Continue the redesign: read `docs/design/redesign-plan.md` and do the next step." Everything a session needs is in this file and in the documents it points to; nothing is carried in a chat history.
- **A session ends with a handoff here:** status table, change log, and any question for the owner under "Open questions for the owner" below, so questions are answered in one go and not scattered over chats.
- **A session starts with the owner's open questions for its step.** Before any work on a step, the agent reads "Open questions for the owner" and interviews the owner in the session (one question at a time, with a recommendation, through the question dialog) on every question listed there for the step it is about to do. A question that is not due yet stays in the list. Answers are written back into this file in the same session. A session without the owner present (a worker, a scheduled run) stops at the first due question and hands back.
- **Inside a session** the agent works in the conversation with the owner. It uses sub-agents only for work that is wide and independent (measuring many components in step 1, reading references), and the Orca lanes (`/design-gh-issue`, `/specify-gh-issue`, `/build-gh-issue`, `/orchestrate-gh-issues`) for the prototype rounds of step 3 and the slices of step 5.
- **Interactive on purpose:** step 2 (challenged rules) and step 3 (direction) are conversations with the owner. Steps 1, 5 and 6 run mostly unattended and end with something to read or look at.

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

The look is decided (kd#1, `## UX decision`). Each question names the step in which it is due; the session doing that step asks it first (see "How we work on it").

| # | Question | Due | Recommendation |
|---|---|---|---|
| 1 | The page title scale beyond the column names (parked decision U18): which sizes do page titles, section headings and dialog titles get in Fraunces? The prototype only shows the column names at 36 px. | start of step 4 (type scale) | show two or three scales on the prototype branch, then ask |
| 2 | The merge candidates of the gap audit that do not depend on the look: button sizes, neutral soft and ghost buttons as two looks (added by step 2), `ListRow` density, `ChoiceChip` shapes, field heights (the one row height of the task sheet's value controls is part of it). Which variants go? | start of step 4 (closing the variant lists) | one question per candidate, each with the audit's numbers |
| 4 | Where does "Voice and copy" live? Step 2 proposes to move the section (25 lines) next to its registry in `docs/copy/`, with a pointer in `DESIGN.md`. | step 4, before the rewrite of `DESIGN.md` | move it |
| 5 | A page sheet (settings section, statistics tile): the card's radius, or its own (the prototype used the card radius times 1.25)? | start of step 4 (radius) | the card's radius: one surface shape |
| 3 | Drag and drop motion: the prototype changed only the shadows. Should lifting, moving and dropping a card get the new state language (durations, curves, the "set down" feel), and how strong? | start of step 4 (motion), tried in a coded prototype before asking | – |

Decided by the owner on 2026-11-11 and to be written down in step 4 (nothing of this is in `DESIGN.md` or `PRODUCT.md` yet):
- The four rule proposals of the brief: a warm neutral canvas, never a saturated one; a muted green as the colour of action, red for exceptions; a serif for headings, the sans for everything read and operated; everything entered or edited sits on a bright lifted sheet, one level only.
- Done may use the accent green. The green is locked with the pick: forest green, hue 152.
- The heading font is Fraunces. The design detector calls it an overused face; the owner chose it knowingly against Newsreader, Young Serif and Besley.
- Text is near-black; shadows are the deeper warm set; the app bar row (parked decision U2) uses flat white pills, no glass.
- A yellow text-marker stroke is an allowed decoration "with slight intentional use"; the Jetzt headline is its first use.
- Statistics opens the same task sheet as the board: one common sheet, one way to open a task (parked decision U7, answered 2026-11-11).
- The four challenged rules of step 2 (answered 2026-11-11, detail in the gap audit, "Asked in this step"): The One Lamp Rule stays as "one solid green button per view; marks, selected options, links and the focus ring are green without being a fill". The three line heights stay and are built into the size tokens. Only sheets cast a shadow, with the app bar's nav pill as the named exception; a control never casts one. The task sheet keeps its two value looks (a select with a chevron, text on a dotted rule) with one row height and one hover, focus and disabled answer.
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
