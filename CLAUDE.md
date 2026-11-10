# CLAUDE.md

## Commands

```bash
# Development
npm run dev           # Nuxt dev server on port 3000 (check if already running)
npm run dev:e2e       # Dev server with Notion stub enabled (E2E_NOTION_STUB=1)
npm run tauri:dev     # Tauri desktop app with hot reload (the user only; agents: skill desktop-verify)
npx npm@11.19.0 install <pkg>  # dependency installs (local npm 11.6 drops `@emnapi` lockfile entries CI needs)

# Test
npm run test:e2e                                                      # Playwright E2E: builds a Nitro node-server into .e2e-build/<port> and runs against it (Notion stub on, ~10 s build, #541)
BASE_URL=http://localhost:3000 npm run test:e2e                       # against any running server instead, e.g. `npm run dev:e2e`; builds nothing
npx playwright install chromium                                      # run after pulling Playwright upgrades
npm run test:e2e -- tests/e2e/task-detail.spec.ts --reporter=list    # Single E2E test (bare `npx playwright test` needs `-c tests/e2e/playwright.config.ts`)

# Quality
npm run lint          # ESLint (includes better-tailwindcss: no-arbitrary-value errors on [bracket] classes, `no-unknown-classes` on utility-shaped classes nothing defines (`text-muted-foreground`); `kan-do/no-taskstatus-truthiness`: `TaskStatus.Open` is 0, so compare a status explicitly, never `if (status)`)
npm run typecheck     # nuxt typecheck (run before merging)

# Impeccable detector: source scan and rendered scan (element rules: contrast, undersized text)
npm run design:detect   # source; also runs in `npm run verify` and the Stop hook
PORT=3101 npm run test:e2e -- tests/e2e/design-detect.spec.ts tests/e2e/state-structure.spec.ts   # rendered matrix + ARIA state snapshots (pre-merge gate on UI paths)
IMPECCABLE_BROWSER="$(node -e "console.log(require('playwright').chromium.executablePath())")" \
  npx impeccable detect "http://localhost:3000/tasks?seed=local"   # needs a running dev server

# Visual regression baselines (run after intentional UI changes): the suite runs against a production build (#540, #541),
# which is what the baselines are recorded from; against a dev server 12 px text sits ~1 px lower and a few shots fail
PORT=3101 npm run test:e2e -- tests/e2e/visual-regression.spec.ts --update-snapshots   # PORT = a free port, never :3000 with a dev server (reuseExistingServer would record dev's offset)
# Then commit the updated PNGs in tests/e2e/snapshots/
```

### Seeded boards for E2E / dev testing

Local tasks (default for UI-only tests, no stub needed): `npm run dev`, open `http://localhost:3000/tasks?seed=local` (board pre-loaded with test tasks). Notion stub (no real credentials): `npm run dev:e2e`, open `/tasks?seed=notion` (both stub options: `.claude/rules/e2e.md`).

