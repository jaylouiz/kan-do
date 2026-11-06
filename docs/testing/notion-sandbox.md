# Notion without manual steps (agents)

Notion work never needs the user to click in Notion. Pick the lightest layer that answers the question:

| Layer | Use for | Needs |
|---|---|---|
| Stub (`E2E_NOTION_STUB=1`, `notion_test_stub[:<session>]` token) | UI, sync logic, E2E specs, error paths | nothing |
| Sandbox (`npm run notion:sandbox`) | real API behaviour: request shapes, property types, pagination, trash/archive | one-time setup below |
| Contract test (`npm run test:contract`) | the unmocked proxy routes against real Notion before merging a Notion-touching change | sandbox |

## Stub

Server-side, in `server/utils/notionStub.ts`. Writes (create, update) are kept in memory per token and show up in later reads. Details in `.claude/rules/e2e.md` ("Notion stub").

**Error paths:** a stub token with `fail=<status>` (e.g. `notion_test_stub:fail=401:<session>`) makes every `/api/notion/*` route fail as if Notion had answered that status, through the same `handleNotionError` mapping (401 → `UNAUTHORIZED`, 429 → `RATE_LIMITED`; 400, 403, 404 and 409 keep their status with `NOTION_API_ERROR`; others → 502 `NOTION_API_ERROR`). Seed it with `seedNotionBoard(context, tasks, { token: 'notion_test_stub:fail=401:x' })`. `create-fail=<status>` (e.g. `notion_test_stub:create-fail=400:<session>`) fails only `create-task`, so the board loads and syncs while a create is refused (#321).

**Paging:** a stub token with `pages=<n>` (e.g. `notion_test_stub:pages=130:<session>`, cap 2000) pads the session with synthetic Today tasks `stub-filler-001…` up to n pages in total; `query-data-source` honours `page_size` (max 100) and `start_cursor` and reports `has_more` / `next_cursor` (`stub-cursor:<offset>`, opaque). The `filter` is otherwise ignored.

**Native Status (#312):** a stub token with `status=native` (e.g. `notion_test_stub:status=native:<session>`) behaves like a database whose `Status` property is Notion's native Status type: the data-source schema (`database-schema-status` fixture) and the pages carry `status`, and a `Status` filter condition or write with the wrong key (`select` for a native token, `status` for any other) fails with a 400 `validation_error`, which the routes pass through as 400 `NOTION_API_ERROR`. Other properties are not checked. Seed it with `seedNotionBoard(context, tasks, { token: 'notion_test_stub:status=native:x' })`.

## Sandbox

An internal integration that sees only one parent page in a throwaway workspace. The script builds databases there (title `kan-do sandbox · <label>`), seeds them and inspects what kan-do wrote. The schema and the matching `NotionConfig` live in `server/utils/notionSandbox.ts`. Status is a `select` by default; `--status-type status` builds a native Status property instead. `NotionIntegration` detects the type from the data-source schema, so both sync (the contract test runs both).

```bash
npm run notion:sandbox -- reset                     # trash + rebuild "default", seed scenario "board"
npm run notion:sandbox -- reset --scenario many     # board | empty | edge | many (>100 tasks) | archive-ready
npm run notion:sandbox -- reset --label pr-123      # separate database, e.g. per worktree / parallel agent
npm run notion:sandbox -- seed edge                 # add a scenario to the existing database
npm run notion:sandbox -- inspect                   # compact JSON of every page: what did kan-do write?
npm run notion:sandbox -- record                    # raw API responses -> tests/fixtures/notion/recorded/
npm run notion:sandbox -- teardown [--all]
```

**Drive the app against it:** with `npm run dev` running, open `/tasks?seed=notion-sandbox` (or `&label=<label>`). The dev-only route `/api/dev/notion-sandbox-config` hands the config with the token to the page, so the token never appears in a URL, command or transcript. The route returns 404 outside `nuxt dev`.

Use a `--label` per worktree when agents work in parallel; `reset` only touches its own label. Tear labelled databases down when done.

### One-time setup (user)

1. https://www.notion.so/profile/integrations → **New integration**: name `kan-do dev sandbox`, type **Internal**, ideally in a separate free workspace. Capabilities: read, update and insert content; no user information.
2. Create an empty page `kan-do sandbox`, then **•••** → **Connections** → add `kan-do dev sandbox`.
3. Write the secret and the page id (the 32 hex characters at the end of the page link) outside the repo:
   ```bash
   mkdir -p ~/.config/kan-do && chmod 700 ~/.config/kan-do
   printf 'NOTION_SANDBOX_KEY=%s\nNOTION_SANDBOX_PAGE_ID=%s\n' 'ntn_…' '<page id>' > ~/.config/kan-do/notion-sandbox.env
   chmod 600 ~/.config/kan-do/notion-sandbox.env
   ```
   `NOTION_SANDBOX_KEY` / `NOTION_SANDBOX_PAGE_ID` in the environment win over the file; `NOTION_SANDBOX_ENV` points at another file.
4. Allow agents to run the script without prompts (user decision, agents may not edit their own permissions): add `"Bash(npm run notion:sandbox *)"` and `"Bash(npm run test:contract*)"` to `permissions.allow` in `.claude/settings.json`.

### Limits

The API cannot create integrations, share pages with them, or edit views. A "page not shared" (404) case therefore uses the stub (`fail=404`), not the sandbox.
