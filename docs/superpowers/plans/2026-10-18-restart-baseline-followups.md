# Restart Baseline — Follow-ups

Deferred findings from the `chore/restart-baseline` reviews, triaged by the final whole-branch review. None block merge.

## Decisions for the product owner
- **i18n:** `CLAUDE.md` and `.devin/rules/02,03,06,09,10,12,14,16` prescribe `useI18n()` + locale files, but no i18n system exists — UI copy is hardcoded German. Either adopt `@nuxtjs/i18n` or rewrite the rules to "hardcoded German copy".
- **Tauri CSP:** `src-tauri/tauri.conf.json` has `"csp": null`.
- **Stale remote branches:** ~20 `claude/*` and old fix branches on origin.

## Recommended next
- Push the branch and confirm the first real GitHub Actions run is green (CI has only been run locally).
- Manual Tauri smoke test (`npm run tauri:dev`, Notion via direct path) before tagging 0.1.0 — Tauri 2.12 / Nuxt 4.5 / Nuxt UI 4.12 jumps.
- E2E coverage for the WIP limit ("In Arbeit" max one task) and mobile edge-scroll — both verified manually only.
- Todoist SDK migration: `@doist/todoist-sdk` is held at 8.2.1 via `overrides` in `package.json` (15.x breaks Todoist types).

## Code quality
- Type persist options as `PersistenceOptions` instead of `as any` (`store/board.ts`, `store/tasks.ts`) — the casts hid the ignored v3 options `paths`/`afterRestore`.
- `server/api/notion/database.get.ts` catch block uses `console.error` + bare `createError` instead of `createApiError`.
- `pages/dnd-sample.vue` duplicates the `SortablePlugins` type and clone-feedback customizer from `composables/useColumnSortable.ts`; the opaque `Extract<UseSortableInput['plugins'], unknown[]>` type could become an explicit import.
- `nuxt.config.ts`: dev nitro config cast to `Record<string, unknown>`; `optimizeDeps.include` is a manual list (new client deps must be added).
- ~16 `@click="() => { x = y }"` wrappers added for vue-tsc; `TaskForm.vue` `urlPlaceholder` const sits between a JSDoc block and its computed.
- `utils/common.ts` is a vague name; `lib/default-tasks.ts` uses double-quoted imports.
- Split `integrations/NotionIntegration.ts` (~1.2k lines).

## Tests
- `tests/integration/statistics-backflow.integration.test.ts` uses a 5 ms sleep to avoid a `getJobHistory()` timestamp tie — use fake timers or a stable tie-break.
- Rare unit flake: `server/api/__tests__/tasks.patch.test.ts` "returns 400 when properties missing" (1/37 runs).
- `tests/e2e/sorting.spec.ts` still has five `waitForTimeout` calls.
- `visual-regression` `task-detail.png` failed once in 7 local runs (skipped in CI).
- Vitest 5 hint: jsdom created 47 times — consider one environment per worker.
- Lint warnings rose 9 → 11 (new better-tailwindcss rules).
