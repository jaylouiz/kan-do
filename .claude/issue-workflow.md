# issue-workflow profile: kan-do

<!-- Read by design-gh-issue, specify-gh-issue, build-gh-issue, orchestrate-gh-issues and workflow-retro
     (the maintainer's agent-workflow skills, https://github.com/jaylouiz/agent-workflow, linked as ~/.claude/agent-workflow;
     contributors without them follow CONTRIBUTING.md). Project facts only; the method lives in the skills.
     CLAUDE.md (plus its path-scoped `.claude/rules/` and project skills) stays the source for commands, invariants and testing rules; this file points into it. -->

## Labels

- lanes: `needs-design` → `needs-spec` → `ready`
- hold: `on-hold-after-spec` = stop after Specify, no Build
- context labels triage may add: `new-feature`, `enhancement`, `polish`, `consistency`, `a11y`, `bug`, `dev-improvement`
- `inbox`, `rule-candidate` (a design-rule proposal waiting for the user, see "Design feedback") and `wayfinder:*` issues are never in a lane

## Sources

- product: `PRODUCT.md`, `docs/application-purpose.md`, `docs/acceptance-criteria.md`
- design system: `DESIGN.md` (direction, tokens, named rules, recurring patterns; frozen `custom-forest` palette), `app.config.ts`, `assets/css/`; per-component detail (values, timings, accepted trade-offs) lives in the component's doc block and CSS comments
- design backlog / audits: an issue naming an ID like `C9` or `A13` → that entry in `docs/design/backlog.md` and the matching finding in `docs/design/audit-2026-10.md`. Done work strikes the backlog entry as `~~...~~ - done <date>`.
- UI copy: German first, English too; every string an i18n key (CLAUDE.md "Language Policy"). Sketches and ASCII layouts use the real column names `Offen`, `Jetzt`, `Wartet`, `Erledigt` and real copy, never lorem ipsum.

## Jobs

- list: `PRODUCT.md` "Jobs to be done", J1-J6 (`Job: J4 Get the planned work done`).

## Design quality

Impeccable plugin (`/impeccable <verb>`). Mode for app surfaces: Operate.
- brief: `/impeccable shape <goal>`; interview when interactive, asserted from the issue, PRODUCT.md and DESIGN.md when a worker.
- current-state review: `/impeccable critique <target>` and `/impeccable audit <target>`.
- variant lenses: `distill` (simpler), `onboard` (first run, empty states), `clarify` (copy), `adapt` (390px behaviour). Use them as thinking lenses while drafting; do not run them on code in Design.
- element look: `/impeccable generate <n> <action> <element>` or `/impeccable live` on a running dev server. Element-level look only (a header, a card), never structure or flow. It is not a wireframe tool: it writes styled variants into source.
- build: before creating a UI element, search the kit first: `npm run ui:find -- <job words>` (manifest), then `/ui` (Pattern check, `.claude/rules/ui-patterns.md`). Then `/impeccable <outcome and target, plus what to keep>` with the spec's brief and ACs; refinement verbs only where the spec calls for them: `layout`, `typeset`, `clarify`, `adapt`, `harden`, `animate`, `colorize`. Run `/impeccable hooks status` first; if off, tell the user (`/impeccable hooks on`).
- gate (UI PRs): `/impeccable audit <target>` and `/impeccable critique <target>` (two isolated assessment sub-agents, real before/after scores, fix every P0/P1); the full procedure: `docs/design/impeccable-gate.md`, read it before the gate. **Hard gate:** no `gh pr create` for a UI PR without both scores or the concrete error.
- polish / detector: `/impeccable polish <target>`, re-run `audit`; the source scan `npm run design:detect` (pinned `impeccable` devDependency) is part of `npm run verify` and the Stop hook, so it gates every session (cloud too); exit 2 = findings: fix or record a justified ignore (`npx impeccable hooks ignore-value <rule> <value>`). Rendered scan: `tests/e2e/design-detect.spec.ts` (surfaces × 1280/390 through `detect --cdp`, open findings in its `KNOWN_FINDINGS` with an issue) and ARIA state snapshots `tests/e2e/state-structure.spec.ts` run in the pre-merge gate for every UI-path PR (`design` in `.claude/hooks/e2e-gate.json`); an ad-hoc URL scan: CLAUDE.md "Commands".
  Detector notes (`.vue` regex-only, the rejected html engine, baseline and ignores, WCAG 2.2 touch targets, upgrading): `docs/design/impeccable-gate.md`.
