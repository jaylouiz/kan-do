---
name: Kan-do
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
  figure-lg:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.15
  figure:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.15
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

# Design System: Kan-do

This file states the direction, the foundations, the rules and the recurring patterns. A value or trade-off of one component lives in that component's doc block; what a test or lint rule guarantees is named once under "Guards" and not repeated as prose. Product truth is in `PRODUCT.md`, the wording rules in `docs/copy/voice.md`.

## Direction

**Paper Desk.** A warm paper desk with white sheets on it. Everything you enter, edit or operate, and the hard data, lies on a sheet; a page's intro and a side note lie flat on the desk, which otherwise stays empty and calm. Kan-do is a working tool that is glanced at many times a day, so the columns, the cards and the one running task have to stand clearly apart, and nothing asks for attention it has not earned.

Airbnb is the positive reference (calm, generous layouts, friendly warmth, flows that happen in place, small polished motion). Trello (rainbow labels, gamified clutter), Notion (dense, technical) and Slack (a saturated block of brand colour as chrome, a dense sidebar, many interactive elements at once) are the anti-references.

- A warm neutral canvas, never a saturated one. Colour comes in small doses.
- White sheets lifted by one warm shadow, one level only: never a sheet on a sheet. A task card's shadow sits tighter than a page sheet's ("Elevation").
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
| Fill on the canvas | `--fill-on-canvas` (the shadow colour at 7 %, 13 % on hover) | a step darker than whatever lies below: soft buttons, the tab track, the Offen header's add button |
| Wash of the primary | `--primary-wash` (the primary at 10 %), `--primary-wash-hover` (18 %) | the answer chip and the focus pill that reads as its state, with primary text |
| Rule line | `--ui-border` | hairlines inside a sheet |
| Ink, graphite | `--ui-text`, `--ui-text-muted` | near-black warm text; secondary text |
| Forest green | `primary` and `success` (ramp `custom-forest`, hue 152) | action and done: the solid button, links, selected options, the focus ring, the running timebox, the done check and washes |
| Warning orange | `warning`, `secondary` | attention: high priority, a timebox running out, a connection that needs a look |
| Raspberry | `error` | destructive and failed, nothing else |
| Marker yellow | `--marker` | the marker stroke; thinned into the sheet's white, the paper of intro notes (The Marker Rule) |
| Topic hues | `--topic-<hue>`, nine | a topic's mark only (The Topic Mark Rule) |

