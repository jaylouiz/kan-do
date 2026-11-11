---
name: Kan-Do
description: The focused today board: white sheets on a warm paper desk, for the work already chosen.
colors:
  primary: "oklch(0.47 0.092 152)"
  primary-deep: "oklch(0.41 0.082 152)"
  primary-wash: "oklch(0.94 0.032 152)"
  warning-orange: "#F96124"
  error-raspberry: "#D0395A"
  marker-yellow: "oklch(0.91 0.145 97)"
  paper: "oklch(0.953 0.013 86)"
  sheet: "#FFFFFF"
  sheet-fill: "oklch(0.966 0.009 86)"
  rule-line: "oklch(0.895 0.016 84)"
  graphite: "oklch(0.42 0.024 80)"
  ink-black: "oklch(0.19 0.012 70)"
  shadow: "rgb(70 48 20)"
typography:
  display:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "2.25rem"
    fontWeight: 500
    lineHeight: 1.15
  headline:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 500
    lineHeight: 1.15
  subhead:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.3
  title:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  sm: "8px"
  md: "12px"
  sheet: "16px"
  pill: "9999px"
---

# Design System: Kan-Do

This file states the direction, the foundations, the rules and the recurring patterns. A value or trade-off of one component lives in that component's doc block; what a test or lint rule guarantees is named once under "Guards" and not repeated as prose. Product truth is in `PRODUCT.md`, the wording rules in `docs/copy/voice.md`.

## Direction

**Paper Desk.** A warm paper desk with white sheets on it. Everything you read, enter or edit lies on a sheet; the desk itself stays empty and calm. Kan-Do is a working tool that is glanced at many times a day, so the columns, the cards and the one running task have to stand clearly apart, and nothing asks for attention it has not earned.

Airbnb is the positive reference (calm, generous layouts, friendly warmth, flows that happen in place, small polished motion). Trello (rainbow labels, gamified clutter), Notion (dense, technical) and Slack (a saturated block of brand colour as chrome, a dense sidebar, many interactive elements at once) are the anti-references.

- A warm neutral canvas, never a saturated one. Colour comes in small doses.
- White sheets lifted by one warm shadow, one level only: never a sheet on a sheet.
- One muted green for action and for done; orange for attention, red for what is destructive or failed.
- A serif for headings, the sans for everything read and operated.
- Questions are asked in place; reversible actions act at once and offer undo.
- Motion is small and physical and explains a state change.
- Light only (`colorMode: false`); a dark mode would be a new feature.

## Foundations

Token values live in `assets/css/main.css` and `app.config.ts`; these tables name the closed scales. A value outside a table is a defect or a recorded exception in a component's doc block.

### Colour

| Role | Token | Use |
|---|---|---|
| Paper | `--ui-page-bg`, `bg-page` | the canvas: page, board, behind every sheet |
| Sheet | `--ui-bg`, `--ui-bg-elevated` (white) | every lifted surface: card, page sheet, task sheet, dialog, menu, toast |
| Fill on a sheet | `--ui-bg-muted`, `--ui-bg-accented` | a light paper tone: selects, badges, the hover of a row |
| Fill on the canvas | `--fill-on-canvas` (the shadow colour at 7 %, 13 % on hover) | a step darker than whatever lies below: soft buttons, the tab track, the empty add slot |
| Rule line | `--ui-border` | hairlines inside a sheet |
| Ink, graphite | `--ui-text`, `--ui-text-muted` | near-black warm text; secondary text |
| Forest green | `primary` and `success` (ramp `custom-forest`, hue 152) | action and done: the solid button, links, selected options, the focus ring, the running timebox, the done check and washes |
| Warning orange | `warning`, `secondary` | attention: high priority, a timebox running out, a connection that needs a look |
| Raspberry | `error` | destructive and failed, nothing else |
| Marker yellow | `--marker` | the marker stroke (The Marker Rule) |
| Topic hues | `--topic-<hue>`, nine | a topic's mark only (The Topic Mark Rule) |

**The One Lamp Rule.** One solid green button per view. Marks, selected options, links and the focus ring are green without being a fill.

**The Status Is Not Decoration Rule.** Green means action or done, orange attention, red destructive or failed. None of them appears for emphasis, branding or variety; integration brand colours do not appear at all.

