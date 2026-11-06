# Agentic UI quality: research and gap analysis (2026-11-05)

Scope: how kan-do's agent lanes (Design, Specify, Build, `/code-review`, Orca workers) build UI, and how to use the Impeccable plugin as well and as reliably as possible. Each claim cites a URL or file path. Text marked **(inference)** is my reading and has no primary source behind it. Measurements come from this repo on 2026-11-05.

## Summary

1. **Impeccable 4.8.0 is out (2026-10-26). kan-do pins 4.7.0 in five places** (CLAUDE.md, `.claude/issue-workflow.md`, `.github/workflows/ci.yml`, the installed plugin, the marketplace clone). The plugin does not auto-update, because third-party marketplaces have auto-update off by default. Relevant changes in 4.8.0: `--list-rules`, `--github` annotations, fewer false positives (`straggler` is now measured, which matters for the backlog entry U19; `design-system-radius` no longer parses `calc()`; `**/` ignore globs stop at folder boundaries), and audit contrast and touch-target checks that now follow WCAG AA. No static Vue SFC element analysis was added, so `.vue` files still get regex rules only. About 57 commits on `main` since 4.8.0 are unreleased; they include Vue/Nuxt live-mode fixes and "Stop hook: let the agent decide".
2. **The critique gate is degraded by construction.** `reference/critique.md` makes the A/B sub-agents mandatory whenever a Task tool exists, and says "unavailable … does not mean inconvenient". The worker task template allows sub-agents only for a stuck root cause or a haiku sweep. Result: 20 of the last 35 merged PRs that mention a critique carry `⚠️ DEGRADED: single-context`, 0 are `dual-agent`, and 28 use "estimate" scores. The before/after score hard gate therefore mostly measures one context grading its own work, which Anthropic's harness post calls the failure mode ("agents reliably skew positive when grading their own work").
3. **The only exit-coded Impeccable check never runs as a gate.** The source scan (`detect … app.vue`) runs in 0.75 s and is clean today (0 primary, 1 advisory). It is only *prose* in the Build lane, plus an *advisory* CI step on `main` that does not run while Actions is out of budget. Adding it to `npm run verify` costs almost nothing and makes it deterministic.
4. **The deterministic floor is otherwise strong:** axe with WCAG 2.2 AA tags over desktop, 390 px and overlay states, 23 visual-regression shots, the no-arbitrary-value lint, `no-raw-text`, i18n parity, and the Impeccable PostToolUse and Stop hooks, which demonstrably fire in Orca worktrees. Missing pieces: a rendered detector *matrix* (routes × 1280/390) as a gate, Playwright ARIA snapshots for state structure, and a rule that a critique judges real screenshots, not code.

Top recommendations: section "Gap analysis & recommendations" (12 items, cheapest mechanism first).

## Impeccable

### Version delta: 4.7.0 → 4.8.0 (and unreleased `main`)

