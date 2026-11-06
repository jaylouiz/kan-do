# Restart Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring kan-do back to a green, CI-guarded baseline (unit, typecheck, lint, E2E), remove the Linear integration entirely, and bring dependencies current.

**Architecture:** No architectural change except deleting the Linear adapter and everything wired to it. Every task leaves all four quality gates green so later tasks can trust them.

**Tech Stack:** Nuxt 4, Vue 3.5, Pinia 3, Nuxt UI 4, Vitest 4, Playwright, Tauri v2, TypeScript 6.

**Spec:** Audit from the 2026-10-18 session (no separate spec file). User decisions: execute the audit's restart order; **remove Linear entirely instead of upgrading `@linear/sdk`**.

## Global Constraints

- Work on branch `chore/restart-baseline` (created from `main`); one commit per task, conventional-commit messages, English.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Follow `CLAUDE.md` conventions (strict TS, no `any`, i18n for UI copy, `useErrorHandler` instead of `console.error`).
- Gate definition used by every task — "all gates green" means:
  - `npx vitest run` → 0 failed
  - `npm run typecheck` → exit 0 (from Task 2 onward)
  - `npm run lint` → 0 errors
  - `npm run test:e2e -- --reporter=line` → 0 failed (from Task 4 onward; before that, no *new* failures beyond the 11 known)
- Before running E2E, ensure nothing else is on port 3000 (`lsof -ti:3000`).
- Never push, never delete remote branches, never touch `src-tauri/target`.
- Upgrade tasks (8–11): if the upgrade cannot be made green within reasonable effort, revert that task's changes completely and report BLOCKED with the reason — do not leave a half-upgrade.

## Review Focus

1. A returning user whose persisted `board-store` has `taskService: 'linear'` (and a `linearConfig` key) must land on the welcome/setup flow, not a crash or blank board → Task 3 adds a store test.
2. Persisted `linearApiKey` in `board-store` must be dropped on hydration without breaking other persisted fields (columns, order) → Task 3 test.
3. `?seed=clear` must still clear legacy `linearConfig` from localStorage so stale state can't resurrect → Task 3 keeps the removal line.
4. Fixed constructor mocks must still assert the same behaviour (status codes, error codes) — not be loosened to pass → Task 1 review checks no assertion changed.
5. E2E tests rewritten after the modal redesign must test the *current* UI's equivalent behaviour, not be deleted to go green; any genuine app regression found is fixed in the app → Task 4.

---

### Task 1: Fix Vitest 4 constructor mocks

Vitest 4 rejects arrow-function implementations when the mock is called with `new` (`TypeError: () => ({...}) is not a constructor`). 44 tests in 14 files fail.

**Files (modify only the mock definitions):**
- `server/api/__tests__/{data-sources.get,database-schema.post,databases.get,pages,tasks.get,tasks.patch,update-task,error-handling}.test.ts`
- `tests/server/api/notion/{archived-tasks.get,create-task,database,ping}.test.ts`
- `tests/composables/{useStatisticsBackfill,useTaskSync,useTaskSync.local,useTaskDetail}.test.ts`
- `tests/integration/statistics-backflow.integration.test.ts`

- [ ] **Step 1:** Run `npx vitest run 2>&1 | tail -5` — expect `44 failed`.
- [ ] **Step 2:** Wherever a mock stands in for a class instantiated with `new` (e.g. `Client` from `@notionhq/client`, `NotionIntegration`, `TodoistIntegration`), replace `vi.fn().mockImplementation(() => ({...}))` / `vi.fn(() => ({...}))` with a `function` expression: `vi.fn(function () { return { request: requestSpy } })`. Leave non-constructor arrow mocks untouched. Do not change any `expect(...)`.
- [ ] **Step 3:** Run `npx vitest run` — expect `0 failed`. If anything still fails, diagnose it individually (it may be a different cause).
- [ ] **Step 4:** Commit `test: use constructible mock implementations for Vitest 4`.

### Task 2: Restore typechecking

`CLAUDE.md` documents `npm run typecheck`, but the script and `vue-tsc` are missing.

**Files:** `package.json`, plus whatever source files have type errors.

