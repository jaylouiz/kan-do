# Penpot (self-hosted): operating guide

Version tested: Penpot 2.18.5 self-hosted (2026-10-26), bundled `penpot-mcp` container. Licence MPL-2.0. Everything goes through hand-written Plugin-API JS in `execute_code`. Not the pick: replies appear as Julius, whole-frame code export is huge, and it needs Docker and a connected browser tab.

## Setup and connect

- Runtime: colima (a fresh profile `penpot`, 4 CPU, 6 GiB, 30 GB) plus the Docker compose plugin (v5.6.1, sha256-verified) in `~/.docker/cli-plugins/`. The older default colima profile was dead (data disk full) and was left untouched. Creating the profile switched the global docker context to `colima-penpot`; revert with `docker context use colima`.
- Compose: the official 2.18.5 file in a local `penpot-selfhost/` folder, edited only to bind frontend (9001) and mailpit (8025) to 127.0.0.1 and to set a random secret key. 8 containers, about 1.8 GiB resident. Stop and start: `DOCKER_CONTEXT=colima-penpot docker compose down` / `up -d` in that directory; `colima stop -p penpot` frees the RAM.
- App at `http://127.0.0.1:9001`. The user's login lives in `credentials.txt` (mode 0600) in that directory; created with `manage.py create-profile` in the backend container (email verification is disabled, no SMTP needed).
- MCP: Account -> Integrations -> MCP Server: enable, create a key (shown once). Remote endpoint `http://localhost:9001/mcp/stream?userToken=<key>`. In an open file, Plugins -> connect to MCP (Chromium 142+: allow the local-network prompt, or use Firefox). The tab must stay awake; one tab and one page at a time. Store the key in a mode-0600 file (`mcp-key.txt` in the compose directory), never in a committed file or shell history. `tools/pp.py` reads it from there.
- Julius does the browser steps (login, key, plugin connect); agents cannot drive it (no Chrome for Playwright).

## Cheapest reads (measured)

| Need | Call (inside `execute_code`) | Reply |
|---|---|---|
| Selection | `penpot.selection` | 137-306 B |
| Comments | `penpot.currentPage.findCommentThreads()` plus `thread.findComments()` (not on `currentFile`) | 0.2-1.3 KB for 3 threads |
| Compact tree dump you write yourself | recursive name/type/size | 6.7 KB |
| Change baseline | `currentFile.findVersions` / `saveVersion` and `revn` (unused; 0 versions existed) | small |
| Screenshot | `Shape.export({type:'png', scale:0.5})` | 26-47 KB (base64) |

Tool `export_shape` takes `shapeId` and has no scale: full size, 70-94 KB. First call per session: the high-level overview, 30 KB of prose, read once.

## "Check comments" recipe (skilled estimate: 3-4 calls, about 8.5 KB without screenshot)

1. One `execute_code`: selection plus open threads with their comments (about 1.5 KB). Check `revn` or a saved version first to skip unchanged files.
2. One compact tree dump (about 6.7 KB), compared against the last build log.
3. One `execute_code`: apply edits, then `thread.reply(text)` and `thread.resolved = true` for each thread (0.3 KB). Replies show as Julius.
4. One screenshot at `scale: 0.5`.

Measured actual: 13 calls / 146 KB, 130 KB of it base64 screenshots.

## Build recipe that worked

Tokens (16 colour, 5 radius, 8 spacing, 6 font-size; hex only) plus three library components in one call, then both boards in one call (flex everywhere, 13 TaskCard instances), 35 tokens verified bound through `shape.tokens`. Measured 16 calls / 193 KB; skilled 9-10 calls, 100-120 KB (about 40 KB if PNGs use `scale`). Variants were not built.

## Code handoff

`penpot.generateMarkup(shapes, {type:'html', style:'css'})` plus `generateStyle(shapes)`: they take an array of shapes. Whole frame: 244 KB, about 5% usable, hashed class names. Per child it is cheaper (one leaf 247 B; the first child 35 KB). SVG of the whole frame 610 KB. Better: dump the tree and write Vue by hand.

## Limits and bugs

| Item | Kind |
|---|---|
| Replies are authored as the logged-in user (Julius); `reply()` has no author param, `Comment.user` is read-only. A separate Claude identity needs a second Penpot user with its own browser session | Tool limit |
| `appendChild` into a component instance throws; keep an optional child hidden in the main component and unhide it per instance | Tool limit |
| "/" in names is rewritten to " / " (board `today/mobile` reads `today / mobile`; component `Button/Primary` becomes path Button) | Tool behaviour, not reproduced for plain boards |
| `setParentIndex` silently does nothing; `insertChild(0)` works | Tool bug (not re-tested) |
| No diff API, one browser tab, one page, tab must stay open | Tool limit |
| Token values hex only; no `lineHeight` token type | Tool limit |
| Shadow, letterSpacing and typography token types exist but were not used | Usage gap (reported as a limit by mistake) |
| `findCommentThreads` is on `currentPage`, not `currentFile` | Usage trap |
| Whole-frame code export (244 KB) | Usage choice; export per child |
| Docker disk and context side effects (above) | Ops note |
