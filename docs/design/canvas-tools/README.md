# Canvas tools for kan-do mockups

Date: 2026-10-26. Findings of a bake-off of four design canvases, the decision, and operating guides that keep each tool cheap to drive.

## Purpose

A shared mockup canvas for Julius and Claude: Julius edits frames and leaves comments, Claude reads the selection and comments, applies the edits, replies and resolves, and hands a finished frame to Vue + Nuxt UI. Requirements tested: build a screen with components and bound tokens, see Julius's manual edits, read the selection, read, reply to and resolve comments (replying as Claude), find `@Claude`, pin to a layer, token-cheap rounds, code handoff, local, open licence.

## Decision

**FigCraft** (MIT and Apache-2.0, alpha, 0.11.2). It covers the whole comment loop (read, reply as `Claude` through a per-call `author`, resolve), sees Julius's manual edits through the undo history, has real components and bound variables, and was Julius's stated favourite. Nothing found disqualifies it. Its weak spot is cost: the skilled check-comments round is the highest of the four (14-25 KB).

**Runner-up and fallback: OpenPencil** (MIT, local). Replies as Claude and resolves, but pins are x/y only, no mention data, no comment editing. Paper is cheapest and best looking but cannot reply and has no components. Penpot (self-hosted) replies as Julius and needs Docker. No hybrid.

Private scorecard with the full matrix (visible to Julius only): https://claude.ai/artifact/BAasXoW6GSVjKychGydtik

## Requirement matrix (condensed)

Legend: ✅ meets, ◐ partly, ❌ misses. M = measured in one run, E = reviewer's skilled estimate. Usage mistakes found in review are not held against a tool; real tool limits are. Each tool built one screen once, so costs are single runs.

| Requirement | FigCraft | OpenPencil | Paper | Penpot (self-hosted) |
|---|---|---|---|---|
| Build a screen (M) | ✅ components, 24 variables bound, no nested instance | ✅ component set, 24 variables, instances can't restyle text | ◐ best looking, 29 tokens via `var()`, no components | ✅ components, 35 tokens bound, no children in instances |
| See Julius's edits (M) | ✅ undo history names each edit | ◐ content diff, ids renumber | ◐ tree and size diff | ◐ no diff API (versions unused) |
| Selection (M) | ✅ `inspect_document` depth 0, 0.7-1.1 KB | ✅ `get_selection`, 99 B | ✅ `get_selection` (needs `fileId`) | ✅ `penpot.selection`, 137-306 B |
| Read comments (M) | ✅ 1.8 KB for 3 | ✅ 2.6 KB for 5 | ✅ about 3.5 KB for 4 | ✅ 1.3 KB for 3 |
| Reply as Claude (M) | ✅ `author` param | ✅ `author` arg, reply reopens a resolved thread | ❌ no reply tool | ◐ replies show as Julius |
| Resolve (M) | ✅ batched with replies, 0.3 KB | ✅ | ✅ | ✅ |
| `@Claude` (M) | ✅ text scan | ◐ no mention data, treat every open thread as Claude's | ✅ text scan | ✅ text scan |
| Pin to layer (M) | ◐ frame level, deeper untested | ❌ x/y only | ✅ `nodeId` (Julius pinned to root) | ◐ board/page level |
| Build, actual (M) | ◐ 41 calls / 290 KB | ❌ 67 calls / 513 KB (lineHeight trap) | ✅ 18 calls / 35 KB | ✅ 16 calls / 193 KB |
| Build, skilled (E) | ✅ 8-10 calls, 80-110 KB | ◐ about 10 calls, 100-120 KB | ✅ about 35 KB | ✅ 9-10 calls, 100-120 KB |
| Check-comments round, actual (M) | ❌ 17 calls / 251 KB | ❌ 75 calls / 309 KB | ✅ 16 calls / 21 KB | ◐ 13 calls / 146 KB |
| Check-comments round, skilled (E) | ✅ 14-25 KB (about 5 if history suffices) | ◐ 12-20 KB plus screenshot | ✅ about 11 KB | ✅ about 8.5 KB |
| Code export (M) | ❌ html 17.5 KB, about 10% reused, no Tailwind | ◐ CLI Tailwind JSX 16 KB, about 60%, drops overrides | ✅ `get_jsx` Tailwind 14 KB, about 60% | ❌ 244 KB, about 5% |
| Licence, local | ✅ MIT + Apache-2.0, local file | ✅ MIT, local `.fig`, no account | ◐ closed app, free plan, terms not researched | ✅ MPL-2.0, Docker VM, 8 containers, about 1.8 GiB RAM |
| Maturity | ◐ alpha, doc/build mismatches | ◐ 0.16, breaking changes each release | ◐ not assessed | ✅ app 2.18.5, young MCP side |

Caveats: Julius's live selection was empty in every run, so selection was verified mechanically only. Fidelity gaps (dock, tab bar, timer ring) were parked and not scored. Paper's cost, licence and cadence were not researched.

## Top FigCraft gaps and workarounds

1. **Code handoff is a rewrite, not an export.** `inspect.code` has no Tailwind (css, html, react, leptos, swiftui, compose) and about 10% of the html was reusable. Build the Vue by hand from a depth-1 read, `DESIGN.md`, `app.config.ts` and `TaskCard.vue`; use `inspect.code` html only for exact sizes.
2. **No compact tree read.** A depth-4 `get_node` is 86 KB, `list_commands` filters 12-34 KB. Use `inspect_document` depth 1 (9.7 KB; the history names Julius's edits), `get_node` on single layers, and the cheat sheet in `figcraft.md`.
3. **Doc and build mismatches plus alpha churn.** `as`/`$ref` not implemented (`$step` works), `args` silently ignored (use `params`), instance `minHeight` set per instance, no nested instances. Re-check `releases/latest` before relying on a documented feature.

## Vue handoff

Hand-written for every tool; none of the exports is usable as is. The FigCraft `Today.vue` (UCard `variant="task"`, UBadge `soft`, `bg-page`) was render-checked in the real app with a temporary preview page: it renders with gaps, no console errors, `nuxt typecheck` passes. Differences from the frame: flatter cards without visible shadow, extra bottom padding, a rounder current-card radius, the app display font, full-width content. Lint gives 7 errors, all `@intlify/vue-i18n/no-raw-text` (hard-coded German, so a production port needs i18n keys), plus warnings for pixel-value Tailwind classes and attribute order. Follow the repo's UI rules (`CLAUDE.md`, semantic tokens, i18n) when implementing for real.

## Revisit the decision when

- FigCraft adds a Tailwind export, a compact tree read, or fixes `as`/`$ref` and per-instance `minHeight`, or its alpha churn breaks the loop.
- OpenPencil adds layer pins or mention data, edit-comment, or the CLI export stops dropping overrides (it is then the stronger open-source option).
- Penpot gets a way to author replies as a second identity, or Paper adds a reply tool and components.
- A real Julius selection and a deeper-layer pin are tested live (never verified against his selection).

## Contents

- `figcraft.md`, `openpencil.md`, `penpot.md`, `paper.md`: operating guides (setup, cheapest reads, check-comments recipe, build recipe, handoff, verified limits, version tested).
- `tools/`: the Penpot MCP client from the bake-off (`tools/README.md`); the FigCraft and OpenPencil clients moved to the `ui-canvas` skill (`scripts/fc.py`, `scripts/op.py`).
- The working loop is the global `/ui-canvas` skill (`~/dev-workspace/ui-canvas`): one adapter per tool, kept current with each release. kan-do's settings for it: `.claude/ui-canvas.md`. These pages are the decision record of 2026-10-26 and are not updated.