Facts: `npm view impeccable versions --json` gives 4.8.0 as latest; `npm view impeccable time` gives 4.7.0 = 2026-10-19 and 4.8.0 = 2026-10-26T23:44Z. The installed plugin is `~/.claude/plugins/cache/impeccable/impeccable/4.7.0` (commit 46b822f, `installed_plugins.json`), and the marketplace clone `~/.claude/plugins/marketplaces/impeccable` is also at 4.7.0. Third-party marketplaces have "auto-update … Off by default" (https://code.claude.com/docs/en/discover-plugins#keep-plugins-updated).

What changed in skill-v4.8.0 / cli-v4.8.0 / engine 0.1.18 that matters here (https://github.com/pbakaus/impeccable/releases/tag/skill-v4.8.0, …/cli-v4.8.0):

| Change | Relevance to kan-do |
|---|---|
| `detect --list-rules [--json]`: rule catalogue without scanning (62 rules: 31 `slop`, 31 `quality`; measured) | Lets a spec or gate name exact rule ids. Shows `design-system-color` is **advisory**, so the 20 Todoist `ignoreValues` never affected the exit code. |
| `detect --github`: findings as GitHub Actions annotations on the causing line | Useful only once Actions runs on PRs (CLAUDE.md "CI": currently off). |
| `hard-offset-shadow` is now advisory, waivable with `data-impeccable-ignore` | Low. |
| `straggler` measures the last word; `design-system-radius` ignores numbers inside `calc()/min()/max()`; a negative margin shorthand is no longer lost; contrast reads gradient text and dark surfaces correctly; a side stripe on table rows/cells reports as `side-tab` | Fewer false positives in the rendered scan; U19 in `docs/design/audit-2026-11.md` (`straggler` on card titles) should be re-checked on 4.8.0. |
| `**/` in an ignore pattern stops at folder boundaries | Re-check any glob ignore after upgrading (kan-do has none today; `.impeccable/config.json`). |
| Audit contrast and touch-target checks match WCAG AA | Aligns with SC 2.5.8 (24×24 CSS px minimum, https://www.w3.org/TR/WCAG22/#target-size-minimum). In 4.7.0, `reference/audit.md` still says "Touch targets: Interactive elements < 44x44px". |
| Engine downloads checked against committed digests; idle-based download timeout | Fewer flaky first runs in fresh worktrees and cloud sessions (inference). |
| Hooks: a session started above the project gets the Stop review per edited project; Cursor hook moves to post-write | Low for Claude Code. |

Unreleased on `main` (`gh api repos/pbakaus/impeccable/compare/skill-v4.8.0...main`, 57 commits): "design hook stops re-reporting unchanged findings (#1202)", "Stop hook: let the agent decide, ask only when it truly can't (#1306)" (relevant to unattended workers), Vue/Nuxt live-mode fixes (#1279 raw SFC injection, #1283 SFC preview CSS, #1296 Nuxt SSR flash), "Fix: require no material fixes before shipping (#1277)" (finish-reviewer, #1241), and "Fix: keep the degraded disclosure out of the output contract (#1245)". Open: #1297 "live-e2e cannot pick on Nuxt fixtures, so Nuxt has no runtime coverage". Live mode on Nuxt is therefore the least-tested path.

**Vue/SFC:** no release note adds static `.vue` element analysis. The detector help still says "Non-HTML files Regex pattern matching" (`impeccable detect --help`, 4.7.0 launcher). The issue-workflow note ("`.vue` files get regex rules only … element rules come from the rendered-URL scan") is still correct.

### Feature coverage

Sources: SKILL.md command table (`…/4.7.0/skills/impeccable/SKILL.md`), https://impeccable.style/docs/, and `.claude/issue-workflow.md` "Design quality".

| Feature | Used by kan-do? | Recommendation |
|---|---|---|
| `shape` | Yes, Design brief (interview or asserted) | Keep. |
| `critique` | Yes, gate before/after | Keep, but run it as specified (dual-agent, rendered) and gate on P0/P1, not on the score delta. See Reliability. |
| `audit` | Yes, gate + default AC "no P0/P1" | Keep. After 4.8.0, its touch-target check matches WCAG AA. |
| `polish` | Yes, after the gate | Keep. Note that polish reads the latest critique snapshot (`critique-storage latest`), which unattended runs never write ("no persisted snapshot"), so polish always does an independent pass. Fine, but say so. |
| `layout/typeset/clarify/adapt/harden/animate/colorize` | Only when the spec names them | Keep. |
| `distill/onboard/clarify/adapt` as lenses in Design | Yes | Keep. |
| `bolder/quieter/delight/overdrive` | No | Correct for an Operate surface ("On Operate and Read, ambition shows as precision and restraint", SKILL.md "Modes"). |
| `optimize` | No | Use when a spec has a perf AC (inference). |
| `generate`, `live` | Yes, element look only | Live on Nuxt has no upstream runtime coverage (#1297). Keep it interactive-only, never in unattended workers. |
| `init` / PRODUCT.md | PRODUCT.md exists with `## Platform` (`PRODUCT.md:5`) | Matches the docs: platform is recorded under `## Platform`, and the old `## Register` is gone (https://impeccable.style/docs/context). |
| `document` / DESIGN.md + `.impeccable/design.json` | Yes (YAML frontmatter tokens, sidecar schemaVersion 2) | Matches: "Design tokens are stored in the YAML frontmatter … sidecar … Don't hand-edit it" (docs/context). |
| `extract` | Yes, a pattern seen 3+ times | Keep. |
| Surface briefs `.impeccable/surfaces/*.md` | **No** (directory absent) | Optional: one brief per route records the mode (Operate) and the direction, so `impeccable context --target` stops re-deriving it (docs/context). Low cost, low value (inference). |
| `doctor` | **No** | Run once after the 4.8.0 upgrade. Beware #846 (open): "Unchanged DESIGN.md sidecar reported stale after checkout/worktree creation (mtime-only)", which gives a false `CONTEXT_STALE` in every fresh Orca worktree. SKILL.md: "Never repair drift as a side effect of a design task." |
| `hooks` (PostToolUse + Stop) | Yes, on | See Hooks. |
| `detect` CLI (source + URL) | Yes, by hand / CI advisory | Make it a gate. See Detector. |
| `.impeccable/critique/ignore.md` (critique drops matching findings) | **No** | Use it for recurring, accepted critique findings (spec "Accepted trade-offs") instead of re-arguing them per PR (critique.md Setup 3). |
| Plugin agents: `impeccable-finish-reviewer`, `-documenter`, `-asset-producer`, `-manual-edit-applier` | No | The finish-reviewer is built for *new-work* builds with a direction contract, comps and `.impeccable/build/state.json`. Its checks 1–5 do not apply to Operate refinements. Not a fit as a gate (inference). Its check 0 (desktop.png + mobile.png must exist and be valid) is worth copying as a rule. |
| `pin`, `telemetry` | No | Optional: `impeccable telemetry off` (4.6.0 notes). |

### Hooks

What they do (plugin `hooks/hooks.json` and `reference/hooks.md`, 4.7.0):
- `SessionStart` (5 s): "Preparing build session". `PostToolUse Edit|Write` (5 s): the per-edit scan of the **immediate tier** only ("broken images, overflowing content, contrast and legibility failures, gradient text, glow shadows, and design-system drift"), fed back as a system reminder, which never blocks the edit on Claude Code. `Stop` (30 s): "a deep pass … runs the full rule set over every UI file touched in the session … deduplicated". `hook.perEditRules: "all"` restores the full set per edit.
- Config: `hook.enabled`, `hook.quiet`, `hook.auditLog` (NDJSON), env overrides `IMPECCABLE_HOOK_DISABLED|QUIET|LOG` (https://impeccable.style/docs/hooks). `hooks status` here: enabled, `maxFindings: 5`, `maxChars: 8000`, env unset (run 2026-11-05).
- The hooks ship *inside the plugin* (`${CLAUDE_PLUGIN_ROOT}`), not in `.claude/settings.json`, so they run wherever the plugin is enabled. It is enabled at user scope (`~/.claude/settings.json` `enabledPlugins`).

Where they are active:
- **Main checkout:** yes. `.impeccable/hook.cache.json` holds per-session `stopBaseline` entries (engine 0.1.16).
- **Orca worktrees / workers:** yes. an Orca worktree of `proto-423-visual-redesign` has `.impeccable/hook.cache.json` (2026-10-31). 4.6.0 notes: the hook "is also found from a nested git worktree", and #1016 (false `MANUAL_DETECTOR_REQUIRED` in worktrees) is closed.
- **Cloud sessions:** no. A cloud session "doesn't load the plugins you installed on your own machine or the ones your repository's `.claude/settings.json` turns on" (https://code.claude.com/docs/en/discover-plugins). CLAUDE.md "Cloud sessions" already says so. There the only Impeccable signal is an explicit `npx impeccable@<v> detect`, which is another reason to put it in `npm run verify` (the Stop hook `verify.sh` runs in cloud too).

How to verify cheaply: `…/scripts/impeccable hooks status` (state + overrides), the presence and mtime of `.impeccable/hook.cache.json` in the worktree after a UI edit, or `hook.auditLog` for a one-off proof. "Silence is ambiguous: it can mean a clean edit, quiet mode, or an inactive hook" (docs/hooks).

### Reliability of critique and audit unattended

Requirements from `reference/critique.md` (4.7.0):
- "Assessment A and B MUST run as two isolated sub-agents whenever a sub-agent/Task tool is exposed … Inline is allowed ONLY when no sub-agent tool exists." "'Unavailable' means exactly one thing … It does not mean inconvenient." "Skipping sub-agents without the banner is the most common failure."
- "Assessment A must finish before detector findings enter the parent synthesis context … it still anchors judgment."
- "Viewable targets require browser inspection when available". For "multi-view targets, inject on 3-5 representative pages".
- "Tauri on macOS (WKWebView) … expose no CDP: run Assessment A and the source scan only". For kan-do this means the rendered checks run against the web build in Chromium, which the repo already does.
- The close: either targeted questions or a literal `Questions skipped: <reason>` line; otherwise "an incomplete run".

What kan-do does instead (`.claude/issue-workflow.md:29`): "sub-agents A and B only if budget allows (else inline with the `⚠️ DEGRADED` banner) … no closing question". The worker template (`~/dev-workspace/agent-workflow/skills/orchestrate-gh-issues/task-template.md:26`) permits `Agent` only for a stuck root cause (opus) or mechanical sweeps (haiku). Evidence of the effect: `gh pr list --state merged --limit 80`. Of the 35 PR bodies that mention a critique, 20 are DEGRADED, 0 dual-agent and 28 contain "estimate"; PRs #609, #602 and #601 say "workers may not spawn sub-agents".

What the primary sources say makes a design judge reliable:
- Separate the judge from the maker. "Separating the agent doing the work from the agent judging it proves to be a strong lever", and "tuning a standalone evaluator to be skeptical turns out to be far more tractable" (https://www.anthropic.com/engineering/harness-design-long-running-apps). Claude Code's own guidance lists "a reviewer that hasn't seen how the code was written" as a reason to use sub-agents (https://code.claude.com/docs/en/best-practices#know-what-subagents-cost).
- The judge looks at the live page: "the evaluator would navigate the page on its own, screenshotting and carefully studying the implementation" (harness post).
- Calibration and thresholds: "I calibrated the evaluator using few-shot examples with detailed score breakdowns", and "Each criterion had a hard threshold" (harness post).
- A reviewer asked to find problems "will always find *something*", so scope it ("skip style") (best practices, "Review against your spec").
- Deterministic over judgment for must-haves: "If something has to happen every time, make it a hook", and a `prompt`/`agent` hook "isn't deterministic either" (best practices, "Enforce the rules that can't have exceptions").

Implications (inference, grounded in the above):
1. Allow exactly two critique sub-agents in workers (A: sonnet/opus design review with the screenshots; B: haiku, detector JSON + rendered scan). The plugin defines this as the non-degraded method, and the cost is two bounded calls per UI PR.
2. Gate on **counts of P0/P1 after fixes** (deterministic once the findings are listed) plus the deterministic checks. Report the /40 and /20 scores, but do not require a before-versus-after improvement. A single-context "~31 → ~33" delta is within the noise of one model grading itself, and 28/35 "estimates" show the number is often not measured.
3. Give Assessment A the 1280 and 390 screenshots the lane already takes ("Screenshots" section) as required input. A critique from code alone violates "Viewable targets require browser inspection". Copy the finish-reviewer's check-0 rule: missing or blank captures mean recapture, never review.
4. Calibrate the judge with this repo's own scored references: the heuristic tables in `docs/design/audit-2026-11.md` and the four committed `.impeccable/critique/*.md` snapshots (scores 22, 27, 32, 28) are ready-made few-shot anchors.
5. Keep "no browser overlay / no live server" for workers. The overlay is only a user-visible artefact (critique.md overlay flow, "[Human] tab"), and B still runs the CLI and URL scans.

### Detector

CLI (4.7.0 `detect --help`; 4.8.0 adds `--list-rules`, `--github`):
- Targets: `[file-or-dir-or-url...]`, so several URLs or paths in one call. "Operational failure takes precedence when a multi-target scan is partial."
- `--json` (array of findings: `antipattern, name, description, severity, category, file, line, snippet, advisory, ignoreValue, importedBy`, measured on 4.8.0 output); `--quiet`; `--scope type,layout`; `--viewport 390x844` (URL scans, default 1280×800); `--no-config`; `--no-inline-ignores`; `--no-design-system`; `--no-advisory`; `--cdp <port>` (Chromium desktop apps only, so not Tauri/WKWebView).
- Exit 0 = no primary findings (advisories allowed); 2 = primary findings; 1 = a target could not be scanned (https://impeccable.style/docs/detector).
- Ignores: `.impeccable/config.json` `detector.ignoreRules|ignoreFiles|ignoreValues`, `config.local.json` for private ones, inline `impeccable-disable[-line|-next-line] <rule>`. Triage policy (`reference/hooks.md` "Triage findings"): the agent may self-serve only `ignore-value` with `--reason "<who decided: evidence>"`; `ignore-file` and `ignore-rule` need the user. For a rule without a value, use `ignore-value <id> "*" --file <path>`.
- **Baselines are not an Impeccable feature.** The docs describe none (docs/detector). `docs/design/baseline.json` (`[]`) is a kan-do convention. With an empty baseline, the exit code alone is the gate (inference).
- Design-system rules read DESIGN.md + `.impeccable/design.json`: `design-system-font` (warning), `-color`, `-radius`, `-font-size` (advisory) (`--list-rules --json`, 4.8.0).

Measured on kan-do (2026-11-05): `detect components pages layouts assets app.vue` with 4.7.0 and 4.8.0 → exit 0, 1 advisory (`design-system-radius` 2px, `assets/css/task-detail.css:149`), 0.75 s wall time. The rendered scans in `audit-2026-11.md` (7 routes) were exit 0.

Gaps: no gate runs either scan. `verify.sh` / `npm run verify` = lint + typecheck + vitest (`package.json:21`), and the CI step is "advisory" on `main` only (`.github/workflows/ci.yml:33`). The rendered scan is single-route in CLAUDE.md and has no 390 px pass, although `--viewport` exists.

## Agentic UI practices (2025–2026) vs kan-do

| Practice | Primary source | kan-do today | Delta |
|---|---|---|---|
| Closed visual loop: the agent renders, screenshots and fixes, batched | "Verify by looking at the rendered result at the sizes it ships at, and batch the checks" (Impeccable SKILL.md); "A browser screenshot next to the mockup" as a check (code.claude.com best practices "Give Claude a check to run") | Yes: Screenshots at 1280 + 390 via `playwright-cli`, `motion:film`, `desktop-pages-shots.spec.ts` | Feed the shots into critique A (above). |
| Independent evaluator (evaluator-optimizer), skeptical, calibrated, with hard thresholds | Anthropic harness post; best practices "Know what subagents cost" | Code: yes (`/code-review` reviewer worker on opus). Design: no (degraded critique) | Two critique sub-agents + few-shot anchors. |
| Deterministic gates over prose rules | best practices "Deterministic and non-deterministic instructions"; "if you keep adding emphasis … that line belongs in a hook" | Strong: Stop `verify.sh`, `eslint-file.sh`, pre-merge E2E gate, guard hook | Detector source scan into verify; rendered matrix into the E2E gate. |
| Design system as contract: tokens in a machine-read file, the linter enforcing them | Impeccable design-system rules read DESIGN.md frontmatter (docs/context, docs/detector); Nuxt UI theme tokens (https://ui.nuxt.com/docs/getting-started/theme/design-system) | Yes: DESIGN.md frontmatter + sidecar, `better-tailwindcss/no-arbitrary-value`, palette-class warning, `app.config.ts` overrides, Pattern check | Re-run `/impeccable document` after token changes (already a rule). Nothing new. |
| Accessibility automation (axe) | https://playwright.dev/docs/accessibility-testing; WCAG 2.2 AA | Yes: `tests/e2e/a11y.spec.ts`, tags `wcag2a … wcag22aa`, blocking on serious/critical, desktop + 390 + overlay states | Keep. Note that axe cannot judge many SCs (focus order, meaning), so critique still matters (inference). |
| ARIA snapshots for structure (`toMatchAriaSnapshot`, `.aria.yml`, partial and regex matching) | https://playwright.dev/docs/aria-snapshots (Playwright 1.64.1 installed) | **No** (`rg toMatchAriaSnapshot tests` → none) | Cheap structural check for state variants (empty/loading/error, sheet open) that pixel shots overfit and axe does not cover. |
| Visual regression | https://playwright.dev/docs/test-snapshots | Yes: 23 `toHaveScreenshot` in `visual-regression.spec.ts`, macOS baselines, production build | Keep. Visual baselines catch regressions, not quality (inference). |
| State matrix (empty / loading / error × 1280 / 390) | Impeccable `harden`/`onboard`; the default UI AC "Empty, loading and error states handled" (`.claude/issue-workflow.md`) | AC exists, evidence is per-PR prose | Make the matrix an explicit screenshot list in the spec template plus ARIA snapshots (above). |
| Component isolation (Storybook/Histoire) | (no kan-do-specific primary source) | No; seeded routes (`?seed=local|demo|dayclose|…`) act as the fixture system | **Not worth it now (inference):** seeds + Playwright already isolate states against the real store, and a story layer would duplicate fixtures and need Nuxt module wiring for a solo app. Revisit if components get reused outside the board. |
| Design MCPs: Nuxt UI MCP, Paper, FigCraft | `.mcp.json` (`nuxt-ui-remote`), CLAUDE.md "UI Work", `.claude/ui-canvas.md` | Yes: Nuxt UI MCP required for props/slots; FigCraft canvas via `/ui-canvas` | Keep. |
| Anti-slop guidance for generation | Anthropic `frontend-design` skill (github.com/anthropics/skills `skills/frontend-design/SKILL.md`: clusters of "AI-generated design", e.g. the "SaaS-card kit", the "ALL-CAPS eyebrow"); Impeccable `craft-floor.md`, `slop` rules (31) | Yes: Impeccable craft floor + `slop` detector rules + DESIGN.md "Do's and Don'ts" | Do not add `frontend-design` as well. Its brief ("distinct visual identity … take aesthetic risk") suits Persuade surfaces and conflicts with Impeccable's Operate restraint (inference). |

## Gap analysis & recommendations

Ordered by mechanism cost (deterministic hook/test first), then impact.

| # | Recommendation | Effort | Impact | Where |
|---|---|---|---|---|
| 1 | Add the source scan to `npm run verify` (so it runs in `verify.sh`, the git pre-push hook and cloud sessions): `npx -y impeccable@<pin> detect --quiet components pages layouts assets app.vue`. Exit 2 fails, exit 1 fails, advisories pass. 0.75 s; clean today. Then drop the prose step in "polish / detector" and the CI "advisory" wording. | S | High: the one exit-coded design check becomes enforced everywhere, including cloud (no plugin there) | `package.json` `verify`; `.claude/issue-workflow.md:30`; `ci.yml` |
| 2 | Upgrade to 4.8.0 as one change: `claude plugin update impeccable@impeccable`, bump `@4.7.0` → `@4.8.0` in CLAUDE.md (2×), issue-workflow.md, ci.yml, and pin it in **one** place (an npm script `design:scan`, so docs reference the script, not a version). Then run `/impeccable doctor` once and re-check U19 (`straggler`). | S | Medium: fewer false positives, WCAG-AA touch targets in audit, `--list-rules`; one pin instead of five | `package.json`, CLAUDE.md "Commands", issue-workflow, ci.yml |
| 3 | Rendered detector matrix as a gate for UI PRs: a script that runs `detect --json` on the seeded routes (`/tasks?seed=local`, `?seed=demo`, `/statistics`, `/settings`, `/trash`, …) at `--viewport 1280x800` and `390x844` against the E2E server build. Wire it into `scripts/e2e-gate.mjs` when the diff touches UI paths. Element rules (contrast, tiny text, overflow) exist only here for `.vue`. | M | High: closes the `.vue` regex-only gap deterministically | `scripts/`, `.claude/hooks/e2e-before-merge.sh` / `e2e-gate.mjs`, `.claude/rules/e2e-gate.md` |
| 4 | Allow the two critique sub-agents in workers (A: design review with the 1280 + 390 screenshots as required input; B: haiku, detector + rendered matrix JSON). Delete "only if budget allows" (it contradicts critique.md's "does not mean inconvenient"). Keep "no overlay / no live server". End with `Questions skipped: unattended worker`, the literal close critique.md requires. | S | High: removes the systematic DEGRADED state (20/35 PRs) | `task-template.md:26` (agent-workflow), `.claude/issue-workflow.md:29` |
| 5 | Change the hard gate from "before and after scores" to "P0/P1 = 0 after fixes (or cited trade-off) + deterministic checks green"; scores stay as reported numbers. Drop the `origin/main` before-run unless the spec asks for a comparison. | S | Medium: less cost per PR, less noise; "estimate" scores stop gating | `.claude/issue-workflow.md` gate + PR body rules |
| 6 | Few-shot calibration for critique A: point it at 2 anchored examples (an `audit-2026-11.md` heuristic table and one committed `.impeccable/critique/*.md` snapshot) with the instruction to score against them. | S | Medium: reduces score drift ("calibrated the evaluator using few-shot examples") | issue-workflow gate line, or a short reference file the worker prompt names |
| 7 | Replace the 20 per-value Todoist `ignoreValues` with one `impeccable hooks ignore-value design-system-color "*" --file assets/css/integrations.css --reason "…"`. `ignore-value` is self-serve per hooks.md, and the rule is advisory anyway. | S | Low: smaller, reviewable config | `.impeccable/config.json` |
| 8 | ARIA snapshot specs for state structure (empty/loading/error/sheet-open per main surface, `.aria.yml` files, partial matching). | M | Medium: deterministic evidence for the default UI AC "Empty, loading and error states handled" | `tests/e2e/` (new spec), e2e-gate map |
| 9 | Evidence rule borrowed from the finish-reviewer check 0: a critique or PR without both valid captures (1280, 390; not blank, right state) is "recapture", never reviewed. The guard hook can check that the PR body has ≥2 images for UI diffs. | S | Medium | `wf_pr_body_check` guard; issue-workflow "Screenshots" |
| 10 | Use `.impeccable/critique/ignore.md` for accepted, recurring critique findings (spec "Accepted trade-offs" that recur across PRs) so workers stop re-raising them. | S | Low–medium | `.impeccable/critique/ignore.md`; issue-workflow gate |
| 11 | Track #846 (false `CONTEXT_STALE` in fresh worktrees) and the unreleased #1306 / #1202 hook fixes. Re-evaluate at the next Impeccable release; until then a `CONTEXT_STALE` in a worker is reported, not acted on (SKILL.md already says so). | S | Low | retro watch list |
| 12 | Do **not** adopt: `impeccable-finish-reviewer` as a gate (built for comp-led new-work), Storybook/Histoire, the `frontend-design` skill, or `--github` (until Actions runs on PRs). | — | Avoids cost | this doc |

### Stale, redundant or contradicting items in the current integration

- **Contradiction:** `.claude/issue-workflow.md:29` "sub-agents A and B only if budget allows" vs `reference/critique.md` "MUST run as two isolated sub-agents whenever a sub-agent/Task tool is exposed … does not mean inconvenient". The worker template's sub-agent limit makes the degraded mode the norm.
- **Contradiction (minor):** "no closing question" vs critique.md's requirement for a literal `Questions skipped: <reason>` line.
- **Stale:** `impeccable@4.7.0` in CLAUDE.md:23/25, issue-workflow.md:30 and ci.yml:36; latest is 4.8.0.
- **Redundant/misleading:** `polish.md` says "Context requests a manual scan only when no automatic detector is active; never add another detector pass". The prose "then `npx … detect`" step duplicates the Stop deep pass unless it becomes the exit-coded gate (recommendation 1). As a gate it is not redundant, because the hook never blocks on Claude Code.
- **Misleading:** "`docs/design/baseline.json` is the accepted source-scan state" reads like an Impeccable mechanism. It is kan-do's own, and empty.
- **Stale (after upgrade):** Impeccable 4.7.0 `audit.md` touch targets "< 44x44px" vs WCAG 2.2 SC 2.5.8 (24 px AA). 4.8.0 aligns audit with AA, so a P1 "touch target < 44px" from a 4.7.0 audit is not a WCAG AA violation.
- **Still correct:** `.vue` regex-only note and the rejected `detector.extensions` html-engine experiment (no static SFC support added through 4.8.0); hooks on in proto branches; Tauri has no CDP, so rendered checks run on the Chromium web build (critique.md "Desktop apps").

## Sources

Impeccable
- https://impeccable.style/docs/ (index), https://impeccable.style/docs/detector, https://impeccable.style/docs/hooks, https://impeccable.style/docs/context
- https://github.com/pbakaus/impeccable/releases (skill-v4.8.0, cli-v4.8.0, engine-v0.1.18, skill-v4.7.0, skill-v4.6.0)
- `gh api repos/pbakaus/impeccable/compare/skill-v4.8.0...main` (unreleased commits, 2026-11-05)
- Issues: #846, #1016, #1241, #1245, #1263, #1279, #1283, #1296, #1297 (github.com/pbakaus/impeccable/issues/<n>)
- `npm view impeccable versions --json`, `npm view impeccable time --json`
- Installed plugin: `~/.claude/plugins/cache/impeccable/impeccable/4.7.0/` → `skills/impeccable/SKILL.md`, `reference/critique.md`, `reference/audit.md`, `reference/polish.md`, `reference/hooks.md`, `hooks/hooks.json`, `agents/impeccable-finish-reviewer.md`; `scripts/impeccable detect --help`, `hooks status`
- `npx impeccable@4.8.0 detect --list-rules --json`; source scans with 4.7.0 and 4.8.0 (scratchpad JSON, 2026-11-05)

Anthropic
- https://code.claude.com/docs/en/best-practices (deterministic vs non-deterministic, "Give Claude a check to run", "Review against your spec", "Know what subagents cost", "Enforce the rules that can't have exceptions")
- https://code.claude.com/docs/en/discover-plugins (auto-update defaults, cloud sessions load no local plugins)
- https://www.anthropic.com/engineering/harness-design-long-running-apps (generator/evaluator, frontend grading criteria, calibration, Playwright MCP evaluator)
- https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md

Playwright, Nuxt UI, W3C
- https://playwright.dev/docs/aria-snapshots, https://playwright.dev/docs/test-snapshots, https://playwright.dev/docs/accessibility-testing
- https://ui.nuxt.com/docs/getting-started/theme/design-system; Nuxt UI MCP `https://ui.nuxt.com/mcp` (`.mcp.json`)
- https://www.w3.org/TR/WCAG22/#target-size-minimum

kan-do
- `CLAUDE.md`; `.claude/issue-workflow.md` ("Design quality", "Default acceptance criteria (UI)", "Screenshots"); `.claude/rules/ui-patterns.md`; `DESIGN.md`; `PRODUCT.md`; `.impeccable/config.json`; `.impeccable/design.json`; `.impeccable/hook.cache.json`; `.impeccable/critique/*.md`; `docs/design/audit-2026-11.md`; `docs/design/baseline.json`
- `.claude/settings.json`; `.claude/hooks/verify.sh`; `package.json` (`verify`); `.github/workflows/ci.yml`; `tests/e2e/a11y.spec.ts`; `tests/e2e/visual-regression.spec.ts`; `.claude/retro-log.md`
- [agent-workflow](https://github.com/jaylouiz/agent-workflow) `skills/build-gh-issue/SKILL.md` §5; `skills/orchestrate-gh-issues/task-template.md:26`
- `gh pr list --state merged --limit 80` (critique provenance count, 2026-11-05)
