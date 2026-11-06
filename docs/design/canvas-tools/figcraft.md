# FigCraft: operating guide

Version tested: figcraft-cli 0.11.2 (alpha, releases almost daily). Date: 2026-10-26. Licence: MIT and Apache-2.0, github.com/storytold/figcraft.

This is the chosen tool. The working loop and the current FigCraft adapter live in the global `/ui-canvas` skill (kan-do settings: `.claude/ui-canvas.md`). This page keeps the measured costs and the verified limits behind them.

## Setup and connect

- Start the live app: `$ARTCRAFT_HOME/bin/craft-live figcraft $ARTCRAFT_HOME/work/projects/kan-do/kan-do.figcraft` (`ARTCRAFT_HOME` = the ArtCraft checkout). It listens on control port 47800 (loopback, unauthenticated).
- MCP server `figcraft-live` in the repo `.mcp.json`: stdio, `figcraft-cli mcp --attach 47800`. No token or key involved. If its tools are missing the app is not running.
- The design file must live under `$ARTCRAFT_HOME/work` (the CLI sandbox root). Binary file, not in git. Always `save_file` after a round.
- Scripted: `scripts/fc.py` in the `ui-canvas` skill.
- Updating the CLI: agents cannot run a freshly downloaded binary (classifier), so Julius swaps it after the sha256 check.

## Cheapest reads (measured on 0.11.2)

| Need | Call | Reply |
|---|---|---|
| Julius's selection | `inspect_document {depth:0}` (no pure selection read exists) | 0.7-1.1 KB |
| Structure plus undo history naming his manual edits | `inspect_document {depth:1}` | 9.7 KB |
| Comments | `run_command {command:"comment.list", params:{filter}}` | 1.8 KB for 3 threads |
| One layer | `get_node` with small depth | about 1 KB |
| Visual check | `screenshot` with `maxSize` <= 800 | 45-60 KB (base64) |
| Exact sizes of a frame | `run_command inspect.code {id, language:"html"}` (`params`, not `args`) | 17.5 KB |

Expensive, avoid: `get_node` depth 4 on a frame (86 KB; roughly 1.7 KB per layer), `inspect_document` depth 2 / 3 (20 / 39 KB), `list_commands` (12-34 KB per filter, the filter also matches descriptions; there is no describe-one-command).

## "Check comments" recipe (skilled: 14-25 KB without screenshot)

1. `inspect_document {depth:0}`: selection, 1 KB.
2. `run_command comment.list {params:{filter:"open"}}`: 1.8 KB. Filters: all, open, resolved, mine, unread. `@Claude` is a plain text scan (no mention data).
3. `inspect_document {depth:1}`: 9.7 KB. The history names Julius's edits (Edit text, Paste, Move layer into, Add comment); read single layers with `get_node` only where a comment points. If the history alone answers it, the round is about 5 KB.
4. One `batch` with all edits (`{"$step": n}` for nodes created earlier in the batch): 0.3 KB.
5. One `batch` with `comment.reply {author:"Claude"}` per thread plus `comment.resolve`: 0.3 KB. Then `comment.markRead {author:"Claude"}`.
6. `save_file` (0.2 KB), one screenshot (about 59 KB), fix in one follow-up batch.

Measured actual (unskilled) was 17 calls / 251 KB: 36% a depth-4 read, 47% two screenshots, 16% command discovery. Mutations themselves were 0.6 KB.

## Build recipe that worked

Variables first (collection `kan-do`: 14 colour, 5 radius, 5 spacing, hex only), then components (`Button`, `Badge`, `TaskCard`), then both boards in one 90-step batch with auto layout and bound variables. Measured: 41 calls / 290 KB (216 KB screenshots) with exploration; skilled estimate 8-10 calls, 80-110 KB (reviewer's figure). Use `$step` refs instead of predicting ids. Ids: one per node; an instance takes 1 + its descendants.

## Code handoff

Hand-written Vue + Nuxt UI from a depth-1 read, `DESIGN.md` and `app.config.ts`. `inspect.code` is not usable as code. Details and the render check are in `README.md`.

## Limits and bugs (0.11.2)

| Item | Kind |
|---|---|
| `inspect.code` has no `tailwind` language (css, html, react, leptos, swiftui, compose); docs say otherwise. About 10% of the html was reusable; absolute widths; no min-height emitted | Tool limit (doc/build mismatch) |
| Batch `as` plus `{"$ref"}` is not implemented; `{"$step": n}` works | Tool limit (doc mismatch) |
| No compact tree read; `inspect_document` depth 1 is the smallest outline | Tool limit |
| Component `minHeight` does not reach existing instances; set it on each instance (desktop and mobile) | Tool behaviour, undocumented (review leaned real, not proven by a mutating test) |
| No instance inside an instance (a Badge inside a TaskCard instance was refused) | Tool limit |
| Pins are frame level; deeper-layer pin untested | Untested |
| Pasted instances keep fixed widths; set `sizingH` fill | Tool behaviour |
| Figtree not installed, text renders in a fallback; oklch rejected (hex only); no text styles; padding and shadow not bound | Tool/environment limit |
| `args` key to `run_command` is silently ignored (filter not applied, `inspect.code` falls back to the selection); the key is `params` | Usage trap (tool is lenient) |
| `node.delete` does not exist (`edit.delete`); `set_properties` is a tool, use `node.set` in a batch | Usage trap |
| Never change `pref.userName`: it is app-wide and renames Julius; pass `author:"Claude"` per call | Usage trap |
| `collab.share/host/publish` publish externally; only on request | Safety note |
| History keeps a redo entry after an undone test batch; harmless unless redo is pressed | Minor |

Wasted calls in the bake-off (about 20 of 41 build calls) were usage: failed ref batches, id probes with undo, the token batch run twice, a wrong command name.
