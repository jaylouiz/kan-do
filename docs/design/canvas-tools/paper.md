# Paper: operating guide

Version tested: Paper desktop app via the `paper-desktop@paper` plugin (`mcp__paper__*` tools), 2026-10-26. The app version was not recorded. Closed commercial app, free plan; no quota was hit. Plan terms, licence, offline behaviour and release cadence were not researched.

## Setup and connect

- The plugin `paper-desktop@paper` (marketplace `paper-design/agent-plugins`) is enabled in user settings; no key or token is involved. Paper.app must be running with a file open: without one, `get_basic_info` and font calls fail. Create one with `create_file` plus `open_file` (we named it `kan-do`), then omit `fileId` to target the file the user is viewing.
- First calls per session: `get_guide {topic:"paper-mcp-instructions"}` (about 9-14 KB, required by the tool), `get_font_family_info` before typography, `finish_working_on_nodes` when done. Tool schemas add about 30 KB.
- No scripted client; the tools were used directly.

## Cheapest reads (measured, approximate)

| Need | Call | Reply |
|---|---|---|
| Selection | `get_selection` (needs `fileId` if another file tab is active) | 0.3 KB |
| Comments | `list_comment_threads` (nodeId, status, text) | about 3.5 KB for 4 threads |
| Did Julius do anything? | `list_comment_threads` plus `list_resources` (`updatedAt`) | about 4.5 KB |
| Structure | `get_tree_summary` depth 2 about 1.5 KB; depth 5 6.5 KB | |
| Styles / one card | `get_computed_styles`, `get_jsx` | 1-3 KB |
| Screenshot | `get_screenshot` | cheap, good quality |

## "Check comments" recipe (skilled estimate: about 11 KB, about 5 KB read only)

1. `get_selection` (0.3 KB), `list_comment_threads` (about 3.5 KB).
2. `get_tree_summary` depth 2 (about 1.5 KB), no depth-5 dump or `find_nodes` probing.
3. Edits: `update_styles` accepts several node ids in one call; `duplicate_nodes` makes a variant in one call and returns a descendant id map; `move_nodes`, `rename_nodes`, `set_text_content` (about 4.5 KB total).
4. `set_comment_thread_status` per thread (about 0.25 KB each). There is no reply tool; answer in chat.
5. One screenshot, then `finish_working_on_nodes`.

Measured actual: 16 calls / about 21 KB (guide excluded), one screenshot.

## Build recipe that worked

`create_tokens` once for all 29 tokens (oklch accepted; namespaces must be Tailwind-v4 style, `--color-*`, `--radius-*`; replies a hash, so binding is only verified visually), `create_artboard`, then one `write_html` for the whole board (HTML styles bind with `var(--token)`), `x-paper-clone` for repeated cards. Reply size scales with the HTML (it lists every created node: 11 KB desktop, 7 KB mobile); the guide pushes small writes, which costs calls instead. About 18 calls / 35 KB; no avoidable calls found. Best-looking board of the four.

## Code handoff

`get_jsx` with the tailwind option, frame level, `includeNodeIds:false`: 14 KB, about 60% usable as layout skeleton (sizes, flex, spacing, radius, token colour names); it repeats font-family and arbitrary values per node. Map to Nuxt UI components by hand. A Paper-side token name that kan-do lacks (for example `--color-paper`, `--color-graphite`) renders unstyled, so map to kan-do tokens.

## Limits and bugs

| Item | Kind |
|---|---|
| No reply tool in the whole tool list (only list, get and set status); the agent answers only in chat | Tool limit |
| No components or instances or variants; reuse is `x-paper-clone` or `duplicate_nodes` (unlinked copies) | Tool limit |
| Comments carry a `nodeId`, but Julius pinned to the Board root (one to Tab Bar), so targets stayed ambiguous | User-side ambiguity, tool supports node pins |
| `@Claude` is a plain text scan | Tool behaviour |
| No shadow token type (shadows literal); font-size tokens defined but not bound (literal px used) | Tool limit / usage gap |
| A file must be open before any tool works; `get_selection` needs `fileId` with several tabs | Tool behaviour |
| No change history; edits detected by tree and size diff against the last build (medium confidence) | Tool limit |