**The Topic Mark Rule.** A topic carries its hue and symbol on its mark only: a small dot or glyph before the name. Never a coloured chip, card, column or surface, never a hue on a name, and no topic hue in a chart (charts use the ink ramp).

**The Marker Rule.** A stroke of yellow text marker through the lower half of a word is an allowed decoration in slight, intentional use (owner, 2026-11-11). It is static, carries no meaning of its own and appears once per view at most. Today's only use: the Jetzt headline. A new use is a recorded decision.

**The Frozen Primary Rule.** The primary palette (forest green, hue 152, chosen by the owner on 2026-11-11) changes only by a decision recorded here, never as a side effect of a feature.

**The Receding Text Rule.** Waiting cards, done titles and placeholders step down through a token colour, never through `opacity` on text, and keep body contrast. The recorded exceptions live with their component and in the a11y test.

### Type

Fraunces 500 (tracking -0.02em) is the display face, Figtree the face for everything read and operated; both are bundled. Each role carries its line height in its size token, so no component writes a `leading-*` class.

| Role | Size | Line height | Face | Use |
|---|---|---|---|---|
| Hero | 48 px | 1.15 | Fraunces | the statistics verdict, the welcome headline |
| Display | 36 px | 1.15 | Fraunces | column names, page titles |
| Headline | 22 px | 1.15 | Fraunces | section headings on a sheet and in a dialog, the title of a task in its sheet |
| Subhead | 18 px | 1.3 | Fraunces | dialog titles, sub-headings, the wordmark |
| Title | 15 px (16 on a phone) | 1.3 | Figtree 400 | card titles |
| Body | 14 px (15 on a phone) | 1.55 | Figtree 400 | notes, descriptions, dialog and settings copy |
| Interface | 14 px (15 on a phone) | 1.3 | Figtree 400 to 500 | buttons, fields, rows, tabs, card meta |
| Label | 12 px | 1.3 | Figtree 500 | badges, chips, counts, property labels, hints |

**The One Role Rule.** The display face is for headings only. Numerals, labels, tab names, prompts and sentences stay in the sans, at 400 to 500 (600 for a key figure).

### Space, size and shape

| Scale | Values |
|---|---|
| Spacing | the 4 px grid; 2 and 6 px are the only half steps |
| Control height | 32 px regular (buttons, tabs, nav), 36 px for fields, selects, value rows, choice chips and the one main action of a surface; 44 px floor for every control on a phone (48 for the main action). Fields, value rows and chips take their height from the `--field-h` token (36 px, 44 px on a phone and on touch), explicit, never from the text line plus padding |
| Radius | 8 px (badges, small controls), 12 px (buttons, fields), 16 px (every sheet), pill, circle |
| Icon size | 12, 16, 20, 24 px (`lib/icons.ts`) |

Sheets share one shape: card, page sheet, task sheet, dialog and menu all take 16 px. No pill-shaped container, with one exception: the app bar's pills.

### Elevation

One shadow colour (`--shadow-color`, a warm brown) at four steps.

| Step | Token | On |
|---|---|---|
| Rest | `--shadow-task` | cards, page sheets (settings sections, statistics tiles), stacks |
| Raised | `--shadow-task-hover` | a card under the pointer |
| In hand | `--shadow-task-drag-elevated` | the dragged card |
| Overlay | `--shadow-overlay`, `--shadow-sheet` | dialogs, menus, popovers, toasts; the task sheet (cast toward the board) |

**The Sheets Cast Shadows Rule.** A shadow belongs to a sheet: a surface lifted off the canvas that holds content. A control never casts one; a selected tab or place is a fill. The one named exception is the app bar's nav pill (flat white, no glass).

### Motion

