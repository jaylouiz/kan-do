# Redesign gap audit (step 1 of the redesign plan)

What the inventory of step 0 (epic kd#58, `docs/design/ui-kit-audit.md`) did not look at: whether the foundations are good, which variants only survived because nothing was allowed to look different, how the interactive states behave as a system, and what was added since. It changes no code. Plan: `docs/design/redesign-plan.md`.

- **Audited commit:** `474da833` (`main`), 2026-11-11.
- **Method:** a throwaway Playwright script (not committed) read the computed styles of every visible element on `/ui?v=all` (inside the samples only, 98 components) and on ten screens (board with the demo and the local seed, task sheet, end-of-day dialog, settings, topics, sources, statistics, trash, welcome), each at 1280 × 800 and 390 × 844, against `nuxt dev`. For the mechanics it took the interactive elements of every sample (609 elements) and forced `:hover`, `:active` and `:focus-visible` through the browser's debugging protocol, so no click or drag was fired. Variant counts come from the templates (`components/`, `pages/`, `layouts/`, `app.vue`, without `pages/ui.vue`).
- **Limits:** counts are elements, so a list of 20 cards weighs 20 times; "screens" means the ten screens above, not every state of the app. `/ui?v=all` shows the whole theme of a library component, so a value seen only there is marked "theme only". A state that script sets (a class on `mouseenter`), a state of a parent (`group-hover`) and anything that moves (drag, the add slot, sheet transitions) is not in the mechanics matrix: those need the running app. `TaskCard` has no interactive element of its own in its samples; its hover is read from the tokens.
- **Reference links** are Mobbin screens (evidence of how shipped products solve the same job, never a look to copy).

## Summary

1. **The token scales are sound but the app uses about twice as many values as the scales name.** 12 font sizes on the ten screens, 13 line-height ratios (the rule in `DESIGN.md` allows three), 15 padding values, 10 durations and 8 easing curves (the tokens name three and two).
2. **Three focus rings, not one.** `DESIGN.md` says "a solid 2px ink ring with an offset on every control". 26 of the 63 measured components show it; about 40 show Nuxt UI's 3 px halo at 25 % of the role colour without an offset (every ghost, soft, subtle, link and outline button, every input, select, checkbox and switch); 4 show the browser's default; 5 show nothing.
3. **Pressed is the same as hover almost everywhere.** Only `ChoiceChip` answers a press (it shrinks to 97 %). The cursor is split too: Nuxt UI controls keep the arrow, hand-built ones show the hand.
4. **Disabled has five looks**, from 50 % opacity to no change at all (`PropertyValueTrigger` and `DatePickerField` look and react as if enabled).
5. **The task sheet's value column mixes two affordances and five control heights** (grey filled selects at 36 px beside dotted-rule values at 32, 34, 38 and 40 px).
6. **The merge candidates of part 2** would remove about 15 variants and 4 components once looks may change; the largest are the button size ladder, `ListRow` density, the `ChoiceChip` shapes and the field heights.
7. **Since step 0:** 9 components added, 4 deleted; all 9 went through the Pattern check with a recorded line.

## Part 1: foundations as used

"Screens" is the number of elements on the ten desktop screens; a value seen only in the `/ui` samples has 0.

### Type

One family (Figtree) everywhere; three weights (400, 500, 600). Sizes:

| Size | Token | Screens | Used for | Finding |
|---|---|---|---|---|
| 8 px | none (`text-[0.5rem]`, allowlisted) | 0 | badge `xs` | below any readable size; `/ui` samples only (`CustomPropertiesStep`, `TaskPriorityBadge`) |
| 10 px | none | 0 | `UKbd` `sm` | theme only |
| 11 px | `--text-label` | 58 | badges, chips, counts | three line heights (11, 12, 16 px) |
| 12 px | `--text-xs` | 21 | property labels, hints | 11 and 12 do one job (small label); on a phone both are 12 |
| 14 px | `--text-sm` (body) | 140 | body, buttons, rows | **six line heights** (14, 16, 18.2, 20, 21, 21.7 px) |
| 15 px | `--text-title` | 36 | card title | one pixel between body (14), title (15) and page copy (16) |
| 16 px | `--text-base` | 15 | settings and statistics copy, phone fields | the same sentence role as 14 px, on other pages |
| 18 px | `--text-lg`, `--text-brand` | 13 | wordmark, dialog title, welcome | three weights and three line heights |
| 20 px | `--text-xl` | 1 | `PageHeader` title | one use; 20, 22 and 24 are three heading sizes two pixels apart |
| 22 px | `--text-headline` | 8 | section headings | two line heights (1.15 and 1.4) |
| 24 px | `--text-2xl` | 2 | sheet title (400), statistics figure (600) | |
| 30 px | `--text-3xl` | 1 | statistics verdict | one use |
| 36 px | `--text-display` | 21 | column names, welcome | |
| 48 px | `--text-5xl` | 2 | statistics verdict, welcome | |

- **Line heights:** 13 ratios are rendered (1.0, 1.09, 1.14, 1.15, 1.25, 1.3, 1.33, 1.4, 1.43, 1.45, 1.5, 1.55, 1.56). "The Three Line-Heights Rule" names 1.15, 1.3 and 1.55. The other ten come from Tailwind's built-in pairings (`text-sm` brings 20 px, `text-xs` 16 px), which most components use unchanged. The rule describes three roles, not what is rendered.
- **Tracking:** eight negative values, all on display sizes; `tracking-display` (-0.015em) gives five of them, the sheet title (-0.6 px at 24 px), `PageHeader` (-0.5 px at 20 px) and the dialog title (-0.45 px at 18 px) write their own.
- **Phone:** the "mobile step" works as described (11 → 12, 14 → 15, 15 → 16) and adds 15 px as a body size that desktop does not have.

### Spacing

Tailwind's 4 px grid is the scale; there is no spacing token.

| Value | Padding (screens) | Gap (screens) | Finding |
|---|---|---|---|
| 2 px | 78 | 0 | half step |
| 4 px | 122 | 76 | |
| 6 px | 104 | 73 | half step, used as often as 8 px for the same job (icon to label, chip padding) |
| 7 px | 30 | 0 | off the grid: `TaskCard`, `TaskProgressChip` |
| 8 px | 68 | 104 | |
| 10 px | 48 | 0 | half step, next to 12 px |
| 12 px | 256 | 26 | the most used padding |
| 14 px | 44 | 0 | half step (`UTable`, `URadioGroup`, nav) |
| 16 px | 52 | 21 | |
| 20 px | 4 | 2 | nearly unused |
| 24 px | 25 | 3 | |
| 28, 32, 36, 40 px | 16, 10, 18, 42 | 0, 1, 0, 1 | page and tile insets |

Fifteen padding values; every half step between 2 and 14 px is in use, so the effective grid is 2 px. The pairs 6 / 8 and 10 / 12 do the same job in different components.

### Control height (density)

| Height | Desktop screens | Where |
|---|---|---|
| 24 px | 0 | `UButton` `xs`, alert actions |
| 28 px | 17 | `UButton` `sm` (rows, cards, triage) |
| 32 px | 41 | `UButton` `md`, tabs, nav links, `PropertyValueTrigger`, `MinutesField`, `UInput` `md` |
| 34 / 38 px | sheet | `InlineEditable` (rule / fill) |
| 36 px | 19 | `UButton` `lg`, `USelect` `lg`, `TaskPropertySelect` |
| 40 px | 0 | `DatePickerField` trigger, `UInput` `xl` |
| 44 px | 1 | `ListRow` action, `StatsTile` toggle |

The three button sizes in use sit 4 px apart (28, 32, 36), which reads as inconsistency more than as hierarchy. The label/value rows of the task sheet hold controls of 32, 34, 36, 38 and 40 px. On a phone the 44 px floor works: every control on the ten screens is 44, 48 or 52 px.

### Radius

`--ui-radius` is 0.5rem (the comment above it in `assets/css/main.css:131` still says 0.75rem). The scale it drives: 4, 8, 12, 16, 24, 32, 48 px, plus the pill and the circle.

| Value | Screens | Used for | Finding |
|---|---|---|---|
| 4 px | 0 | `StatsRhythmGrid` cells | one component |
| 6 px | 0 | `TopicEditor` | off the scale, one element |
| 8 px | 84 | badges, chips, small buttons, checkboxes | |
| 12 px | 18 | buttons, inputs, selects | |
| 15 px | 8 | inside `TaskCard` | off the scale (the card radius minus its edge) |
| 16 px | 49 | cards, notes, tabs list | |
| 24 / 32 px | 3 | welcome only | two steps for one screen |
| 48 px | 6 | statistics surfaces | far from the 16 px of a card; the two "sheet" kinds do not look related |
| pill | 43 | nav, stack pill, choice chips, switches | written two ways (`9999px` by hand, Tailwind's `rounded-full`) |
| circle | 114 | dots, marks, swatches | |

### Elevation

Eight shadow tokens in `main.css` (card rest, hover, drag, lifted, two for stacks, sheet, overlay). Rendered beside them, from Tailwind's scale:

| Shadow | Where | Covered by "The Only Cards Float Rule"? |
|---|---|---|
| `shadow-xs` | `StatsTile`, the statistics verdict surface | no |
| `shadow-sm` | `UTabs` indicator; the nav pill (named exception) | tabs: no |
| `shadow-md` | the end-of-day button under Erledigt (`components/board/Board.vue:92`); the phone bar (named exception) | button: no |
| `shadow-lg` | `USwitch` thumb, the welcome sheet | no |

Two shadow colours are in use: the custom tokens cast a cool slate (`rgba(15, 23, 42, …)`), Tailwind's cast black. On a warm paper palette the cool slate is a choice worth revisiting with the direction of kd#1 ("warmer").

### Motion

Tokens: `--duration-fast` 150 ms, `--duration-base` 200 ms, `--duration-slow` 300 ms, `--ease-standard`, `--ease-emphasized`. Rendered on the screens:

| Duration | Easing | Screens | Where |
|---|---|---|---|
| 120 ms | standard | 4 | add slot reveal |
| 150 ms | standard | 82 | Nuxt UI controls |
| 150 ms | `ease` (no token) | 64 | the dotted rule of property values, the nav |
| 150 ms | emphasized | 12 | card |
| 160 ms | emphasized / standard | 76 | card transform, add slot grow |
| 180 ms | standard | 4 | Yesterday note |
| 200 ms | emphasized | 78 | card, washes |
| 200 ms | standard / `ease` / `ease-out` / Tailwind `ease-out` | 54 | sheet, switch, tabs, progress chip |
| 240 ms | `ease-in-out` | 19 | progress chip |
| 300 ms | `ease` / `ease-in-out` | 38 | progress chip |
| 500 ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 16 | column header |
| 600 / 700 ms | emphasized, a spring (`linear(…)`) | 133 | progress chip, card internals |

Ten durations and eight curves; `/ui` adds 220 and 280 ms and a ninth curve (`TaskStack`, `TaskDeletedGap`, `RecapDeck`). Pairs that do one job with two numbers: 150 / 160 ms (a control changes colour, a card changes transform), 200 / 220 / 240 ms (a surface fades or moves), `ease-standard` / plain `ease` at 150 ms. Step 0 kept these on purpose ("motion unchanged"); the redesign can fold them into the three tokens. Twenty-three interactive components have no transition at all on their own state change (among them `ListRow`, `StatsTile`, `SwatchRadioGroup`, `InlineEditable` fill, `ChoiceChip` row, `ExternalLink`), so hover snaps there and eases elsewhere.

### Icons and borders

- **Icon size:** the documented scale is 12 / 16 / 20 / 24 px. Rendered on the screens: 16 (50), 20 (31), 12 (16), **13 (15)**, 14 (4), **17 (4)**, 18 (4), 24 (2). The 13 and 17 px icons are sized in `em` inside `TaskCard` and `TaskProgressChip`.
- **Borders:** 1 px solid hairlines carry nearly everything. A dotted 1 px rule means "editable value" (`MinutesField`, property values), a dashed 1 px outline means "opens a search" (`ChoiceChip` `field`), 2 px solid is the switch track and the swatch ring.

## Part 2: variants that survived only because nothing could change

Per user job: what exists now, how often it is used, and what could merge once looks may change. "Merge" is a candidate for step 3 and step 4 to confirm, not a decision.

| User job | Exists today (uses) | Could merge | Removes |
|---|---|---|---|
| Trigger an action | `UButton`: variants ghost 48, soft 44, solid 20, link 8, subtle 1 (outline 0); sizes `md` 64, `sm` 35, `lg` 22, `xs` 1 at 32 / 28 / 36 / 24 px | Two sizes instead of three (a regular one and the primary action of a surface); `subtle` (one use, the topic editor's symbol trigger) into soft once soft has an edge on white; decide whether neutral soft and neutral ghost stay two looks (they differ only at rest and are used equally often, with no rule a reader can see) | 1 size, 1 to 2 variants |
| Show a list row | `ListRow`: density roomy 1, cozy 2, compact 2; hover text 4, surface 1. Outside it: `SettingsSubpageLink`, `MorePanel` rows, `DayCloseTaskRow`, `TrashEntryRow`, `CustomPropertiesStep`, `StatsWeekTable` | One density (the three only copy what each site had); one hover; `SettingsSubpageLink` becomes a `ListRow` action row; `DayCloseTaskRow` takes the row once its look may change | 2 densities, 1 hover mode, 1 to 2 components |
| Pick one of a few | `ChoiceChip`: pill 3, row 2, icon 2, chip 1, plus `field` and `large`; `UButton` soft with `aria-pressed` (board menu); `UTabs` pill 1; `URadioGroup` 1; radio cards on `reka-ui` (`LocalSetupFlow`); the welcome choice card; `SwatchRadioGroup` | `pill` and `chip` are one shape at two heights; `icon` is that shape made square; `row` is a menu row and could be the select menu's item; the board menu's pressed buttons become the chip; the two card pickers (`LocalSetupFlow`, welcome) become one | 2 to 3 shapes, 1 hand-built radio group |
| Edit a value in a label/value row | `PropertyValueTrigger` (4 tones), `InlineEditable` (fill, rule), `TaskPropertySelect` (filled, plain), `MinutesField`, `DatePickerField`; heights 32 to 40 px | One row height and one affordance: today a list value is a grey filled box and a free value is text on a dotted rule, side by side (the rule "Choice chip or property value" in `DESIGN.md` describes the split; it exists because the two were built at different times). `InlineEditable` `rule` is the common affordance (3 of 5 uses) | 1 affordance, 4 heights, 1 variant |
| Type into a field | `UInput`: `sm` 8, `md` 7, `lg` 1, `xl` 1; `USelect` `lg` 22, default 2; `USelectMenu` `lg` 1, `md` 1; `UTextarea` | One field height for forms (today 28, 32, 36 and 40 px; a select beside an input is 4 px taller) and one for the title field | 2 to 3 sizes |
| Tell the user something | `UAlert` subtle 27 (error 14, warning 7, info 1); toasts; field errors; `EmptyNote` 5, `EmptyState` 1 | Nothing: one variant, two levels of empty state with a written boundary. This family is done | 0 |
| Ask in a dialog | `AppDialog` `sm` 6, `md` 2, `lg` 2; `ResponsiveOverlay` 3; `TaskDetailModal` (statistics only) | `TaskDetailModal` goes with the parked layout decision U7; widths stay | 1 component |
| Show a small status or count | `UBadge` neutral subtle 2, soft 1 (sizes `xs`, `sm`); `TaskPriorityBadge` with five sizes; `TaskStackPill`; `TaskProgressChip` | One badge size (the 8 px text of `xs` goes); `TaskPriorityBadge` keeps one or two sizes; soft and subtle badges become one | 3 to 4 sizes, 1 variant |
| Head a section | `SectionHeader` 5 (every use is `h3`, the `tag` prop offers seven); the `section-heading` utility (13 uses at step 0); `PageHeader`; about ten hand-written `font-display` strings at other sizes | One heading component for section and page level, with the three heading sizes (20 / 22 / 24) folded into the type scale | 1 implementation, 1 to 2 sizes |
| Open and close a part | `UCollapsible` 1, the `StatsTile` toggle, the Yesterday note toggle, `ListRow` action with `expanded`, the stack header | One disclosure affordance (same caret, same motion); the components stay | 0 components, 3 looks |
| Switch a view | `UTabs` default 4, pill 1 | Nothing | 0 |
| Hold content as a surface | `TaskCard` (16 px radius, card shadow), `StatsTile` in two tones (48 px radius, `shadow-xs` or a ring), the welcome sheet (24 px, `shadow-lg`) | One surface language: today three unrelated radii and shadows mean "a sheet" | 1 tone |

**How shipped products solve these jobs with one pattern** (Mobbin, web):

- List rows with trailing actions: [Gorgias](https://mobbin.com/screens/605ee156-4f7e-453e-8a7c-471d6b0cf43e), [LangChain](https://mobbin.com/screens/d512431c-3359-4c1e-b4cf-7d0aa2516208) and [Navattic](https://mobbin.com/screens/862c7e14-a978-4f6d-a788-4a9ade78f94f) each use one row height on a hairline with icon actions at the right edge; [Airwallex](https://mobbin.com/screens/20f6cf65-6657-48c5-8ab9-448a58540679) uses the same row to open a side panel. None has a density choice per list.
- Picking a value while adding a task: [Todoist](https://mobbin.com/screens/97edbdf7-2860-4176-9cb8-946b6d886b2a), [Plane](https://mobbin.com/screens/92c84c1b-1c84-4c21-9849-5649c44cb190) and [Lightfield](https://mobbin.com/screens/ba1a986c-df3c-4fa7-a4bb-c3df378280c5) use one chip shape for every property, whatever it opens; [hilos](https://mobbin.com/screens/e7b6ea97-08de-45ec-a286-93627d3beda4) uses one bordered select for every list value and a segmented control only for the two-way kind switch. In each product a value control has one height and one affordance.
- Notices: [Airtable](https://mobbin.com/screens/19d3eae7-6f69-4a81-b993-3be2c3ca5b80) shows two roles in one tinted banner shape; [Relevance AI](https://mobbin.com/screens/81a7a885-8320-40a1-85cc-7550a28ce34b) pairs an inline warning with a toast for the failed action; [Aboard](https://mobbin.com/screens/151318f3-efd8-46e2-b7cc-d8c46f8ab322) puts the action inside the inline notice. kan-do's alert, toast and field error split matches this.
- Empty lists: [Midday](https://mobbin.com/screens/59af3e57-871e-4849-9e2a-af161e4730d4) and [AirOps](https://mobbin.com/screens/8a1d512c-3bdb-4a9d-8274-8ee239f0cc7e) use a sentence and a subline, [Whop](https://mobbin.com/screens/a2f0b4e1-71f9-451c-bf14-c0c79ff7afce) and [Base44](https://mobbin.com/screens/63fab4cd-9788-4dc0-8afa-8e5c5aaf3688) add a small icon, [Linear](https://mobbin.com/screens/5cc1bd35-b393-4c63-9b86-280b982247e0) an illustration and actions. kan-do's two levels (`EmptyNote`, `EmptyState`) sit inside this range; all five centre the block, kan-do left-aligns it on purpose.

## Part 3: mechanics matrix

Computed on the first interactive elements of every `/ui` sample (desktop). "Components" counts components that show the behaviour on at least one element.

### Focus-visible

> Resolved after this audit (2026-11-11, owner decision): every control now shows Nuxt UI's halo; the 2 px ink ring is gone. The table below is the state that was measured.

| Ring | Components | Which |
|---|---|---|
| 2 px solid ink, 2 px offset (the rule in `DESIGN.md`) | 26 | solid `UButton`, `UTabs`, `TaskPropertySelect`, `USelectMenu` `soft` and `property`, and everything hand-built with `focus-ring`: `ChoiceChip` (pill, chip, icon), `PropertyValueTrigger`, `InlineEditable`, `MinutesField`, `SwatchRadioGroup`, `ListRow`, `StatsTile`, `AddTaskSlot`, `SettingsSubpageLink`, `DatePickerField` |
| 3 px at 25 % of the role colour, no offset (Nuxt UI's default) | 26 | `UButton` ghost, soft, subtle and link (101 of 123 button tags), `USwitch`, `ULink`, and every component that uses those buttons |
| the same plus a 1 px inset ring | 23 | `UInput`, `USelect`, `UTextarea`, `UCheckbox`, `URadioGroup` list, `UButton` outline and subtle |
| the browser's default (`outline: auto`) | 4 | `ChoiceChip` `row` (and so `NewCardOptionList`), `ExternalLink`, a link in `TokenStep` |
| none on the element | 5 | `UInput` and `USelectMenu` variant `none`, `URadioGroup` card and table (the ring may sit on the card), the collapsed `TaskStack` control |

The 25 % halo of the neutral role on the paper background comes to about 1.6:1 (calculated from the two colours, not measured), below the 3:1 a focus indicator needs; `app.config.ts` fixes it for the solid button only (`app.config.ts:331`), the comment at `:284` names the cause (Nuxt UI's own compound variants merge in after the plain variant).

### Hover and pressed

| Hover answer | Components | Which |
|---|---|---|
| background one step darker | 37 | every `UButton` variant except link, selects, `ChoiceChip` row, nav rows, `SettingsSubpageLink` |
| nothing on the element | 31 | checkbox, switch, radio, text inputs, `ListRow` action (its `hover:text-highlighted` does not show when the children set their own colour), `StatsTile` toggle, `SwatchRadioGroup`, `InlineEditable` fill, `ExternalLink`, `UTabs` |
| underline colour darkens | 7 | property values (`PropertyValueTrigger`, `InlineEditable` rule, `DatePickerField`, `TaskPropertySelect` plain) |
| text colour | 5 | link buttons, `ULink` |
| fills with ink, text inverts | 4 | `ChoiceChip` pill, chip, icon |
| border colour | 1 | the radio cards of `LocalSetupFlow` |

- **Pressed:** 61 of 63 components show exactly their hover state while pressed. `ChoiceChip` scales to 0.97; `TaskDetailMetadata`'s trigger changes background only when pressed.
- **Cursor:** the arrow on every Nuxt UI control (`UButton`, tabs, selects, checkbox, switch) and on `ListRow` and `StatsTile`; the hand on hand-built controls (`ChoiceChip`, `PropertyValueTrigger`, `InlineEditable`, `SwatchRadioGroup`, `AddTaskSlot`, `TaskStackHeader`) and on `USelectMenu` `soft` and `property`. Two buttons next to each other can differ.
- **Transition on the state change:** 150 ms `ease-standard` on 40 components (Nuxt UI), none on 23, 150 ms plain `ease` on 7 (the dotted rule), 120 ms on 4, 200 ms on `USwitch`.
- **`TaskCard`** (from the tokens): hover swaps `--shadow-task` for `--shadow-task-hover` over 160 ms `ease-emphasized`; nothing else in the kit answers hover with a shadow, which fits "cards are the only lifted objects".

### Disabled, loading, selected

| State | Look | Components |
|---|---|---|
| Disabled | opacity 0.75, `not-allowed` | `UButton`, `USelectMenu`, `TaskPropertySelect` |
| Disabled | opacity 0.5, `not-allowed` | `ChoiceChip` |
| Disabled | grey fill, full opacity, `not-allowed` | `UInput`, `UTextarea` |
| Disabled | `not-allowed` only, no visible change on the control element (a wrapper may dim it) | `USelect`, `USwitch`, `UCheckbox`, `URadioGroup` |
| Disabled | no change at all: hand cursor, hover still answers | `PropertyValueTrigger`, `DatePickerField` |
| Loading | the disabled look plus a 1 s linear spinner | `UButton`, `USwitch` |
| Loading | spinner only, the control stays live | `UInput`, `USelect`, `USelectMenu` |
| Selected | filled with ink or the role colour | `ChoiceChip` picked, `USwitch` on, checkbox, radio |
| Selected | 2 px inset ring | `SwatchRadioGroup` |
| Selected | weight 600 and `aria-current` | `ChoiceChip` row, `PropertyValueTrigger` picked |
| Selected | a moving indicator with `shadow-sm` | `UTabs` |
| Expanded | nothing on the trigger but `aria-expanded` (the caret turns) | `ListRow` action, `StatsTile`, `UCollapsible` |

### Keyboard

| Control | Element | Behaviour |
|---|---|---|
| `UButton`, `ChoiceChip`, `PropertyValueTrigger`, `ListRow` action, `StatsTile` toggle, `AddTaskSlot` | native `<button>` | Tab, Enter, Space |
| `UTabs`, `URadioGroup`, `LocalSetupFlow` cards | `reka-ui` | one tab stop, arrow keys move |
| `SwatchRadioGroup` | hand-built `role="radio"` | roving tabindex and arrow keys (`utils/radioArrowKeys`), rows in the symbol grid |
| `USelect`, `USelectMenu`, `TaskPropertySelect` | `reka-ui` combobox or button | Enter or Space opens, arrows move, type-ahead |
| `InlineEditable` | `div[role="button"]` | Tab, Enter starts editing |
| collapsed `TaskStack` | `span[role="button"][tabindex="0"]` | focusable, **no visible focus on the element itself** |
| `ExternalLink`, `SettingsSubpageLink` | `<a>` | Tab, Enter |

### Where two primitives answer the same state differently

1. Focus: three rings (2 px ink, 3 px halo, browser default) and five controls without one. A ghost button beside a solid button in the same dialog footer shows two different rings.
2. Hover on a text-style control: a background step (`UButton` ghost), an underline (`PropertyValueTrigger`), a text colour (`UButton` link), nothing (`ListRow` action, `ExternalLink`).
3. Press: one component gives feedback, the rest none.
4. Cursor: arrow or hand depending on who built the control.
5. Disabled: five looks, two of them not recognisable as disabled.
6. Easing: a hover eases in 40 components and snaps in 23.
7. Loading: sometimes locks the control, sometimes not.

## Part 4: delta since step 0

Component files: 105 at `2a511228`, 110 now (9 added, 4 deleted). The deleted four are the dead ones the audit named (`TaskProgressBar`, `TaskTimebox`, `TaskTimer`, `ExpandingButton`).

| Added | PR | Pattern line in the PR | Outcome |
|---|---|---|---|
| `ListRow` | #101 | yes | aligned with `SourceRow`; the action row is new |
| `EmptyNote` | #99 | yes | new, replaced seven hand-written copies |
| `ChoiceChip` | #113 | yes | new, merged four hand-built looks |
| `PropertyValueTrigger` | #113 | yes | new, four raw buttons share it |
| `SwatchRadioGroup` | #113 | yes | new (`URadioGroup` takes labelled options only) |
| `AppDialog` | #139 | yes | a wrapper over the existing `UModal` pattern |
| `MinutesField` | #140 | yes | new, from three identical call sites |
| `MiddleEllipsis` | #149 | yes | new, no existing pattern |
| `EmptyState` | #151 | yes | aligned with `EmptyNote` (icon and subline for a page) |

Every addition has a recorded Pattern decision; seven of the nine are merges that removed copies. Two things the check did not catch, because it compares jobs and not states: none of the nine PRs compared the new primitive's focus, hover, pressed and disabled answers with its neighbours (part 3 is the result), and `ListRow`, `ChoiceChip` and `PropertyValueTrigger` each kept the geometry "each site had" as variants (part 2).

Usage also moved since the audit: `UAlert` 9 → 27 tags (the plain coloured lines are gone), `UButton` 146 → 123 tags by this audit's count, and the default button size is now `md` (64 uses) where the audit counted `sm` 53 and `lg` 50.

## Input for the next steps

**Step 2 (rule review):** rules that this audit shows as not matching what is rendered, to label "challenged" or "enforced".

| Rule in `DESIGN.md` | Evidence |
|---|---|
| Focus: "a solid 2px ink ring with an offset on every control" | holds for 26 of the 63 measured components (part 3) |
| The Three Line-Heights Rule | 13 ratios rendered (part 1, type) |
| The Only Cards Float Rule | `StatsTile`, the end-of-day button, the welcome sheet and the tabs indicator carry shadows outside the named exceptions |
| Buttons: the size ladder | three sizes 4 px apart; the ladder is followed, the question is whether it is worth three steps |
| "Choice chip or property value" | documents two affordances for editing one kind of thing (part 2) |
| Shapes: "one base" | 48 px statistics surfaces, 24 and 32 px on welcome, 6 and 15 px one-offs |

**Step 3 (direction):** each interpretation of the brief should state, as part 2 asks, which merge candidates it takes; and should propose one state language (focus ring, hover, press, disabled, cursor, one easing) since today's is the sum of two (Nuxt UI's defaults and the hand-built controls).

**Step 4 (system):** candidates for the closed scales: type 8 sizes (11 or 12, 14, 16, 18, 22, 36, 48 plus the card title) instead of 14; three line heights that are actually applied; a 4 px spacing grid with 2 and 6 as the only half steps; two control heights; radius 8 / 12 / 16 plus pill and circle; the three durations and two curves that exist as tokens.

## Small things found on the way

- `assets/css/main.css:131`: the comment says the radius baseline is 0.75rem, the value is 0.5rem.
- The pill radius is written as `9999px` by hand and as Tailwind's `rounded-full`; both render the same.
- Disabled `PropertyValueTrigger` and `DatePickerField` keep the hand cursor and the hover answer.

## Step 2: rule review of `DESIGN.md`

Every rule and paragraph of `DESIGN.md` (373 lines at commit `71abce60`, 2026-11-11) with a label of the plan's table, the evidence, and what step 4 does with it. Nothing in `DESIGN.md` is changed by this step. Line numbers are those of `DESIGN.md`.

- **Labels:** principle (stays), foundation (stays as a table), pattern (one line and a pointer to `/ui`), component detail (moves to the component's doc block or its CSS comment), enforced (prose goes, the guard is named once), challenged (the owner decides). "Duplicate" means the same rule is already stated in another section and is counted there.
- **Evidence** is the gap audit above (parts 1 to 3), the guard tests in `tests/config/`, ESLint, `tests/e2e/a11y.spec.ts`, and for the challenged rules the owner's decision on kd#1 (`## UX decision`, 2026-11-11) and the chosen prototype (`assets/css/proto.css` on `proto/1-visual-redesign`, commit `15b65260`).

### Result in short

1. **Well over half of the body can go or move.** Of the 257 lines below the frontmatter, roughly 95 are component detail (they describe one component and belong in its doc block), 35 are enforced by a test or lint rule, and 30 repeat a rule that is stated elsewhere in the file (an estimate by paragraph, not a count by line). The whole "Do's and Don'ts" section (18 lines) is duplicates and enforced lines.
2. **Seventeen rules are challenged.** Thirteen are already answered by the owner's direction decision of 2026-11-11 and only need rewriting in step 4. Four needed the owner's word in this step and have it (below). Three more are already in the plan's open questions and are due at the start of step 4.
3. **Five rules are stated but nothing checks them** (the three line heights, the icon size scale, one `lg` button per surface, one filled primary per view, "the selected place is the route"). Step 6 gives each a guard, or step 4 drops it.
4. **The frontmatter (116 lines) repeats token values of `assets/css/main.css` and `app.config.ts`** and has drifted from them: it gives buttons an 8 px radius and badges a 4 px one, where 12 and 8 px are rendered (part 1, radius). Step 4 first checks what the Impeccable detector reads from the frontmatter, then keeps only that.

### Labels per section

**Overview (lines 122 to 136)**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| Creative North Star "The Quiet Desk" | principle, challenged (decided) | The direction is now Paper Desk: a calm canvas, lifted sheets, depth and contrast. "Calm comes from restraint" stays true; "flat" and "one ink accent" do not | rewritten for Paper Desk from the seven principles of the brief on kd#1 |
| References: Airbnb; Trello and Notion as anti-references | principle | Owner, 2026-11-11: Airbnb stays, Slack joins the anti-references | stays, Slack added (also in `PRODUCT.md`) |
| "Warm paper page, bright card sheets, one quiet ink accent" | principle, challenged (decided) | green accent, hue 152 | reworded |
| "One typeface; type and space compose the page, not boxes, lines or fills" | principle, challenged (decided) | Fraunces for headings; input areas on sheets | reworded |
| "Flat by default; shadows only on things you can pick up" | principle, challenged (decided) | every lifted surface is a sheet with the warm shadow | reworded |
| "Questions are asked in place; reversible actions act at once and offer undo" | duplicate of Behaviour | – | removed here |
| "Motion is small and physical and explains a state change" | duplicate of Behaviour, Motion | – | removed here |
| "Light only for now" | principle | `colorMode: false` | stays |

**Colors (lines 138 to 177)**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| Primary: Desk Ink, Deep Ink, Ink Wash | foundation, challenged (decided) | the primary is the forest green (hue 152), locked by the owner | table row with the new ramp |
| Warning Orange | foundation | unchanged by the direction | table row |
| Done Teal | foundation, challenged (decided) | Owner: done may use the accent green. The prototype maps the whole `success` ramp onto the primary | removed; done is the accent. The list of places (check, drop wash, in-card confirmation, Yesterday note) is component detail |
| Raspberry | foundation | "red for exceptions" (rule proposal 2) | table row |
| Focus Dusk | component detail | one use: the Jetzt focus overlay and its card shadow | comment at the token |
| Topic marks: nine hues | foundation, enforced | `tests/config/topic-tokens.test.ts` holds 3:1 per hue | one line and the guard; Notion's mapping is component detail |
| Topic marks: "Known collision, accepted" | component detail (a recorded decision) | new: the topic green now also meets the accent green, the topic yellow the marker | the record grows by these two; the hues are retuned on the white sheet in step 4 (the guard keeps 3:1) |
| Neutral: Paper, Sheet, Rule Line, Pencil, Graphite, Ink Black | foundation, challenged (decided) | warm ramp (hue 84), white sheets, near-black text | table with the new values |
| The One Lamp Rule | principle, **challenged (asked)** | see "Asked in this step", 1 | per the answer |
| The Status Is Not Decoration Rule | principle, challenged (decided) | "teal means done" no longer holds; orange and red keep their meaning; brand colours of integrations stay out | reworded: green is action and done, orange attention, red destructive or failed |
| The Topic Mark Rule | pattern | holds in the code, no guard | one line, pointer to `/ui` |
| The Frozen Primary Rule | principle (process) | the owner's decision of 2026-11-11 is the recorded decision the rule asks for; `CLAUDE.md` states the rule too | stays, frozen on the green; stated once |
| The Receding Text Rule | principle, partly enforced | `tests/e2e/a11y.spec.ts` checks the contrast and names the two exemptions. Open defect, not a rule question: the waiting card's greyscale reads cool on the warm canvas (kd#1, "Known issues") | stays as one sentence; the exemptions live in the test |

**Typography (lines 179 to 198)**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| Display Font, Body Font, Mono, Character ("one friendly geometric sans … not a second typeface") | foundation, challenged (decided) | Fraunces 500 in the display and headline roles, Figtree for everything read and operated | rewritten |
| Hierarchy: Display, Headline, Title, Body, Label, Mobile step | foundation | part 1: 12 sizes on the screens against 8 roles; 20, 22 and 24 px headings two pixels apart; 14, 15 and 16 px one pixel apart | a table of the closed scale (the audit's candidate: eight sizes) |
| Display: "column names (always `text-muted`, centred)" and "statistics key figures" | foundation, challenged (decided) | column names are in ink; numerals stay in the sans (`proto.css`: "a serif figure in a table of minutes reads as decoration") | reworded |
| Headline: section headings, modal titles "a notch smaller" | foundation, challenged (due at step 4) | the page title scale, open question 1 of the plan | per the answer |
| The One Role Rule | principle, challenged (decided in part) | the rule now carries the serif; "and numerals" leaves it | stays, reworded: the display face is for headings only |
| The Three Line-Heights Rule | foundation, **challenged (asked)** | see "Asked in this step", 2 | per the answer |

**Layout (lines 200 to 209)**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| "Type and space compose every page … lines, boxes and tints do not" | principle, challenged (decided) | rule proposal 4: input areas on lifted sheets, one level | replaced by "sheets on a desk, one level" |
| "No card in a card" | principle | kept by the decision ("never a sheet on a sheet") | stays, inside the new rule |
| Board (desktop) | pattern | columns and card size are in the code; "the Jetzt slot is always one card tall" is the part a reader cannot see | one line |
| Board (mobile) | component detail | `.claude/rules/mobile-board.md` already holds it | removed here |
| Stacks | component detail | `TaskStack` doc block, `.claude/rules/drag-and-drop.md` | moves; one pattern line stays: "no lines, boxes or tints around a group" |
| Chrome: one global app bar, no board toolbar, no back arrow | pattern | holds for the pages the bar leads to; since #236 a flow step and a settings sub-page have the one `BackButton` (owner decision 2026-11-13) | one line |
| Page offsets | component detail | `assets/css/app-nav.css` is "the one place" by the paragraph's own words | removed here |
| Pages: "one flat, readable column"; "Statistik is the exception" | pattern, challenged (decided) | settings sections and statistics tiles become sheets, so the exception becomes the normal case | reworded as one pattern for every page |

**Elevation and Shapes (lines 211 to 225)**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| "Hybrid: flat paper and flat chrome; cards are the only lifted objects" | principle, challenged (decided) | rule proposal 4 | replaced |
| Shadow Vocabulary | foundation | part 1: eight custom shadow tokens plus four Tailwind shadows, in two shadow colours | a table: one warm shadow colour, one named step per kind of surface |
| The Only Cards Float Rule | principle, challenged (decided), remainder **asked** | every lifted surface is a sheet with the same warm shadow. What a control may do is not decided: see "Asked in this step", 3 | replaced by the sheet rule; the remainder per the answer |
| The Glass Chrome Rule | principle, challenged (decided) | flat white pills, no glass (parked decision U2) | removed; `tests/config/app-nav-glass.test.ts` goes with the glass code in step 5 |
| Shapes: "gently rounded from one base" | foundation, challenged (decided in substance) | part 1: 48 px statistics surfaces, 24 and 32 px on the welcome page, 6 and 15 px one-offs. The decision gives settings sections and statistics tiles one sheet shape. The prototype uses the card radius times 1.25 for page sheets, which would be a second surface radius | a table: 8, 12 and 16 px, pill, circle; step 4 settles whether a page sheet takes the card's radius or its own |
| "No pill-shaped containers", exception: the app bar | pattern | holds | one line |

**Components (lines 227 to 309)**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| Intro: "custom components only for the board domain" | principle, out of date | `components/ui/` holds shared primitives since step 0 | reworded: Nuxt UI first, a shared primitive from three call sites on |
| Buttons, Primary: "at most one per view" | duplicate of The One Lamp Rule | – | removed here |
| Buttons, Focus | foundation (decided 2026-11-11), enforced in part | `button-contrast.test.ts` (no compound overrides the ring), `a11y.spec.ts` (the primary button shows the halo) | two lines: the ring and the accepted trade-off; the rest is a comment at `focus-ring` |
| Buttons, Soft / Ghost | pattern, challenged (due at step 4) | part 2: neutral soft (44 uses) and neutral ghost (48) differ only at rest, "with no rule a reader can see" | joins open question 2 of the plan |
| Buttons, Size ladder (table and rules) | enforced, challenged (due at step 4) | `button-ladder.test.ts` checks every line of the table except "exactly one `lg` per surface". Part 1: three sizes 4 px apart | the prose becomes one line and the guard; the number of steps is open question 2 |
| Buttons, Phones: 44 px (with the measured Nuxt UI internals) | enforced, component detail | `button-ladder.test.ts` (theme floor); the measurements are a record of #552 | one line; the measurements move to the theme comment in `app.config.ts` |
| Chips / Badges | pattern | part 2: soft and subtle badges, five sizes of `TaskPriorityBadge` | one line; "no rainbow labels" is The Topic Mark Rule |
| Task card (five paragraphs) | component detail | doc blocks of `TaskCard`, `TaskProgressChip`, `TaskCarryOverDots` | moves; one pattern line stays: "the Jetzt card is a regular card, focus comes from the board stepping back" (the owner rejected the coloured Jetzt card of Clay Desk) |
| Add task | component detail | `AddTaskSlot` and `NewCardFlow` doc blocks; the paragraph already points there | moves |
| Task sheet: one sheet for details and the add form | pattern | Owner, 2026-11-11: statistics opens the same sheet (parked decision U7); `TaskDetailModal` goes | one line, now without an exception |
| Task sheet: property rows | component detail, part of the challenged "Choice chip or property value" | part 2: five control heights in the rows | moves; the affordance per the answer |
| Dialogs and overlays | enforced, pattern | `design-patterns.test.ts` (no bare `UModal`); `ResponsiveOverlay` | one line and the guard |
| In-card question | pattern | `TaskTimeboxNudge`, `NewCardFlow` | one line |
| Notices and toasts | pattern, enforced in part | part 2: "this family is done". `warning-notices.test.ts`, `role-contrast.test.ts` | one line per kind; the contrast numbers (measured on the old palette) live in the tests |
| Sync status | component detail | `MorePanel`, `AppNav` | moves |
| App bar, Look | component detail, challenged (decided) | flat white pills; values in `app-nav.css` | moves; the glass text is dropped |
| App bar, "Selected state is the route" | pattern, no guard | marked "binding" | one line; a guard in step 6 |
| App bar: Third segment and indicator, Mehr panel, Layering | component detail | `AppNav` doc block, `app-nav.css`, the z-index tokens | moves |
| Statistik surfaces, Grouped surface | pattern, challenged (decided) | the tiles take the sheet of the card (kd#1, "Patterns") | folded into the one sheet rule |
| Statistik surfaces: Disclosure tile, Ink ring | component detail | `StatsTile`, `StatsEstimateRing` doc blocks | moves; one pattern line stays: "charts use the ink ramp only" |
| Tabs | pattern, enforced | `design-patterns.test.ts` (no hand-rolled tabs); the look is the theme | one line and the guard |
| Settings sub-page: header, widths | component detail | `PageHeader`, the sub-page layout | moves |
| Settings sub-page: "hairline-divided rows, no cards" | pattern, challenged (decided) | settings sections become sheets | removed |
| Settings: "Behaviour apart from maintenance" | pattern (adopted 2026-11-06) | holds | stays, one line |
| Inputs / Fields: "disabled inputs get a muted background, not only opacity" | pattern, challenged (decided) | part 3: five disabled looks. The chosen state language has one (50 %) | replaced by the state language |
| Inputs / Fields: "inline editing is the default for task properties" | pattern | holds | one line |
| Behaviour: Ask in place, Optimistic moves, No modal on modal, Quiet notices over interruptions | principle | hold | stay, one line each |
| Behaviour: Undo instead of confirm | principle, component detail | the delete gap's values are in the `TaskDeletedGap` doc block | the principle stays as two lines |
| Behaviour: Motion | principle, foundation, challenged (decided in part, the rest due at step 4) | part 1: ten durations and eight curves against three and two tokens. The chosen state language uses the tokens only, a press gives 3 %, cards lift on hover. "Never during a drag" meets open question 3 of the plan | the principle stays; a table of the three durations and two curves; the count is held by the motion ratchet (`token-literals.test.ts`) |
| Behaviour: Earned celebration | principle (recorded exception, 2026-11-06) | fits principle 1 of the brief ("joyful in the moment") | stays |
| Behaviour: Keyboard | principle, enforced in part | `a11y.spec.ts`; part 3, keyboard table | stays, two lines |

The state language the owner chose (hand cursor on everything pressable, a press gives 3 %, one disabled look, cards lift on hover and set down on press, one easing for a state change) has no home in `DESIGN.md` yet. Step 4 writes it as one foundation table; it answers the seven differences at the end of part 3.

**Usage guidelines (lines 311 to 324)**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| Which icon | enforced | `icon-map.test.ts`, `icons-bundled.test.ts`, `nuxt-ui-icons.test.ts`; the icon sizes are not checked (part 1: 13 and 17 px icons sized in `em`) | one line and the guards; the size scale becomes a foundation row |
| Which button | duplicate of Buttons | – | removed |
| Dialog actions | pattern (convention) | "cancel first, primary last" has no guard | one line under Buttons |
| Destructive action | duplicate of "Undo instead of confirm"; the irreversible half is a pattern | `pages/trash.vue` | one line: an irreversible action confirms in place |
| Open outside vs inside | component detail | `ExternalLink` doc block, `lib/icons.ts` | moves |
| Notice, toast or inline | duplicate of Notices and toasts | – | merged into that one place |
| Empty state | pattern | `EmptyState`, `EmptyNote`; part 2: inside the range of shipped products | one line, pointer to `/ui` |
| Wording of Save, Cancel and Close | duplicate of Voice and copy | `docs/copy/terms.json` | removed |
| Choice chip or property value | pattern, **challenged (asked)** | see "Asked in this step", 4 | per the answer |

**Voice and copy (lines 326 to 350), App icon, Do's and Don'ts**

| Rule or paragraph | Label | Evidence | Step 4 |
|---|---|---|---|
| Voice and copy: Address, Tone, Buttons are verbs, Errors, Failure sentences, No "Bitte", Technical detail, Empty states, Progress, English, Voice, Names and full stops, Characters, Statistik verdicts | principle (copy) | no check can tell these | stay. Proposal for the owner in step 4: the section moves next to its registry (`docs/copy/`), which the `copy-writer` skill reads, and `DESIGN.md` keeps a pointer. That alone is 25 lines |
| Voice and copy: One term per concept, Löschen / Entfernen / Trennen, Task state, Settings / token / time | enforced by the registry | `docs/copy/terms.json` holds each term with the forms to avoid (`delete`, `remove`, `disconnect`, `done-day`, `settings`, `set-up`, `token`, `time-spent`) | prose removed, the registry named once |
| Voice and copy: Case ("No ALL CAPS") | enforced | `design-patterns.test.ts` (no uppercase class) | one line |
| Voice and copy: Plurals, Both languages together | enforced | `npm run i18n:check`, ESLint `no-raw-text` | one line |
| App icon: "Yellow is an icon-only exception, never used in the app UI" | principle, challenged (decided) | Owner, 2026-11-11: the yellow marker is allowed in slight, intentional use; the Jetzt headline is its first use | reworded as the marker rule |
| Do: styling priority, overrides in `app.config.ts`, `bg-page` and `bg-elevated` | duplicate of `CLAUDE.md` "Styling" and the Neutral table | – | removed |
| Do: "compose pages with type and space" | challenged (decided) | rule proposal 4 | removed |
| Do: ask in place and offer undo | duplicate of Behaviour | – | removed |
| Do: WCAG 2.2 AA | principle, enforced | `a11y.spec.ts`, `button-contrast.test.ts`, `role-contrast.test.ts` | one line under the foundations |
| Do: Phosphor icons. Don't: raw palette classes, hex or px values | enforced | ESLint (palette classes, Heroicons), `token-literals.test.ts`, `icons-bundled.test.ts` | removed, the guards are named once |
| Don't: more than one ink fill, confirmation dialogs, nested cards and stacked modals, decorative animation | duplicates of The One Lamp Rule and Behaviour | – | removed |
| Don't: "a second display typeface" | challenged (decided) | Fraunces | removed |

### Challenged rules the owner's direction decision already answers

No question is open on these; step 4 rewrites them. Source: kd#1 `## UX decision` and the answers to the brief (2026-11-11).

| Rule today | What replaces it |
|---|---|
| North Star "The Quiet Desk": flat, one ink accent, one typeface | Paper Desk: a calm warm canvas, white sheets lifted by a warm shadow, near-black text, one green, a serif for headings |
| Desk Ink as the primary; The Frozen Primary Rule | forest green, hue 152; the rule stays and is frozen on the green |
| Done Teal; "teal means done" in The Status Is Not Decoration Rule | done shares the accent green; orange and red keep their meaning |
| One typeface; "Don't add a second display typeface"; numerals in the display role; column names in muted text | Fraunces in the display and headline roles only; numerals and interface text in Figtree; column names in ink |
| "Type and space, not boxes" (Layout, Pages, the settings sub-page, a Do) | everything entered or edited sits on a bright lifted sheet, one level only; "No card in a card" stays |
| The Only Cards Float Rule | one warm shadow scale for every lifted surface (card, page sheet, task sheet, dialog, menu) |
| The Glass Chrome Rule | flat white pills, no glass |
| Statistik as the named exception with its own 48 px surfaces | statistics tiles and settings sections are the same sheet |
| "Disabled inputs get a muted background, not only opacity" | one disabled look for every control |
| "Yellow is an icon-only exception" | a yellow marker stroke is an allowed decoration in slight, intentional use |
| The task sheet on the board, `TaskDetailModal` on statistics | one common task sheet |
| Anti-references Trello and Notion | Slack joins them; Airbnb stays the positive reference |
| Motion as it is rendered (ten durations, eight curves) | three durations, two curves, one state language |

### Asked in this step

Each with the evidence, references for and against (Mobbin, web: how shipped products solve it, never a look to copy) and the recommendation. The owner's answer is recorded under each.

**1. The One Lamp Rule: "Ink is the only accent. If more than one element per view is ink-filled, one of them is wrong."**
- Evidence: the accent is now green and also means done, so a board with done cards shows green checks beside the green button under Erledigt; selected options, links and the focus ring are green too. The rule's first sentence still holds (one accent); its second sentence, read by the word, would now forbid what the owner chose. Only "a solid primary is `lg`" is checked (`button-ladder.test.ts`); "one per view" is not.
- For keeping it: [Mintlify](https://mobbin.com/screens/fcbb573f-e515-4e12-bd15-46e39a13564c) has one filled button on the page and the eye lands on it. Against a loose reading: [Replit](https://mobbin.com/screens/093752e0-185b-45e6-b6b9-10ae944810a2) shows four filled blue buttons in one column, and none reads as the next step. A product that lives with several: [Klaviyo](https://mobbin.com/screens/2b6f0a9f-94b2-4275-87c3-7475bd42bf8a) has one Save per sheet, each quiet until its sheet has changes.
- Recommendation: keep it, reworded to what it protects: "one solid green button per view; marks, selected options, links and the focus ring are green without being a fill". Step 6 can then check it per surface.
- **Answer (owner, 2026-11-11): keep, reworded as recommended.**

**2. The Three Line-Heights Rule: "`--lh-tight` for display text, `--lh-snug` for compact UI, `--lh-body` for reading. No other line-heights."**
- Evidence: 13 ratios are rendered (part 1). The three tokens are used in 16 files; everything else takes the line height that Tailwind pairs with a size class (`text-sm` brings 20 px, `text-xs` 16 px), so 14 px text alone has six line heights. The rule names three roles and the code has no way to follow it.
- Recommendation: keep the three, and make them true by construction: each type role of the closed scale carries its line height in its own token (`--text-<role>--line-height`, as `--text-headline` already does), so a size class brings the right one and nobody writes a `leading-*` class. The prose rule becomes a column of the type table, and the ratchet for type literals holds it. Cost: a few pixels of height change in many places, inside the foundations slice of step 5, where the baselines are re-recorded anyway.
- **Answer (owner, 2026-11-11): keep the three, built into the size tokens, as recommended.**

**3. What may cast a shadow (the remainder of The Only Cards Float Rule)**
- Evidence: decided is that every sheet casts the one warm shadow. Not decided is a control. Today four things outside the rule cast one (part 1): the indicator of the tabs, the thumb of the switch, the end-of-day button under Erledigt (`shadow-md`) and the welcome sheet. The chosen prototype took the shadow off the app bar's indicator and left the others as they were.
- For a shadow on a moving indicator: [Canva](https://mobbin.com/screens/2cbe2bb0-bb17-4f1b-83ea-7047a5781339) raises the selected segment as a white chip with a soft shadow, which says "this part slides". Against: [Replit](https://mobbin.com/screens/093752e0-185b-45e6-b6b9-10ae944810a2) (the theme switch) and [Mintlify](https://mobbin.com/screens/fcbb573f-e515-4e12-bd15-46e39a13564c) mark the selected segment by fill alone and stay readable.
- Recommendation: a shadow belongs to a sheet (a surface lifted off the canvas that holds content: card, page sheet, task sheet, dialog, menu, toast, the app bar pill). A control never casts one: the selected tab and the selected place are a fill, the end-of-day button is a plain soft button on the canvas. This keeps the shadow's one meaning ("a sheet on the desk") and removes Tailwind's second shadow colour from the app.
- **Answer (owner, 2026-11-11): "Agree to only sheets cast a shadow with the app bar nav pill as exception."** Read as: the app bar's pill (the bar itself, as in the chosen prototype) is the one named exception and is not counted as a sheet; the selected place inside it stays a fill without a shadow. Step 4 confirms this reading when the rule is written.

**4. "Choice chip or property value": in the task sheet's rows a value that opens a list is a filled select with a chevron, a free value is text on a dotted rule**
- Evidence: part 2 and summary point 5: two affordances and five control heights (32 to 40 px) side by side in one column. The split is the owner's own decision (D2 on kd#114): the look says what will happen, a list opens or a field is typed into.
- For one affordance: [Plane](https://mobbin.com/screens/e4e28e54-94c1-432b-946b-430997323dd8) and Todoist (part 2) use one chip shape for every property, whatever it opens. For two that share a frame: [hilos](https://mobbin.com/screens/1bccd0ad-5b1c-4bf9-beba-5f856e59a13e) gives list values a select with a chevron and the free "Labels" value a text field, both with the same height, border and radius; [Unify](https://mobbin.com/screens/0d35f16d-27a1-4bba-ae88-c7c50cfb7926) puts three selects of one height in a row.
- Recommendation: keep the two affordances, because each tells the truth about what a click does, and remove what the audit measured as inconsistent: one row height for every value control, and one answer to hover, focus and disabled (today `PropertyValueTrigger` and `DatePickerField` do not look disabled at all). The chevron stays the only difference a reader has to learn. The exact height is part of open question 2 of the plan (field heights).
- **Answer (owner, 2026-11-11): keep both looks, one height and one behaviour, as recommended.**

### Due at the start of step 4 (already in the plan's open questions)

| Rule | Plan question |
|---|---|
| Headline hierarchy: page titles, section headings, dialog titles | 1, the page title scale |
| Buttons: the size ladder; soft and ghost as two neutral looks (new in this list); "`USelect` and `UInput` keep their own field heights" | 2, the merge candidates |
| Motion: "never runs … during a drag" | 3, drag and drop motion |

### Stated but checked by nothing

Input for step 6 (a guard) or step 4 (drop the rule): The Three Line-Heights Rule; the icon size scale of `lib/icons.ts`; "exactly one `lg` per surface"; "one filled primary per view"; "selected state is the route" (`aria-current` on exactly one control).
