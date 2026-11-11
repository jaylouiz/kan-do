# Design Backlog

Open design debt, measured against `PRODUCT.md` and `DESIGN.md`. Prioritised by visibility in the core loop (glance → move → timer → close). Created 2026-10-19.

Each open item is tracked as a GitHub issue (`(#n)` after the ID; title starts with the backlog ID, labels `design-debt` + category). The issue body is the spec; this file stays the audit snapshot. The second `C9` (archive button) was renumbered `C14` on import. Done items (C1, C2, A7) have no issue.

Sources: audit/critique 2026-10 (`docs/design/audit-2026-10.md`, IDs marked *audit* / *critique*), axe (`tests/e2e/a11y.spec.ts`, exclusions marked `// a11y-backlog:`), Impeccable detector (`docs/design/baseline.json`), ESLint `better-tailwindcss` warnings, and the pattern decisions in DESIGN.md.

## Top 10 next (2026-10-20, after audit + critique)

Ordered by visibility in the core loop (glance → move → timer → close). Details: `docs/design/audit-2026-10.md`.

1. **P4** (#30) Swap onto a full Jetzt with hover preview + undo toast (decided 2026-10-20) — today `isDropBlocked` is computed but never rendered and the drop refuses silently.
2. ~~**P2 + A9** (#31) Task detail as `USlideover`/`UDrawer` - also fixes the missing initial focus, the leaky trap and the lost focus return.~~ - done 2026-10-20
3. **A13** (#32) Enter opens a focused card; German dnd-kit announcements with task titles instead of IDs.
4. ~~**R1** (#33) Visible "Aufgabe hinzufügen" — today it is hover-only on desktop and absent on mobile.~~ - done 2026-10-20
5. ~~**C8** (#34) Timebox ring: overrun → warning, never raspberry; neutral on done cards.~~ - done 2026-10-20
6. ~~**A5** (#35) Decide on focus-mode dimming~~ - done 2026-10-20 (dimming removed entirely, other columns look normal; emphasis on the Jetzt card moved to #93, ~~done 2026-10-21~~ as the in-slot current variant).
7. ~~**P3** (#36 -> #101) Quick add `n`/`⌘K` + `j`/`k` + `UKbd` hints.~~ - done 2026-10-21 as a narrower `⌘K` command palette (#101); `n`, `j`/`k`, number keys remain a possible follow-up.
8. ~~**R2** (#37) Mobile board action row reachable from every tab, hit areas ≥44px.~~ - done 2026-10-20
9. ~~**C7 + A8** (#38) Statistics KPI numbers neutral (`text-highlighted`), colour only for real deviations.~~ - done 2026-10-20
10. ~~**R3** (#39) Mobile statistics time-frame `USelectMenu` uses v2 props → shows raw `today`.~~ - done 2026-10-20

## Consistency

| # | Item | Where | Source |
|---|---|---|---|
| C1 | ~~Muted text (neutral-500) 4.4:1 on Paper~~ — done 2026-10-19: `--ui-text-muted` is now the neutral-500/600 midpoint (`#68625c`, 5.5:1 on Paper, 4.8:1 on Rule Line). | `assets/css/main.css` `--ui-text-muted` | axe (statistics, settings) |
| C2 | ~~Raw palette classes~~ — done 2026-10-19 (semantic tokens). Open: Todoist current-mode icon is now neutral (brand red only on setup buttons per DESIGN.md); ~~`OnboardingWelcome.vue` appears unused~~ — deleted 2026-11-03 (#553). | `ModeSettingsModal` et al. | ESLint `no-restricted-classes` |
| ~~C3 (#40)~~ - done 2026-10-20 | ~~Arbitrary values in `app.config.ts` (`z-[80]`, `min-w-[160px]`, animate-[…])~~ | `app.config.ts`, 5 px warnings | ESLint / DESIGN.md |
| ~~C4 (#41)~~ | ~~44 detector findings: 23 colours, 13 font sizes, 8 radii off the DESIGN.md ramps~~ - done 2026-10-20 | see `baseline.json` | Impeccable detect |
| ~~C5 (#42)~~ - done 2026-10-20 | ~~134 `enforce-canonical-classes` warnings (mechanical, `lint:fix` candidate)~~ | many | ESLint |
| ~~C6 (#43)~~ | ~~`main.css` is 892 lines; component-level rules likely belong in `app.config.ts` variants or scoped styles~~ - done 2026-10-20: split into layered partials next to `main.css` (kept global because selectors target dnd-kit, teleported and cross-component DOM, and scoped styles are unlayered) | `assets/css/*.css` | Guide assessment |
| ~~C7 (#38)~~ | ~~Statistics KPI numbers use fixed status colours as decoration (ink/teal/orange/orange/info); "100% Schätzgenauigkeit" shows in attention orange. Set all to `text-highlighted`; colour only the threshold badge~~ - done 2026-10-20 | `pages/statistics.vue:57-81` | audit F4 / critique |
| ~~C8 (#34)~~ | ~~Timebox ring escalates to `error` (raspberry) at ≥100%, also on done cards — DESIGN.md: overdue = orange, raspberry = destructive only~~ - done 2026-10-20 | `TaskProgressCircular.vue:132` | audit F7 / critique |
| ~~C9 (#44)~~ - done 2026-10-20 | ~~Shared dialog conventions: one width scale for all `UModal`s (today 9 modals use 6 widths: `sm:max-w-sm/md/lg/3xl`, `max-w-2xl/4xl`), footer chrome centralised in `app.config.ts` (right-aligned actions, top border), reusable `SelectionCard` (pick one of N) and `WizardModal` (stepper shell for Notion setup). The unused `components/ui/modal/Modal.vue` wrapper (its `#content` slot dropped header/footer) was removed. Rebuild fresh on current main; ideas from closed PR #15 (2026-06, superseded). Coordinate with P2 (task detail → slideover)~~ | `components/**/*Modal.vue`, `app.config.ts`, `pages/styleguide.vue` | PR #15 review 2026-10-20 |
| ~~C14 (#45)~~ - done 2026-10-20 | ~~Solid teal "Aufgabe archivieren" button (status colour as action fill) + archive toast `color: 'success'`; undo action ink on delete toast vs teal on archive toast. Use soft/ghost neutral~~ | `BoardColumnArchiveSection.vue`, `Board.vue:456` | critique |
| ~~C10 (#46)~~ - done 2026-10-20 | ~~83 `i-heroicons-*` icons in 20 files; rule is Phosphor (`i-ph-*`). Swap + lint guard~~ | ~~e.g. `Board.vue:460`, `pages/statistics.vue:30`~~ | audit F13 |
| ~~C11 (#47)~~ - done 2026-10-20 | ~~Dead/dev files: `TaskDetailContent.new.vue`, `pages/dnd-sample.vue` (ships, 7 detector findings)~~ | `components/task`, `pages` | audit F14 |
| ~~C12 (#48)~~ - done 2026-10-20 | ~~Modal title fonts inconsistent: task detail title Figtree, settings title serif (DESIGN.md: `font-display`)~~ | `TaskDetailContent.vue`, `app.config.ts` modal | critique |
| C13 (#49) | ~~Copy: welcome "persoennliches" / "lasse dir", brand spelled kan-do/Kan-do/Kan-Do; archive button singular vs toast plural; column "Jetzt" vs "In Arbeit" in docs/E2E~~ - done 2026-10-20 (copy fixed; "Jetzt" kept as documented column name, see PR) | `i18n/locales/de.json:656` et al. | critique |

## Accessibility (WCAG 2.2 AA, all `color-contrast`, serious)

| # | Item | Ratio | Where |
|---|---|---|---|
| A1 (#50) | ~~Done column: teal titles on teal wash, badges, archive heading `text-success-600`, white on success button~~ - done 2026-10-20 | 2.3–4.4:1 | `#column-done`, `BoardColumnArchiveSection` |
| A2 (#51) | ~~Waiting card titles dimmed~~ - done 2026-10-20 | 3.3:1 | `#column-waiting .task-title-text` |
| A3 (#52) | ~~Card topic line `opacity-50`~~ - done 2026-10-20 | 3.3:1 | `TaskCard .task-topic` |
| A4 (#53) | ~~High-priority badge orange on light orange~~ - done 2026-10-20 | 2.0:1 | `.priority-high` |
| A5 (#35) | ~~Focus-mode dimming of inactive columns (intended, but headers 1.7:1) — decide whether dimmed content must stay readable~~ - done 2026-10-20 (dimming removed; emphasis on Jetzt tracked in #93; the Jetzt focus overlay of #394 brings an intentional, reversible dimming back, with its contrast measured and exempt in the test) | 1.5–2.5:1 | focus mode |
| A6 (#54) | ~~Empty-field placeholders in task detail~~ - done 2026-10-20 | 2.3:1 | `.inline-editable-trigger` |
| A7 | ~~Muted description on selected option card~~ — fixed by C1 | settings modal `.border-primary .text-muted` |
| ~~A8 (#38)~~ | ~~Statistics: success/info KPI numbers, success badge (rule disabled for the whole page)~~ - done 2026-10-20 | 1.95–2.7:1 | `pages/statistics.vue` |
| ~~A9 (#31)~~ - done 2026-10-20 |~~**Verified failing (audit F1):** detail dialog takes no initial focus, Tab walks ~10 board controls behind the scrim, Esc returns focus to `<body>`. Fix via P2 (reka FocusScope) or interim in `useModalBehavior.ts:82,115-158`~~| — | `useModalBehavior`, `TaskAnimatedModal` |
| A10 (#55) | ~~Primary solid button focus is only the 25% halo (1.4:1 vs page) — passes 2.4.7, weak for 2.4.11; consider a solid offset ring~~ - done 2026-10-20 | — | `app.config.ts` `button` |
| A11 (#56) | ~~Inline-editable title/fields in task detail have no `tabindex` → not keyboard-reachable~~ - done 2026-10-20 | — | `InlineEditable*` |
| A12 (#57) | ~~Notion setup `UStepper` is `disabled`, so triggers never take focus; `stepper.slots.trigger` override is dead~~ - done 2026-10-20 | — | `NotionSetupModal` |
| A13 (#32) | ~~Enter/Space on a focused card both start the dnd-kit keyboard drag — no keyboard way to open details; live region announces English text with raw IDs ("Draggable item seed-open-1 was dropped"); card name is the whole card text. Pass German `accessibility` announcements to `DragDropProvider`, Enter → details, `aria-label` = title (*audit F2 / critique*)~~ - done 2026-10-20 | — | `Board.vue:12`, `SortableTaskWrapper.vue`, `TaskCard.vue:19` |
| A14 (#58) | ~~`/tasks` has no `<main>` and no `<h1>`; "✓ Erledigt" includes the glyph in its accessible name (*audit F11*)~~ - done 2026-10-20 | — | `pages/tasks.vue`, `Board.vue:14` |
| ~~A15 (#59)~~ | ~~Mobile statistics table: axe `scrollable-region-focusable` (serious); header clipped mid-word (*audit F10*)~~ - done 2026-10-20 | — | `TasksTable.vue` `.overflow-auto` |
| A16 (#60) | ~~Reduced motion: mobile column slide keeps `transform 320ms` (also outside 150–220ms) under `reduce`; `will-change` left on at rest. Only `TaskProgressCircular` has a reduce block (*audit F9*)~~ - done 2026-10-20 | — | `main.css:398-400` |
| A17 (#61) | ~~Invisible "Manuell" sort control is the first Tab stop (opacity 0 until hover) — show it on `:focus-visible` (*critique*)~~ - done 2026-10-20 | — | `ColumnSortingControl.vue` |

## Patterns (decided, not yet implemented)

The spec of each open pattern lives in its entry and issue; DESIGN.md keeps only durable rules (#416).

| # | Pattern | Current state |
|---|---|---|
| ~~P1 (#62)~~ - done 2026-10-21 | ~~Undo toast instead of confirm dialogs~~ | ~~Delete, archive and completion (drag, context menu, detail sheet) all show the undo toast~~ (`useCompletionUndo`) |
| ~~P2 (#31)~~ - done 2026-10-20 |~~Task details: `USlideover` desktop, `UDrawer` mobile~~|~~custom `TaskAnimatedModal`; mobile is a centred modal with close X top-right (out of thumb reach); desktop opens only on double-click. Fixes A9~~|
| ~~P3 (#36 -> #101)~~ - done 2026-10-21 | ~~Quick add via `n` / `⌘K`, `j`/`k` navigation, `UKbd` hints~~ | narrower re-scope: `⌘K` command palette with card actions (`CommandPalette.vue`, `useCommandPalette.ts`); single-key shortcuts deliberately not added |
| P4 (#30) | Swap onto full "Jetzt": hover preview (displaced card → Wartet, quiet Graphite one-liner on the column), undo toast; keyboard + live region equivalent; no red, no shake; the displaced task's time tracking stops at the swap | **not implemented:** `useBoardDndKit.ts:66-79` sets `dragState.isDropBlocked` but no component reads it; drop snaps back silently. Bind in `BoardColumnProgressContent.vue`, Graphite one-liner via i18n |
| ~~P6 (#63)~~ - done 2026-10-22 | ~~Yesterday's wins: shown once on today's board until acknowledged; framed as celebration, not archive housekeeping; never pushes today's wins down~~ | ~~behaviour exists (`BoardColumnArchiveSection`, "Gestern erledigt" + archive button); framing and placement open~~ |
| ~~P7 (#64)~~ - superseded 2026-10-29 by #394 (regular Jetzt card, the board steps back behind it) | ~~Current task as the lamp: card grows over its unchanged "Jetzt" slot after drop, shrinks on drag start, in-place interactions via drag handle (see DESIGN.md "The current task is the lamp") | proposed. Stage one shipped 2026-10-21 in #93 (in-slot current variant: serif title, 64px ring, ink edge, ambient loop while the timer runs); the overlapping layer is still open. Suggested steps: (1) ~~static large card, read-only, test for a few days~~ done (in-slot, #93); (2) shrink on drag + grab-point anchor; (3) handle + timer inline; (4) swap preview shrink; (5) notes after the P2 boundary is settled~~ |
| P5 (#65) | One-sentence empty states per column | not implemented: empty columns render blank; only Wartet gets a "?" suffix (`BoardColumn.vue:420`). `?seed=clear` routes to welcome, so not seen live |

## Responsive / Mobile

| # | Item | Where | Source |
|---|---|---|---|
| ~~R1 (#33)~~ | ~~"Add task" is hover-only; invisible to keyboard, absent at 390px. Persistent ghost button under Offen + thumb-reach add on mobile~~ - done 2026-10-20 | `BoardColumn.vue`, `AddTaskButton.vue` | audit F3 / critique |
| ~~R2 (#37)~~ | ~~Mobile board actions (stats, stack, settings, refresh) live inside the Erledigt panel — off-screen on Offen/Jetzt; icons 32×32, archive/stat buttons 32px tall, sort toggle 91×24. Dock above the tab bar, ≥44px~~ - done 2026-10-20 | `BoardSyncControls.vue`, `main.css` mobile board | audit F8 |
| ~~R3 (#39)~~ | ~~Mobile statistics `USelectMenu` uses v2 props (`:options`, `option-attribute`, `value-attribute`) → empty menu, shows raw `today`. Use `:items` + `value-key`~~ - done 2026-10-20 | `pages/statistics.vue:23-28` | audit F5 |
| ~~R4 (#66)~~ | ~~200% text at 1440: Erledigt pushed off-canvas (scrollWidth 2208); 10px chips don't scale; "30 min" overflows ring~~ - done 2026-10-20 | `TaskCard.vue`, board grid | audit F12 |

## Polish

| # | Item |
|---|---|
| X1 (#67) | ~~Dark mode is not implemented (`colorMode: false`); `[data-theme='dark']` tokens in `main.css` are dormant. Decide: implement or remove.~~ - done 2026-10-20 (removed; light-only) |
| ~~X2 (#68)~~ - done 2026-10-20 | ~~Visual regression doesn't cover mobile 390px, empty column, WIP-limit, drag overlay.~~ |
| ~~X3 (#69)~~ | ~~Impeccable detector on `.vue` runs regex rules only; for element rules (contrast etc.) scan the dev server or set `{ "ext": ".vue", "engine": "html" }` in `.impeccable/config.json`.~~ - done 2026-10-20 |
| ~~X4 (#70)~~ | ~~Statistics and settings read as stock Nuxt UI (KPI grid, option-card list), welcome as a third louder world (photo hero, brand-red CTA although settings says Todoist "Demnächst verfügbar"). Bring them into the Quiet Desk: serif numerals, spacing over cards, one CTA — `pages/statistics.vue`, `ModeSettingsModal.vue`, `pages/welcome.vue` (*critique*)~~ - done 2026-10-21; Todoist hidden until supported, statistics is one page without tabs |
| ~~X5 (#71)~~ - done 2026-10-22 (folded into #63) | ~~Erledigt shows "Gestern erledigt" + two inline buttons above today's wins; "Statistik öffnen" duplicates the chart icon. Move yesterday to review, keep one quiet archive action — `BoardColumnArchiveSection.vue` (*critique*)~~ |
| ~~X6 (#72)~~ | ~~Running timer reads "0 min" + 2px dot — not "running" at a glance; task detail offers timebox twice ("+ Timebox" chip and "Timebox setzen") and exposes "Metadaten" — `TaskProgressCircular.vue`, `TaskDetailContent.vue` (*critique*) |~~ - done 2026-10-20; Metadaten kept (collapsed, holds source/ID, not redundant)

## UI audit 2026-11 (#549, part of #548)

Findings of `docs/design/audit-2026-11.md` (audited at `2bc0f398`). Filed fix sets are sub-issues of #548 and carry their finding IDs; the rest are recorded here only, because fixing them changes layout or navigation (excluded by #548), touches a risk area, or is too small to file.

| # | Item | Where | Status |
|---|---|---|---|
| ~~U1 (#550)~~ | ~~Sticky page header is translucent and blurred; its height is copied as `7rem`~~ | `components/ui/PageHeader.vue`, `assets/css/app-nav.css` | done 2026-11-03: opaque `bg-page`, PageHeader publishes `--page-header-height` |
| U2 | The app bar's row is transparent, content shows beside the pills while scrolling | `assets/css/app-nav.css:42-54` | decided 2026-11-11 (kd#1): flat white pills, no glass; built in step 5 of the redesign |
| ~~U3 (#551)~~ | ~~Day close: secondary actions heavier than the CTA, footer duplicated~~ | `TaskCarryOverTriage.vue`, `DayCloseDialog.vue` | done 2026-11-03: compact triage is ghost, footer buttons carry `touch-target` (Fertig 44 px at 390) |
| ~~U4 (#552)~~ | ~~No button size and variant ladder~~ | `DESIGN.md`, `app.config.ts` | ~~filed, needs-design~~ done (`tests/config/button-ladder.test.ts`, completion date not recorded; checked 2026-11-09, `docs/design/ui-kit-audit.md`) |
| U5 (#553) | Unused components, helper and CSS | `OnboardingWelcome.vue`, `ui/feedback/ProgressBar.vue`, `ui/Section.vue`, `task-detail.css:29-61` | ~~filed, ready~~ done 2026-11-03 (#553) |
| U6 (#554) | Legacy statistics modal and the always-on `statisticsPageEnabled` flag | `TaskStatisticsModal.vue`, `app.config.ts:271` | ~~filed, needs-spec~~ done 2026-11-03 (#554) |
| ~~U7~~ | ~~Statistics drill-down opens `TaskDetailModal`, the board opens `TaskSheet`~~ | `pages/statistics.vue:34` | ~~decided 2026-11-11 (kd#1)~~ done 2026-11-11 (kd#179): statistics opens the task sheet through `/statistics/:id`, `TaskDetailModal` is gone |
| ~~U8 (#556)~~ | ~~Section-heading class string copied 11×~~ | settings pages and components | ~~filed, ready~~ done (`@utility section-heading`; checked 2026-11-09) |
| U9 (#557) | Three tab looks | `pages/settings/topics.vue:17`, `notion.vue:36`, `StatsTiles.vue:55` | ~~filed, needs-spec~~ done 2026-11-03 (#557) |
| ~~U10 (#558)~~ | ~~Hand-rolled warning boxes, drifting warning text step~~ | `SyncWarningModal.vue:100`, wizard steps | ~~filed, needs-spec~~ done (boxes gone, `warning-notices.test.ts`; plain coloured lines remain, tracked in #74; checked 2026-11-09) |
| U11 (#557) | Orange warning icon as an empty state, ALL CAPS eyebrow, `trash.empty` wording | `notion.vue:28`, `TaskDetailContent.vue:23`, `NotionSettingsSection.vue:14` | ~~filed, needs-spec~~ done 2026-11-03 (#557) |
| ~~U12 (#555)~~ | ~~Modal/drawer split and `matchMedia` copied~~ | `ResponsiveOverlay.vue`, `useIsDesktop.ts` | done 2026-11-03 |
| ~~U13 (#559)~~ | ~~16 components without `defineOptions`, 4 without a doc block, stale `trash.vue` doc, stale dark test runs~~ | see audit doc | ~~filed, ready~~ done for components (`component-conventions.test.ts`; pages are exempt by the test; checked 2026-11-09) |
| ~~U14 (#556)~~ | ~~Focus-ring utilities hand-written 11×~~ | 8 files | ~~filed, ready~~ done (`@utility focus-ring`; one hand-written ring left in `NewDayRecap.vue:41`, goes with #73; checked 2026-11-09) |
| ~~U15 (#551, #552)~~ | ~~`.touch-target` applied by hand, missed in the day-close footer~~ | `board.css:62`, `DayCloseDialog.vue` | done with U3 (#551) and U4 (#552) |
| U16 | Large components mixing jobs: `TaskForm` 777, `notion.vue` 699, `TaskDetailContent` 655, `BoardColumn` 610, `TaskCard` 594 lines | `components/task`, `components/board`, `pages/settings` | open; the board files are a drag-and-drop and visual-regression risk area, so each split is its own spec |
| U17 | 40 `data-testid`s that no test references (`day-close-body`, `trash-restore`, `trash-remove`, `gap-undo`, `settings-subpage-link`, `focus-settings`, …) | `components/**` | open, low; drop or use them in a cleanup |
| U18 | Page title scale: `PageHeader` h1 is `text-xl font-semibold`, DESIGN.md "Pages" says display headings | `components/ui/PageHeader.vue:15` | decided 2026-11-11 (kd#1): page titles are the display role, 36 px (page titles done in kd#179, 2026-11-11; section and sub-headings follow in kd#180) |
| U19 | Card titles leave a one-word last line (detector `straggler` ×3 on the demo board); `text-wrap: pretty` is not set | `components/task/TaskCard.vue:38` | open, visible on every card, regenerates visual baselines |
| ~~U20~~ | ~~`statistics.pageTitle` "Statistiken" vs the app bar place "Statistik"~~ | `i18n/locales/de.json` | done 2026-11-06 (#680): "Statistik" everywhere, `statistics-page` proposed in `docs/copy/terms.json` |
