# Contributing to Kan-Do

Kan-Do is a focus layer for one person's day: a today-only board (Offen, Jetzt, Wartet, Erledigt) on top of Notion or local tasks, as a Nuxt web app and a Tauri macOS desktop app. This file gets you from clone to merged pull request. It points at the sources of truth instead of copying them.

## Contents

- [Product and design direction](#product-and-design-direction)
- [Setup](#setup)
- [Architecture orientation](#architecture-orientation)
- [Conventions](#conventions)
- [Quality gate](#quality-gate)
- [How work flows](#how-work-flows)
- [Branches, commits and pull requests](#branches-commits-and-pull-requests)
- [Working with AI agents](#working-with-ai-agents)
- [Building and deploying](#building-and-deploying)
- [Troubleshooting](#troubleshooting)

## Product and design direction

Read these before you change behaviour or UI:

- [PRODUCT.md](PRODUCT.md): users, positioning, constraints, principles, and "Jobs to be done" (J1 to J6, referenced from issues).
- [DESIGN.md](DESIGN.md): visual system, tokens, named rules, recurring patterns. Open design debt: [docs/design/backlog.md](docs/design/backlog.md).
- [docs/application-purpose.md](docs/application-purpose.md): vision and non-goals.
- [docs/acceptance-criteria.md](docs/acceptance-criteria.md): user acceptance criteria.
- [docs/adr/](docs/adr/): architectural decisions (one file per decision).

## Setup

Prerequisites:

- Node.js and npm (a current LTS; Nuxt 4).
- For the desktop app only: the Rust toolchain and the Tauri CLI (`~/.cargo/bin/cargo install tauri-cli`; release builds need >= 2.11.5).

```bash
git clone https://github.com/jaylouiz/kan-do.git
cd kan-do
npx npm@11.19.0 ci          # first install, exact lockfile
cp .env.example .env        # only needed for Notion/Todoist work, see below
```

Dependencies: install and add packages with `npx npm@11.19.0 install <pkg>`. Local npm 11.6 silently drops `@emnapi` lockfile entries that CI needs. Plain `npm install|i|ci` is blocked for agents by a hook for the same reason; do not use it for lockfile changes.

Environment (`.env.example`): `NOTION_KEY`, `NOTION_PAGE_ID` (Notion integration), `TODOIST_CLIENT_ID`, `TODOIST_CLIENT_SECRET` (Todoist OAuth, web only). You do not need any of them for UI work: a Local board and the Notion stub cover it. Build-time variables (`BASE_URL`, `NITRO_PRESET`, ...) are listed under [Building and deploying](#building-and-deploying).

### Run the web app

```bash
npm run dev           # http://localhost:3000 (check that nothing is running already)
npm run dev:e2e       # same, with the Notion stub (E2E_NOTION_STUB=1), no real credentials
```

Seeded boards, so you never click through onboarding. Open the URL once; `plugins/e2e-seed.client.ts` writes localStorage and reloads:

- `http://localhost:3000/tasks?seed=local`: a Local board with test tasks (default for UI work).
- `?seed=demo`: realistic demo board (a landscaping business owner's day) for trying the app and reviewing UI.
- `?seed=dayclose`, `?seed=newday` / `newday-all`: end-of-day dialog and new-day recap.
- `?seed=notion` (needs `npm run dev:e2e`), `?seed=mixed`, `?seed=clear`.
- `?lang=en` switches UI copy to English (persisted).

Seeding details and the Notion stub: [.claude/rules/e2e.md](.claude/rules/e2e.md). Real Notion API checks in a sandbox workspace: [docs/testing/notion-sandbox.md](docs/testing/notion-sandbox.md).

### Run the desktop app (Tauri)

```bash
npm run tauri:dev     # native macOS window with hot reload (uses your real app data folder and Keychain)
```

To check desktop behaviour without touching your own data, use the sandboxed run in [docs/testing/tauri-dev-sandbox.md](docs/testing/tauri-dev-sandbox.md). Desktop-only rules (E2E stub, CSP, in-app feedback): [.claude/rules/desktop.md](.claude/rules/desktop.md).

## Architecture orientation

- **Stack**: Nuxt 4 (Vue Composition API), Pinia, Nuxt UI + Tailwind, Phosphor icons, vue-i18n. The desktop app is a Tauri v2 wrapper around the same frontend (`src-tauri/`, Rust).
- **State**: Pinia stores in `store/` use the Setup API (`defineStore('id', () => ...)`) with `acceptHMRUpdate()`; use `Record<string, T>`, not `Map`, so state serialises; helpers in `utils/mapHelpers.ts`.
- **One orchestrator**: [composables/useTaskSync.ts](composables/useTaskSync.ts) is the only place that mutates both the store and an upstream service. Nothing outside it switches on a source name.
- **Task sources and identity** ([ADR 015](docs/adr/015-task-source-identity-and-persisted-shape.md)): each task has `source` (`local | notion | todoist`) and `externalId`. `id` is the stable app-level identity; integrations only ever see `externalId`. Adapters live in `integrations/sources/`.
- **Board invariants**: four columns in fixed order Offen, Jetzt, Wartet, Erledigt; "Jetzt" accepts at most one task (WIP limit, enforced in `onDragOver`).
- **Offline-first**: the local cache is authoritative and reconciles on reconnect. Persistence goes through one adapter, `appStorage`; on desktop Rust owns the data file ([ADR 008](docs/adr/008-file-backed-persistence.md), [ADR 011](docs/adr/011-backups-and-conflict-safety.md)). API tokens live in the macOS Keychain, never in persisted state ([ADR 007](docs/adr/007-secrets-keychain.md)).
- **Server**: `server/` holds Nuxt API routes (Notion proxy). Errors: `createApiError('NOTION_API_ERROR', 502)`.
- **Layout**: `components/` (board, task, notion, ...), `composables/`, `integrations/`, `pages/`, `store/`, `types/`, `utils/`, `lib/`, `server/`, `i18n/locales/`, `src-tauri/`, `tests/`, `scripts/`.

Deep detail per subsystem lives in path-scoped rule files in [.claude/rules/](.claude/rules/); read the matching one before you create or change files in that area:

| Rule file | Covers |
|---|---|
| [drag-and-drop.md](.claude/rules/drag-and-drop.md) | dnd-kit invariants, stacks, origin column |
| [mobile-board.md](.claude/rules/mobile-board.md) | swipe between pages, edge-scroll |
| [task-sources.md](.claude/rules/task-sources.md) | `boardConfig.sources`, add target, pending sync, mixed board |
| [persistence.md](.claude/rules/persistence.md) | `appStorage`, `PERSISTED_KEYS`, data safety, `cargo test` |
| [task-timers.md](.claude/rules/task-timers.md) | Jetzt timers |
| [e2e.md](.claude/rules/e2e.md), [e2e-gate.md](.claude/rules/e2e-gate.md) | seeding, stub, drag simulation, the pre-merge E2E tiers |
| [ui-patterns.md](.claude/rules/ui-patterns.md) | the Pattern check before creating or changing a UI element |
| [desktop.md](.claude/rules/desktop.md) | desktop stub, CSP, in-app feedback |

## Conventions

- **Components**: `defineOptions({ name: 'ComponentName' })`; a `@component` / `@description` / `@usage` / `@responsibility` header doc block; props via `defineProps<Props>()`, emits via `defineEmits<{...}>()`, v-model via `defineModel<T>()`. Never mutate Pinia state in templates; go through store actions. Gate browser APIs with `if (import.meta.client)`, dev logs with `if (import.meta.dev)`.
- **Styling**: Nuxt UI semantic tokens first; no raw hex, no palette classes, no arbitrary `[bracket]` values (ESLint enforces); component overrides in `app.config.ts`; Phosphor icons (`ph:`) only, because other collections are not bundled and the desktop CSP blocks them. The `custom-ink` palette is frozen; changing it is a recorded decision in DESIGN.md. Rules and recurring patterns: [DESIGN.md](DESIGN.md).
- **Fonts**: served locally from `public/fonts/`, declared via the `fonts` section of `nuxt.config.ts` (`@nuxt/fonts`, `src` keeps it local-only). Tokens `--font-sans` / `--font-display` live in `assets/css/main.css`; use the `font-display` utility class for headings.
- **Language**: code, comments, commits, docs in English. UI copy is German by default, English supported, always via i18n keys (`const { t } = useI18n()`; outside setup `translate()` from `lib/i18n.ts`); no hard-coded strings in templates (ESLint `no-raw-text`). Both `i18n/locales/de.json` and `en.json` need every key: `npm run i18n:check`. Copy wording goes through the term registry [docs/copy/terms.json](docs/copy/terms.json) (rules: DESIGN.md "Voice and copy"). Locale resolution: [ADR 006](docs/adr/006-i18n-routing-and-locale-detection.md).
- **Privacy**: mark task text (title, notes, topic, custom values) with `data-private` so feedback screenshots mask it.
- **Errors**: use `useErrorHandler()` and `handleError(message, context)` instead of `console.error`. An auth or configuration error never opens a setup dialog by itself; it marks the source `broken`.
- **TaskStatus**: `TaskStatus.Open` is `0`. Compare a status explicitly, never `if (status)` (ESLint rule `kan-do/no-taskstatus-truthiness`).
- **UI work**: read PRODUCT.md and DESIGN.md first. Look up Nuxt UI components in the Nuxt UI docs or `.nuxt/ui/<component>.ts`; do not guess props or slots. Before creating or changing a UI element, find the existing pattern for the same user job and reuse, align or diverge deliberately (`ui-patterns.md`, one `Pattern:` line per decision in the PR). Give a design reason ("because...") to the maintainers; it becomes a rule only through a proposal they adopt, never by editing DESIGN.md on your own.
- **Tests**: stores use `setActivePinia(createPinia())` per test; composables mock deps with `vi.doMock` before import; server routes use `supertest` + `h3` (`server/api/__tests__/`); E2E defaults to a Local board with `tests/e2e/helpers/seed.ts` helpers and `context.addInitScript`, never copy-pasted localStorage setup. i18n in tests: `tests/setup/i18n.ts` (locale `de`), `setTestLocale('en')` for English.

## Quality gate

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests and the full E2E suite on every pull request and every push to `main` (docs-only changes skip). The local gate below is still the main one, and a pull request is not ready until it passes:

```bash
npm run verify        # lint:ci + typecheck + design:detect + vitest (run before opening a PR)
npm run lint          # ESLint (includes Tailwind class rules)
npm run typecheck     # nuxt typecheck
npm test              # Vitest unit tests (tests/); e.g. npx vitest tests/store/tasks.test.ts
npm run build         # also when the PR touches nuxt.config.ts, package.json, app.config.ts, server/ or vercel.json
npm run i18n:check    # de/en locale parity
npm run design:detect # Impeccable design detector, source scan
```

End-to-end tests (Playwright) run against a production build with the Notion stub on:

```bash
PORT=3101 npm run test:e2e -- tests/e2e/task-detail.spec.ts --reporter=list
```

- `npm run test:e2e` builds into `.e2e-build/<port>` and serves it; Playwright reuses whatever already serves that port. In a worktree, or beside a dev server on `:3000`, always set `PORT=<free port>`.
- Against a running dev server instead (no build, visual shots differ by ~1 px): `BASE_URL=http://localhost:3000 npm run test:e2e`.
- After pulling Playwright upgrades: `npx playwright install chromium`.
- UI-path PRs also run the rendered design scan and ARIA snapshots: `PORT=3101 npm run test:e2e -- tests/e2e/design-detect.spec.ts tests/e2e/state-structure.spec.ts`.
- Visual baselines (`tests/e2e/snapshots/`, macOS-rendered, so the spec skips itself when `CI` is set): after an intentional UI change run `PORT=3101 npm run test:e2e -- tests/e2e/visual-regression.spec.ts --update-snapshots` and commit the PNGs. Never record them against a dev server.
- Rust changes: `cargo test --lib` (see [.claude/rules/persistence.md](.claude/rules/persistence.md)).
- Merging runs a tiered E2E set from a pre-merge hook (docs-only changes skip it; others run smoke plus the specs mapped to the touched area). List the specs you ran in the PR body as `E2E-specs: a b c`. Tier rules: [.claude/rules/e2e-gate.md](.claude/rules/e2e-gate.md).
- Opt in to checks before every push: `git config core.hooksPath .githooks` (`npm run verify`; in testing mode `fast` only the unit tests of changed code).

Issue and PR numbers: in code, comments, test names and docs a bare `#n` always means the private archive of the project's earlier history, `jaylouiz/kan-do-archive` (numbers up to #704, not public); a reference to an issue or PR of this repo is written `kd#n`. GitHub text (issues, PRs, commit messages) keeps the plain `#n`, which GitHub links to this repo; commit messages up to `cda2fa7b` use archive numbers.

## How work flows

GitHub issues are the work queue. Optional lanes, in order: `needs-design` (open UX direction) -> `needs-spec` (open build decisions or incomplete issue) -> `ready` (clear, buildable). `on-hold-after-spec` stops after the spec. Unsorted side-findings are labelled `inbox` and are not worked until triaged. Other context labels: `new-feature`, `enhancement`, `polish`, `consistency`, `a11y`, `bug`, `dev-improvement`. Project facts for the workflow: [.claude/issue-workflow.md](.claude/issue-workflow.md).

What a good issue holds (it is fine to file one with only a title; the first design or spec pass completes the rest):

- `## Problem`, free of solutions: who, in which situation, what is wrong or missing (or which delight is missing), and why it matters. Add `Job: J4 Get the planned work done` using the ids from PRODUCT.md "Jobs to be done". If you have an idea or mechanism, it goes into Solution.
- `## Solution`: two to five lines on the current shape of the answer. It starts as your rough idea (or `open`) and is sharpened by design and spec.
- Added later, as the issue moves along: `## User stories`, `## Acceptance criteria` (observable behaviour, one line per state), then technical approach, implementation notes and verification.
- Bugs: name the job the bug breaks; acceptance criteria are the correct behaviour plus a regression check. Tech-only work (refactor, tooling): say what hurts technically and why; acceptance criteria include "user-visible behaviour unchanged".
- Unclear problem or a destination too big for one session: say so in the issue instead of guessing a solution.

UI work: UX direction is settled in the issue first. Throwaway prototypes live on `proto/<n>-<slug>` branches, are previewed on Vercel, and are never merged. Default acceptance criteria for UI work (empty/loading/error states, 390 px and desktop, i18n keys in both locales, keyboard and screen reader, semantic tokens only, no P0/P1 design findings) are listed in [.claude/issue-workflow.md](.claude/issue-workflow.md).

## Branches, commits and pull requests

- Branch name: `<type>/<n>-<kebab-slug>` with type `fix|feat|test|docs|chore` and `<n>` the issue number. Never work on `main` directly.
- Use a git worktree per task, so parallel work never switches the main checkout's branch: `git worktree add ../kan-do-<slug> -b <branch> origin/main`. Worktrees symlink `node_modules`; run `npx nuxt prepare` once for lint and typecheck.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`), English, imperative.
- A pull request body holds: `Closes #<n>`; acceptance criteria as a checklist with evidence; the `E2E-specs: a b c` line; `Pattern:` lines when the diff touches UI source; for UI changes 1 to 3 screenshots at desktop and 390 px (light only) and the design-quality results; anything you left out and any follow-ups. Anything worthwhile you noticed outside the task becomes its own issue, not part of the PR.
- Never commit screenshots, absolute `/tmp` paths, or an incidental `package-lock.json` rewrite.
- A regression test must fail without the fix; check this once by reverting the fix.
- Releases are the maintainer's job only: version bumps, `npm run release`, the signing key, Developer ID certificate and notarization. See [docs/release.md](docs/release.md) and [ADR 009](docs/adr/009-release-pipeline-and-updater.md); contributors never run a real release.

## Working with AI agents

[CLAUDE.md](CLAUDE.md) is the instruction file for coding agents (commands, invariants, conventions); it is the compact twin of this file. Contributors who use Claude Code get the repo's hooks automatically through `.claude/settings.json`, so expect a session to take longer to finish than without them:

- A `Stop` hook (`.claude/hooks/verify.sh`) runs lint, typecheck, `design:detect` and Vitest (plus the rendered design scan when design files changed) before the session may finish; failures are fed back and the agent keeps working. Its timeout is 600 s.
- A `PostToolUse` hook lints and token-checks each edited file.
- A `PreToolUse` guard blocks risky commands: `pkill` of nuxt, `tauri dev` with the real app identity, real releases, and plain `npm install|i|ci`. The message names the allowed command; do not work around it.
- A pre-merge hook (`.claude/hooks/e2e-before-merge.sh`) runs the tiered E2E gate on `gh pr merge`, against a production build; it may take up to 1800 s and blocks the merge on a failure.
- Prerequisites for the hooks: `jq` and `perl` on `PATH` (macOS ships perl; `brew install jq`), Chromium for Playwright (`npx playwright install chromium`), and `npx nuxt prepare` once per checkout or worktree (lint and typecheck read `.nuxt/`). Without `perl` the pre-merge hook refuses a merge command; without `jq` it cannot read the command at all, so install both.
- The testing mode (`.claude/testing-mode`, `fast` or `quality`, untracked) is read per checkout; without the file everything runs in `quality`.
- Workflow skills (`/build-gh-issue` and friends, [agent-workflow](https://github.com/jaylouiz/agent-workflow)), Orca and the FigCraft design canvas are the maintainer's personal tooling and not part of the repo; the method is described in this file, not required.

## Building and deploying

```bash
npm run build         # web build (Nitro preset from NITRO_PRESET, default static)
npm run generate      # static files; the desktop app's frontend (beforeBuildCommand)
npm run preview       # preview a web build
npm run tauri:build   # desktop bundle: src-tauri/target/release/bundle/{macos,dmg}
```

Build-time environment variables (read in `nuxt.config.ts`):

| Variable | Default | Meaning | Example |
|---|---|---|---|
| `BASE_URL` | `/` | App base path (trailing slash matters) | `/my-app/` |
| `NITRO_PRESET` | `static` | Build preset | `node-server` |
| `APP_TITLE` | `kan-do` | Browser title | `My Kan-Do` |
| `APP_LANG` | `de` | HTML `lang` attribute | `en` |

Scenarios:

- **Static host under a sub-path** (GitHub Pages, Netlify): `BASE_URL=/repo-name/ npm run build`, publish the generated output (Netlify: `dist`). Example: GitHub Pages `username/kan-do` is served at `https://username.github.io/kan-do/` with `BASE_URL=/kan-do/`.
- **Node server** (Vercel, Railway, any Node host): `BASE_URL=/ NITRO_PRESET=node-server npm run build`, run `node .output/server/index.mjs`. Optional `PORT` (default 3000) and `HOST`.
- **Vercel** for this repository: `vercel.json` deploys only `main` and `proto/*` branches.
- **Docker**: a multi-stage or single-stage Node image that runs `RUN BASE_URL=/ NITRO_PRESET=node-server npm run build` and `CMD ["node", ".output/server/index.mjs"]`, `EXPOSE 3000`.
- **Multiple environments**: keep separate `.env.production` / `.env.staging` files with different `BASE_URL`.

The desktop release pipeline (signing, notarization, updater, release notes): [docs/release.md](docs/release.md) and `release-notes/README.md`.

## Troubleshooting

- **404s or missing assets after a sub-path deploy**: `BASE_URL` must match the deploy path and end with `/`.
- **SSR not working**: set `NITRO_PRESET=node-server` and make sure a Node runtime is available.
- **Desktop: "Asset not found: index.html"**: `beforeBuildCommand` in `src-tauri/tauri.conf.json` must be `npm run generate`; run it once by hand to check the static output.
- **Desktop app does not start or build fails**: run `npm run tauri:dev` and read the console; check `rustc --version`; clean build with `rm -rf src-tauri/target && npm run tauri:build`; update Tauri with `~/.cargo/bin/cargo install tauri-cli --force`.
- **Hot reload stuck**: restart `npm run dev` and check that port 3000 is free.
- **Notion errors in development**: check `NOTION_KEY` in `.env`, or use `npm run dev:e2e` to run against the stub.
- **E2E hits a stale server**: another process serves your `PORT`; choose a free port.

Questions or ideas: open a GitHub issue with a `## Problem` section as described above.