The `?seed=<mode>` URL param (handled by `plugins/e2e-seed.client.ts`) writes the correct localStorage state and reloads. Supported modes: `local`, `dayclose` (board tailored to review the end-of-day dialog), `notion`, `newday` / `newday-all` (first start on a new day, the recap opens; `&daysago=n`; E2E: `seedNewDayBoard`), `demo` (the realistic demo board of #527, `lib/demo-board.ts`, also the onboarding sample button: a landscaping business owner's tasks with stacks under every grouping option, a Jetzt timebox, Wartet notes, carry-over and done-today tasks; for trying the app and reviewing UI, never an E2E fixture, specs use `local`), `mixed` (Local and Notion tasks side by side, Notion stub, `&default=local` makes Local the default source; E2E: `seedMixedBoard`), `clear`.

## Architecture

### State Management

- `composables/useTaskSync.ts` is the single orchestrator: the only place that mutates both store and upstream service (`createTask(draft, source)` makes every new task, #321). `useTaskSync` and `useIntegrationManager` never switch on a source name; `useTaskSources` resolves a source's `TaskSourceAdapter` (`integrations/sources/`, ADR 015).
- **Task source and identity** (ADR 015): every `Task` has `source` (`'local' | 'notion' | 'todoist'`) and `externalId` (`string | null`). `id` is the stable app-level identity (statistics, order, carry-over, archive, timers and routes are keyed by it) and never changes; integrations receive `externalId`, never `id` (`externalIdOf()` in `lib/taskSources.ts`). `useTaskSync` routes by `task.source`. `boardConfig.sources` replaced `taskService`; read and write it only as `.claude/rules/task-sources.md` says.
- Stores use Pinia **Setup API** (`defineStore('id', () => { ... })`). Always include `acceptHMRUpdate()`.
- Use `Record<string, T>` (not `Map`) — serializes naturally with `pinia-plugin-persistedstate`
- Use `mapHelpers` utilities (`utils/mapHelpers.ts`) for Record operations
- Persistence goes through one adapter, `appStorage`. Never capture a storage in a constant at import time.
- Secrets (desktop): API tokens live in the macOS Keychain, never in persisted state — see `docs/adr/007-secrets-keychain.md` and `lib/secrets.ts` (`SECRET_STATE_PATHS`, `persistOmitFor`)

### Board Invariants

- Four columns in fixed order: **Offen → Jetzt → Wartet → Erledigt**
- **WIP limit**: "Jetzt" accepts at most one task — enforced in `onDragOver` via `event.preventDefault()`
- Offline-first: local cache is authoritative; reconcile on reconnect

### Subsystem rules

Path-scoped rules in `.claude/rules/` load when you read or edit a matching file (globs in each file's `paths:`). Read the matching file before creating a new file in that area.

- `drag-and-drop.md`: dnd-kit invariants, stacks, the origin column (#372), one root node per list item
- `mobile-board.md`: swipe between pages and edge-scroll on mobile
- `task-sources.md`: `boardConfig.sources`, add target (#321), pending sync (#319), move between sources (#322), mixed board (#323, #325), `mergeTasks`
- `persistence.md`: `appStorage` and `PERSISTED_KEYS`, `afterHydrate` (#273), desktop data safety (ADR 011), export/import, data status payload, `cargo test`
- `task-timers.md`: Jetzt timers (#352)
- `e2e.md`: seeding detail, Notion stub, drag simulation, cold-server warm-up, fixtures
- `e2e-gate.md`: tier rules of the pre-merge E2E gate (docs/style-only skip, smoke + mapped specs, `E2E_GATE=full`)
- `ui-patterns.md`: the Pattern check before creating or changing a UI element (#586), record line format
- `ui-catalog.md`: the `/ui` Components engine: catalog entries, the manifest rows of Nuxt UI components, the style fingerprint (#66)
- `desktop.md`: desktop E2E stub, desktop CSP (ADR 012), in-app feedback (ADR 010/014)

### Component Conventions

- `defineOptions({ name: 'ComponentName' })` on every component
- Include `@component` / `@kind` (primitive, component, compound, block) / `@category` (one of the nine in `scripts/ui-manifest.mjs`) / `@description` / `@usage` / `@avoid` / `@responsibility` header doc block; the manifest behind `npm run ui:find` and `/ui` is derived from them on every run, nothing to regenerate or commit (`npm run ui:manifest` prints it); terms in `GLOSSARY.md`
- Props via `defineProps<Props>()`, emits via `defineEmits<{...}>()`, v-model via `defineModel<T>()`
- Never mutate Pinia state directly in templates; route through store actions
- Gate browser APIs with `if (import.meta.client)`; guard dev logs with `if (import.meta.dev)`
- Mark task text (title, notes, topic, custom values) with `data-private` (masked in feedback screenshots)

### Styling

Rules live in `DESIGN.md` (direction, tokens, named rules, recurring patterns; per-component values and accepted trade-offs live in the component's doc block). Short form: Nuxt UI semantic tokens first, no raw hex or palette classes (ESLint warns), component overrides in `app.config.ts`, Phosphor icons (`ph:`). The primary palette (`custom-ink`) is frozen — change it only by a decision recorded in DESIGN.md (an agent may make it as an `agent-decided` record, `.claude/issue-workflow.md` "Decisions"). Icons from an uninstalled collection (`i-lucide-*`) are blocked by the desktop CSP; enforced by `tests/config/icons-bundled.test.ts`.

### UI Work

- Before UI work read `PRODUCT.md` (users, principles) and `DESIGN.md` (visual system, patterns) — the design source of truth. Open design debt lives in `docs/design/backlog.md`.
- Look up every Nuxt UI component via the Nuxt UI MCP (`get-component-metadata`, `search-components`) or `.nuxt/ui/<component>.ts` — never guess props or slot names.
- **Pattern check** (`.claude/rules/ui-patterns.md`, loads with any UI file): before creating or changing a UI element, find the existing Pattern for its user job (`npm run ui:find -- <job words>` over the manifest first, then `/ui`) and decide reuse, align or diverge yourself; leave one `Pattern:` line per decision (PR body, or the final report for ad-hoc work).
- **Design reasons** ("because…", "so that…") from the user, in any channel, or a `diverged from` reason: skill `design-rule` challenges it and proposes a rule. Never write a rule before the user says yes.
- Process: open direction → `/design-gh-issue` (brief, variants, throwaway prototype or canvas sketch, UX decision) → `/specify-gh-issue` → `/build-gh-issue` (screenshots at desktop + 390px, light only; Impeccable gate). Which Impeccable verb runs where: `.claude/issue-workflow.md` "Design quality".

### Language Policy

- Code, comments, commits, docs: **English**
- UI copy: **German by default, English supported, via i18n keys** — `import { useI18n } from 'vue-i18n'`, `const { t } = useI18n()`, never hardcoded strings in templates (ESLint `no-raw-text`). Outside component setup use `translate()` from `lib/i18n.ts`.
- UI copy goes through the `copy-writer` skill and the term registry `docs/copy/terms.json` (rules: `DESIGN.md` "Voice and copy"); only the user approves a `decided` term.
- Locales: `i18n/locales/de.json` + `en.json` (vue-i18n syntax, not ICU); every key in both. Check with `npm run i18n:check`.
- Locale resolution (no switcher, `plugins/i18n-locale.client.ts`): `?lang=de|en` (persisted) > `KANDO_LOCALE` (dev only, not persisted) > stored `kando-locale` > `navigator.languages` > `de`. Try it: `KANDO_LOCALE=en npm run dev` or `/tasks?lang=en`. Rationale: `docs/adr/006-i18n-routing-and-locale-detection.md`.

Live copy editor (dev only, `docs/copy/live-copy-editor.md`): `dev-tools/copy-editor/` and `server/copy-editor/` exist only behind `__COPY_EDITOR__` (dev, E2E build); keep tool code there, never import it from app code.

UI status labels (used in E2E assertions): `Offen`, `Jetzt`, `Wartet`, `Erledigt`

## Design canvas

Mockups live on a shared FigCraft canvas, worked through the global `/ui-canvas` skill (build, replicate, variants, "check comments", handoff). Its kan-do settings (canvas file, start command, frame = route naming, token and component mapping, handoff target) are in `.claude/ui-canvas.md`. Implementing a handed-off frame follows "UI Work" above. FigCraft and `/ui-canvas` are the maintainer's personal tooling; contributors follow CONTRIBUTING.md.

## Testing

- **Stores**: `setActivePinia(createPinia())` per test; reset after
- **i18n in tests**: `tests/setup/i18n.ts` installs i18n globally (locale `de` before each test, so German literals are fine); use `setTestLocale('en')` from `tests/helpers/i18n.ts` for English. E2E pins `locale: 'de-DE'`.
- **Composables**: mock deps via `vi.doMock` before importing the module
- **Server routes**: `supertest` + `h3` (see `server/api/__tests__/`)
- **Record/Map state**: use `.get()`, `.has()`, `.size` — never bracket access
- **E2E default**: use a Local board (`sources: { connected: [], default: 'local' }`) for all UI tests unrelated to integrations — no stub or env var needed. Use `tests/e2e/helpers/seed.ts` helpers (`seedLocalBoard`, `seedNotionBoard`) instead of copy-pasting localStorage setup.
- **E2E seeding**: prefer `context.addInitScript` (runs before page JS) over `page.evaluate` after `goto`. See `tests/e2e/helpers/seed.ts`.
- **E2E server**: `npm run test:e2e` starts `scripts/e2e-server.mjs` (build, then serve a production build on `PORT`, default 3000; the pre-merge gate and `npm run release` run the same command). Playwright reuses whatever already serves that port, so in a worktree, or next to a dev server on `:3000`, use `PORT=<free port> npm run test:e2e …`. The build has its own `.nuxt`/output below `.e2e-build/<port>`, so it never touches a running dev server, `.nuxt` or the `.output` of `npm run generate`; a fresh worktree needs no setup (the script runs `nuxt prepare` when `.nuxt` is missing; lint/typecheck still need it by hand: `npx nuxt prepare`). Stop your own server only by its port's PID (`lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill`). Debugging against `nuxt dev`: `BASE_URL=http://localhost:<port> npm run test:e2e …` (no build; the visual shots then differ by ~1 px).
- **Agent-driven browser testing**: invoke the `playwright-cli` skill (not Playwright MCP tools). Promote to an external script only when `page.mouse` pointer control is needed (e.g. drag-and-drop), or when `playwright-cli` finds no Chrome (use the repo's `playwright` chromium). Seed first (`?seed=local`), then open the task sheet from the board or `goto /tasks/seed-open-1`; a detail URL without the seed step loses the seed.
- Desktop pages and the sandboxed `tauri dev`: skill `desktop-verify` (never touches the production app or steals focus, #623). Real Notion without user clicks: skill `notion-sandbox`.

## Hooks

**Testing mode** (#693): `.claude/testing-mode` (per checkout, untracked) = `fast` or `quality` (default; missing or unknown reads as `quality`), honoured by the Stop hook, the pre-merge gate, `npm run release --stage` and the workflow skills; switching it is the user's one-way decision. Rules: profile "Verification".

`.claude/settings.json` registers a `Stop` hook (`.claude/hooks/verify.sh`) that runs `lint:ci`, `typecheck`, `design:detect`, `vitest run` and, when a design-path file changed since its last pass, the rendered Impeccable scan (`scripts/design-scan.mjs`, ~30 s) before Claude may finish; failures are fed back and Claude keeps working (max 3 consecutive blocks). The rest of E2E runs in the pre-merge hook. A `PostToolUse` hook (`.claude/hooks/eslint-file.sh`, matcher `Edit|Write|Bash`) runs `eslint --fix --quiet` and the `var()` token check (`scripts/lint/design-tokens.mjs`) on each edited file and feeds remaining errors back. Both skip `proto/*` branches (throwaway prototypes). The Impeccable plugin adds its own design hooks. All of them work in the edited file's own checkout (`.claude/hooks/edit-root.sh`): a session started here that edits a worktree gets lint, token checks, Impeccable (`impeccable-worktree.sh`) and Stop verification there too. Files a Bash command changed (sed, heredocs; `bashEditDiff` or an mtime scan, `edit-root.sh`, #650) get the same per-edit checks; none after `git checkout|pull|stash…` or for more than 40 files, where only the Stop checks see them. Worktrees symlink `node_modules` via `worktree.symlinkDirectories`.

A `PreToolUse` Bash hook (`.claude/hooks/guard-commands.sh`) blocks `pkill` of nuxt, `tauri dev` with the real app identity, a real release (`npm run release` without `--dry-run`, `gh workflow run release`) and `npm install|i|ci`; its message names the allowed command. Do not work around it.

## Issue Workflow

GitHub issues are the work queue; lanes `needs-design` → `needs-spec` → `ready`, each optional (`on-hold-after-spec` = no Build). Skills (the maintainer's personal tooling, [agent-workflow](https://github.com/jaylouiz/agent-workflow), run with Orca; vocabulary and triage rule in its README; contributors follow CONTRIBUTING.md instead): `/design-gh-issue` (UX, prototype on `proto/<n>-*` branches, never merged), `/specify-gh-issue` (never edits code), `/build-gh-issue` (never merges), `/orchestrate-gh-issues` (coordinates all plus `/code-review`, merges by default); user, Claude or sub-agents may invoke them. kan-do facts they need: `.claude/issue-workflow.md`. Issue edits (body, labels, comments) need no user approval.

After merge: GitHub deletes the remote head branch (repo setting "Automatically delete head branches"); the `SessionStart` hook `.claude/hooks/cleanup-merged.sh` removes local worktrees and branches of merged PRs, Orca-managed ones via `orca worktree rm` (skips dirty worktrees and branches with commits after the merge; a lone modified `package-lock.json` counts as clean and is discarded, because Orca's repo setup script `npm install` rewrites it with local npm 11.6). After merging a PR yourself, run it right away; `--dry-run` previews.

Issue and PR numbers: in code, comments, test names and docs a bare `#n` always means the private archive `jaylouiz/kan-do-archive` (`gh issue view <n> -R jaylouiz/kan-do-archive`, numbers up to #704). Numbers overlap, so a reference to an issue or PR of this repo is written `kd#n` there (`gh issue view <n>`). GitHub text (issues, PRs, new commit messages) keeps the plain `#n`, which GitHub links to this repo; only commit messages up to `cda2fa7b` use bare `#n` for the archive. The issue body is the single current spec; comments hold the history. `inbox` issues (rule in `~/.claude/CLAUDE.md`) are out of scope until the user relabels or names them.

## CI

`.github/workflows/ci.yml` runs on PRs, pushes to `main` and by hand (`quality` = lint, typecheck, Vitest, then full E2E, always in full: standard runners are free for this public repo; docs-only changes skip; read-only, no secrets; actions pinned by SHA). The local gate stays: `npm run verify` before opening a PR, `npm run build` when the PR touches `nuxt.config.ts`, `package.json`, `app.config.ts`, `server/` or `vercel.json`, the relevant E2E specs (`E2E-specs: a b c` in the PR body), and the pre-merge hook's tiered E2E run on `gh pr merge` (`scripts/e2e-gate.mjs`, `.claude/rules/e2e-gate.md`). Vercel deploys only `main` and `proto/*`. `git config core.hooksPath .githooks` (set in the maintainer's checkout) checks every push at the testing mode (`.githooks/pre-push`). `visual-regression.spec.ts` self-skips when `CI` is set (macOS baselines).

## Cloud sessions

Claude Code on the web (`CLAUDE_CODE_REMOTE=true`) attaches only this repo: no personal skills (`/build-gh-issue` etc.) and no plugins (superpowers, Impeccable skills; `npm run design:detect` works). `.claude/hooks/cloud-setup.sh` installs dependencies, Chromium (needs `cdn.playwright.dev` and `playwright.download.prss.microsoft.com` in the environment's allowed domains) and `playwright-cli`; the Stop hook gates as locally. The GitHub proxy rejects `gh issue` and `gh pr` (GraphQL) for any token: read and comment through the built-in GitHub tools, write through `gh api repos/{owner}/{repo}/...` (REST), open the PR with the session's Create PR. `gh issue comment --attach` does not exist there, so screenshots stay in the session. Merge with `gh api -X PUT repos/jaylouiz/kan-do/pulls/<n>/merge -f merge_method=merge`: the pre-merge E2E hook gates it like `gh pr merge` locally (same tier and specs from `scripts/e2e-gate.mjs`); the built-in GitHub tools' merge and GitHub's merge button skip the gate. Local only: Tauri (`tauri:*`, `desktop-verify`), `notion-sandbox`, Orca, the FigCraft canvas, `visual-regression.spec.ts` (skips itself; `npm run release` runs it).

## Error Handling

Use `useErrorHandler()` — `handleError(message, context)` instead of `console.error`. Context keys (e.g. `notion_setup`) map to German UI copy. An auth or configuration error never opens a setup dialog by itself (#319): it marks the source `broken` and the sync button's popover offers "Verbindung reparieren". Server errors: `createApiError('NOTION_API_ERROR', 502)`.

## Key Reference Docs

- `docs/release.md` + `docs/adr/009-release-pipeline-and-updater.md` + `docs/adr/013-signing-notarization-and-ci-release.md` — `npm run release` runs verify and the full E2E suite; the self-updater (#225), Developer ID signing and the CI release (#228; a tag push runs it, a local release stays the default). `/prepare-release` prepares version and notes and hands the user the command. Agents never touch the updater signing key, the Developer ID certificate or notarization credentials.
- `docs/acceptance-criteria.md` — UAC for validation
- `docs/application-purpose.md` — product vision and non-goals
- `docs/adr/` — architectural decisions
