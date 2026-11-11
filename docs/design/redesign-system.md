# Redesign system definition (step 4 of the redesign plan)

What the chosen direction (Paper Desk, kd#1 `## UX decision`) means as token values, closed variant lists and written rules. It is the input for the spec on kd#1 and for the slices of step 5. It changes no code. Plan: `docs/design/redesign-plan.md`; evidence: `docs/design/redesign-gap-audit.md`; the rewritten design file: `docs/design/DESIGN.next.md`.

- **Sources of a value:** the prototype (`assets/css/proto.css` on `proto/1-visual-redesign`, block "A PAPER DESK" and the shared blocks; the step 4 switches at commit `968c1861`), the owner's answers of 2026-11-11 (listed in the plan under "Open questions for the owner"), and the gap audit's measurements.
- **Status of each line:** *decided* = the owner said so; *follows* = a direct consequence of a decision; *proposed* = my choice inside a decision, listed again under "For the owner to approve".

## 1. Foundations as token values

### Colour

| Token | Today | New | Status |
|---|---|---|---|
| `--ui-page-bg` | stone paper `#F5F5F4` | `oklch(0.953 0.013 86)` | decided |
| `--ui-bg`, `--ui-bg-elevated` | `#FAFAF9` | `#fff` | decided |
| `--ui-bg-muted` / `--ui-bg-accented` | Rule Line | `oklch(0.966 0.009 86)` / `oklch(0.945 0.012 86)` | decided (prototype) |
| `--ui-border` | `#E7E5E4` | `oklch(0.895 0.016 84)` | decided (prototype) |
| `--ui-text`, `--ui-text-highlighted` | `#1C1917` | `oklch(0.19 0.012 70)` | decided |
| `--ui-text-muted` | `#68625C` | `oklch(0.42 0.024 80)` | decided (prototype) |
| Neutral ramp | `stone` | warm, hue 84: the six values above are fixed; the other steps are re-spaced so the ramp falls evenly (the prototype's 600 and 700 are 0.38 and 0.37) | proposed |
| Primary ramp | `custom-ink`, hue 255 | `custom-forest`, hue 152: 50 `0.972 0.016`, 100 `0.94 0.032`, 200 `0.885 0.055`, 300 `0.80 0.08`, 400 `0.66 0.10`, 500 `0.47 0.092`, 600 `0.41 0.082`, 700 `0.36 0.070`, 800 `0.30 0.056`, 900 `0.25 0.044`, 950 `0.18 0.030` (oklch lightness and chroma) | decided |
| Success ramp | `custom-teal` | the primary ramp; `custom-teal` is deleted | decided |
| Warning, error | `custom-orange`, `custom-raspberry` | unchanged | decided |
| `--marker` | – | `oklch(0.91 0.145 97)` | decided |
| `--shadow-color` | cool slate `15 23 42`, and Tailwind's black | `70 48 20` | decided |
| `--fill-on-canvas`, `--fill-on-canvas-hover` | – | the shadow colour at 7 % and 13 % | follows (the prototype's tab track and add slot; the soft button of the `?btn=` comparison) |
| `--overlay-scrim` | neutral-900 at 12 % | the shadow colour at 17 % | decided (prototype) |
| `--topic-<hue>` (nine) | tuned on `#FAFAF9` | retuned on white, 3:1 kept by the guard; green and yellow move away from the accent and the marker where the guard allows | follows |
| `--focus-dusk` | `oklch(0.27 0.04 65)` | unchanged | – |

Neutral soft buttons: `bg-elevated` is white in the new palette, so a soft button on a sheet had no fill in the prototype. The soft fill becomes `--fill-on-canvas` (a translucent tint reads on white and on paper), set once in the `button` theme.

### Type

Fonts: Fraunces (variable, OFL) is bundled like Figtree; `--font-display: 'Fraunces', ui-serif, Georgia, serif`, weight 500, tracking -0.02em. No web font request (desktop CSP, ADR 012).

| Role | Token | Today | New | Status |
|---|---|---|---|---|
| Hero | `--text-5xl` | 48 px, welcome and verdict; 30 and 36 px beside it | 48 px / 1.15; the 30 px verdict figure and the 24 to 36 px welcome and recap lines fold into hero or display | proposed |
| Display | `--text-display` | 36 px column names | 36 px / 1.15: column names and page titles (`PageHeader`, today 20 px sans) | decided |
| Headline | `--text-headline` | 22 px | 22 px / 1.15: section headings; the task title in its sheet (today 24 px) | decided; the sheet title proposed |
| Subhead | `--text-lg` (and `--text-brand`) | 18 px, three weights | 18 px / 1.3: dialog titles, sub-headings, the wordmark | decided |
| Title | `--text-title` | 15 px | 15 px / 1.3 (16 on a phone) | unchanged |
| Body, Interface | `--text-sm` | 14 px, six line heights | 14 px; interface 1.3 from the size token, reading text 1.55 through one `text-body` utility (15 on a phone) | decided (three line heights in the tokens); the split proposed |
| Label | `--text-label`, `--text-xs` | 11 and 12 px | 12 px / 1.3; 11 px goes | proposed |
| – | `--text-base`, `--text-xl`, `--text-2xl`, `--text-3xl`, 8 and 10 px | 16, 20, 24, 30 px in a few places | not in the scale: 16 px settings and statistics copy becomes body, 20 and 24 px headings become headline or subhead, the 8 px badge text goes with the badge size | proposed |

Twelve rendered sizes become eight. Line heights: `--lh-tight` 1.15, `--lh-snug` 1.3, `--lh-body` 1.55 stay and are written into `--text-<role>--line-height`; `leading-*` classes are removed from the templates and held at zero by a ratchet.

### Space, size, shape

| Scale | Today (gap audit, part 1) | New | Status |
|---|---|---|---|
| Spacing | 15 padding values, every half step from 2 to 14 px | the 4 px grid, 2 and 6 px as the only half steps; 7, 10 and 14 px move to the nearest step | proposed |
| Button height | 24, 28, 32, 36 px | 32 px regular, 36 px for the one main action of a surface | decided |
| Field height | 28, 32, 36, 40 px; the sheet's value rows 32 to 40 px | 36 px for inputs, selects, the value controls of the task sheet and the choice chip | decided (the chip follows) |
| Phone | 44 px floor, 48 for `lg` | unchanged | – |
| Radius | 4, 6, 8, 12, 15, 16, 24, 32, 48 px, pill, circle | 8, 12, 16 px, pill, circle; `--ui-radius` stays 0.5rem | decided |
| Icon size | 12, 13, 14, 16, 17, 18, 20, 24 px | 12, 16, 20, 24 px; the `em`-sized icons of `TaskCard` and `TaskProgressChip` take a step | proposed |

### Elevation

| Token | New value | Used by |
|---|---|---|
| `--shadow-task` | `0 0 0 1px rgb(c / 0.07), 0 2px 3px 0 rgb(c / 0.1), 0 10px 22px -6px rgb(c / 0.2), 0 22px 40px -12px rgb(c / 0)` | cards, page sheets, stacks (as a filter) |
| `--shadow-task-hover` | the same four layers: `0.07, 0.06, 0.14, 0.3` | a card under the pointer |
| `--shadow-task-drag-elevated` | `0 0 0 1px rgb(c / 0.07), 0 26px 48px -12px rgb(c / 0.38)` | the dragged card |
| `--shadow-sheet` | `-18px 0 44px -6px rgb(c / 0.26), -2px 0 8px rgb(c / 0.12)` | the task sheet on desktop |
| `--shadow-overlay` | `0 22px 50px -8px rgb(c / 0.32), 0 3px 10px rgb(c / 0.14)` | dialogs; new: menus, popovers, toasts (today Nuxt UI's defaults in Tailwind's black) |
| the nav pill | `0 0 0 1px rgb(c / 0.07), 0 2px 3px rgb(c / 0.1), 0 8px 18px -6px rgb(c / 0.2)` | the app bar's pills, the named exception |

`c` is `--shadow-color`. The resting and the raised card shadow keep one list of four layers (kd#128: WebKit steps a geometry change). Tailwind shadows leave the app: `StatsTile` (`shadow-xs`), the tabs indicator (`shadow-sm`), the end-of-day button (`shadow-md`), the switch thumb and the welcome sheet (`shadow-lg`).

### Motion

The three durations and two curves stay as they are. Folded into them: 120 and 160 ms to fast, 180, 220 and 240 ms to base, 280 ms to slow, plain `ease`, `ease-out` and `ease-in-out` to the two curves. Kept as recorded choreography in their doc blocks: the app bar's 420 ms timeline and springs, the progress chip's spring, the column header's 500 ms, the completion burst. Twenty-three interactive components gain the fast transition on their state change.

Drag and drop (owner: "gentle"): the preview animates `scale` 1 to 1.02 and its tilt 0 to 2 degrees with the in-hand shadow growing, 150 ms emphasized; `--dnd-reorder-duration` is the base duration; `DragOverlay`'s drop animation is 200 ms emphasized; the dropped card plays a 200 ms set-down (size, tilt and shadow back to rest). Individual `scale` and `rotate`, because `transform` belongs to `dnd.css`; off under reduced motion. The set-down needs a hook for "this card was just dropped" (the prototype watches the placeholder class leave; Build decides the real mechanism in `useBoardDndKit`, visuals only, no logic change).

### States

The table in `DESIGN.next.md` "States" is the definition. What changes against the gap audit's mechanics matrix: the hand cursor on every Nuxt UI control (today the arrow); a press answer on every control (today only `ChoiceChip`); one disabled look (today five, two of them invisible: `PropertyValueTrigger`, `DatePickerField`); loading always locks the control (today inputs and selects stay live); the browser's default ring on `ChoiceChip` `row`, `ExternalLink` and the `TokenStep` link becomes the halo, and the collapsed `TaskStack` control gets a visible focus.

## 2. Closed variant lists

| User job | Stays | Goes or merges | Uses to move |
|---|---|---|---|
| Trigger an action | `UButton` solid, soft, ghost, link; `md` 32 px, `lg` 36 px | `sm` (35 uses) and `xs` (1) become `md`; `subtle` (1, the topic editor's symbol trigger) becomes soft; `outline` stays unused | soft and ghost by rule (below) |
| Show a list row | `ListRow`, density cozy, hover surface | `roomy`, `compact`, hover `text`; `SettingsSubpageLink` and `DayCloseTaskRow` become `ListRow` | 5 sites, 2 components |
| Pick one of a few | `ChoiceChip` (one chip at 36 px, icon-only allowed), `field`; one choice card | `pill` and `chip` merge, `icon` is the chip, `row` uses the select menu's item, `large` goes with `row`; the board menu's `aria-pressed` buttons become the chip; the card pickers of `LocalSetupFlow` and the welcome page become one | 8 sites, 1 hand-built radio group |
| Edit a value in a row | select with chevron (`TaskPropertySelect`), text on a dotted rule (`InlineEditable` `rule`, `PropertyValueTrigger`), both 36 px | `InlineEditable` `fill`; the four other heights; `PropertyValueTrigger` tones are reviewed in the slice | the task sheet |
| Type into a field | `UInput`, `USelect`, `USelectMenu`, `UTextarea` at 36 px (`lg`) | `sm`, `md`, `xl` | 16 inputs, 3 selects |
| Show a status or count | `UBadge` neutral, one variant, one size; `TaskPriorityBadge` in one size | badge `xs` (8 px text), soft against subtle, four sizes of `TaskPriorityBadge` | – |
| Head a section | `SectionHeader` (headline), `PageHeader` (display) | the `section-heading` utility and about ten hand-written `font-display` strings fold into the two | about 25 sites |
| Open and close a part | the components stay; one caret and one motion | three looks | 5 sites |
| Hold content as a surface | the sheet (16 px, resting shadow) | `StatsTile`'s two tones and 48 px radius, the welcome sheet's 24 px and `shadow-lg` | – |
| Ask in a dialog | `AppDialog` (3 widths), `ResponsiveOverlay`, `TaskSheet` | `TaskDetailModal` (statistics opens the task sheet) | 1 component |
| Tell the user something, switch a view | unchanged | – | – |

**Soft or ghost (owner, 2026-11-11, after the comparison on the prototype):** soft for a neutral action that stands on its own (a dialog's cancel, a button under a list or on the canvas) and for the one main action of a row; ghost for further actions inside a row, card, menu or toolbar and for every icon-only button. Today's 44 soft and 48 ghost uses are re-sorted by this rule in the action slice (for example the feedback dialog's ghost cancel becomes soft, a second soft action in a row becomes ghost).

Expected removal: 2 button sizes and 1 variant, 2 densities and 1 hover mode, 3 chip shapes, 1 affordance variant and 4 heights, 3 field sizes, 4 to 5 badge sizes, 1 heading implementation, 2 surface looks; components `SettingsSubpageLink`, `DayCloseTaskRow`, `TaskDetailModal` and one of the two card pickers.

## 3. Where the text of today's `DESIGN.md` goes

`DESIGN.next.md` is written from the labels of the rule review (gap audit, "Step 2"). 373 lines become 241 (the frontmatter 116 to 54, the body 257 to 187).

| Today | In the new file | Elsewhere |
|---|---|---|
| Frontmatter: colours, type, radius, spacing, components | colours, type and radius with the new values | `spacing` and `components` are dropped: they repeated token values and had drifted (8 px button radius where 12 is rendered). Impeccable's detector does not read them; its live panel and the `document` command do, and work with the shorter form (its seed mode writes name and description only) |
| Overview | "Direction" | – |
| Colors and its named rules | "Colour": one table, six rules (One Lamp reworded, Status reworded, Topic Mark, the new Marker Rule, Frozen Primary on the green, Receding Text) | Done Teal's list of places, Focus Dusk, Notion's hue mapping, the accepted hue collision: the token comments in `main.css` |
| Typography | "Type": one table, The One Role Rule | The Three Line-Heights Rule becomes the table's line-height column |
| Layout | "Layout": five lines | Board (phone): `.claude/rules/mobile-board.md` (already there); stacks: `TaskStack` doc block; page offsets: `app-nav.css` |
| Elevation, Shapes | "Elevation" and "Space, size and shape" | The Glass Chrome Rule is dropped with the glass code and `app-nav-glass.test.ts` |
| Components (84 lines) | one line per user job (22 lines) | Buttons' phone measurements: the `button` theme comment in `app.config.ts`; task card, progress chip, carried-over dots, done drop: `TaskCard`, `TaskProgressChip`, `TaskCarryOverDots` doc blocks; add task: `AddTaskSlot`, `NewCardFlow`; property rows: `TaskDetailContent`; sync status: `MorePanel`; app bar look, third segment, Mehr panel, layering: `AppNav` and `app-nav.css`; statistics tile and ring: `StatsTile`, `StatsEstimateRing`; settings sub-page: `PageHeader` and the sub-page layout |
| Behaviour | "Behaviour", shortened | the delete gap's values: `TaskDeletedGap` (already there) |
| Usage guidelines | folded into "Components" and "Guards" | open outside or inside: `ExternalLink` doc block and `lib/icons.ts` |
| Voice and copy (25 lines) | a pointer in the intro | `docs/copy/voice.md`; the lines the registry already enforces (one term per concept, Löschen / Entfernen / Trennen, task state, settings / token / time) are not repeated there |
| App icon | one line; "yellow is icon-only" is replaced by The Marker Rule | – |
| Do's and Don'ts | removed: duplicates and enforced lines | – |
| – | "States" and "Guards" are new | – |

Before a paragraph is removed from `DESIGN.md`, the slice that removes it checks that the named doc block really says it and adds what is missing.

## 4. What step 5 has to know

- **`DESIGN.md` is swapped in the foundations slice**, with the token values: `docs/design/DESIGN.next.md` moves over it and this draft file is deleted. Until then the two differ on purpose.
- **Readers of `DESIGN.md` that the swap touches:** `server/copy-editor/translate.ts` (`extractVoiceRules` reads the `## Voice and copy` section; it has to read `docs/copy/voice.md`) and its test; the `copy-writer` skill (`SKILL.md`, `calibrate.md`, `scenarios.md`), `release-copywriting`, `CLAUDE.md` "Language Policy", `components/ui/EmptyNote.vue` and `docs/copy/terms.json` (references by section name); comments and messages that name a section which no longer exists (`scripts/lint/ratchets.mjs` "Buttons" and "Styling", `lib/inkRamp.ts`, test descriptions). `scripts/design-scan.mjs` counts `DESIGN.md` as an input, so the rendered scan reruns.
- **The voice move is independent of the look** and can be its own small change before the foundations slice.
- **Guards that change:** `button-ladder.test.ts` (two sizes; `sm` and `xs` fail), `app-nav-glass.test.ts` (deleted), `topic-tokens.test.ts` (white sheet), `button-contrast.test.ts`, `role-contrast.test.ts` and `error-soft-contrast.test.ts` (new palette), `card-shadow-crossfade.test.ts` (the new four layers), the motion ratchet in `token-literals.test.ts` (lower baseline). New guards are step 6: line heights from size tokens only, the icon size scale, one solid button per view, one `aria-current`, no shadow on a control.
- **Contrast already checked on the prototype:** axe, 0 failures on five surfaces at 1280 and 390 (step 3). Not yet checked: the new soft fill under text (near-black on a 7 % tint is far above 4.5:1 by calculation), the retuned topic hues, the Themen and Daten sub-pages, the desktop app.
- **Known defect to fix in the card slice:** waiting cards read cool grey on the warm canvas (the greyscale filter).

## 5. For the owner to approve

Decided items are not asked again. These are my choices inside the decisions; each can be vetoed with a comment on the pull request, and silence on a line is not consent until the pull request is approved as a whole.

1. **Label text is 12 px everywhere; 11 px goes.** Badges, chips and counts grow by one pixel on desktop (they are 12 px on a phone today).
2. **16, 20, 24 and 30 px leave the type scale.** Settings and statistics copy becomes 14 px body; small headings move to 18 or 22 px; hero lines to 36 or 48 px.
3. **The task title in its sheet is the headline role: 22 px Fraunces** (today 24 px). The prototype showed it in Fraunces; it is the one place where the user's own text is set in the display face.
4. **Interface text at 14 px gets line height 1.3, reading text 1.55** (today mostly Tailwind's 1.43). Buttons and rows keep their height through their own height token; multi-line descriptions get a little more air.
5. **Spacing half steps are 2 and 6 px only.** 7, 10 and 14 px paddings move by 1 to 2 px.
6. **Menus, popovers and toasts take the warm overlay shadow** (today Nuxt UI's default black shadows).
7. **The neutral ramp is re-spaced** around the six fixed values.
8. **`PRODUCT.md`:** Slack joins the anti-references; principle 3 becomes "Sheets and type over decoration: content sits on a sheet, and inside a sheet headings, type scale and space structure it before lines, boxes and fills do." (You decided both changes; this is the wording.)
9. **`DESIGN.next.md` as a whole**, including the two new named rules (The Marker Rule, The Sheets Cast Shadows Rule) and the reworded One Lamp and Status rules.
