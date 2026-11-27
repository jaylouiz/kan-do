# issue-workflow profile: kan-do

<!-- profile-template: 1 -->

<!-- Read by design-gh-issue, specify-gh-issue, build-gh-issue, orchestrate-gh-issues and workflow-retro
     (the maintainer's agent-workflow skills, https://github.com/jaylouiz/agent-workflow, linked as ~/.claude/agent-workflow;
     contributors without them follow CONTRIBUTING.md). Project facts only; the method lives in the skills.
     CLAUDE.md (plus its path-scoped `.claude/rules/` and project skills) stays the source for commands, invariants and testing rules; this file points into it. -->
<!-- Partials: every `##` heading stays; a long section is a short index plus one pointer line to its `.claude/issue-workflow/<slug>.md`, with a "read when".
     The partial holds the rules: follow the pointer when the step needs it and add new rules there. Budget 15 KB (`settings.sh profile`). -->

## Labels

- lanes: `needs-design` → `needs-spec` → `ready`
- hold: `on-hold-after-spec` = stop after Specify, no Build
- context labels triage may add: `new-feature`, `enhancement`, `polish`, `consistency`, `a11y`, `bug`, `dev-improvement`
- `inbox`, `rule-candidate` (a design-rule proposal waiting for the user, see "Design feedback") and `wayfinder:*` issues are never in a lane

## Sources

- product: `PRODUCT.md`, `docs/application-purpose.md`, `docs/acceptance-criteria.md`
- design system: `DESIGN.md` (direction, tokens, named rules, recurring patterns; frozen `custom-forest` palette), `app.config.ts`, `assets/css/`; per-component detail (values, timings, accepted trade-offs) lives in the component's doc block and CSS comments
- design backlog / audits: an issue naming an ID like `C9` or `A13` → that entry in `docs/design/backlog.md` and the matching finding in `docs/design/audit-2026-10.md`. Done work strikes the backlog entry as `~~...~~ - done <date>`.
- UI copy: German first, English too; every string an i18n key (CLAUDE.md "Language Policy"); draft and final copy: section "Copy".

## Jobs

- list: `PRODUCT.md` "Jobs to be done", J1-J6 (`Job: J4 Get the planned work done`).

## Design quality

Impeccable plugin (`/impeccable <verb>`). Mode for app surfaces: Operate. Slots (brief, current-state review, variant lenses, element look, build, gate, polish / detector, design records, hooks):
Full text: .claude/issue-workflow/design-quality.md (read when: a Design step that fills a slot, Build step 4 and the gate in step 5, review of a UI PR)
- build: search the kit first, `npm run ui:find -- <user-task words>`, then `/ui` ("Pattern check")
- gate (UI PRs): one design review of the built result, `/impeccable critique <target>`; **hard gate:** no `gh pr create` for a UI PR without its findings in the PR body, or the concrete error

## Copy

- draft rules (prototypes, sketches, ASCII layouts): real draft wording in German, never lorem ipsum; "du"; sentence case; the real column names `Offen`, `Jetzt`, `Wartet`, `Erledigt`; no middle dot. Nothing more: wording is not polished in Design rounds, feedback on it waits for the copy pass.
- copy inventory: every text element of a variant with its purpose, or `convention` when it is there only because the component has the slot or it is the usual thing.
- copy pass: the `copy-writer` skill, section "Copy pass" (rules `docs/copy/voice.md`, registry `docs/copy/terms.json`); it returns the `### UI copy` table.
- Build: implement `### UI copy` verbatim as i18n keys; an issue without it gets the copy pass before the PR (its table goes into the PR body). `/impeccable clarify` does not rewrite copy that came from the table.

## Default acceptance criteria (UI)

Add these to every UI spec unless they do not apply:
- [ ] Empty, loading and error states handled (a new or changed state gets its ARIA snapshot in `tests/e2e/state-structure.spec.ts`)
- [ ] Works at 390px and on desktop (light only, see DESIGN.md)
- [ ] All UI copy via i18n keys, present in `de.json` and `en.json` (`npm run i18n:check`)
- [ ] Keyboard and screen-reader behaviour correct; contrast meets WCAG 2.2 AA
- [ ] Nuxt UI semantic tokens only: no raw hex, palette classes or arbitrary values
- [ ] A time-scoped group or panel handles its stale case (open past the boundary: midnight, day close)
- [ ] A create or push path of a synced source: test a fetch landing before the push (no duplicate, no overwrite)
- [ ] The design review (profile "Design quality", gate) leaves no P0/P1 the PR introduced
- [ ] (only if the UX decision left a look choice open) variants compared with `/impeccable live`, choice noted in the PR

## Components

Nuxt UI MCP (`get-component-metadata`, `search-components`) or `.nuxt/ui/<component>.ts`. Never guess props or slot names.

## Screenshots

