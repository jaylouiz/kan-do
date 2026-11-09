---
name: Kan-Do
description: The focused today board — a quiet desk for the work already chosen.
colors:
  primary: "oklch(0.52 0.090 255)"
  ink-deep: "oklch(0.45 0.085 255)"
  ink-soft: "oklch(0.93 0.027 255)"
  done-teal: "#4CBDA8"
  done-teal-wash: "#D1F1EA"
  warning-orange: "#F96124"
  error-raspberry: "#D0395A"
  paper: "#F5F5F4"
  sheet: "#FAFAF9"
  rule-line: "#E7E5E4"
  pencil: "#A8A29E"
  graphite: "#68625C"
  graphite-deep: "#57534E"
  ink-black: "#1C1917"
  focus-dusk: "oklch(0.27 0.04 65)"
  topic-gray: "oklch(0.55 0.015 260)"
  topic-brown: "oklch(0.50 0.075 55)"
  topic-orange: "oklch(0.60 0.16 52)"
  topic-yellow: "oklch(0.64 0.13 88)"
  topic-green: "oklch(0.54 0.12 150)"
  topic-blue: "oklch(0.54 0.14 245)"
  topic-purple: "oklch(0.52 0.17 305)"
  topic-pink: "oklch(0.58 0.18 0)"
  topic-red: "oklch(0.54 0.19 27)"
typography:
  display:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.15
  headline:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.15
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
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1rem
  body-mobile:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.3
  label-mobile:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1rem
  brand:
    fontFamily: "Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  card: "16px"
  pill: "9999px"
spacing:
  card-inline: "12px"
  card-block: "12px"
  stack-offset: "4px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.sheet}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
  button-soft:
    backgroundColor: "{colors.ink-soft}"
    textColor: "{colors.ink-deep}"
    rounded: "{rounded.md}"
  task-card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.card}"
    width: "288px"
    height: "132px"
  task-card-done:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.graphite-deep}"
    rounded: "{rounded.card}"
  badge-neutral:
    backgroundColor: "{colors.rule-line}"
    textColor: "{colors.ink-black}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  app-bar-pill:
    backgroundColor: "{colors.rule-line}"
    textColor: "{colors.graphite-deep}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    height: "36px"
  app-bar-chip-selected:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.pill}"
---

# Design System: Kan-Do

This file states the direction, the tokens, the rules and the recurring patterns. Exact values, timings and per-feature detail live next to the code (component doc blocks, CSS comments, `tests/e2e/a11y.spec.ts`) and in the issue that decided them. Product truth (users, principles, scope) is in `PRODUCT.md`.

## Overview

**Creative North Star: "The Quiet Desk"**

A tidy desk under a good lamp. One sheet is in front of you, the rest is stacked neatly to the side, and nothing on the desk asks for attention it hasn't earned. Kan-Do is a working tool (Operate mode): the board is scanned many times a day in short glances, so calm comes from restraint, predictability and generous space, not from decoration.

The desk is warm, not austere. Calm comes from generous composition (few things per screen, large confident headings, space between groups), friendly rounded warmth (warm paper neutrals, soft radii, one approachable sans), flows that happen in place (a question asked on the card, a value edited in its row) and small physical motion that explains what just happened. Airbnb is the positive reference for all four. Trello (rainbow labels, gamified clutter) and Notion (dense, technical, information overload) are the anti-references: no dense toolbars, no sidebar overload, no modal on modal.

**Key Characteristics:**
- Warm paper page, bright card sheets, one quiet ink accent.
- One typeface; type and space compose the page, not boxes, lines or fills.
- Flat by default; soft, ambient shadows only on things you can pick up.
- Questions are asked in place; reversible actions act at once and offer undo.
- Motion is small and physical and explains a state change.
- Light only for now (`colorMode: false`); dark mode would be a new feature, designed from scratch.

## Colors

A warm-neutral paper palette with one quiet ink accent, three fixed status colours and nine small topic-mark hues.

### Primary
- **Desk Ink** (`primary`, ramp `custom-ink`, Nuxt UI `primary`): the one accent. Solid primary buttons, focus rings, links, selected options and the running timebox.
- **Deep Ink** (`ink-deep`): hover and pressed state of primary; primary text on soft fills.
- **Ink Wash** (`ink-soft`): soft button and selected-row backgrounds.

### Secondary
- **Warning Orange** (`warning-orange`, `custom-orange`, Nuxt UI `secondary` and `warning`): attention. High priority, a timebox running out or over, a connection that needs a look. Never a brand accent.

### Tertiary
- **Done Teal** (`done-teal`, `custom-teal`, Nuxt UI `success`): completion. It marks the done state (the check on a done card, the Erledigt drop wash, the in-card confirmation, the Yesterday note surface: no outline, a darker wash than the confirmation but short of the drop wash), never a card sheet and never a solid action fill.
- **Raspberry** (`error-raspberry`, `custom-raspberry`, Nuxt UI `error`): destructive and failed states only.
- **Focus Dusk** (`focus-dusk`): a warm brown-grey that exists only as the tint of the Jetzt focus overlay and of the lifted card's shadow; never text, fill or border, and not part of the primary.