**The One Lamp Rule.** One solid green button per view. A selected option (a chip, a switch, a checkbox, the funnel while a topic focus is on) may be a green fill and does not count; marks, links and the focus ring are green without being a fill. The action of a toast is soft, so a toast never adds a second lamp (user, 2026-11-20, #606).

**The Status Is Not Decoration Rule.** Green means action or done, orange attention, red destructive or failed. None of them appears for emphasis, branding or variety (the completion burst is the one recorded exception, see "Earned celebration"); integration brand colours do not appear at all. The confirming button of a destructive dialog ("Trennen") is soft red, also when nothing is lost, like every other destructive confirm (user, 2026-11-20, #606).

**The Topic Mark Rule.** A topic carries its hue and symbol on its mark only: a small dot or glyph before the name. Never a coloured chip, card, column or surface, never a hue on a name, and no topic hue in a chart (charts use the ink ramp).

**The Marker Rule.** A stroke of yellow text marker centred on the bottom edge of a word (through the foot of its letters) is an allowed decoration in slight, intentional use (owner, 2026-11-11). It is static, carries no meaning of its own and appears once per view at most: one marker per view, on the headline of its focus column. Uses: the "Jetzt" headline on "Heute" and the "Für heute" headline (Offen) on "Alle", which fades when the user moves to "Heute" (user, #469). A second use of the hue, not of the stroke (user, #853, 2026-11-25): the paper of intro notes (the welcome, its tour, the step hints, the planning note) is the marker yellow thinned into the sheet's white, so a note reads as a note on the desk and never as a task card or a page sheet; values in `IntroNote`'s doc block. A new use is a recorded decision.

**The Frozen Primary Rule.** The primary palette (forest green, hue 152, chosen by the owner on 2026-11-11) changes only by a decision recorded here, never as a side effect of a feature.

**The Receding Text Rule.** Waiting cards, done titles and placeholders step down through a token colour, never through `opacity` on text, and keep body contrast. The recorded exceptions live with their component and in the a11y test.

**The Bright Ground Rule.** Text that is read (a brand, a headline, a summary) may lie directly on a photo only where the picture behind it is bright and even enough for WCAG AA (4.5:1, 3:1 for large text). The photo is positioned per breakpoint to guarantee that (the welcome photo is anchored to its bright wall on a phone, so the strip above the sheet shows no table, plant or book), and the contrast is checked on the rendered page at 1280 and 390 px, not assumed from the file. Flat text on the plain canvas follows "Flat intro, lifted work" (Layout); on a photo this rule decides, and a photo that cannot guarantee a bright ground behind the text gets a sheet (rule candidate #472, owner, 2026-11-18).

### Type

Fraunces 500 (tracking -0.02em) is the display face, Figtree the face for everything read and operated; both are bundled. Each role carries its line height in its size token, so no component writes a `leading-*` class.

| Role | Size | Line height | Face | Use |
|---|---|---|---|---|
| Hero | 48 px | 1.15 | Fraunces | the statistics verdict, the welcome headline |
| Display | 36 px | 1.15 | Fraunces | column names, page titles |
| Headline | 22 px | 1.15 | Fraunces | section headings on a sheet and in a dialog, the title of a task in its sheet |
| Key figure | 36 px, 24 px | 1.15 | Figtree 600, tabular figures | the figure that is the content of its place: 36 px for the one figure of a stage or a large ring (the statistics verdict, a donut opened at 170 px), 24 px for a count in a row or tile and the figure of a small ring (the day-close Timebox, the 120 px rings of the statistics tiles: 24 px "160:00" is 82 px wide in the 92 px clear centre) |
| Subhead | 18 px | 1.3 | Fraunces | dialog titles, sub-headings, the wordmark |
| Title | 15 px (16 on a phone) | 1.3 | Figtree 400 | card titles |
| Body | 14 px (15 on a phone) | 1.55 | Figtree 400 | notes, descriptions, dialog and settings copy |
| Interface | 14 px (15 on a phone) | 1.3 | Figtree 400 to 500 | buttons, fields, rows, tabs, card meta |
| Label | 12 px | 1.3 | Figtree 500 | badges, chips, counts, property labels, hints, group headings (a field group, a list or a section inside a dialog, `SectionHeader size="label"`) |

**The One Role Rule.** The display face is for headings only. Numerals, labels, tab names, prompts and sentences stay in the sans, at 400 to 500 (600 for a key figure).

### Space, size and shape

| Scale | Values |
|---|---|
| Spacing | the 4 px grid; 2 and 6 px are the only half steps |
| Control height | 36 px for buttons (one height, see The One Height Rule), fields, selects, value rows and choice chips; 32 px for tabs and nav; 44 px floor for every control on a phone (48 for a labelled button), the rows of dropdown, select, context and command-palette menus included (32, 36, 40 and 36 px from `md` up; the palette has no tap entry on a phone, its floor applies when Cmd/Ctrl+K opens it in a window narrower than `md` and covers a later phone entry). Fields, value rows and chips take their height from the `--field-h` token (36 px, 44 px on a phone), explicit, never from the text line plus padding |
| Radius | 8 px (badges, small controls), 12 px (buttons, fields), 16 px (every sheet), pill, circle; 32 px for the task sheet alone (a recorded exception, below) |
| Icon size | 12, 16, 20, 24 px (`lib/icons.ts`) |

**Icon exception.** Icons are Phosphor (`ph:`) everywhere except `NowGlyph`, the inline SVG set of the floating Now window (owner, 2026-11-22, #587; #565 D3b): the window must look like a native macOS element (SF Symbols style) and Phosphor has no matching glyph, and inline SVG needs no icon collection in the desktop CSP. It is the only exception; a new icon need goes to Phosphor.

**The One Height Rule.** Every button has the height of the main one: 36 px, 48 px on a phone, so buttons side by side line up and are as easy to hit as the main one (owner, 2026-11-17, #424). The main button differs by colour only, and a solid green or error button is at least 96 px wide. A button is smaller only where the space is narrow, and each such button is listed with its reason in `tests/config/button-ladder.test.ts`: the alert and toast action (24 px, #377), a link inside running text, and the round icon-only buttons of the board's chrome (32 px on desktop, 44 px on a phone: the Offen header's add button, the plan arrows, centred on a card's edge in the soft primary look drawn by their own rule (#467, D2), the stack header's close button) and the card-corner menu button (a 28 px circle with a 44 px hit area), whose geometry is tied to the 32 px title line and the card corner.

**The Phone Hit Area.** The 44 px floor is measured on what a finger meets, not on the drawn box: a control may be smaller if an invisible hit area brings the tappable box to 44 × 44 (a round button or a swatch: a `::after` pseudo-element; a switch: the theme's `after:-inset-x-2 after:-inset-y-4`, placed from inside the track's 2 px border, so 6 px past the track to the sides, never into the field beside it; a container that clips its overflow leaves room for it, #822). A checkbox or a switch row is one target: the checkbox's box takes the whole row (the theme's `checkbox` slots), the row is 44 px high. A link inside a sentence is exempt (WCAG 2.5.8) and is listed with that reason in the guard; a link on a line of its own is a 44 px row (`ExternalLink standalone`). The guard walks the seeded screens at 390 px and probes each control's hit box (`tests/e2e/phone-hit-areas.spec.ts`, #592); its exception list names each exception and its reason.

Sheets share one shape: card, page sheet, dialog and menu take 16 px. The task sheet's 32 px corners are the one recorded exception of the radius scale: the sheet grows out of its card and folds back into it, and its opening motion ends in that radius (`TaskMorphShell`, #468; user, 2026-11-20, #606). No pill-shaped container, with these exceptions: the app bar's pills, the in-card question language (the note and number fields of the in-card add flow and the segmented choice's track, #72, #434) and the phone focus bar (user, 2026-11-20, #606).

### Elevation

One shadow colour (`--shadow-color`, a warm brown) at four steps.

| Step | Token | On |
|---|---|---|
| Card | `--shadow-card` | task cards and stacks: a hairline ring and a short drop, so the cards lie close to the board (#878) |
| Sheet | `--shadow-task` | page sheets (settings sections, statistics tiles, recap, welcome) |
| In hand | `--shadow-task-drag-elevated` | the dragged card |
| Overlay | `--shadow-overlay`, `--shadow-sheet` | dialogs, menus, popovers, toasts; the task sheet (cast toward the board) |

**The Sheets Cast Shadows Rule.** A shadow belongs to a sheet: a surface lifted off the canvas that holds content. A control never casts one; a selected tab or place is a fill. The one named exception is the app bar's nav pill (flat white, no glass).

### Motion

| Token | Value | For |
|---|---|---|
| `--duration-fast` | 150 ms | a control or a card changing colour, a press |
| `--duration-base` | 200 ms | fades, washes, a card settling, neighbours making room |
| `--duration-slow` | 300 ms | a surface changing size or position |
| `--duration-place` | 400 ms | a place change: the board and the app bar's indicator moving between places |
| `--duration-curtain` | 700 ms | a key moment's curtain lifting or closing |
| `--duration-stage` | 1300 ms | a key moment's stage arriving or leaving, and the place change inside it |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | things that change in place |
| `--ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | things that arrive and settle |

A place change is one answer (#601, user, 2026-11-20): every change between two places fades in `--duration-base` with the leaving page out of the flow, so the entering page is at its final place from the first frame; only Heute and Alle slide (`--duration-place`, the board moves, no page swaps), and the key moments keep their stage. Overlays run on the same tokens, themed in `app.config.ts`: a menu, popover, select list or tooltip `--duration-fast`, a dialog, the command palette and the side sheet `--duration-base`, the phone drawer `--duration-slow`; panels that scale a few pixels use `--ease-standard` both ways, the scrim, the side sheet and the drawer arrive on `--ease-emphasized`. Motion explains a state change, the way paper would move. A mechanical change is short; motion is never decorative or looping, and `prefers-reduced-motion` makes it instant. On page load nothing moves except a key moment that opens the session (the new-day recap, the welcome photo). A component with its own choreography (the app bar's indicator, the progress chip, the completion burst) records it in its doc block. Reduced motion is one global rule (`assets/css/main.css`, last layer) that zeroes every transition and animation; the exceptions are progress indicators, not movement: the spinner, the delete gap's drain line and the nudge's countdown (`data-motion-progress`), and the focus overlay's 150 ms fade (a `!important` of its own, `board-focus-overlay.css`). Scripted animations (`element.animate`) read `lib/motionTokens.ts`, the script mirror of this table, and check the media query themselves.

**The One Piece Rule.** A view arrives as one piece: incoming content does not rearrange after it is visible, a surface changes size only as a guided motion, and hover never moves a neighbour (user, ten corrections, among them #43, #225, #294).

**The Key Moment Rule.** Deliberate exception (user, 2026-11-19): a once-a-day key moment (welcome to board, recap, planning to "Heute", day close) is a full-size stage and moves slower than a mechanical change, because it is "a one-time-per-day key transition helping to tell the story" (#433); the key moments share the curtain and take `--duration-curtain` and `--duration-stage`. Challenge was: conflicts: Material's longest duration is 1000 ms, and motion here is otherwise short.

### States

One answer per state, on every control, whoever built it.

| State | Answer |
|---|---|
| Pressable | the hand cursor |
| Hover | the fill one step darker (a ghost control gains the fill); a text control darkens its text or rule |
| Press | the control gives 3 % (`scale: 0.97`); a field holds still, a select's trigger included |
| Focus | Nuxt UI's halo: 3 px at 25 % of the role colour, no offset (`focus-ring`, `--focus-ring-*`); a field keeps its 1 px inner ring. Accepted trade-off (owner, 2026-11-11): below the 3:1 of WCAG 1.4.11 on the page |
| Disabled | 50 % opacity, `not-allowed`, no hover answer. A group of disabled parts (the segments of `SegmentedChoice`) dims once, as a group, never 50 % of 50 % |
| Loading | the disabled look plus a spinner; the control is locked |
| Selected | a fill (chip, switch, checkbox, tab, place); never a shadow. A ticked checkbox is the primary fill, set once in `app.config.ts`: no call site sets a colour |
| Card | its sheet one step darker (`--task-card-hover-bg`) on hover and while pressed, on touch too; it never moves and its shadow stays (owner, 2026-11-12) |
| Drag | the card rises out of its resting pose (2 % larger, the 2 degree tilt, the in-hand shadow, 150 ms), neighbours make room in 200 ms, the drop glides 200 ms and the card is set down in 200 ms |

## Layout

- **Sheets on a desk.** Everything entered or edited sits on a white sheet; a page is a column of sheets on the canvas (settings sections, statistics tiles) and a heading names each sheet. One concern is one sheet: its parts are separated inside the sheet by a hairline and a lower-level heading, never by a second sheet (owner, 2026-11-15, #333). Inside a sheet, type, space and hairlines group content. No card in a card.
- **Flat intro, lifted work.** A sheet holds what is operated and the hard data; a page's intro (headline, lead sentence) and a side note lie flat on the canvas (user, #238, #217, #428, #437).
- **Shared edges.** What belongs together shares an edge: a heading, a button or a note takes the content edge of the block it belongs to (its centre line where the block is centred) (user, among them #437, #297, #293, #565).
- **Nothing pressed to an edge.** A control inside a strip keeps the strip's padding on every side (user, #293, #573).
- **One scroll per page.** No scroll area inside a page that scrolls, except a list inside a sheet; a sheet grows with its content (user, #575, #44). The task sheet is the recorded exception: one fixed, card-shaped frame whose open tab scrolls inside, because only a fixed frame gives it a controlled height (user, 2026-11-26, #870; reverses the content height of #846 and brings back the fixed frame of #705).
- **Board (desktop):** three equal columns, Offen | Jetzt with Wartet below it | Erledigt, centred on wide screens. Cards are fixed-size sheets. The Jetzt slot is always one card tall, filled or empty.
- **Board (phone):** one column page per screen, moved by a swipe (`.claude/rules/mobile-board.md`).
- **Only the app bar is fixed.** On a phone only the app bar is fixed over a list; an action or a note sits in the header or at the end of the list, so no task is covered (user, #248, #297, #373, #566). A drawer or a toast is an overlay, not a fixed bar. One exception: the intro hint (below, "Tell the user something") floats over the board, so it keeps scroll room under the lists, where every card and column button can be scrolled clear of it (user, 2026-11-25, #806, #725).
- **Groups of cards** collapse into a stack; no lines, boxes or tints around a group.
- **Chrome:** one global app bar on every page. The board has no toolbar of its own, and the bar is the way between pages. A step inside a flow (the welcome steps) and a deeper route (a settings sub-page) go back with the back button, not with the bar: see "Step back" under Components.

**The One Stage Rule.** The day close and the recap are one stage: the title and subline lie on the photo, anchored under the app bar, and under them sits one paper sheet in a 44 rem column that holds the content (the decks, or the summary, timebox and topics) and the two buttons, like `/welcome`: the content scrolls inside the sheet, the buttons stay at its foot under a hairline (the way out soft, the main button solid without an arrow, on top on a phone). On a window under about 30 rem tall (a landscape phone) the sheet stops scrolling inside: the whole column scrolls, the title, the content and the buttons one after the other, so nothing is cut off. On a phone the sheet floats above the tab bar with all corners rounded. The day close enters with the photo coming down over the board and both leave with it lifting. This reverses #428 (the recap's content on the photo, only the controls on a sheet) and the docked footer sheet of #612, by user decision of 2026-11-21 (#707); before that: user, 2026-11-20, #612, #580.

## Components

Nuxt UI components first, themed in `app.config.ts`; a shared primitive in `components/ui/` from three call sites on; custom components for the board domain. One line per user task; how each looks, with every variant and state, is on `/ui`.

- **Trigger an action:** `UButton`. Solid green for the one main action of a surface (36 px). Soft for a neutral action that stands on its own and for the main action of a row; a row of two actions may show both soft, from three on one is soft and the others are ghost (owner, 2026-11-12). Ghost for further actions inside a row, card, menu or toolbar and for an icon-only button, except the destructive one of such a pair, which is soft in the error tone so it is told apart at a glance. Link inside running text. One height, 36 px (48 on a phone), and a solid green or error button is at least 96 px wide, so "Weiter" keeps the wide rectangle (#424); no `outline`, `subtle`, `xs` or `xl`, except the one `xs` Nuxt UI sets on the actions of an alert or toast: 24 px high on desktop, 44 px on a phone, at the 14 px text step of the notice beside it (#377). Footers of a dialog, a side sheet and a flow step: one cluster at the right edge, the neutral cancel (or Back) soft first, the main action solid last; on a phone the two share the row; a lone main button sits at the right, never full width on desktop; with three or more choices or labels that do not fit, the footer stacks full width with the main action on top and cancel last, on desktop and phone alike (#611). `footer-actions` (`assets/css/footer.css`) is that footer. The action of a toast is soft.
- **Pick one of a few:** `ChoiceChip`, one chip shape at one height (36 px), with an icon alone where the options are symbols. Larger options with a description are the one choice card. A toggle that stays on beside others is the chip too.
- **Edit a value in a label/value row** (task sheet): a select with a chevron when the value opens a list, text on a dotted rule when it is free input, which turns into a field with the select's fill and radius while it is edited (the add sheet's note too: it grows with its text, #613). Both are 36 px high and share hover, focus and disabled. A value never wears a chip.
- **Type into a field:** `UInput`, `USelect`, `UTextarea` at 36 px. Inline editing is the default for task properties; an empty value shows a muted placeholder in place.
- **Show a list row:** `ListRow`, one density (cozy, 44 px at least), a muted tint on hover; trailing actions follow the button rule.
- **Open a block in place:** the header is one button (`aria-expanded`) with a `DisclosureCaret` at its trailing end, a chevron-down that turns 180 degrees; the block opens below it over `--duration-slow` (`UCollapsible`), the neighbours glide and nothing jumps (the Gestern erledigt note, a Statistik tile, a topic's editor, the in-card timebox step, the task sheet's rows). An opened Statistik tile opens in place: it spans the row from `md` (first, by CSS order) and holds its detail inside itself, the others sit below it (#689, reverses #610 tile b), and the move glides over `--duration-place` (#789, `useTileGlide`; a long travel takes longer, up to `--duration-curtain`, so no frame moves more than 120 px, and the panels that open or close run on the glide's clock). A stack keeps its 200 ms fan and carries the chevron on its pill. Turning "Karten stapeln" or the grouping on or off, and a topic focus, glide every card to its new place over the same 300 ms (`useBoardGlide`) (user, 2026-11-20, #610, #642).
- **Show a status or count:** a neutral `UBadge` in the label role, one size; priority "Hoch" is the one tinted badge on a card. A topic is muted text with its mark, never a chip.
- **Head a section:** `SectionHeader` (roles: hero, display, headline, sub and the 12 px label) and `PageHeader` (the page title); no hand-written heading classes.
- **Hold content as a surface:** the sheet. `TaskCard` on the board; `PageSheet` for a page (settings section, statistics tile, welcome) takes its radius, with the page sheets' resting shadow (`--shadow-task`, a step wider than the card's); a page's intro and a side note (the trash note) take none ("Flat intro, lifted work"). A card in a page (the trash entries) is a sheet already and sits on the canvas.
- **The task card:** topic first, the title below it, the footer with the source icon first (when the card names its source: only where the board has two or more sources, the same in every column and on "Alle", #609), then the timebox chip, the carried-over dots and priority (#471). The Jetzt card is a regular card: focus comes from the board stepping back, not from the card changing.
- **The task sheet:** details and the add form are one sheet, opened the same way from the board and from statistics. A task's detail on desktop is a sheet that grows out of its card, the card's face scaling along with it, and folds back into it (one fixed frame, 720 px wide and 403 px high, close to the card's shape and capped by the window, the same for every task; 32 px corners; the title row with the task menu ⋯ and the close button at its end, at the same place in every state; the label "Spontan" and the planned-days line or the carried-over question under the title; then the tabs "Details", "Notiz" and, on a board with extra properties, "Eigenschaften" with their count ("Switch a view in a page", inside the sheet); the open tab has the whole body and is the one scroll area: Details holds the standard properties in two columns, label left of the value, in the order Status, Heute / Thema, Aktivität / Priorität, Timebox / time spent, Notiz the note alone, with a mark on its tab when there is one, Eigenschaften the board's extra properties in the same grid; one quiet footer line with the source and the creation date under every tab. The sheet never changes its size or place for a long note, many properties or an open editor; the rarely used actions open in source, move to source, "Kam spontan dazu", "ID kopieren" and Delete sit behind the menu, which reverses the bottom row of #244; `TaskMorphShell`, #468, #870, user, 2026-11-26, which reverses the one grid as tall as its content of #846; the strip of set properties and the Metadaten block of #705 stay gone); the add form on desktop is a side sheet; on a phone both are a bottom drawer.
- **Ask in a dialog:** `AppDialog` in three widths; `ResponsiveOverlay` when it becomes a drawer on a phone. For a question or a short task the user returns from, never for a process ("A process is a page"); one overlay at a time.
- **Ask about one card:** on the card (`TaskTimeboxNudge`, the new-card flow): non-modal, self-dismissing, ignoring it loses nothing.
- **Tell the user something:** an undo toast after a reversible action or for news; `UAlert` subtle for a state inside a flow; the `UFormField` error for a field; one quiet line above the content for a state the user cannot fix now (`UAlert` `variant="flat"`: the subtle alert without its ring). A healthy sync is silent. The intro hint (`IntroHintOverlay`) is the one notice that floats over the board: a sheet fixed at the bottom centre (above the app bar on a phone), one at a time, with a way to close it, and scroll room below the lists so every card and column button can be scrolled clear of it (user, 2026-11-25, #806, #725, #800). No other lasting notice floats; only the toast, which comes and goes, floats too.
- **Link in a sentence:** `ULink` (the `link` theme) or `ExternalLink` (adds `ICONS.external` on the line of its own): the `text-link` look, forest green, underlined at rest, one darker step on hover, the focus ring; a link carries no colour or underline class of its own (#603). An action that stands on its own is a `UButton` (ghost for a text action), never a link.
- **Show that something loads:** `LoadingLine` (a turning `i-ph-circle-notch`, muted text, `role="status"`); a waiting button is `UButton loading` (#603).
- **Show an empty place:** `EmptyState` for a page or tab whose main content is a list that fills with use, `EmptyNote` (one muted sentence) everywhere else; empty columns stay blank, except where a line guides: the empty Offen on Heute ("Von gestern", "Was steht heute an?", #356, #761, #802), the empty "Für heute" column of Alle (`BoardPlanNote`, #741) and the empty Jetzt, which shows a dashed card-shaped placeholder (`board.emptyProgressHint`) where the one current task lands; the add button covers it on hover and on focus (user, 2026-11-25, #806, #805).
- **Switch a view in a page:** `UTabs` `variant="link"`: labels on a line, the selected one marked by an underline indicator, no track (#318, #308). It reads lighter than the app bar's nav pill, so it never passes for place navigation. Settings siblings share it: `/settings` keeps the 44 px `xl` (#333), every sub-page, Notion included, the 32 px default and the 672 px column (#603).
- **Choose an option in a page:** `UTabs` as the segmented track (`variant="pill"`, the default look in `app.config.ts`): a track on the canvas, the selected option a white chip. For picking an option (a split, a kind, a range), never for moving between views.
- **Step back in a flow or a deeper route:** `BackButton`: a ghost button, `arrow-left` before the label, left-aligned, 44 px high, the label "Zurück zu <where>" names where it leads ("Zurück zur Auswahl" inside the welcome sheet, "Zurück zu Einstellungen" on a settings sub-page). It is the first line of the flow step or of the sub-page head, above the title (#263); a page the app bar leads to (Heute, Statistik, Einstellungen, Papierkorb) has none. Steps of a flow slide sideways, forward from the right and back mirrored (owner decision, #236, 2026-11-13: replaces "no back arrow anywhere").
- **Move between places:** the app bar. The selected place is the route and nothing else; `aria-current="page"` sits on exactly one control, and an open Mehr panel never replaces it.
- **Charts:** hand-built SVG in the ink ramp only (`lib/inkRamp.ts`); no status colour, no topic hue.
- **Settings:** settings that maintain the user's own content or data are grouped apart from settings that change board behaviour (owner, 2026-11-06).

## Behaviour

- **Ask in place.** A question that belongs to a card or a row is asked there, not in a modal, sheet or toast.
- **Undo instead of confirm.** Deleting and completing act at once and offer undo; no "Are you sure?". An irreversible action confirms in place, never in a modal.
- **Optimistic moves.** Moves apply at once; sync runs in the background and surfaces only on failure.
- **No modal on modal.** A sub-flow replaces the dialog or happens inside it.
- **A process is a page.** A process the user stays in until it is done (a setup, a key moment) is a page or a stage; a dialog is for a question or a short task the user returns from, and carries no header or footer line without a purpose (user, #43, #468, #463).
- **Quiet notices over interruptions.** System states and news are a notice, a toast or a popover, never a dialog that opens by itself.
- **Earned celebration.** Everyday actions confirm quietly; completing a task earns a short celebration around the card: once per completion, about a second, design-system colours, no sound, never blocking. Recorded exception (owner, 2026-11-06): rewarding achievements supports motivation. Recorded exception (owner, #295, 2026-11-14): a task finished below its timebox shows one praise line on the confirmation layer ("Sehr gut! Schneller als geplant."), and the burst is bolder and carries green, warning orange, sky and marker yellow (never raspberry, never a topic hue); this is the only praise text.
- **A view filter never hides Jetzt.** Any view-only reduction of the board (property filter, focus mode, search) leaves the card in Jetzt visible and unchanged, so the board always shows that Jetzt is occupied. A filtered view may then show one card outside the filter; that is the intended trade (owner, #235, 2026-11-16).
- **Say it once.** A heading, description or control that only repeats what its neighbour already says (a stepper label, the page subline, a field label, a labelled button) is left out; a control keeps its accessible name (user, ten corrections, among them #441, #480, #434).
- **One heading level in a menu.** A group inside a menu or popover carries one heading level: its group heading is the only heading. A second sub-heading never splits a group; a hairline or the row language separates what is left. It applies to menus and popovers only: a sheet keeps its lower-level heading ("Sheets on a desk"). Example: the Mehr panel (#431; rule candidate #464, owner, 2026-11-18).
- **Keyboard.** Everything is keyboard-reachable, including board moves; `⌘K` opens the command palette. Announcements name the task and the column, never ids.
- **Accessibility.** WCAG 2.2 AA (text 4.5:1, non-text 3:1), with the recorded exceptions named in the a11y test.

## Guards

What a check already guarantees is not repeated above. `npm run verify` runs them.

| Guarantee | Guard |
|---|---|
| Semantic tokens only: no palette classes, hex, arbitrary values, stray z-index, duration or easing | ESLint, `tests/config/token-literals.test.ts`, `scripts/lint/design-tokens.mjs` |
| No motion literal outside the tokens: a duration, a curve or an easing keyword in a declaration, a custom property, a `duration-N` / `ease-*` class or a scripted `.animate()`; what stays is a component's own choreography, recorded in its doc block and counted in `scripts/lint/literal-baseline.json` | `scripts/lint/design-tokens.mjs` (`npm run lint`), `tests/config/token-literals.test.ts` |
| The motion tokens of the stylesheet, the script mirror and this table agree; reduced motion is the one global rule | `tests/config/motion-tokens.test.ts` |
| The 4 px grid, in `.vue` files: no half-step spacing class but `-0.5` and `-1.5` (roots `p`, `m`, `gap`, `space`, `inset`, `top`/`left`/`right`/`bottom`, `size`, `w`, `h`, `min-`/`max-` and `translate` forms; not `start-`, `end-`, `basis-`, `indent-`), no padding, margin or gap off the grid in a style block, no icon-class width or height off 12, 16, 20, 24 px in a style block (Tailwind `size-N` on a `UIcon` and `.css` files are not checked) (a kept exception is on the file's allow list with its reason) | `scripts/lint/design-tokens.mjs` (`checkScaleLiterals`), `tests/config/token-literals.test.ts` |
| Button vocabulary: the one size, the allowed variants, the phone floor, the 96 px minimum of a solid button, the list of smaller buttons with their reasons | `tests/config/button-ladder.test.ts` |
| Text and control contrast, the focus halo on the main button, the receding-text exceptions | `tests/e2e/a11y.spec.ts`, `tests/config/button-contrast.test.ts`, `role-contrast.test.ts`, `error-soft-contrast.test.ts` |
| Warning text steps and notices on `UAlert` | `tests/config/warning-notices.test.ts` |
| Topic hues keep 3:1 on the sheet | `tests/config/topic-tokens.test.ts` |
| No bare `UModal`, no hand-rolled tabs, no uppercase | `tests/config/design-patterns.test.ts` |
| Icons: mapped meanings, bundled collection only | `tests/config/icon-map.test.ts`, `icons-bundled.test.ts`, `nuxt-ui-icons.test.ts` |
| No new raw `<button>`, no visual identity in a call-site `ui` prop or in a text, font, padding-to-zero, ring or background class on a kit component; raw elements per page, style blocks outside the board, task, kit, overlay and recap, and the style lines of a board or card component may only fall | `tests/config/ratchets.test.ts` (baselines `tests/config/*.baseline.json`, `npm run ratchet:lower`) |
| No empty `<template>`, `<script>` or `<style>` block | ESLint `vue/no-empty-component-block` |
| Every pressable on the board, the task sheet, Statistik, the topic editor, the in-card add flow and `/ui` shows the hand and changes under the pointer (a selected one excepted) | `tests/e2e/hover-answer.spec.ts` (#592) |
| Nothing jumps during a transition (no box moves more than 140 px per 17 ms frame, or 8+ px within two frames and 45 ms; a frame lost to load, and the one after it, is not judged, #666) and reduced motion is instant (no animation or transition over 1 ms but the named progress indicators), over the welcome and setup steps, the Mehr panel, page changes, the blocks that open in place (#610), the board's regroup and topic focus (#642) and a delete with its undo; places whose fix is open are allow-listed with their issue number | `tests/e2e/motion-guard.spec.ts`, `tests/e2e/helpers/frameSteps.ts` (#600) |
| Every visible control on the seeded screens has a 44 × 44 hit area at 390 px, a named exception list | `tests/e2e/phone-hit-areas.spec.ts` (#592) |
| A Pattern line for every new or changed UI element | `tests/config/pattern-check.test.ts`, `.claude/rules/ui-patterns.md` |
| The rendered look: computed-style fingerprint of `/ui`, pixel baselines, Impeccable scan | `tests/e2e/` (`visual-regression`, `design-detect`, the `/ui` specs) |
| Line heights from the size tokens (no `leading-*`, no `text-<size>/<line height>`, no hand-written line height), weight 600 only in the listed files (key figures, running-text `<strong>`, the picked or current value; a ratchet), the icon size scale, no shadow on a control | `tests/config/design-lock-in.test.ts` |
| One solid green button per view | `tests/e2e/design-detect.spec.ts` (counted on every scanned surface) |
| `aria-current="page"` on exactly one control per route | `tests/e2e/app-nav.spec.ts` |
| The board's display rules: one sheet shape, one heading (a heading or legend with a text or font class only falls: a ratchet), one list row, one badge size, the closed radius scale | `tests/config/display-layout.test.ts` |
| One term per concept, both languages, plurals | `docs/copy/terms.json`, `npm run i18n:check`, ESLint `no-raw-text` |

## App icon

A white task card with one large green done check and no text, on two paper sheets, on a forest body (master and values: `docs/design/app-icon/`; user, 2026-11-24, replacing the "Kan / do" card of 2026-11-22). The full forest surface is an icon-only exception: the app UI keeps green in small doses.