- design records: a pattern repeated 3+ times with the same intent → `/impeccable extract <area>`; a changed DESIGN.md rule, token or pattern → `/impeccable document` (asks before overwriting); per-issue detail goes to the component's doc block, not DESIGN.md.
- hooks: Impeccable's own detector hook stays on, also on proto branches; per edit it reports only its immediate tier, contrast and tiny text come from the Stop hook's rendered scan and the pre-merge `design-detect` spec.

## Default acceptance criteria (UI)

Add these to every UI spec unless they do not apply:
- [ ] Empty, loading and error states handled (a new or changed state gets its ARIA snapshot in `tests/e2e/state-structure.spec.ts`)
- [ ] Works at 390px and on desktop (light only, see DESIGN.md)
- [ ] All UI copy via i18n keys, present in `de.json` and `en.json` (`npm run i18n:check`)
- [ ] Keyboard and screen-reader behaviour correct; contrast meets WCAG 2.2 AA
- [ ] Nuxt UI semantic tokens only: no raw hex, palette classes or arbitrary values
- [ ] `/impeccable audit` has no P0/P1 findings on the touched files
- [ ] (only if the UX decision left a look choice open) variants compared with `/impeccable live`, choice noted in the PR

## Components

Nuxt UI MCP (`get-component-metadata`, `search-components`) or `.nuxt/ui/<component>.ts`. Never guess props or slot names.

## Screenshots

