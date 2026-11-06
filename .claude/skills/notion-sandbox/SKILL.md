---
name: notion-sandbox
description: Check kan-do against the real Notion API without the user clicking in Notion - reset and seed the sandbox workspace, drive the app against it (/tasks?seed=notion-sandbox), inspect what kan-do wrote, and run the opt-in contract test. Use when a Notion-touching change needs real API behaviour (request shapes, property types, pagination, trash/archive) beyond the E2E stub, or before merging a Notion-touching PR.
---

# Notion sandbox

The source of every command and the one-time setup is `docs/testing/notion-sandbox.md`. Use the stub
(`.claude/rules/e2e.md`) for UI, sync logic and error paths; this skill is for real API behaviour.

1. Reset your own database (a `--label` per worktree when agents work in parallel):
   `npm run notion:sandbox -- reset --label <label>` (scenarios: `--scenario board|empty|edge|many|archive-ready`).
2. Drive the app: with your dev server running (`PORT=<free port> npm run dev`), open
   `/tasks?seed=notion-sandbox&label=<label>`. The token never appears in a URL, command or transcript.
3. See what kan-do wrote: `npm run notion:sandbox -- inspect --label <label>`.
4. Before merging a Notion-touching PR: `npm run test:contract`, result in the PR (profile "Orchestration").
   Run both npm commands as plain commands (no `cd … &&` prefix) so the allow rules match.
5. Tear labelled databases down when done: `npm run notion:sandbox -- teardown --label <label>`.

Missing setup (no sandbox credentials): stop and tell the user; the one-time setup is theirs.