| Token | Value | For |
|---|---|---|
| `--duration-fast` | 150 ms | a control changing colour, a press, a card lifting |
| `--duration-base` | 200 ms | fades, washes, a card settling, neighbours making room |
| `--duration-slow` | 300 ms | a surface changing size or position |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | things that change in place |
| `--ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | things that arrive and settle |

Motion explains a state change, the way paper would move. It is short, never decorative or looping, never runs on page load, and `prefers-reduced-motion` makes it instant. A component with its own choreography (the app bar's indicator, the progress chip, the completion burst) records it in its doc block.

### States

One answer per state, on every control, whoever built it.

| State | Answer |
|---|---|
| Pressable | the hand cursor |
| Hover | the fill one step darker (a ghost control gains the fill); a text control darkens its text or rule |
| Press | the control gives 3 % (`scale: 0.97`) |
| Focus | Nuxt UI's halo: 3 px at 25 % of the role colour, no offset (`focus-ring`, `--focus-ring-*`); a field keeps its 1 px inner ring. Accepted trade-off (owner, 2026-11-11): below the 3:1 of WCAG 1.4.11 on the page |
| Disabled | 50 % opacity, `not-allowed`, no hover answer |
| Loading | the disabled look plus a spinner; the control is locked |
| Selected | a fill (chip, switch, checkbox, tab, place); never a shadow |
| Card | lifts 2 px on hover with the raised shadow, sets down on press |
| Drag | the card rises out of its resting pose (2 % larger, the 2 degree tilt, the in-hand shadow, 150 ms), neighbours make room in 200 ms, the drop glides 200 ms and the card is set down in 200 ms |

## Layout

- **Sheets on a desk.** Everything entered or edited sits on a white sheet; a page is a column of sheets on the canvas (settings sections, statistics tiles) and a heading names each sheet. Inside a sheet, type, space and hairlines group content. No card in a card.
- **Board (desktop):** three equal columns, Offen | Jetzt with Wartet below it | Erledigt, centred on wide screens. Cards are fixed-size sheets. The Jetzt slot is always one card tall, filled or empty.
- **Board (phone):** one column page per screen, moved by a swipe (`.claude/rules/mobile-board.md`).
- **Groups of cards** collapse into a stack; no lines, boxes or tints around a group.
- **Chrome:** one global app bar on every page. The board has no toolbar of its own, and there is no back arrow anywhere: the bar is the only way between pages.

## Components

Nuxt UI components first, themed in `app.config.ts`; a shared primitive in `components/ui/` from three call sites on; custom components for the board domain. One line per user job; how each looks, with every variant and state, is on `/ui`.

- **Trigger an action:** `UButton`. Solid green for the one main action of a surface (36 px). Soft for a neutral action that stands on its own and for the one main action of a row. Ghost for further actions inside a row, card, menu or toolbar and for every icon-only button. Link inside running text. Two heights, 32 and 36 px; no `outline`, `subtle`, `xs` or `xl`. Dialog footers: neutral cancel first, main action last.
- **Pick one of a few:** `ChoiceChip`, one chip shape at one height (36 px), with an icon alone where the options are symbols; `field` (dashed outline) for the cell that opens a search. Larger options with a description are the one choice card. A toggle that stays on beside others is the chip too.
- **Edit a value in a label/value row** (task sheet): a select with a chevron when the value opens a list, text on a dotted rule when it is free input. Both are 36 px high and share hover, focus and disabled. A value never wears a chip.
- **Type into a field:** `UInput`, `USelect`, `UTextarea` at 36 px. Inline editing is the default for task properties; an empty value shows a muted placeholder in place.
- **Show a list row:** `ListRow`, one density, the row tints on hover; trailing actions follow the button rule.
- **Show a status or count:** a neutral `UBadge` in the label role, one size; priority "Hoch" is the one tinted badge on a card. A topic is muted text with its mark, never a chip.
- **Head a section:** `SectionHeader` (headline) and `PageHeader` (display); no hand-written heading classes.
- **Hold content as a surface:** the sheet. `TaskCard` on the board; page sheets take its radius and resting shadow.
- **The task card:** topic first, the title below it, the footer with the timebox chip, source, carried-over dots and priority. The Jetzt card is a regular card: focus comes from the board stepping back, not from the card changing.
- **The task sheet:** details and the add form are one sheet (a side sheet on desktop, a bottom drawer on a phone), opened the same way from the board and from statistics.
- **Ask in a dialog:** `AppDialog` in three widths; `ResponsiveOverlay` when it becomes a drawer on a phone. For flows that need the whole stage; one overlay at a time.
- **Ask about one card:** on the card (`TaskTimeboxNudge`, the new-card flow): non-modal, self-dismissing, ignoring it loses nothing.
- **Tell the user something:** an undo toast after a reversible action or for news; `UAlert` subtle for a state inside a flow; the `UFormField` error for a field; one quiet line above the content for a state the user cannot fix now. A healthy sync is silent.
- **Show an empty place:** `EmptyState` for a page or tab whose main content is a list that fills with use, `EmptyNote` (one muted sentence) everywhere else; empty columns stay blank.
- **Switch a view in a page:** `UTabs`: a track on the canvas, the selected tab a white chip.
- **Move between places:** the app bar. The selected place is the route and nothing else; `aria-current="page"` sits on exactly one control, and an open Mehr panel never replaces it.
- **Charts:** hand-built SVG in the ink ramp only (`lib/inkRamp.ts`); no status colour, no topic hue.
- **Settings:** settings that maintain the user's own content or data are grouped apart from settings that change board behaviour (owner, 2026-11-06).

## Behaviour

- **Ask in place.** A question that belongs to a card or a row is asked there, not in a modal, sheet or toast.
- **Undo instead of confirm.** Deleting and completing act at once and offer undo; no "Are you sure?". An irreversible action confirms in place, never in a modal.
- **Optimistic moves.** Moves apply at once; sync runs in the background and surfaces only on failure.
- **No modal on modal.** A sub-flow replaces the dialog or happens inside it.
- **Quiet notices over interruptions.** System states and news are a notice, a toast or a popover, never a dialog that opens by itself.
- **Earned celebration.** Everyday actions confirm quietly; completing a task earns a short celebration around the card: once per completion, about a second, design-system colours, no sound, no praise text, never blocking. Recorded exception (owner, 2026-11-06): rewarding achievements supports motivation.
- **Keyboard.** Everything is keyboard-reachable, including board moves; `⌘K` opens the command palette. Announcements name the task and the column, never ids.
- **Accessibility.** WCAG 2.2 AA (text 4.5:1, non-text 3:1), with the recorded exceptions named in the a11y test.

## Guards

What a check already guarantees is not repeated above. `npm run verify` runs them.

| Guarantee | Guard |
|---|---|
| Semantic tokens only: no palette classes, hex, arbitrary values, stray z-index, duration or easing | ESLint, `tests/config/token-literals.test.ts`, `scripts/lint/design-tokens.mjs` |
| Button vocabulary: the two sizes, the allowed variants, the 44 px floor, a solid button is the 36 px one | `tests/config/button-ladder.test.ts` |
| Text and control contrast, the focus halo on the main button, the receding-text exceptions | `tests/e2e/a11y.spec.ts`, `tests/config/button-contrast.test.ts`, `role-contrast.test.ts`, `error-soft-contrast.test.ts` |
| Warning text steps and notices on `UAlert` | `tests/config/warning-notices.test.ts` |
| Topic hues keep 3:1 on the sheet | `tests/config/topic-tokens.test.ts` |
| No bare `UModal`, no hand-rolled tabs, no uppercase | `tests/config/design-patterns.test.ts` |
| Icons: mapped meanings, bundled collection only | `tests/config/icon-map.test.ts`, `icons-bundled.test.ts`, `nuxt-ui-icons.test.ts` |
| No new raw `<button>`, no visual identity in a call-site `ui` prop | `tests/config/ratchets.test.ts` |
| A Pattern line for every new or changed UI element | `tests/config/pattern-check.test.ts`, `.claude/rules/ui-patterns.md` |
| The rendered look: computed-style fingerprint of `/ui`, pixel baselines, Impeccable scan | `tests/e2e/` (`visual-regression`, `design-detect`, the `/ui` specs) |
| One term per concept, both languages, plurals | `docs/copy/terms.json`, `npm run i18n:check`, ESLint `no-raw-text` |

Stated above and not yet checked (step 6 adds a guard or the rule goes): the line heights come from the size tokens only; the icon size scale; one solid green button per view; `aria-current` on exactly one control; a control casts no shadow.

## App icon

A yellow Mac-style body with three white sheets (master: `docs/design/app-icon/kan-do-icon-final.svg`).