- tool: `playwright-cli` skill (no Chrome installed: a script with the repo's `playwright` chromium, CLAUDE.md "Testing"); seed first (`/tasks?seed=local`), then open the task sheet from the board or `goto /tasks/seed-open-1`; a detail URL without the seed step loses the seed
- widths: 1280 and 390; light only
- entry URL: `http://localhost:<port>/tasks?seed=local` (`?seed=dayclose` for the end-of-day dialog, `?seed=notion` with `npm run dev:e2e`; a seed switches the Jetzt focus overlay off, `&focus=1` shows it)
- phone browser chrome (Safari's toolbar and status bar tint, safe areas): the iOS simulator runs the local dev server, `xcrun simctl boot <device>`, `xcrun simctl openurl <device> "http://localhost:<port>/…"`, `xcrun simctl io <device> screenshot <file>` (kd#207; Playwright shows no browser bars)
- desktop-only pages (`/settings/data`, `/settings/github`): `desktop-pages-shots.spec.ts` (skill `desktop-verify`)
- motion (stack collapse and other script animations): `npm run motion:film` (paused, seeked filmstrips plus jump/pop checks; usage in `scripts/motion-film.mts`), in Design and Build alike; it has no nav or app-bar target (#616: use a seeked filmstrip there)
- completion effects at 390px (headless, #692): the mobile board shows one column page; focusing a card in Erledigt switches to that page (`focusin`). To replay a completion effect on that card, push its id into the board store's transient `confirmingTaskIds` (`store/board.ts`) through the page's Pinia instance; say in the round that the shot replays an already-done card. A real completion on desktop: the drag helpers in `.claude/rules/e2e.md`. Seek motion by timing (e.g. 150/350/600 ms) when `motion:film` has no target.
- WebKit (the desktop app's engine): Playwright WebKit screenshots never paint `backdrop-filter`, so they verify layout and the no-blur fallback only; check blur in Chromium, the real WKWebView look is the user's manual check (#615, 20 min lost)

## Prototype

- host: `PORT=<port> npm run dev`, then `/tasks?seed=local&variant=<key>` (seed and variant in one URL: a later `goto` without `seed` shows onboarding); variants mount inside the existing page (board, task sheet, settings page). A new top-level surface gets a route under `pages/prototype/`.
- switcher: `components/prototype/PrototypeSwitcher.vue`, a fixed bottom pill (← key label →, arrow keys outside inputs) that updates `?variant=`. Nuxt names components in that folder `Prototype<Name>`: other proto-only components live outside it or are used by the prefixed name. It is not on `main` as a component: copy the generic `.claude/templates/PrototypeSwitcher.vue.template` there and edit only its `LABELS` map (other proto branches hardwire their own variants and plugins, #692).
- branch: `proto/<n>-<slug>`, own worktree, never PR'd or merged; pushed per round as the record.
- cleanup: `.claude/hooks/cleanup-merged.sh` removes the local worktree, local branch and `origin/proto/<n>-*` once issue #<n> is closed (dirty worktrees skipped); while it is open the branch stays as the Design record.
- proto CSS sits outside `@layer`, so it beats Tailwind utilities too (`max-md:hidden` loses to a proto `display:flex`): switch proto layouts with media queries in the proto CSS, not with utilities
- relaxed: `.claude/hooks/verify.sh` and `eslint-file.sh` skip `proto/*`, so raw German strings, missing tests and lint warnings are fine. Keep `nuxt build` working (the preview deploy builds it).
- share: every pushed `proto/*` branch gets a Vercel preview deployment (`vercel.json` deploys only `main` and `proto/*`, #355; other branches get none: use the local server); once it is built (1-2 min after push), its URL is `id=$(gh api "repos/{owner}/{repo}/deployments?sha=$(git rev-parse HEAD)" --jq '.[0].id'); gh api repos/{owner}/{repo}/deployments/$id/statuses --jq '.[0].environment_url'` (the commit status links only the Vercel dashboard). Seed URLs work there because the web build uses `localStorage`.
- look (Build's Look comment, `ux-impact` issues): PR branches get no preview, so `Preview:` is the Production URL (`gh api 'repos/{owner}/{repo}/deployments?environment=Production&per_page=1' --jq '.[0].id'`, then its statuses' `environment_url`, as `wf_deploy_check` looks it up) followed by `Path:`, marked "valid once merged and deployed". The Look is taken after Done, on Production.
- data: local seed only; no Notion, Todoist or GitHub calls.

## Pattern check

Before a UI element is created or changed, the agent finds the existing Pattern for its user job and decides reuse, align or diverge alone (#586). The procedure loads with any UI file: `.claude/rules/ui-patterns.md` (also for ad-hoc edits outside the lanes).
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

- **testing mode** (#693): `.claude/testing-mode` holds `fast` or `quality` (default and fallback `quality`); read it before writing tests or choosing checks. `quality` = everything below. `fast` (pre-stable; switching modes is a one-way item, see "Decisions"):
  - write a test only for (1) a bug fix (regression test that fails without the fix), (2) logic with a branch, loop, parser, money or security, (3) anything in "Risk areas"; none for pure markup, copy or styling, and no new visual baselines or ARIA snapshots outside a risk area. Existing tests stay, and a spec, baseline or ARIA snapshot the diff breaks (a moved page, a changed link or label) is updated in the same PR: fast trims new tests, never repairs (run_d0fe7191bd61: #691 cost 2 fix rounds).
  - Stop hook and pre-push hook (`.githooks/pre-push`): `lint:ci`, `typecheck`, `design:detect` and `vitest run --changed origin/main` (Stop: no rendered design scan); GitHub CI selects per event (CLAUDE.md "CI"), never by testing mode; pre-merge gate tier `fast` (smoke + risk-area `map` rules flagged `risk: true` + touched specs + the `E2E-specs:` line; no `design` specs but the style fingerprint `ui-catalog` for a stylesheet, asset, `app.config.ts`, `nuxt.config.ts` or catalogued-component change (kd#230), no label/testid matches; docs and other style-only skip as before); spec sizing: Specify's Verification section follows the same rule.
  - platforms and browsers: `fast` verifies desktop (Tauri) behaviour on macOS only and web behaviour in Chromium only; a new check, spec project or CI matrix entry for another OS or browser (Windows, Linux desktop, WebKit, Firefox) is `quality`-only. Today the project has none, so the two modes differ in depth, not in platform coverage (the Linux CI container is the one other environment: Chromium, the full suite on `main`).
  - never reduced in either mode: `npm run verify` as a manual command, the Notion contract test for Notion PRs, the guard hooks. Releases: `alpha`/`beta` follow the mode, `stable` always runs full verify + full E2E and refuses `fast` (`docs/release.md`).
- gate command: `npm run verify` (lint:ci, typecheck, vitest; the Stop hook runs the same)
- a new regression test must fail with the fix reverted (check once: `git diff HEAD -- <src paths> > <scratchpad>/fix.patch && git apply -R <scratchpad>/fix.patch`, run the test, `git apply <scratchpad>/fix.patch`; list paths inline, zsh does not word-split `$VAR`; on macOS `sed -i` needs `''`)
- never commit absolute `/tmp` or scratchpad paths (e.g. a debug `page.screenshot({ path })`)
- a spec that changes existing behaviour: `rg` the old behaviour's wording in doc comments and types too (#304)
- E2E: `PORT=<free port> npm run test:e2e -- tests/e2e/<name>.spec.ts` (full paths: a bare word is a substring filter; zsh does not word-split `$SPECS`: pass a list as `${=SPECS}` or an array). List the specs you ran as `E2E-specs: a b c` (basenames) in the PR body; the pre-merge hook adds them to its tier. `npm run build` when the PR touches build config (`nuxt.config.ts`, `package.json`, `app.config.ts`, `server/`, `vercel.json`); a `nuxt.config.ts` change also runs `smoke` and `visual-regression` (E2E runs against the built app since #541: a dev-only check misses what the build drops, #576; a build-tooling spike, e.g. a PostCSS or Vite plugin, also proves itself with `npm run build`, kd#70)
- DnD spec set (drag changes): the specs of the `drag-and-drop and stacks` rule in `.claude/hooks/e2e-gate.json` (the gate runs the same set; list it with `echo '{"files":[{"path":"composables/useBoardDndKit.ts"}]}' | node scripts/e2e-gate.mjs`, field `specs`, then `npm run test:e2e -- $(printf 'tests/e2e/%s.spec.ts ' <names>)`)
- flake fix (#446, replaces the `e2e-full` label): run the flaky spec with `PORT=<free> npx playwright test -c tests/e2e/playwright.config.ts <file> --repeat-each=20 --retries=0` and state the result in the PR body; a pattern sweep over several specs (no single flaky spec) runs `--repeat-each=5` per changed spec
- a flake whose log shows only the assertion: read the failed test's `error-context.md` first (page snapshot at the failure, e.g. an empty palette, #572); the console is in the failed test's `trace.zip` (`test-results/*/`; the `*.trace` JSONL holds console events); a race on the first fetch reproduces by delaying the stub route (`page.route` + wait), not by `--repeat-each`; a focus or timing race reproduces under load against one persistent server (`node scripts/e2e-server.mjs` + `BASE_URL`, `--workers=10 --repeat-each=60`: ~5 % in 35 s, #685)
- a global CSS change (scroll bars, root layout) runs `visual-regression.spec.ts` once in Specify with the candidate CSS injected, in the default headless mode, before choosing the approach (#669: a forced-classic-bar check hid ~40 moved baselines)
- any change visible on the board (headers, cards, stacks) also runs `visual-regression.spec.ts`; update snapshots only for intended changes; which region a baseline moved: `magick compare -metric AE old.png new.png diff.png` and `magick diff.png -trim info:` for the box (no PNG reader in the repo)
- motion changes (#578): `PORT=<free> npm run dev`, then `npm run motion:film -- --out <scratchpad dir> --base http://localhost:<port> [--group topic|priority]` (`scripts/motion-film.mts`: seeks the paused script animations to 12 points, writes a filmstrip per stack and flags jumps, pops and endpoint mismatches; exit 1 on a flag). Never in `test:e2e` or the gate. Real-device feel stays manual: Chrome DevTools Performance with 4x CPU throttling, no Layout/Paint bands per frame. Attach the strips to the PR. The motion's E2E assertions pause at the first or last frame (`stack-motion.spec.ts`: `__pauseMotion`), never race the 220 ms beat
- spacing or size changes: `grep -rn 'toBe(\|toBeCloseTo(' tests/e2e` for hard-coded pixel boxes (#220)
- Rust changes: `.claude/rules/persistence.md` (`cargo test --lib`)

## Pull requests

- screenshots: `gh pr create --attach '<scratchpad>.png#alt'` with `![alt](<same path, without #alt>)` in the body file (gh ≥ 2.99; absolute paths in both: paths inside a `--body-file` resolve against the file's own directory, so a relative mismatch leaves the local line and appends a second copy); never commit screenshots or open a screenshot branch. Later: `gh pr edit <n> --body-file <f> --attach <path>`
- issue comments with images: `gh issue comment <n> --body-file <f> --attach <path>`
- required in body (the guard hook checks `Closes`, attribution, `E2E-specs:` and the `Pattern:` lines): ACs as a checklist with evidence, the `E2E-specs: a b c` line, `Pattern:` lines when the diff touches UI source files ("Pattern check"), `## Review` (orchestrated runs: the lead template), Impeccable critique/audit before and after plus P2/P3 (UI), 1-3 result screenshots (UI), `inbox` issues filed, anything left out

## Decisions

User decision 2026-10-30. Rule, labels and `decide.sh`: `/orchestrate-gh-issues` section 5.
- one-way (a decision request, the issue parks): a Design round of a `needs-design` issue; changing a DESIGN.md principle, named rule or token other than the palette (detail that lives in code, such as timings, sizes or a component's exact look, is two-way: decide, record it in the issue and the component's doc block); deleting or rewriting existing user data (persisted state, Notion/Todoist/GitHub content); release or other outward-facing actions; switching the testing mode or weakening a verification gate (Stop hook, pre-merge E2E gate, release checks; #693); a held merge; low confidence on something expensive to undo
- explicitly two-way (decide, record in `## Decisions` + `decide.sh record`, continue, merge): technical structure (e.g. a separate settings store vs. reusing a store); `custom-forest` palette changes (also recorded in DESIGN.md); integration changes that hit no one-way item; data model or persisted-shape changes, provided old persisted data still loads (migration or backward-compatible read, covered by a test); a scope change against the issue that the coordinator (standalone: the reviewer) agrees is reasonable
- digest cap: 2h (`--cap 7200`, the script default)

## Orchestration

- runner: Orca; max 5 concurrent workers (user decision: dev-server ports, Playwright CPU, shared visual baselines). Ports, risk globs, verify/build, after-merge steps, deploy check and the PR-body check: `.claude/issue-workflow.sh` (read by `spec.sh`, `merge-pr.sh`, `guard.sh`)
- with 3+ workers: specs say E2E `--workers=2`; the hook retries a failing test once itself; after a hook failure in specs the PR does not touch, rerun them alone once more (`PORT=<free> npx playwright test <failed files>`); many first-render timeouts mean load (`uptime`), not the PR
- a PR branched before a merged test-infra fix rebases first; parallel epic siblings never fix an ADR number in the spec (the later-merged PR renumbers)
- serialize: issues touching the same risk area or the same file; only the first PR changing a PNG in `tests/e2e/snapshots/` regenerates it, the next waits, rebases, regenerates
- merge gate: the `PreToolUse` hook `.claude/hooks/e2e-before-merge.sh` runs the tiered E2E gate on `gh pr merge`. `E2E_GATE=full gh pr merge <pr> --merge` only when the PR changes gate logic (`e2e-*.sh`, `e2e-*.pl`, `scripts/e2e-gate.mjs`, a new or changed rule in `.claude/hooks/e2e-gate.json`; a path added to an existing rule is a normal targeted PR) or shared test infrastructure beyond a helper. A flake fix runs its spec through the gate like any changed spec; the fixer proves it with `--repeat-each=20 --retries=0` and states it in the PR. "Checks pass" = `merge-pr.sh prep` (verify, build when needed) + the hook's E2E run; Vercel builds no PR branch. **Never wait for PR CI** (owner decision 2026-11-12, alpha phase): a PR runs only `quality` there (lint, typecheck, Vitest; no E2E), and a PR merges once the local gate is green, risk areas and CI changes included. The full E2E suite runs on every push to `main` (CLAUDE.md "CI") and by hand (`gh workflow run ci.yml`); `npm run release` runs it locally. A red `main` after a merge (the full run) gets an `inbox` issue naming the missing `map` rule.
- Notion-touching PRs: the builder (and fixer) runs `npm run test:contract` in its worktree and reports the result in the PR; a failure blocks the merge. `.claude/settings.json` allows it and `npm run notion:sandbox *`; run them as a plain command (no `cd … &&` prefix) so the allow rule matches. If a worker is still denied, the coordinator runs it before merge
- CI reruns (run_c70ac44813db): `ci.yml` cancels in progress per ref, so `gh run rerun` on an older run of a PR cancels the newer head's run (~35 min lost, kd#125); rerun only the latest run of the head, or push a new head. `gh pr update-branch` diverges the worktree (prep's push is then rejected): `git pull --ff-only` in the worktree first. The CI e2e job is a matrix of up to 8 shards (`e2e (n/total)`, kd#129, kd#187), only as many as the selected specs need.
- after merge: `merge-pr.sh after` (fast-forward of the main checkout when on `main`, `npx npm@11.19.0 install` when `package.json` changed, `cleanup-merged.sh`, deploy check); a deploy that is not green gets an `inbox` issue

## Retro

- running log: `.claude/retro-log.md`
- context files: `~/.claude/CLAUDE.md`, `CLAUDE.md`, `.claude/issue-workflow.md`, `~/.claude/agent-workflow/skills/*/SKILL.md`, `~/.claude/agent-workflow/reference/issue-rules.md` (every stage loads it; the README is not loaded)
- metric sources: `<git common dir>/agent-ledgers/checks.tsv`, one row per run of the Stop hook (`verify.sh`) and the pre-merge E2E gate: date, hook, branch or PR head, tier, spec count, seconds, result (`pass`, `fail`, or `timeout` = the E2E run exceeded its own budget and the merge was blocked, #415), flaky specs. Compare a PR's tier and spec count with its diff; a stamped (cached) gate pass writes no row
- escape (#446): a full release run (`npm run release`) that fails on a spec no PR gate ran since the last release (compare `checks.tsv` with the failing spec) is an `escaped` entry in the retro log: add the missing mapping to `.claude/hooks/e2e-gate.json` (the area whose file changed) and name the PR that should have run it; a spec that names a changed i18n value or `data-testid` is selected by text since #525, so a miss there means the spec asserts neither (a count, a visual state): map it
- edits land: skill method → the agent-workflow checkout (`~/.claude/agent-workflow`, commit + push there); kan-do facts → this file or CLAUDE.md, committed to `main` as `docs(workflow): ...` from a temporary worktree on `origin/main` when the main checkout is not on `main`