- tool: `playwright-cli` skill (no Chrome installed: a script with the repo's `playwright` chromium, CLAUDE.md "Testing"); seed first (`/tasks?seed=local`), then open the task sheet from the board or `goto /tasks/seed-open-1`; a detail URL without the seed step loses the seed
- widths: 1280 and 390; light only
- entry URL: `http://localhost:<port>/tasks?seed=local` (`?seed=dayclose` for the end-of-day dialog, `?seed=notion` with `npm run dev:e2e`; a seed switches the Jetzt focus overlay off, `&focus=1` shows it)
- phone browser chrome, desktop-only pages, seeking animations, motion filmstrips, completion effects at 390px, WebKit, embedding shots: the partial

Full text: .claude/issue-workflow/screenshots.md (read when: a shot beyond the board or task sheet: phone browser chrome, desktop-only pages, motion, completion effects, WebKit; embedding shots in a PR or issue comment)

## Prototype

Throwaway variants on `proto/<n>-<slug>` (own worktree, never PR'd or merged), shown at `/tasks?seed=local&variant=<key>`; local seed data only. Host, switcher, cleanup, share, agent checks and the Look preview:
Full text: .claude/issue-workflow/prototype.md (read when: Design, building or checking a prototype; Build, the Look comment)

## Pattern check

Before a UI element is created or changed, the agent finds the existing Pattern for its user task and decides reuse, align or diverge alone (#586). The procedure loads with any UI file: `.claude/rules/ui-patterns.md` (also for ad-hoc edits outside the lanes).
- record: one `Pattern: <job> → reused|aligned with|diverged from|new …` line per decision, or `Pattern: none (<why>)`; grammar in the rule file. Lane work puts the lines in the PR body (design: the variants comment and the `## UX decision` `**Patterns:**` line); ad-hoc work puts them in the final report. The user vetoes afterwards; nothing waits for them.
- gate: `wf_pr_body_check` (`.claude/issue-workflow.sh`) blocks `gh pr create` when the diff touches `components/**/*.vue`, `pages/**/*.vue`, `layouts/**` or `app.vue` and the body has no valid `Pattern:` line. A `diverged from` line also needs `Rule candidate: #<n>` or `Rule candidate: none (<reason>)` (see "Design feedback").
- reviewer: each new or changed component under `components/` has a line; spot-check one `reused` or `aligned with` claim against the named element.

## Design feedback

A design reason from the user ("because…", "so that…") builds the design framework only through a proposal the user adopts (#587). Skill: `.claude/skills/design-rule`.
- channels: chat in any session, PR review and issue comments, prototype comments and decision answers, canvas threads (`.claude/ui-canvas.md`), and a `diverged from` reason from the Pattern check. A bare preference without a reason is applied and not turned into a rule.
- flow: apply the request, challenge the reason (convention, `PRODUCT.md`, `DESIGN.md`), one verdict (`matches convention`, `conflicts`, `personal preference only`), propose. User in the session: the proposal is in the reply and the user adopts, declines or keeps it a one-off on the spot. Nobody there (orchestrated worker, PR): a `rule-candidate` issue, referenced from the PR as `Rule candidate: #<n>`; the user adopts later with "adopt #<n>".
- writes: an agent never writes the rule before the user's explicit yes. A DESIGN.md named rule is already a one-way item under "Decisions": the user's adoption is that decision, so an orchestrated worker never makes it.
- list open proposals: `gh issue list --label rule-candidate`

## Canvas

`/ui-canvas` with `.claude/ui-canvas.md` (FigCraft, frame = screen name, variants `<frame>/v<n>`).

## Risk areas

Changes here are expensive or fragile; they raise the tech-check rating and get a separate reviewer (globs: `WF_RISK_GLOBS` in `.claude/issue-workflow.sh`, kept in step with this list):
- `store/` (esp. `tasks.ts` merge logic), `composables/useTaskSync.ts`, `integrations/`, server API routes
- drag-and-drop (`useBoardDndKit.ts`, stacks, WIP limit on Jetzt): `.claude/rules/drag-and-drop.md`
- persisted data shape, `PERSISTED_KEYS`, desktop data file and its guard (`src-tauri/`)
- the frozen `custom-forest` palette; DESIGN.md principles, named rules and tokens
- anything that moves visual-regression baselines (`tests/e2e/snapshots/`)
- E2E per risk area (#446): there is no full-suite tier per PR. `.claude/hooks/e2e-gate.json` maps each area above (and shared test and build infrastructure) to the specs that exercise it (`area` names the reason); a new risk area or a new file in one gets its `map` rule in the same PR (a guard test fails on an unmapped file). Specify names the specs at risk in the spec's "E2E at risk" line; the builder lists them as `E2E-specs:`; the reviewer checks that line against the diff and adds what is missing

## Branches

- name: `<type>/<n>-<kebab-slug>`, type `fix|feat|test|docs|chore`
- `.claude/settings.json` allows `rm src-tauri/target`, its `ln -s` from the main checkout and `rm -rf dist` / `.e2e-build` / `tests/e2e/playwright-report` / `tests/e2e/test-results` without a prompt: one path per `rm` call, never chained with git (a chained or multi-path `rm` stops an unattended worker at a prompt)
- a lone modified `package-lock.json` is Orca's setup `npm install` rewrite: `git checkout -- package-lock.json` before a rebase, never commit it.
- a worktree made by hand (`git worktree add`, e.g. from a session that already sits in a worktree) gets no `node_modules`: `ln -s <main checkout>/node_modules node_modules`, then `npx nuxt prepare`; only worktrees the harness creates are linked (`worktree.symlinkDirectories`). An Orca worktree has its own real `node_modules` from the setup `npm install`: never link there (`ls -d node_modules` first).

## Verification

Full text: .claude/issue-workflow/verification.md (read when: Build step 5, Specify sizing)
- testing mode (#693): `.claude/testing-mode` holds `fast` or `quality` (default and fallback `quality`); read it before writing tests or choosing checks (what `fast` trims: the partial)
- gate command: `npm run verify` (lint:ci, typecheck, vitest; the Stop hook runs the same)
- E2E: `PORT=<free port> npm run test:e2e -- tests/e2e/<name>.spec.ts`, always the production build, never `nuxt dev`; list the specs you ran as `E2E-specs: a b c` (basenames) in the PR body
- gate tier before READY: `gh pr view <pr> --json files,body,baseRefName,headRefOid | node scripts/e2e-gate.mjs`, run what its `tier` says (tiers: `.claude/rules/e2e-gate.md`)
- repeat-run command: `PORT=<free> npx playwright test -c tests/e2e/playwright.config.ts <file> --repeat-each=<n> --retries=0 --workers=4` (`--workers=1` for timing), on a production build: 10 runs for a new timing test, 30 as the flake proof, result in the PR body
- in the partial, by kind of change: regression tests, build config, visual baselines, flakes, terms, DnD, motion, performance, spacing, Rust

## Pull requests

- screenshots: `gh pr create --attach '<path>.png#alt'` with `![alt](<same path, without #alt>)` in the body file, from a space-free absolute path (`/tmp/kd-<n>/`); never commit screenshots or link branch image URLs. Path pitfalls, later edits, issue comments with images: `.claude/issue-workflow/screenshots.md`
- write the body file complete before `gh pr create` (the guard reads the file, not a later `sed`); the `E2E-specs:` line holds bare names: `E2E-specs: smoke task-detail` (no `tests/e2e/`, no `.spec.ts`)
- required in body (the guard hook checks `Closes`, attribution, `E2E-specs:` and the `Pattern:` lines): ACs as a checklist with evidence, the `E2E-specs: a b c` line, `Pattern:` lines when the diff touches UI source files ("Pattern check"), `## Review` (orchestrated runs: the lead template), the design review's findings (P0/P1 fixed or why not, P2/P3 listed) (UI), 1-3 result screenshots (UI), `inbox` issues filed, anything left out

## Decisions

User decision 2026-10-30. Rule, labels and `decide.sh`: `/orchestrate-gh-issues` section 5.
- one-way (a decision request, the issue parks): a Design round of a `needs-design` issue; changing a DESIGN.md principle, named rule or token other than the palette (detail that lives in code, such as timings, sizes or a component's exact look, is two-way: decide, record it in the issue and the component's doc block); deleting or rewriting existing user data (persisted state, Notion/Todoist/GitHub content); release or other outward-facing actions; switching the testing mode or weakening a verification gate (Stop hook, pre-merge E2E gate, release checks; #693); a held merge; low confidence on something expensive to undo
- explicitly two-way (decide, record in `## Decisions` + `decide.sh record`, continue, merge): technical structure (e.g. a separate settings store vs. reusing a store); `custom-forest` palette changes (also recorded in DESIGN.md); integration changes that hit no one-way item; data model or persisted-shape changes, provided old persisted data still loads (migration or backward-compatible read, covered by a test); a scope change against the issue that the coordinator (standalone: the reviewer) agrees is reasonable
- digest cap: 2h (`--cap 7200`, the script default)

## Orchestration

Runner: Orca, max 5 concurrent workers; executable facts (ports, risk globs, verify/build, after-merge steps, deploy check, PR-body check): `.claude/issue-workflow.sh`. Load rules, serializing, the merge gate, Notion contract runs, CI reruns, merging yourself, after merge:
Full text: .claude/issue-workflow/orchestration.md (read when: Orchestrate, the coordinator; merging a PR yourself)

## Retro

Running log `.claude/retro-log.md`. Context files, metric sources (`checks.tsv`), escapes and where edits land:
Full text: .claude/issue-workflow/retro.md (read when: Retro)