- [ ] **Step 1:** `npm install -D vue-tsc@latest` (must support TypeScript 6.0.x; if it doesn't, pin `typescript` to the newest version vue-tsc supports and say so in the report).
- [ ] **Step 2:** Add script `"typecheck": "nuxt typecheck"`. Run it; record the error count.
- [ ] **Step 3:** Fix errors properly (real types, no `any`, no `@ts-ignore`; `@ts-expect-error` only with a comment explaining a third-party typing bug). Skip errors located only in Linear files (`integrations/LinearIntegration.ts`, `integrations/linearStub.ts`, `components/linear/**`, `store/linearConfig.ts`, `types/linear.ts`) — Task 3 deletes them; list them in the report.
- [ ] **Step 4:** All gates green except allowed Linear-only errors. Commit `chore: add vue-tsc and typecheck script; fix type errors`.

### Task 3: Remove the Linear integration

**Delete:** `integrations/LinearIntegration.ts`, `integrations/linearStub.ts`, `components/linear/` (whole dir), `store/linearConfig.ts`, `types/linear.ts`, `tests/fixtures/linear/`, any `tests/**` file that only tests Linear.

**Modify (remove Linear branches/options/imports):**
- `types/state.ts` — `taskService: 'notion' | 'todoist' | 'local' | 'example' | null`; remove `linearApiKey`.
- `store/board.ts` — remove `setLinearApiKey`, `'linear'` from `setTaskService` type; add hydration sanitising (see Step 1).
- `composables/useTaskSync.ts` (`syncToLinear`, imports), `composables/useIntegrationManager.ts`, `store/integrationHealth.ts`, `components/settings/ModeSettingsModal.vue`, `pages/welcome.vue`, `pages/styleguide.vue` (only the LinearSetupModal demo + "Lokal, Notion oder Linear" copy; line ~519 "Linearbalken" is unrelated German, keep it).
- `composables/useErrorHandler.ts`, `lib/errorMessages.ts` — drop `linear_setup`.
- `nuxt.config.ts`, `types/globals.d.ts` — drop `__LINEAR_STUB_ALLOWED__`.
- `plugins/e2e-seed.client.ts` — drop `seed=linear` and the `__LINEAR_STUB_ALLOWED__` gate; **keep** `localStorage.removeItem('linearConfig')` in `seed=clear`.
- `server/utils/notionStub.ts` — reword comments that "mirror Linear".
- `assets/css/main.css` — remove `--integration-linear-*` tokens and `.btn-integration--linear`; update the wizard-height comment.
- `tests/e2e/helpers/seed.ts` (`seedLinearBoard`), `tests/e2e/helpers/constants.ts` (`LINEAR_STUB_API_KEY`).
- i18n locale files — remove Linear-only keys (grep the locale dir for `linear`).
- `package.json` — `npm uninstall @linear/sdk`.
- Docs: `CLAUDE.md` (Linear stub section, Testing bullets about `@linear/sdk` and the Linear stub, stores list, seed modes, fixtures line), `.devin/rules/*` that mention Linear, `README.md` if it does. Leave `docs/archive/` untouched. Add `docs/adr/005-remove-linear-integration.md` (context: SDK 18 majors behind, low use; decision: remove; consequence: persisted `linear` users fall back to setup).

- [ ] **Step 1: Write failing test** in `tests/store/board.test.ts` (create or extend; `setActivePinia(createPinia())` per test):
  - `it('resets a persisted linear taskService to null on hydration')` — seed `localStorage['board-store']` with `{ boardConfig: { taskService: 'linear', linearApiKey: 'x', ...otherValidFields } }`, instantiate the store with the persistedstate plugin, expect `boardConfig.taskService` toBe `null` and `'linearApiKey' in boardConfig` toBe `false`, and other persisted fields unchanged.
  If the persistedstate plugin is awkward in unit tests, test an exported pure function instead: `sanitizeBoardConfig(raw: unknown): BoardConfig` in `store/board.ts`, wired via the persist `afterHydrate` hook (or `serializer.deserialize`), and test it directly with the same assertions.
- [ ] **Step 2:** Run it, expect FAIL.
- [ ] **Step 3:** Implement sanitising; do all deletions/edits above.
- [ ] **Step 4:** `grep -rni linear --exclude-dir={node_modules,.nuxt,.output,src-tauri,.git,archive} --exclude=package-lock.json .` — only allowed hits: the ADR, the sanitiser + its test, `seed=clear` removal line, "Linearbalken" in styleguide, `assets/img/gggrain.svg` (SVG `linearGradient`). Report the final grep output.
- [ ] **Step 5:** All gates green (E2E: no new failures beyond the 11 known). Commit `feat!: remove Linear integration`.

### Task 4: Repair the 11 failing E2E tests

Failing after the June modal redesign (`f0c614b`, `428290f`): `task-detail.spec.ts` (7: topic/activity select persistence, copy-ID button, status dropdown, header actions visible, `set-timebox-cta`), `timebox-presets.spec.ts` (3), `task-modal-animation.spec.ts:130` (card styling), `notion-setup-stepper.spec.ts:48` ("Aktualisieren" button).

- [ ] **Step 1:** Run each failing spec; for each test decide: (a) **stale selector** — the behaviour still exists in the new UI under a different element → update the test (prefer `data-testid`; add a testid to the component if needed); (b) **intentionally removed** behaviour (confirm via the commit message/diff of `f0c614b`/`428290f`) → delete the test, list it in the report with the commit justifying it; (c) **regression** — behaviour should exist but is broken → fix the app, keep the test.
- [ ] **Step 2:** Use `page.mouse` patterns per `.devin/rules/09-testing-and-quality.md`; no `waitForTimeout` added.
- [ ] **Step 3:** Full E2E run → 0 failed; run the four specs twice more to check flakiness. If visual-regression baselines legitimately changed, update with `--update-snapshots` and commit the PNGs.
- [ ] **Step 4:** All gates green. Commit `test(e2e): align specs with redesigned task modal` (+ `fix:` commit separately if an app regression was fixed).

### Task 5: Dependency hygiene (in-range updates, audit, Tauri alignment)

- [ ] **Step 1:** In `package.json` pin `"@nuxt/devtools": "^3.4.3"` (currently `latest` → resolved to an alpha).
- [ ] **Step 2:** `npm update` (in-range minors/patches), then `npm audit fix` (no `--force`). Record `npm audit` summary before/after; list any remaining advisories and why they remain.
- [ ] **Step 3:** Tauri: in `src-tauri/Cargo.toml` set `tauri-plugin-http = "2.8"` (match the JS `@tauri-apps/plugin-http` minor), run `cd src-tauri && ~/.cargo/bin/cargo update -p tauri -p tauri-build -p tauri-plugin-http -p tauri-plugin-log && ~/.cargo/bin/cargo check`. If cargo isn't available, skip and report.
- [ ] **Step 4:** `npm run generate` succeeds. All gates green. Commit `chore(deps): update in-range dependencies, fix audit advisories, align Tauri http plugin`.

### Task 6: CI workflow

**Create:** `.github/workflows/ci.yml`

- Triggers: `push` to `main`, `pull_request`.
- Job `quality` (ubuntu-latest, Node from `.nvmrc` if present, else `24`): `npm ci` → `npm run lint:ci` → `npm run typecheck` → `npx vitest run`.
- Job `e2e` (needs `quality`): `npm ci` → `npx playwright install --with-deps chromium` → `npm run test:e2e`; upload `tests/e2e/playwright-report` as an artifact on failure.
- Cache npm via `actions/setup-node` `cache: npm`. Use current major versions of official actions.
- Visual-regression snapshots are macOS-rendered: if `visual-regression.spec.ts` would fail on Linux, exclude it in CI via `--grep-invert` or a `process.env.CI` skip, with a comment explaining why.

- [ ] **Step 1:** Write the workflow; validate syntax with `npx --yes @action-validator/cli .github/workflows/ci.yml` (or `actionlint` if installed).
- [ ] **Step 2:** Run locally with `CI=1` the exact command sequence of both jobs; all pass.
- [ ] **Step 3:** Commit `ci: add GitHub Actions workflow for lint, typecheck, unit and E2E tests`. (Do not push.)

### Task 7: Repository cleanup

- [ ] **Step 1:** Delete root clutter after checking nothing references them (`grep -r` for each basename): `TEMP_07_RULE_UPDATE.md`, `test-animation.html`, `test-modal-stack-fix.html`, `styleguide-bottom.png`, `styleguide-full.png`.
- [ ] **Step 2:** Root-level `utils.ts`, `taskStatusEnum.ts`, `default-tasks.ts`: move into `utils/`, `types/` (enum) and `utils/` respectively (or the dir their importers' conventions suggest), update every import. Check Nuxt auto-import collisions in `utils/` (a name clash changes behaviour). If a file is unused, delete it.
- [ ] **Step 3:** Align versions: `src-tauri/tauri.conf.json` `version` and `package.json` `version` both `0.1.0`; `src-tauri/Cargo.toml` package version too.
- [ ] **Step 4:** Update `package.json` `description` to reflect current scope (local, Todoist, Notion) — e.g. `"The focused today board — local, Todoist or Notion"`.
- [ ] **Step 5:** All gates green; `npm run generate` succeeds. Commit `chore: tidy repository root and align versions`.

### Task 8: Upgrade Vitest 4 → 5

- [ ] **Step 1:** Read the Vitest 5 migration guide (vitest.dev/guide/migration). `npm i -D vitest@^5 @vitest/*` (any installed `@vitest/*` packages to matching version); check `@nuxt/test-utils` supports Vitest 5 (upgrade it if needed; if no compatible version exists → BLOCKED, revert).
- [ ] **Step 2:** Adapt `vitest.config.ts` / tests to breaking changes. All gates green. Commit `chore(deps): upgrade Vitest to v5`.

### Task 9: Upgrade Pinia 3 → 4

- [ ] **Step 1:** Read Pinia 4 release notes/migration. Confirm `pinia-plugin-persistedstate` (and `@pinia/nuxt` if used) have Pinia-4-compatible releases; if not → BLOCKED, revert.
- [ ] **Step 2:** Upgrade, adapt stores. Verify persisted state survives: load `?seed=local`, add a task, reload — task still present (do this in the E2E run or a quick Playwright check). All gates green. Commit `chore(deps): upgrade Pinia to v4`.

### Task 10: Upgrade @nuxt/fonts 0.14 → 1.x

- [ ] **Step 1:** Read the 1.0 changelog; upgrade; adapt the `fonts.families` config in `nuxt.config.ts` if the schema changed. Confirm Figtree and Instrument Serif still load (check computed `font-family` in a Playwright check or visual-regression spec). All gates green. Commit `chore(deps): upgrade @nuxt/fonts to v1`.

### Task 11: Upgrade @dnd-kit/vue 0.3 → 0.5

Highest risk — DnD invariants in `CLAUDE.md` (Drag-and-Drop + Mobile Board Layout sections) must all still hold.

- [ ] **Step 1:** Read the dnd-kit changelog for 0.4 and 0.5 (`@dnd-kit/vue`, `@dnd-kit/dom`, `@dnd-kit/abstract`). Upgrade all `@dnd-kit/*` packages together.
- [ ] **Step 2:** Adapt `composables/useBoardDndKit.ts`, `useColumnSortable`, `SortableTaskWrapper.vue`, `ColumnDropZone`, `Board.vue` to API changes.
- [ ] **Step 3:** All DnD E2E specs (`drag-and-drop`, `dnd-*`, `sorting`, `stack-*`, `visual-regression`) pass 3 consecutive runs; WIP limit (one task in "In Arbeit") still enforced; full gates green. Commit `chore(deps): upgrade @dnd-kit/vue to 0.5`.
- [ ] **Step 4:** Update `CLAUDE.md` DnD section only if an invariant's mechanism changed.

### Final

- [ ] Whole-branch review; update `CLAUDE.md` (typecheck command now real; Linear gone; CI exists). Report remaining work: Tauri CSP (`"csp": null`), pruning stale remote branches (user's call), `NotionIntegration.ts` split.
