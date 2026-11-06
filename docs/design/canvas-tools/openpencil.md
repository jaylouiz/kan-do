# OpenPencil: operating guide

Version tested: app, CLI and MCP all 0.16.0 (2026-10-14). 0.x with breaking changes every release; the MCP package must match the app version. Licence MIT, local-first, no account. Date: 2026-10-26. Runner-up to FigCraft.

## Setup and connect

- Install user-level (non-admin Mac, no /Applications): DMG (aarch64, sha256 checked against SHA256SUMS) into `~/Applications/OpenPencil.app`; `@open-pencil/mcp@0.16.0` and `@open-pencil/cli@0.16.0` via npm with `--ignore-scripts` into `~/dev-workspace/sandbox/open-pencil/{mcp,cli}`. Never `npm i openpencil-mcp` (the bare name is a squatted placeholder by an unrelated account).
- Julius does the GUI steps: open the app, finish first launch, open or create a document, Settings -> MCP -> Local server on. Check with `openpencil documents list` (needs the app running with a document open).
- Auth is on by default. The stdio bridge `openpencil-mcp` finds the socket through a discovery file, `~/Library/Application Support/OpenPencil/mcp.json` (mode 0600, valid only while the app runs, field `authToken`), or reads `OPENPENCIL_MCP_AUTH_TOKEN`. Alternative: turn off Settings -> MCP -> Authentication. Never print the token.
- Register: `claude mcp add --scope user open-pencil -- <abs path to>/openpencil-mcp`. Scripted: `scripts/op.py` in the `ui-canvas` skill.
- Document: `.fig` binary (Figma-compatible), comments stored inside. Not diffable in git; use `openpencil tree` or `export -f jsx` for reviewable text. Do not commit the working `.fig`.

## Cheapest reads (measured)

| Need | Call | Reply |
|---|---|---|
| Selection | `get_selection` | 99 B |
| Comments (open threads) | `get_comments` (`includeResolved` for all) | 2.6 KB for 5 threads |
| Structure of a subtree | `get_page_tree {root_id, depth:3}` | 2.2-3.4 KB |
| One subtree as JSX | `get_jsx` on a child node | 1-3 KB |
| Screenshot | `export_image` (arg is `ids`; has a scale option) | about 70 KB |

Avoid: `get_page_tree` without `root_id`/`depth` (53 KB, whole document); `get_jsx` on a whole screen (truncates at 12,000 chars, about 13 KB, no paging; the `path` param writes the full file when `OPENPENCIL_MCP_ROOT` is set).

## "Check comments" recipe (skilled estimate: 15-25 calls, 12-20 KB plus one screenshot)

1. `get_selection` (0.1 KB), `get_comments` (0.9-2.6 KB).
2. `get_page_tree {root_id, depth:3}` (2-3 KB), then `get_jsx` on the 2-3 relevant subnodes (1-3 KB each). There is no change history and ids renumber across sessions, so edit detection is by content against the last known tree (the unskilled run misread a moved label as a new element).
3. Apply all style edits in one `batch_update` or one `eval` (Figma-style plugin JS, stdio only), not one call per property (the unskilled run spent 36 calls on 12 cards).
4. `reply_to_comment {author:"Claude"}` and `resolve_comment` (about 0.7 KB echo each; batching them through `eval` is untested).
5. `save_file`, one screenshot.

Measured actual: 75 calls / about 305 KB (+2 in the fix round): three screenshot rounds, a 53 KB page tree, one call per property. Almost all usage error.

## Build recipe that worked

`create_collection`, `create_variable` once per variable (24 calls in one `op.py` process is cheap), one `render` of the components sheet (Button set, Badge, TaskCard), one `render` per board from JSX (the best batching of the four tools). Measured 67 calls / 513 KB (90% images), of which the lineHeight trap cost 16 calls / 233 KB. Skilled estimate about 10 calls, 100-120 KB.

## Code handoff

CLI `openpencil export --node <id> -f tailwind-jsx` on the saved `.fig` (file mode only; no live JSX export): 16 KB, about 60% usable as skeleton, but it drops instance text and fill overrides. Prefer live `get_jsx` per top-level child, which is current. `get_codegen_prompt` takes no id; it returns Vue 3 + Tailwind guidelines. Rewrite to Nuxt UI by hand.

## Limits and bugs

| Item | Kind |
|---|---|
| Comments pinned by x/y only (`node: null`); the layer must be inferred | Tool limit |
| No mention data (none in core source); none of Julius's 5 comments said `@Claude`, so treat every open thread as for Claude | Tool limit |
| No edit-comment tool (add, reply, resolve only). A reply reopens a resolved thread: re-resolve after a correction reply | Tool limit |
| Julius's comment author is a random guest name ("Teal Badger"); agents set theirs via `author` (default "Agent") | Tool behaviour |
| CLI JSX export drops instance text and fill overrides | Tool bug (reproduced by the reviewer) |
| `set_fill` ignores alpha (`#00000000` renders opaque black); `eval` with paint opacity 0 or `fills = []` probably works, untested; the run used a paper-coloured fill | Tool limit, untried workaround |
| No bulk variable tool, hex only (no oklch), no shadow or typography binding | Tool limit |
| Instances cannot override text style (strike-through, size) | Tool limit |
| `get_jsx` renders a nested instance as a plain Frame and drops component properties | Tool limit |
| Unitless `lineHeight` means px, silently (1.15 gives overlapping text); write px values | Usage trap (docs give no unit) |
| `get_page_tree` does have `root_id`, `depth`, `node_types` | Usage trap (one run claimed otherwise) |
| `export_image` wants `ids`, not `id` or `nodeIds` | Usage trap |
| Re-rendering instead of editing in place renumbers ids | Usage choice |