### Topic marks
- **Nine hues** (`topic-gray`, `-brown`, `-orange`, `-yellow`, `-green`, `-blue`, `-purple`, `-pink`, `-red`; `--topic-<hue>` in `assets/css/main.css`): the tone of a topic's mark, a 12px dot or a 16px Phosphor fill glyph before the name (#431). Each tone has at least 3:1 on the card sheet (`tests/config/topic-tokens.test.ts`); they can be retuned in the one place without touching a component (#423). Notion's nine colour names map 1:1 onto them, other source colours onto the nearest hue.
- **Known collision, accepted:** orange, red and green share hues with the status colours (the "Hoch" chip, the done check, failures). The mark is small and the topic name sits beside it, so the two do not read as one signal (user decision D2 on #430).

### Neutral
Nuxt UI `neutral: 'stone'`, remapped in `assets/css/main.css`:
- **Paper** (`paper`, `bg-page`): page wash, board surface, sticky chrome.
- **Sheet** (`sheet`, `bg-elevated` / `bg-default`): cards, sheets, modals, popovers.
- **Rule Line** (`rule-line`, `bg-muted` / `bg-accented`): dividers, neutral badges, soft surfaces.
- **Pencil** (`pencil`, `text-dimmed`): placeholders of disabled fields, disabled.
- **Graphite** (`graphite`, `text-muted`): secondary text, column headers; deliberately lighter than `text-toned`.
- **Ink Black** (`ink-black`, `text-default` / `text-highlighted`): primary text.

### Named Rules
**The One Lamp Rule.** Ink is the only accent. If more than one element per view is ink-filled, one of them is wrong.

**The Status Is Not Decoration Rule.** Teal means done, orange means attention, raspberry means destructive or failed. They never appear for emphasis, branding or variety. Integration brand colours (Todoist red, Notion black) do not appear in the UI; sources are shown in neutral ink. A topic's own hue lives on its mark only (The Topic Mark Rule).

**The Topic Mark Rule.** A topic may carry a hue and a symbol on its mark only: a small dot or glyph before the name. The name stays neutral muted text. Never a coloured chip, label, card, stack, column or surface, and never a hue on a name in a list or table. One mark per topic, from the nine `--topic-*` tokens; no mark at all for a topic with neither hue nor symbol. This is the one place where hue encodes the user's own category rather than status (decision D2, #430/#431). Charts never take a topic hue: they use the ink ramp ("Ink ring", #469).

**The Frozen Primary Rule.** The primary palette (Ink, hue 255) changes only by a decision recorded here (the user's, or an agent's marked `agent-decided` on its issue), never as a side effect of a feature.

**The Receding Text Rule.** Waiting cards, done titles and placeholders step down through a token colour, never through `opacity` on text, and text keeps body contrast. Status text sits on its own wash in the deep step of its colour. A deliberate exception (today: the Jetzt focus overlay dimming the rest of the board, and the muted content of a collapsed stack's front card) is a recorded decision: it is reversible or purely a signal, documented with its component, and exempted narrowly in the a11y test.

## Typography

**Display Font:** Figtree 600 (the same face as body; `--font-display` stays as the role token)
**Body Font:** Figtree (fallback ui-sans-serif, system-ui)
**Mono:** the system mono stack, only for paths, ids and code

**Character:** one friendly geometric sans. Hierarchy comes from size, weight and `text-muted`, not from a second typeface. Large, confident display headings structure a page; everything you read and act on stays at regular weight.

### Hierarchy
- **Display** (600, slight negative tracking, tight line-height): column names (always `text-muted`, centred), the welcome headline, statistics key figures (tabular numerals).
- **Headline** (600, `text-headline`): section headings in columns, dialogs and pages; the utility `section-heading` (`assets/css/utilities.css`) carries the full set for the settings, updates and data pages and the What's New dialog. Modal titles are a notch smaller and also semibold.
- **Title** (400, snug): task card titles, clamped. The task's own title in the sheet is regular weight too: it is the task's text, not a heading.
- **Body** (400, reading line-height): notes, dialog content, settings copy.
- **Label** (500, small): badges, chips, meta. The task sheet's property labels are a step larger, because they are the only name of an editable value.
- **Mobile step** (≤767px): card and label text rise one step (`body-mobile`, `label-mobile`); the root font size and the column headlines stay.

### Named Rules
**The One Role Rule.** `font-display` (Figtree 600) is only for display and headline roles (headings and numerals; never labels, tab names, prompts or plain sentences). Body, labels and card titles stay at 400-500.

**The Three Line-Heights Rule.** `--lh-tight` for display text, `--lh-snug` for compact UI, `--lh-body` for reading. No other line-heights.

## Layout

Type and space compose every page: headings, scale and generous gaps group content; lines, boxes and tints do not. No card in a card.

- **Board (desktop):** three equal columns on the paper surface, Offen | Jetzt with Wartet below it | Erledigt, as a compact centred group on wide screens. Cards are fixed-size sheets, so the board reads as an even grid. The Jetzt slot is always one card tall, filled or empty, so nothing below it jumps.
- **Board (mobile):** one column page per screen (Offen | Jetzt with Wartet | Erledigt), moved by a swipe only (and the drag edge arrows while a card is dragged); there are no column tabs and no action dock. The bottom bar holds the two places and ⋯; the wordmark is not shown on a phone (no backing, it printed over the cards, kd#24). The active page is `data-mobile-page` on `.board`, and focus entering an off-screen page makes it active.
- **Stacks:** a group of cards collapses into one stack: the front card with a few peek layers behind it and a split-capsule pill (the grouping property as a card shows it, then the stack icon and the count). The stack is one control and drags as a whole; expanded, the members are plain cards under a header that is the same pill, centred, with a round close button (X) at the right edge and no caption. No lines, boxes or tints around a group.
- **Chrome:** one global app bar on every page (brand (not on a phone), Heute, Statistik, ⋯ / Mehr; `components/nav/AppNav.vue`). Board actions live in the ⋯ menu while the board is the current place (Ansicht, Tag abschließen, sync) and, for Tag abschließen, as a CTA under Erledigt; the board has no toolbar of its own, the bar is navigation. The bar is the only way between pages: there is no back arrow anywhere.
- **Page offsets:** every page sits below the desktop bar and above the phone bar. `assets/css/app-nav.css` is the one place that declares `--app-bar-offset-top` (3.5rem on desktop, 0 on a phone) and `--phone-bar-offset` (4.5rem plus the safe-area inset on a phone, 0 on desktop): the sticky tab list on a sub-page offsets by the first plus `--app-bar-veil-hang` (the veil's 1.75rem, 0 on a phone), so the veil never washes it (the page header is not sticky, it scrolls away), the board's `min-height` subtracts it, the phone column pages, the add-task bar, the Erledigt CTA and the toasts clear the second.
- **Pages** (settings, data): one flat, readable column with display headings and spacing; rows divided by hairlines at most. **Statistik is the exception** (decision D1/D2, #469): a page of grouped surfaces, the verdict surface first, then tiles that expand in place (single column below `md`); see "Statistik surfaces" under Components. Settings and data stay flat.

## Elevation & Depth

Hybrid: flat paper and flat chrome; cards are the only lifted objects. Shadows are ambient and soft: they say "this is a sheet you can pick up", never "this is important".

### Shadow Vocabulary
Named in `assets/css/main.css`: sheet at rest, sheet hovered, sheet in hand (the drag overlay), sheet in the lamp (the Jetzt card while the focus overlay is on), the collapsed stack, the desktop task sheet, and the modal overlay.

### Named Rules
**The Only Cards Float Rule.** Cards carry the custom shadows. The named exceptions are the desktop task sheet (cast toward the board) and modals (a hairline ring plus a soft downward shadow, so a dialog separates by its surface, not by a stronger scrim). Popovers, dropdowns and menus keep Nuxt UI defaults; nothing else gets a shadow. Waiting cards sink through greyscale and a toned title, not through shadow changes.

**The Glass Chrome Rule.** Blur is allowed only on navigation chrome (the app bar's pills), never on content: cards, the board, sheets and dialogs stay solid. Every glass surface carries its own opaque fallback (no `backdrop-filter`, reduced transparency) and keeps AA label contrast over the worst card behind it. The tint is made of existing tokens, never a white fill, and the depth is the existing shadow scale (`--shadow-sm` on desktop, `--shadow-md` on a phone); that shadow is the app bar's own exception to The Only Cards Float Rule.

## Shapes

Gently rounded from one base, `--ui-radius`, which drives Nuxt UI's scale. Task cards use double the base with a white edge, so they read as paper sheets. Badges and chips are small and rounded; pills (the stack caption, in-card answers) are fully rounded; toggles are circles. No sharp corners, no pill-shaped containers, with one named exception: the app bar's pill (and its round ⋯ pill, also the phone's bottom bar) is a single, deliberate pill-shaped container. The rule keeps its meaning everywhere else.

## Components

Nuxt UI components with project-wide overrides in `app.config.ts`; custom components only for the board domain.

### Buttons
- **Primary:** ink fill, light text, at most one per view; deep ink on hover.
- **Focus:** a solid 2px ink ring with an offset on every control (not Nuxt UI's translucent halo). Hand-rolled controls take the utility `focus-ring` (`assets/css/utilities.css`); solid primary Nuxt UI buttons and tab triggers carry it from `app.config.ts`, while soft and ghost buttons keep Nuxt UI's translucent halo.
- **Soft / Ghost:** the default for secondary actions; board actions are ghost icon buttons. Dialog footers put the neutral cancel first and the primary last.
- **Size ladder (#552):** one size per role, not per surface. `md` is the theme default and needs no prop; a call site climbs or descends only by the role below. Heights in px at desktop / at 390 px.

  | Role | Size | Desktop / 390 px | Variant |
  | --- | --- | --- | --- |
  | The one primary CTA of a surface (day-close Fertig, new-day recap, "Tag abschließen", a wizard step's primary, a dialog or sheet footer primary, an empty-state CTA) | `lg` | 36 / 48 | primary (solid); soft neutral only for "Tag abschließen" |
  | Siblings in the same footer or row (cancel, back, a secondary action) | `md` (default) | 32 / 44 | soft; ghost for a quiet cancel |
  | Rows, cards, in-card actions, icon buttons | `sm` | 28 / 44 (icon-only 44 wide too) | ghost for icon buttons and quiet actions, soft for a labelled row action |
  | A control inside running text, or one with its own hit area (the stack header close) | `xs` | 24 / no floor | link or ghost |

  `xl` and `outline` are not in the vocabulary; a state that wants an outline (selected, destructive) is soft with a colour. Exactly one `lg` per surface: a footer with several siblings keeps one `md` row and the CTA alone is `lg`; neutral cancel first, primary last. A footer row aligns its buttons `items-center`: a stretching flex row would lift the `md` siblings to the CTA's height.
- **Phones: 44 px.** Every button is at least 44 px high at 390 px (`lg` 48), icon-only ones 44 wide. The floor lives in the `button` theme in `app.config.ts` (`max-md:min-h-11`), so a surface never applies `.touch-target` to a button; `xs` is the one size without it. `tests/config/button-ladder.test.ts` fails on `xl`, `outline`, a hand-set `touch-target`, an explicit `md`, a stray `xs` or a solid primary without `lg`. The size ladder covers buttons only: `USelect` and `UInput` keep their own field heights. Nuxt UI internals follow the floor and were measured at 390 px (#552): calendar header and its Löschen / Heute 44, modal close 44 x 44, alert actions and toast actions 44 (these two stay `xs` with their own 44 rule, `.kando-notice-actions` / `.kando-toast-actions` in `mobile-nav.css`, #284: a notice is not a surface with a `lg` CTA). The app uses no `UInputNumber`.

### Chips / Badges
- Neutral soft badges in the Label role; priority "Hoch" (the one badge on a card, #617) uses the warning tone softly. A topic is plain muted text with an optional mark before it (a hue dot or a symbol glyph, The Topic Mark Rule), never a chip. No rainbow labels.

### Task card
- **Card:** a sheet with the card radius, white edge and resting shadow; fixed size; the topic leads and the title sits below it and clamps; the footer carries the timebox chip first, then the source icon, the carried-over dots and the priority badge. No activity badge on the card (the activity is for grouping and statistics; the task sheet shows it). Cards and stacks in a column sit 0.75rem apart (`--task-list-gap`). Task text is marked `data-private`.
- **States:** in progress at full contrast with its live timebox; waiting greyscale with a toned title; done on the regular sheet with a struck, toned title and a teal check. The Jetzt card is a regular card: focus comes from the board stepping back, not from the card growing.
- **Progress chip:** the timebox label is also the card's progress. It is the footer's first item. Outside Jetzt it is a light grey chip whose fill shows time spent, never coloured. In Jetzt it grows to the right from its own place into a bar across the footer in the primary tint, turning to the warning tint near and past the timebox. Without a timebox it counts spent time forward. Text on every fill keeps body contrast.
- **Carried-over dots:** from a task's second day on the board, small muted dots count the board days up to six; past six the dots stop, a "+" and the exact number follow; no colour escalation. After several days the task sheet offers a calm triage (keep, make smaller, delete).
- **Done drop:** dropping into Erledigt washes the column in light teal while hovering and plays a brief in-card check after the drop; no praise copy, no toast.

### Add task
- One card-sized slot in each column that takes new tasks: a soft grey button at rest that grows into the card shape on hover or focus and shrinks back (instantly with reduced motion), never ink-filled. The Jetzt slot shows its card shape only on hover or focus, with a lightning icon: it starts the task now. Clicking the Jetzt slot turns it into the sheet's draft card in the same place; saving puts the card there. Clicking the Offen slot turns it into the guided new card (#649): the title is typed on the card, then Thema, Aktivität, Timebox and Notiz are asked one at a time over a wash, the answers in a 2×2 grid, with the keys 1-4, Enter and Esc shown inside the buttons; Thema and Aktivität show the three best values and a fourth cell "Mehr" that looks like an input (dashed outline, search icon) and opens the rest with a search and "Neu: „text“" (kd#16), Timebox two suggestions and "···"; it saves at the end with a toast. The sheet stays for Jetzt, the palette and the nav. Values: the `NewCardFlow` doc block.

### Task sheet
- Details and the add form open in one sheet: a side slideover on desktop, a bottom drawer on mobile, no close button (Escape, overlay click, swipe). While it is open the board dims behind it and the open card stays lit.
- Content is labelled property rows: a quiet label column, the value as plain text that is its own control and edits in place. Every row keeps its place whether set or not ("Auswählen…", "+ hinzufügen"); there are six standard rows, the last one "Aufgewendete Zeit" (the total in minutes, edited like the Timebox, the time left as muted text beside it, warning tone at 20 % or less, kd#4); there is no separate time block or progress ring on the sheet; no per-row icons, dividers or chips (the Thema value's own mark is part of the value, not a row icon). The Thema and Aktivität pickers have an edit mode in the footer (Bearbeiten / Fertig): one button row per option opens the shared topic editor under the row (a nested drawer at 390px); options carry no controls. Notes follow the rows and render Markdown.

### Dialogs and overlays
- Every modal declares one width from `utils/modalSizes.ts`; header, rules and footer come from the `modal` theme in `app.config.ts`. All overlays darken the page with the shared light scrim (`--overlay-scrim`); separating the dialog from the board is the surface's job.
- A dialog that is a modal (or, for the task sheet, a slideover) on desktop and a drawer on a phone is hosted by `ResponsiveOverlay`; the 768px breakpoint is `useIsDesktop()`. Do not hand-roll the split or call `matchMedia` for it.
- One overlay at a time (see Behaviour). Flows that need the whole stage (setup, closing the day, feedback) are dialogs; small questions are not.

### In-card question
- A small, optional question about one card is asked on the card (`TaskTimeboxNudge` is the first): a layer over the card face with the question and a few soft pill answers; non-modal, one at a time, self-dismissing, and ignoring it loses nothing.

### Notices and toasts
- **Undo toast:** after a reversible action, with "Rückgängig".
- **System notice:** a state the user cannot fix in the current flow (data folder, sync conflict, cloud upload) is one quiet single-line notice above the content, warning for "needs attention", error only for "failed", neutral when nothing is at risk. It disappears by itself when the state is healthy.
- **Inline notice and warning text (#558):** a notice inside a flow (a dialog, a wizard step) is `UAlert`, `variant="subtle"`, `color="warning"` (or `info`), never a hand-built `border-warning/20 bg-warning/10` box. Warning status text on `bg-default` is the 700 step (`text-warning-700`, 5.7:1 on Paper, 6.0:1 on Sheet; the base orange is 2.9:1 and fails), the same step as `error-700`; only inside the tinted `UAlert` it is the 800 step (set once in `app.config.ts`). Guarded by `tests/config/warning-notices.test.ts`.
- **Sync status:** a source that cannot sync puts a status dot on ⋯ (error for a rejected token, else warning; the 700 step, and ⋯'s accessible name says "Verbindungsproblem"), and the Mehr panel names the worst problem above the resync row with the fix; never a dialog on its own. A healthy sync is silent: no dot, no extra line.

### App bar
- **Look.** The brand `kan-do` stands left of the pill on the paper (no pill behind it, #642); one pill holds the two places (Heute, Statistik), plus a third segment while the route is a page behind ⋯ (Einstellungen, Papierkorb; #583); a separate round ⋯ pill sits beside it. The group (brand, pill, ⋯) is centred as a whole, so the brand moves left when the third segment widens the pill (accepted, #642). On a phone the brand is not shown (kd#24): the pill and ⋯ are centred. Both are neutral frosted glass (The Glass Chrome Rule): a soft grey, paper-tinted track (`--ui-bg-muted`, translucent over a blurred backdrop, never white) with a hairline, the selected segment on one raised white chip (`--ui-bg` with the xs shadow, the moving indicator), no ink fill, no ink badge. 2.25rem tall on desktop (the brand is 1.125rem), 3.25rem on a phone with 2.75rem segments. Because cards scroll under the bar, a paper veil (page paper fading to nothing) sits behind the pills, so cards dissolve into the paper instead of ending at the pill's edge; the page header is not sticky, so the bar alone stays when a page scrolls. Without `backdrop-filter`, or under reduced transparency, the pill falls back to a near-opaque tint. The one pill-shape exception is named under Shapes. Values live in `app-nav.css`.
- **Selected state is the route, not the panel (binding).** Heute is selected on `/tasks*`, Statistik on `/statistics`, the third segment on `/trash` (Papierkorb) and `/settings*` (Einstellungen, linking `/settings`); nothing else. ⋯ is never selected and carries no `aria-current`: an open Mehr panel is an overlay and never replaces the selected place, ⋯ shows only a soft pressed fill (and `aria-expanded`), visibly different from the raised chip. `aria-current="page"` sits on exactly one control.
- **Third segment and indicator (#583).** The segment grows in the pill when such a page is entered and shrinks away when Heute or Statistik is chosen; Einstellungen <-> Papierkorb re-measures and relabels it. One indicator stretches between the segments like a rubber segment: two springs chase the live box of the selected segment, the edge in the direction of travel stiffer with a small overshoot, the trailing edge lagging. One 420 ms timeline and one easing drive everything that changes the pill's layout (the segment, the phone segment padding 1rem -> 0.75rem). Reduced motion: instant. Values live in `app-nav.css` and the `AppNav` doc block.
- **Mehr panel** (a popover, not a menu: it holds a switch, chips and a status footer): Ansicht (Karten stapeln, group-by chips; board only) -> Tag abschließen (board only) -> Papierkorb (n), Einstellungen, App-Update (desktop app only) -> sync footer; the page the pill shows as its third segment is not listed (on `/settings*` no Einstellungen row, on `/trash` no Papierkorb row; App-Update stays). Fokus lives only in Einstellungen.
- **Layering.** The bar sits below sheets, dialogs, drawers, the palette and the Mehr popover, and below toasts; with an overlay open the bar is dimmed by its scrim and not clickable. On a phone it fades out while a card is dragged.

### Statistik surfaces
Statistik answers its questions in order (Arbeite ich gut? Wie entwickle ich mich? Wo schätze ich falsch? Wofür nehme ich mir Zeit? Wann arbeite ich?) and shows the least first. No tile carries a step label ("n / n"). Three patterns carry it (`components/statistics/Stats*.vue`; per-component values live in their doc blocks).
- **Grouped surface.** A section on its own rounded surface: `rounded-3xl`, Ink Wash `bg-primary/10` for the one headline surface (the verdict), `bg-default` + `shadow-xs` or `bg-elevated` + `ring ring-default` for the rest. Never a card in a card, at most one level of grouping, a hairline inside. Semantic tokens only.
- **Disclosure tile.** The question is the heading (`<h2>` holding one `<button aria-expanded aria-controls>`); the tile shows one line and a mini chart and expands in place to its panel, one at a time. Focus stays on the toggle (it is restored when the tile moves); the open tile moves first in the DOM at `md+` (never CSS `order`, which breaks reading and focus order), the DOM order stays natural below `md`; closed panels have no tab stops; the toggle row is at least 44px; reduced motion removes any motion.
- **Ink ring.** Charts are hand-built SVG (no chart library): segments on one circle in the ink ramp (`--ui-text-highlighted` at 100 / 72 / 50 / 32 / 18 / 10 %, darkest = largest, the folded rest the lightest), a neutral track, a tick for the user's own usual value, `role="img"` with an `aria-label` that states the numbers (the sentence beside it carries them too). The ramp is the only chart palette: no status colour, no topic hue (The Topic Mark Rule stays; a topic hue appears on the mark before a name only).

### Tabs
- In-page tabs are `UTabs` with one `tabs` override in `app.config.ts` (#557): the app bar's look, a soft grey track with the active tab as a raised white chip, no ink fill and no underline, so a page with a primary button never carries a second ink fill. Tabs are for in-page switching (topics and activities, the Notion sections, the Statistik split); the app bar's pill is for places. Hand-rolled `role="tablist"` is not used.

### Settings sub-page
- `PageHeader` without a back arrow (a page is left through the app bar or ⋯ -> Einstellungen), kept on the sub-pages (`/settings/data` and so on); none on `/settings`, `/trash` and Statistik, where the app bar names the page (the title stays as a screen-reader-only h1, #670, #686). One flat column centred on the app bar's axis: 672 px (`max-w-2xl`) on Einstellungen, its sub-pages and Papierkorb, the full container on Statistik and Notion; the sub-page layout owns the width (`definePageMeta({ pageWidth: 'narrow' })`, #673), a page sets no width class. Display headings, hairline-divided rows, no cards. Status is a muted line; actions are soft or ghost, the default source is a quiet badge.
- **Behaviour apart from maintenance.** Settings that maintain the user's own content or data (topics, activities, export/import, storage, updates, access) are grouped apart from settings that change board behaviour. Adopted (user, 2026-11-06, #701, from the #691 D1 answer): "it's not really bound to board behavior, just user data maintenance". Challenge was: matches convention (behaviour preferences vs. data management, Apple HIG settings grouping).

### Inputs / Fields
- Nuxt UI inputs on the sheet; disabled inputs get a muted background, not only opacity. Inline editing is the default for task properties; an empty value shows a muted placeholder in place.

### Behaviour
- **Ask in place.** A question that belongs to a card or a row is asked there, not in a modal, sheet or toast.
- **Undo instead of confirm.** Deleting and completing act at once and offer undo (archiving the done tasks with "Gesehen" or in the new-day recap acts at once with neither a toast nor an undo, #463); no "Are you sure?". A delete confirms on the spot, in the card's own slot (the gap: trash icon, "Im Papierkorb", a "Rückgängig" pill and a 5 s draining line along its bottom edge, all in raspberry on a muted raspberry fill without an outline: destructive state, #581; compact at the collapsed Yesterday note's height, #57, so the cards below glide up and back on undo), not in a toast; afterwards the task sits in the trash (one page, Papierkorb, reached from the Mehr panel with the count in its row; no dock icon and no quick sheet) and comes back from there. Completing still uses a toast. Upstream deletes wait until the undo window has closed. Dragging a card into Erledigt needs no toast: the reverse drag is the undo. Values of the gap: the `TaskDeletedGap` doc block.
- **Optimistic moves.** Moves apply instantly; sync runs in the background and surfaces only on failure.
- **No modal on modal.** A sub-flow (picking an element, a screenshot, a confirm step) replaces the dialog or happens inside it; it never stacks a second one.
- **Quiet notices over interruptions.** System states and news are a notice, a toast or a popover, never a dialog that opens by itself (an update offers "Was ist neu" as a toast).
- **Motion.** Motion explains a state change: things move the way paper would (fade, glide, settle, a small spring where a label becomes the live status of a card). It is short, never decorative or looping (one exception: Earned celebration), never runs on page load or during a drag, and `prefers-reduced-motion` makes it instant.
- **Earned celebration.** Everyday actions confirm quietly; completing a task is an achievement and earns a short celebration around or behind the card: once per completion on every path into Erledigt, at most about 1 s, design-system colours, no sound and no praise text, never blocking the next action; `prefers-reduced-motion` leaves the plain completion. Deliberate exception (user, 2026-11-06, #692): rewarding achievements supports motivation and continuous productivity. Challenge was: conflicts: a reward on every completion wears off and drifts towards gamified clutter, hence small, contained and quiet otherwise.
- **Keyboard.** Everything is keyboard-reachable: cards are focusable and move with the keyboard drag, click-to-edit fields are buttons, `⌘K` opens the command palette for global and card commands. Announcements name the task and the column, never ids.

## Usage guidelines

One checklist for recurring UI decisions. Each line: the job, the rule, an example, the guard. A collected rule names its home section and is not repeated; the semantic icon map is `lib/icons.ts` (`ICONS`, #67), guarded by `tests/config/icon-map.test.ts`.

- **Which icon.** Bind `ICONS.<meaning>`, never a literal glyph; icon sizes are the four spacing steps in `lib/icons.ts`. Stepping back or forward and "go on" are the component's job (`ICONS.back`, `ICONS.forward`, `ICONS.goOn`; the step recipe lives in `/ui`), not a rule here. Guard: icon-map test.
- **Which button.** Primary, soft, ghost and the size ladder: Components, Buttons. Guard: `tests/config/button-ladder.test.ts`.
- **Dialog actions.** Neutral cancel first, primary last, one `lg` per surface: Components, Buttons; one overlay at a time: Behaviour, "No modal on modal". Convention.
- **Destructive action.** Act at once and offer undo, no "Are you sure?": Behaviour, "Undo instead of confirm" (example `TaskDeletedGap`). Convention.
- **Open outside vs inside (adopted, D1 on #68).** `ICONS.external` (`arrow-square-out`) means "opens outside the app" and is bound to `ExternalLink` (example `GithubTokenRow.vue`); opening details inside the app uses `ICONS.openDetail`. Named exceptions: the feedback dialog's own buttons (`FeedbackDialog.vue`, `useFeedback` `openExternal`), toast actions and the task sheet menu's "open in source", which carry the icon without `ExternalLink`. Convention.
- **Notice, toast or inline (adopted, D1 on #68).** A toast is a reversible action done (undo) or news; a `UAlert` subtle is a state inside a flow; a field problem is the `UFormField` error; a state the user cannot fix now is the quiet system notice (all under Components, Notices and toasts). A plain coloured line is not a notice. Guard: `tests/config/warning-notices.test.ts` for the warning step, the rest convention.
- **Empty state (adopted, D1 on #68).** On the task board one muted sentence at most, and empty columns stay blank. On every other surface a calm graphic plus a subline; no CTA unless a next step exists. The graphic's look is designed in kd#106 and this rule says what, not how; until then those surfaces keep one muted sentence (`pages/trash.vue`). Wording: Voice and copy, "Empty states". Convention.
- **Wording of Save, Cancel and Close.** Collected from Voice and copy ("Buttons are verbs": "Speichern" / "Save", a dismiss is "Abbrechen" / "Cancel" or "Schließen" / "Close"), terms in `docs/copy/terms.json`; no new term. Convention.

Not yet a rule: choice chip vs a property-value trigger (decision D2 on #68).

## Voice and copy

The registry `docs/copy/terms.json` is the vocabulary; the `copy-writer` skill applies both. The terms for address, Timebox, Löschen/Entfernen/Trennen, Verbindung and Notiz are decided; the answers of #473 and #485 are decided in the registry once the user approves them with `npm run terms:approve`.

- **One term per concept.** Every concept has one term in `docs/copy/terms.json` (German and English, plus forms to avoid). Reuse it; a concept that is not there is added as `proposed` in the same change. A `decided` term changes only with the user.
- **Address.** German speaks the user as "du". English has no formal form.
- **Löschen, Entfernen, Trennen.** "Löschen" when data goes away (a task, a stored token, a draft), "Entfernen" when a value or an element is taken away without deleting data (a timebox, a screenshot), "Trennen" for ending an integration connection.
- **Tone.** Calm, like a well-made notebook (PRODUCT.md personality: natural, helpful, assistive). Quiet confirmation (principle 4): state what happened ("Im Papierkorb"), no exclamation marks, no praise.
- **Case.** Sentence case for labels, titles and buttons ("Tag abschließen", "Close the day"); proper names and the four column names keep their capital letters. No ALL CAPS.
- **Buttons are verbs.** The label names what happens: "Speichern", "Löschen", "Trennen", not "OK" or "Ja". A dismiss is "Abbrechen" or "Schließen".
- **Errors say what happened and what to do next.** "Notion ist gerade nicht erreichbar. Versuche es später erneut." Never a raw technical detail, status code or exception text (PRODUCT.md principle 5: if a user sees one, the design has failed).
- **Failure sentences.** A full sentence about something that was tried reads "… konnte nicht … werden" / "… could not be …"; a short status label next to a source or row keeps "fehlgeschlagen" / "failed"; "kann nicht" / "cannot" only states a rule ("cannot be negative").
- **No "Bitte".** Errors and hints use a plain imperative ("Versuche es erneut.", "Try again."), no "Bitte" / "Please".
- **Technical detail.** Only the Data settings page shows a detail, in one form: "<What happened>. Details: {error}" (the folder or file system is what the user must fix there). This is the single exception to the raw-detail rule above.
- **Empty states.** "Noch keine X." (plus how it fills, where there is something to do) when the thing appears with use; "Keine X gefunden." only for a search or filter result; never "… verfügbar".
- **Progress.** German is passive with the object first ("Datenbanken werden geladen…", "Wird geprüft…"), English the present participle ("Loading databases…"); no space before `…`; the percent sign has no space ("{percent}%").
- **Task state.** A task is "erledigt" / "done"; "Fertig" / "Done" only labels a button that closes a dialog; "abschließen" only for the day or a setup.
- **Settings, token, time.** "Einstellungen" for the place and what can be changed, "einrichten" for the first guided setup, no "Konfiguration"; "Token" is the secret and "Zugriff" what it permits (no "Zugang"); "Aufgewendete Zeit" / "Time spent" (the running timer on a card keeps "Bisher gearbeitet").
- **English.** American spelling (color, canceled, gray); no contractions except the feature name "What's new".
- **Voice.** The app has no speaker: no "wir" / "we"; passive, or "the app" as subject.
- **Names and full stops.** "Kan-Do" in running text (the lowercase `kan-do` is only the wordmark in the app bar, `nav.brand`); German compounds with a brand name take a hyphen ("Notion-Datenbank"). A description or hint that is a sentence ends with a full stop; a noun phrase or list does not.
- **Characters.** One ellipsis character `…` (not three dots) for loading and truncated actions. Quotes are „…“ in de and “…” in en. `{named}` placeholders only, never string concatenation of translated fragments.
- **Plurals.** vue-i18n pipe syntax, one branch per form (`{n} Aufgabe | {n} Aufgaben`); a literal pipe is written `{'|'}`. Never "(s)" or "Aufgabe(n)".
- **Statistik verdicts.** A verdict is a plain sentence relative to the user's own last 4 weeks ("Es läuft besser als sonst"), never an absolute target, never red, never praise; a harder week is stated plainly (#469).
- **Both languages together.** A string lands in `de.json` and `en.json` in the same change (`npm run i18n:check`).

## App icon

A yellow Mac-style body with three white sheets (master: `docs/design/app-icon/kan-do-icon-final.svg`). Yellow is an icon-only exception, never used in the app UI.

## Do's and Don'ts

### Do:
- **Do** follow the styling priority: (1) Nuxt UI semantic tokens (`text-muted`, `bg-elevated`, `text-primary`) → (2) baseline overrides in `assets/css/main.css` → (3) custom domain tokens in `assets/css/main.css`.
- **Do** put component overrides in `app.config.ts → ui.<component>` and verify slot names via the Nuxt UI MCP `get-component-metadata` or `.nuxt/ui/<component>.ts`.
- **Do** use `bg-page` for the page and board surface, `bg-elevated` for sheets.
- **Do** compose pages with type and space: a display heading and a gap before a box, a line or a tint.
- **Do** ask small questions in place, and offer undo for anything reversible.
- **Do** aim for WCAG 2.2 AA (text 4.5:1, non-text 3:1); `tests/e2e/a11y.spec.ts` checks it.
- **Do** use Phosphor icons (`ph:` / `i-ph-*`).

### Don't:
- **Don't** use raw Tailwind palette classes (`text-gray-600`, `bg-red-500`) or arbitrary hex/px values; ESLint warns on them.
- **Don't** use ink for more than one filled element per view, or status colours for emphasis. The app bar uses no ink fill on any width (the selected place is a raised white chip), so it never adds a second filled element next to the Erledigt CTA or a primary button.
- **Don't** add confirmation dialogs for reversible actions, or a dialog for a question that belongs to one card.
- **Don't** nest cards, stack modals, or add toolbars to the board. The global app bar is navigation, not a board toolbar; the board itself carries no controls of its own.
- **Don't** animate for decoration (the completion celebration is the one exception, see "Earned celebration"), loop, or run board transitions during a drag.
- **Don't** set body text in the display role (600) or add a second display typeface.
