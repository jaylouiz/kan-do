---
paths:
  - ".github/workflows/**"
  - "scripts/ci-e2e-plan.mjs"
  - ".githooks/**"
---
# CI: the GitHub workflow

The short form (what a PR runs, the local gate) is in root `CLAUDE.md` "CI".

`.github/workflows/ci.yml`: a PR runs `quality` only (lint, typecheck, Vitest); a push to `main` and a manual run (`gh workflow run ci.yml`) also run every E2E spec over 8 shards in Playwright's image (`plan` + `e2e`; owner decision 2026-11-12 for the alpha phase: no E2E on PRs, and no merge waits for remote CI; to turn PR E2E back on, drop the `if` on the `plan` job, `scripts/ci-e2e-plan.mjs` still selects the gate's specs for a PR). Docs-only changes skip; read-only, no secrets; actions pinned by SHA; kd#187. A red `main` run is the signal that a merge broke something: fix forward. The local gate stays: `npm run verify` before opening a PR, `npm run build` when the PR touches `nuxt.config.ts`, `package.json`, `app.config.ts`, `server/` or `vercel.json`, the relevant E2E specs (`E2E-specs: a b c` in the PR body), and the pre-merge hook's tiered E2E run on `gh pr merge` (`scripts/e2e-gate.mjs`, `.claude/rules/e2e-gate.md`). Vercel deploys only `main`, `proto/*` and `dev`; `dev` is the dev instance (a Preview with `/ui` and the copy editor, `isDevInstance` in `lib/devPages.ts`, #246), updated with `npm run deploy:dev`. `git config core.hooksPath .githooks` (set in the maintainer's checkout) checks every push at the testing mode (`.githooks/pre-push`). `visual-regression.spec.ts` self-skips when `CI` is set (macOS baselines).
