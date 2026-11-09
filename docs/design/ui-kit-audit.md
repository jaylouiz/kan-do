# UI kit audit (delta to audit-2026-11)

Audit of what the UI kit consists of: every component, variant and state, library versus hand-built, raw `<button>` call sites, duplicated solutions, hard-coded visual values and dead code. It is the input for the sub-issues of epic #58 (UI Kit Audit and Cleanup); it changes no code (#61).

- **Audited commit:** `2a511228` (`main`), 2026-11-09. Every `file:line` below exists on that commit.
- **Delta to** `docs/design/audit-2026-11.md` (audited at `2bc0f398`): that document's findings are re-checked in "audit-2026-11 status"; its Part 1 inventory is the starting point of the duplicates section.
- **Method:** read-only `rg` and small throw-away scripts (not committed, no dependency added): the commands are in each section. A `knip` scan was tried and could not run in the audit sandbox (the `npx` download was refused), so the dead-code scan uses the import graph the issue allows instead (section "Dead code"). Nuxt UI variant names were read from `.nuxt/ui/<component>.ts` and the overrides from `app.config.ts`.
- **Taxonomy** is the one of #58 decision D1: `kind` is primitive, component, compound or block; `category` is one of Aktion, Eingabe (with form structure), Navigation (with keyboard), Feedback, Overlay, Darstellung, Layout (with blocks). A decision is `keep`, `merge` or `replace`, always with the reason and the acting sub-issue of #58.
- **Counts are measured, not estimated**, except where a cell says "approx." (regex over templates; multi-line tags with `>` inside an attribute can be miscounted by a few).

## Summary

- **105 components** under `components/` (24 Layout/blocks, 31 Darstellung, 21 Eingabe, 15 Overlay, 6 Navigation, 4 Feedback, 4 Aktion). 4 are dead (styleguide-only). 33 Nuxt UI components are used in templates (31 once `/styleguide` and its orphans go: `UContainer`, `UProgress`).
- **32 raw `<button>` elements in 18 files** (the issue counted 18 files; same files). 13 move onto `UButton` or `UTabs`, 7 merge into one list-row or choice-chip primitive, 12 are kept with a reason.
- **Biggest duplication families:** back/forward (5 implementations), icon notation (`i-ph-*` in 61 files, `ph:*` in 9), external-link icon (2), list rows (about 10 hand-built), notices (plain coloured lines 28 against `UAlert` 9), choice chips (4 hand-built looks).
- **Hard-coded values:** 20 colour literals outside the token definitions, 133 motion literals, 73 spacing literals, 54 z-index literals; table in "Hard-coded values".
- **audit-2026-11:** 16 of 20 findings are done, 4 stay open (U2, U7, U18, U19), U16 and U17 are tracked only; the backlog still shows several finished rows as open (this PR corrects them).
- **One owner was missing:** dead code and dependency drift had no sub-issue, so #86 is new (linked to #58).

## Component table

105 rows, one per `components/**/*.vue`, sorted by folder. `variant or state` lists the props of the component that are a string union or a boolean (`–` = none), `library / custom / mixed` compares Nuxt UI tags, raw buttons (`<button` tags in the source: a `v-for` renders several) and literals in the file, `usage` is the number of non-test files that render or import it. Re-measure with the commands in "Dead code".

| Component | Kind | Category | Variant or state (props) | Location | Library / custom / hard-coded | Usage | Decision | Sub-issue |
|---|---|---|---|---|---|---|---|---|
| `CommandPalette` | compound | Navigation | – | `components/CommandPalette.vue` (107 l) | library, 6 U* | 1 | keep: UCommandPalette in a UModal, the one keyboard entry (⌘K) | #73 |
| `AddTaskSlot` | block | Layout | showButton, hidden, inCard | `components/board/AddTaskSlot.vue` (362 l) | mixed, 1 U*, 1 raw button, 11 literals | 2 | keep: board slot; its raw `add-task-button` has its own row below | #77 |
| `Board` | block | Layout | – | `components/board/Board.vue` (515 l) | library, 3 U* | 2 | keep: drag-and-drop risk area, no split here (U16); page-step arrows are the back/forward family (see Duplicates) | #73 |
| `BoardColumn` | block | Layout | – | `components/board/BoardColumn.vue` (611 l) | custom, 6 literals | 2 | keep: drag-and-drop risk area | #77 |
| `BoardColumnHeader` | block | Layout | isEmpty | `components/board/BoardColumnHeader.vue` (83 l) | custom, 8 literals | 1 | keep: part of the column | #77 |
| `BoardColumnItem` | block | Layout | staticMode | `components/board/BoardColumnItem.vue` (99 l) | custom | 1 | keep: part of the column | #77 |
| `BoardColumnProgressContent` | block | Layout | isDragging | `components/board/BoardColumnProgressContent.vue` (201 l) | custom, 2 literals | 1 | keep: column progress readout | #77 |
| `BoardColumnYesterdayNote` | block | Layout | – | `components/board/BoardColumnYesterdayNote.vue` (325 l) | mixed, 2 U*, 3 raw button, 20 literals | 1 | keep: 3 raw buttons (rows below); hand-built disclosure note | #71 |
| `BoardPageDots` | component | Navigation | live | `components/board/BoardPageDots.vue` (86 l) | custom, 5 literals | 1 | keep: mobile page indicator, no library equivalent | #73 |
| `ColumnDropZone` | block | Layout | isEmpty | `components/board/ColumnDropZone.vue` (123 l) | custom, 1 literals | 2 | keep: drag-and-drop risk area | #77 |
| `ColumnSortingControl` | compound | Aktion | visible | `components/board/ColumnSortingControl.vue` (127 l) | library, 2 U*, 1 literals | 1 | keep: UDropdownMenu + UButton, a library composition | #71 |
| `DayCloseBody` | block | Layout | – | `components/board/DayCloseBody.vue` (129 l) | library, 3 U* | 1 | keep: shared by the dialog and the drawer | #77 |
| `DayCloseDialog` | block | Overlay | – | `components/board/DayCloseDialog.vue` (161 l) | library, 4 U* | 1 | keep: uses `ResponsiveOverlay` (U12 done) | #75 |
| `DayCloseTaskRow` | compound | Darstellung | – | `components/board/DayCloseTaskRow.vue` (52 l) | custom | 1 | keep: list row (see Duplicates: list rows) | #76 |
| `FocusOverlay` | block | Layout | on, leaving, touch, swallowTap | `components/board/FocusOverlay.vue` (112 l) | custom | 1 | keep: Jetzt focus backdrop, board-only | #77 |
| `NewCardFlow` | block | Eingabe | – | `components/board/NewCardFlow.vue` (1131 l) | mixed, 10 U*, 7 raw button, 36 literals | 1 | keep: 1132 lines, 7 raw buttons, its own `ncf__*` look; each raw button is a row below; do not split here (risk area) | #72 |
| `NewCardOptionList` | compound | Eingabe | searchable, showMark, large | `components/board/NewCardOptionList.vue` (138 l) | mixed, 2 U*, 2 raw button | 1 | keep: option list with search; 2 raw buttons (rows below) | #72 |
| `SortableTaskWrapper` | block | Layout | stackPosition: first·middle·last | `components/board/SortableTaskWrapper.vue` (118 l) | custom | 2 | keep: drag-and-drop risk area | #77 |
| `TaskDraftCard` | block | Layout | – | `components/board/TaskDraftCard.vue` (69 l) | custom, 2 literals | 1 | keep: in-card add draft | #77 |
| `ElementPickerBar` | compound | Feedback | – | `components/feedback/ElementPickerBar.vue` (81 l) | library, 1 U*, 2 literals | 1 | keep: feedback tooling, UButton only | #74 |
| `FeedbackAnnotator` | block | Eingabe | – | `components/feedback/FeedbackAnnotator.vue` (160 l) | library, 6 U* | 1 | keep: screenshot annotator; icon tools use UButton | #72 |
| `FeedbackDialog` | block | Overlay | – | `components/feedback/FeedbackDialog.vue` (329 l) | library, 28 U* | 1 | keep: UModal + form; plain `text-error-700` lines (see Duplicates: notices) | #75 |
| `FeedbackImage` | component | Darstellung | – | `components/feedback/FeedbackImage.vue` (52 l) | custom | 1 | keep: screenshot preview | #76 |
| `AppNav` | block | Navigation | – | `components/nav/AppNav.vue` (335 l) | mixed, 4 U*, 1 raw button | 1 | keep: the app bar pill; 1 raw button (`app-nav-more`, row below) | #73 |
| `MorePanel` | block | Navigation | – | `components/nav/MorePanel.vue` (244 l) | library, 17 U* | 1 | keep: popover panel of the app bar; rows are hand-built (see Duplicates: list rows) | #73 |
| `NotionSettingsSection` | block | Layout | isSaving, hasChanges, alwaysShowSave | `components/notion/settings/NotionSettingsSection.vue` (90 l) | library, 2 U* | 1 | keep: settings section | #77 |
| `NotionSetupModal` | block | Overlay | forceSetup | `components/notion/setup/NotionSetupModal.vue` (267 l) | library, 4 U*, 2 literals | 2 | keep: UModal wizard shell | #75 |
| `PropertyMapper` | block | Eingabe | – | `components/notion/setup/mapping/PropertyMapper.vue` (964 l) | library, 28 U* | 2 | keep: 965 lines, 16 `size="lg"` selects; revisit the size ladder | #72 |
| `WizardController` | block | Layout | broken, animate | `components/notion/setup/wizard/WizardController.vue` (829 l) | custom | 2 | keep: wizard state, no own look | #77 |
| `CustomPropertiesStep` | block | Eingabe | – | `components/notion/setup/wizard/steps/CustomPropertiesStep.vue` (210 l) | library, 3 U*, 2 literals | 2 | keep: wizard step | #72 |
| `DatabaseSelectionStep` | block | Eingabe | loading | `components/notion/setup/wizard/steps/DatabaseSelectionStep.vue` (205 l) | library, 4 U* | 1 | keep: wizard step; two-line empty state (see Duplicates: empty states) | #74 |
| `MappingStep` | block | Layout | – | `components/notion/setup/wizard/steps/MappingStep.vue` (54 l) | custom | 1 | keep: wizard step host | #77 |
| `PriorityMappingStep` | block | Eingabe | – | `components/notion/setup/wizard/steps/PriorityMappingStep.vue` (232 l) | library, 3 U* | 2 | keep: wizard step; UAlert already (U10 done) | #72 |
| `StatusMappingStep` | block | Eingabe | – | `components/notion/setup/wizard/steps/StatusMappingStep.vue` (288 l) | library, 11 U* | 2 | keep: wizard step; UAlert already (U10 done) | #72 |
| `TokenStep` | block | Eingabe | – | `components/notion/setup/wizard/steps/TokenStep.vue` (162 l) | library, 3 U* | 1 | keep: wizard step | #72 |
| `NewDayRecap` | block | Layout | – | `components/recap/NewDayRecap.vue` (181 l) | mixed, 2 U*, 1 raw button | 1 | keep: recap shell; the kind switch is a raw segmented control (row below) | #77 |
| `RecapDeck` | block | Darstellung | kind: done·undone, hideHeading | `components/recap/RecapDeck.vue` (240 l) | mixed, 2 U*, 9 literals | 1 | keep: swipe deck; caret-left/right buttons are the back/forward family | #73 |
| `DataBackupList` | block | Darstellung | – | `components/settings/DataBackupList.vue` (173 l) | library, 5 U* | 1 | keep: list rows plus a plain `text-warning-700` line | #76 |
| `DataConflictCopies` | block | Darstellung | – | `components/settings/DataConflictCopies.vue` (94 l) | library, 2 U* | 1 | keep: list rows plus a plain error line | #76 |
| `DataConflictModal` | block | Overlay | – | `components/settings/DataConflictModal.vue` (165 l) | library, 5 U* | 1 | keep: UModal; plain error line | #75 |
| `DataExportImport` | block | Layout | – | `components/settings/DataExportImport.vue` (97 l) | library, 2 U* | 1 | keep: settings section; plain status lines | #77 |
| `DataFolderChangeModal` | block | Overlay | – | `components/settings/DataFolderChangeModal.vue` (193 l) | library, 5 U* | 1 | keep: UModal + URadioGroup | #75 |
| `DataRestoreModal` | block | Overlay | – | `components/settings/DataRestoreModal.vue` (135 l) | library, 4 U* | 1 | keep: UModal | #75 |
| `DataStorageNotice` | compound | Feedback | showDetails | `components/settings/DataStorageNotice.vue` (119 l) | library, 1 U* | 3 | keep: the system notice: UAlert subtle | #74 |
| `DisconnectSourceDialog` | block | Overlay | – | `components/settings/DisconnectSourceDialog.vue` (173 l) | library, 6 U* | 1 | keep: UModal + 2 UAlert | #75 |
| `GithubTokenRow` | compound | Eingabe | – | `components/settings/GithubTokenRow.vue` (222 l) | library, 11 U* | 1 | keep: token field row; `arrow-up-right` external link (see Duplicates) | #67 |
| `SettingsSubpageLink` | compound | Navigation | – | `components/settings/SettingsSubpageLink.vue` (42 l) | library, 2 U* | 2 | keep: link row to a sub-page (list row family) | #73 |
| `SourceRow` | compound | Darstellung | – | `components/settings/SourceRow.vue` (115 l) | library, 6 U* | 1 | keep: the canonical list row (audit-2026-11) | #76 |
| `LocalSetupFlow` | block | Layout | – | `components/setup/LocalSetupFlow.vue` (93 l) | mixed, 3 U*, 1 raw button, 1 literals | 1 | keep: imports reka-ui directly; raw back button (row below) | #73 |
| `NotionSetupFlow` | block | Layout | – | `components/setup/NotionSetupFlow.vue` (187 l) | mixed, 3 U*, 1 raw button, 1 literals | 1 | keep: raw back button (row below) | #73 |
| `SetupRail` | compound | Navigation | – | `components/setup/SetupRail.vue` (96 l) | library, 1 U*, 3 literals | 1 | keep: stepper rail | #73 |
| `StatsEstimateRing` | component | Darstellung | – | `components/statistics/StatsEstimateRing.vue` (48 l) | custom | 1 | keep: SVG chart, custom | #76 |
| `StatsOutliers` | compound | Darstellung | – | `components/statistics/StatsOutliers.vue` (41 l) | mixed, 1 raw button | 1 | keep: 1 raw row button (row below) | #76 |
| `StatsPatterns` | compound | Darstellung | – | `components/statistics/StatsPatterns.vue` (74 l) | library, 1 U* | 1 | keep: chart tile content | #76 |
| `StatsRhythmBars` | component | Darstellung | ghost | `components/statistics/StatsRhythmBars.vue` (54 l) | custom | 1 | keep: SVG chart, custom | #76 |
| `StatsRhythmGrid` | component | Darstellung | – | `components/statistics/StatsRhythmGrid.vue` (76 l) | custom | 1 | keep: SVG chart, custom | #76 |
| `StatsRing` | component | Darstellung | – | `components/statistics/StatsRing.vue` (81 l) | custom | 3 | keep: SVG ring, 3 users | #76 |
| `StatsTile` | compound | Darstellung | open, tone: default·elevated, toggleable, wide | `components/statistics/StatsTile.vue` (81 l) | mixed, 1 U*, 2 raw button | 1 | keep: disclosure tile; the raw toggle sits inside an `<h2>` (row below) | #76 |
| `StatsTiles` | block | Darstellung | – | `components/statistics/StatsTiles.vue` (248 l) | library, 1 U* | 1 | keep: tile group with UTabs | #76 |
| `StatsTimeSplit` | component | Darstellung | by: topic·activity, mode: chart·rows, stacked | `components/statistics/StatsTimeSplit.vue` (80 l) | custom | 1 | keep: SVG chart, custom | #76 |
| `StatsTrendBars` | component | Darstellung | – | `components/statistics/StatsTrendBars.vue` (45 l) | custom | 1 | keep: SVG chart, custom | #76 |
| `StatsVerdict` | block | Darstellung | – | `components/statistics/StatsVerdict.vue` (83 l) | custom | 1 | keep: verdict surface | #76 |
| `StatsWeekTable` | component | Darstellung | – | `components/statistics/StatsWeekTable.vue` (46 l) | custom | 1 | keep: small table with hairlines; UTable is not used here, see `TasksTable` | #76 |
| `TasksTable` | compound | Darstellung | showCompletedDate | `components/statistics/TasksTable.vue` (189 l) | library, 1 U*, 1 literals | 1 | keep: the only UTable | #76 |
| `SyncWarningModal` | block | Overlay | open | `components/sync/SyncWarningModal.vue` (146 l) | library, 6 U* | 2 | keep: UModal + 3 UAlert | #75 |
| `AddTargetSwitch` | compound | Eingabe | – | `components/task/AddTargetSwitch.vue` (55 l) | custom | 1 | keep: add target switch (#321) | #72 |
| `DatePickerField` | compound | Eingabe | disabled | `components/task/DatePickerField.vue` (117 l) | mixed, 4 U*, 1 raw button, 1 literals | 1 | keep: UPopover + UCalendar; the trigger is a raw button (row below) | #72 |
| `TaskCard` | block | Darstellung | muted, preview, draft, readonly | `components/task/TaskCard.vue` (669 l) | mixed, 4 U*, 31 literals | 9 | keep: UCard `variant="task"`; 670 lines, 26 hard-coded literals, motion heavy; drag-and-drop risk area | #69 |
| `TaskCardContextMenu` | compound | Overlay | – | `components/task/TaskCardContextMenu.vue` (333 l) | library, 5 U* | 2 | keep: UContextMenu | #75 |
| `TaskCarryOverDots` | component | Darstellung | decorative | `components/task/TaskCarryOverDots.vue` (105 l) | mixed, 1 U*, 6 literals | 4 | keep: 4 users | #76 |
| `TaskCarryOverTriage` | compound | Aktion | compact | `components/task/TaskCarryOverTriage.vue` (113 l) | library, 3 U* | 2 | keep: 3 UButtons (U3 done) | #71 |
| `TaskCompletionBurst` | component | Feedback | – | `components/task/TaskCompletionBurst.vue` (159 l) | custom, 4 literals | 1 | keep: celebration animation | #74 |
| `TaskDeletedGap` | block | Feedback | – | `components/task/TaskDeletedGap.vue` (237 l) | mixed, 2 U*, 20 literals | 2 | keep: undo pill with its own motion (17 literals) | #70 |
| `TaskDetailContent` | block | Layout | isPreview, startSmaller | `components/task/TaskDetailContent.vue` (750 l) | mixed, 2 U*, 1 raw button | 3 | keep: sheet content; 1 raw button (row below) | #77 |
| `TaskDetailCustomFields` | compound | Eingabe | – | `components/task/TaskDetailCustomFields.vue` (224 l) | library, 2 U* | 1 | keep: custom field editors | #72 |
| `TaskDetailMetadata` | compound | Darstellung | pinned | `components/task/TaskDetailMetadata.vue` (64 l) | library, 3 U*, 1 literals | 1 | keep: UCollapsible | #76 |
| `TaskDetailModal` | compound | Overlay | modelValue | `components/task/TaskDetailModal.vue` (74 l) | library, 1 U*, 1 literals | 2 | keep: modal twin of the sheet, used from `/statistics` only (U7, a layout decision, stays open) | #75 |
| `TaskDetailNotes` | compound | Eingabe | – | `components/task/TaskDetailNotes.vue` (90 l) | library, 1 U* | 1 | keep: notes textarea | #72 |
| `TaskForm` | block | Eingabe | autoFocus, isUnplanned, isPreview | `components/task/TaskForm.vue` (822 l) | mixed, 10 U*, 2 raw button | 2 | keep: 823 lines, 2 raw buttons (rows below) | #72 |
| `TaskPriorityBadge` | component | Darstellung | size: xs·sm·md·lg·xl | `components/task/TaskPriorityBadge.vue` (88 l) | library, 2 U* | 3 | keep: UBadge + UTooltip | #76 |
| `TaskProgressBar` | component | Darstellung | – | `components/task/TaskProgressBar.vue` (217 l) | mixed, 2 U*, 4 literals | 1 | replace: dead: only `pages/styleguide.vue` uses it; `TaskProgressChip` is the live one; delete with `/styleguide` | #86 |
| `TaskProgressChip` | component | Darstellung | isNow | `components/task/TaskProgressChip.vue` (312 l) | mixed, 1 U*, 20 literals | 1 | keep: live progress readout | #76 |
| `TaskPropertyRow` | compound | Eingabe | private | `components/task/TaskPropertyRow.vue` (44 l) | custom | 3 | keep: label + value row of the sheet (form structure) | #72 |
| `TaskPropertySelect` | compound | Eingabe | multiple, searchAutofocus, createItem, disabled, side: top·bottom, align: start·center·end | `components/task/TaskPropertySelect.vue` (152 l) | library, 2 U* | 5 | keep: USelectMenu `property` variant (app.config) | #72 |
| `TaskSheet` | block | Overlay | open, hideTitle, flushBody | `components/task/TaskSheet.vue` (190 l) | custom | 2 | keep: uses `ResponsiveOverlay` | #75 |
| `TaskSourceIcon` | primitive | Darstellung | – | `components/task/TaskSourceIcon.vue` (38 l) | library, 1 U* | 1 | keep: source glyph | #76 |
| `TaskStack` | block | Layout | muted, preview | `components/task/TaskStack.vue` (357 l) | custom, 3 literals | 2 | keep: drag-and-drop risk area | #77 |
| `TaskStackHeader` | block | Layout | – | `components/task/TaskStackHeader.vue` (133 l) | custom, 3 literals | 1 | keep: drag-and-drop risk area | #77 |
| `TaskStackPill` | compound | Darstellung | – | `components/task/TaskStackPill.vue` (141 l) | custom, 10 literals | 2 | keep: domain chip | #76 |
| `TaskTimebox` | component | Darstellung | – | `components/task/TaskTimebox.vue` (53 l) | library, 1 U* | 1 | replace: dead: only `pages/styleguide.vue` uses it; delete with `/styleguide` | #86 |
| `TaskTimeboxNudge` | block | Eingabe | – | `components/task/TaskTimeboxNudge.vue` (515 l) | mixed, 2 U*, 3 raw button, 24 literals | 1 | keep: 516 lines, 3 raw buttons (rows below) with its own `nudge__*` look | #72 |
| `TaskTimer` | component | Darstellung | – | `components/task/TaskTimer.vue` (106 l) | library, 1 U* | 1 | replace: dead: only `pages/styleguide.vue` uses it; delete with `/styleguide` | #86 |
| `TopicPropertyPicker` | compound | Eingabe | kind: topic·activity, createItem, editable | `components/task/TopicPropertyPicker.vue` (184 l) | mixed, 3 U*, 1 raw button | 1 | keep: picker with one raw row button (row below) | #72 |
| `TopicEditor` | compound | Eingabe | – | `components/topic/TopicEditor.vue` (354 l) | mixed, 7 U*, 3 raw button, 4 literals | 1 | keep: swatch and symbol radio groups are raw buttons (rows below) | #72 |
| `TopicEditorHost` | compound | Overlay | – | `components/topic/TopicEditorHost.vue` (57 l) | library, 1 U* | 2 | keep: UDrawer host | #75 |
| `TopicMark` | primitive | Darstellung | task: Pick<Task,source·topic·topicColorCode>·n | `components/topic/TopicMark.vue` (76 l) | library, 1 U* | 9 | keep: topic glyph, 9 users | #76 |
| `TrashEntryRow` | compound | Darstellung | forever | `components/trash/TrashEntryRow.vue` (154 l) | mixed, 4 U*, 5 literals | 1 | keep: list row (canonical with `SourceRow`) | #76 |
| `ExpandingButton` | component | Aktion | – | `components/ui/ExpandingButton.vue` (112 l) | library, 2 U*, 1 literals | 1 | replace: dead: only `pages/styleguide.vue` uses it; delete with `/styleguide` | #86 |
| `ExternalLink` | compound | Aktion | – | `components/ui/ExternalLink.vue` (48 l) | custom | 3 | keep: the one external-link anchor; icon notation decided in #67 | #67 |
| `PageHeader` | compound | Layout | narrow | `components/ui/PageHeader.vue` (49 l) | custom | 1 | keep: sticky page header (U1 done) | #77 |
| `ResponsiveOverlay` | compound | Overlay | open, desktop: modal·slideover, closeButton | `components/ui/ResponsiveOverlay.vue` (172 l) | library, 3 U* | 3 | keep: modal on desktop, drawer on phone (U12 done) | #75 |
| `SectionHeader` | compound | Layout | tag: div·h1·h2·h3·h4·h5·h6 | `components/ui/SectionHeader.vue` (51 l) | library, 1 U* | 5 | keep: 5 users; the `section-heading` utility covers the page-level heading | #77 |
| `InlineEditable` | compound | Eingabe | showEditIcon, multiline, affordance: fill·rule, interactiveDisplay, required | `components/ui/inline/InlineEditable.vue` (319 l) | library, 2 U*, 1 literals | 4 | keep: inline edit; UInput inside | #72 |
| `UpdateDialog` | block | Overlay | – | `components/updates/UpdateDialog.vue` (134 l) | library, 4 U* | 1 | keep: UModal | #75 |
| `WhatsNewDialog` | block | Overlay | – | `components/updates/WhatsNewDialog.vue` (62 l) | library, 2 U* | 1 | keep: UModal | #75 |

## Nuxt UI components in use

33 components (`rg -o '<U[A-Z]\w+' components pages layouts app.vue`), `Used` columns from the templates (approx.: regex over tags, dynamic bindings counted as "dynamic"); a variant not listed is not set explicitly and falls to the default (`app.config.ts` sets the `button` default size `md`, `tabs` default colour `neutral`). The theme axes available for each component are in `.nuxt/ui/<component>.ts`; every explicitly used value was found there.

| Component | Kind | Category | Variants and states used | Location(s) | Library / custom / hard-coded | Usage | Decision | Sub-issue |
|---|---|---|---|---|---|---|---|---|
| `UButton` | primitive | Aktion | variant: soft ×43, ghost ×43, link ×8, dynamic ×6; color: neutral ×88, primary ×22, error ×5, warning ×2, success ×1, dynamic ×6; size: sm ×34, lg ×23, xs ×1, dynamic ×1; loading ×28; block ×11 | `components/board/Board.vue`, `components/board/ColumnSortingControl.vue`, `components/board/DayCloseBody.vue` (+42) | library; theme override: yes; `:ui` on 2 tags | 146 tags in 45 files | keep: the one button; ladder guarded by `button-ladder.test.ts`; raw `<button>` sites listed below move onto it | #71 |
| `UIcon` | primitive | Darstellung | no variant props set | `components/board/AddTaskSlot.vue`, `components/board/Board.vue`, `components/board/BoardColumnYesterdayNote.vue` (+33) | library; theme override: no; `:ui` on 0 tags | 61 tags in 36 files | keep: notation (`i-ph-*` vs `ph:*`) and size classes decided in #67 | #67 |
| `UFormField` | compound | Eingabe | no variant props set | `components/feedback/FeedbackDialog.vue`, `components/nav/MorePanel.vue`, `components/notion/setup/mapping/PropertyMapper.vue` (+6) | library; theme override: no; `:ui` on 1 tags | 32 tags in 9 files | keep: the one field wrapper (label, hint, error) | #72 |
| `USelect` | primitive | Eingabe | size: lg ×22 | `components/notion/setup/mapping/PropertyMapper.vue`, `components/notion/setup/wizard/steps/DatabaseSelectionStep.vue`, `components/notion/setup/wizard/steps/StatusMappingStep.vue` (+1) | library; theme override: yes; `:ui` on 0 tags | 24 tags in 4 files | keep: native-style select, always `size="lg"`; justify against `USelectMenu` or merge | #72 |
| `UInput` | primitive | Eingabe | variant: ghost ×1, dynamic ×1; color: dynamic ×1; size: sm ×8, md ×1, lg ×1, xl ×1, dynamic ×2; loading ×1 | `components/board/NewCardOptionList.vue`, `components/feedback/FeedbackDialog.vue`, `components/notion/setup/mapping/PropertyMapper.vue` (+9) | library; theme override: yes; `:ui` on 7 tags | 21 tags in 12 files | keep: sizes `sm`…`xl` in use; align on the ladder | #72 |
| `UModal` | compound | Overlay | no variant props set | `components/CommandPalette.vue`, `components/feedback/FeedbackDialog.vue`, `components/notion/setup/NotionSetupModal.vue` (+10) | library; theme override: yes; `:ui` on 13 tags | 13 tags in 13 files | keep: width through `MODAL_WIDTH`; identity strings in `:ui` move to `app.config.ts` (D1) | #75 |
| `UCheckbox` | primitive | Eingabe | color: neutral ×7, primary ×1 | `components/feedback/FeedbackAnnotator.vue`, `components/feedback/FeedbackDialog.vue`, `components/settings/DataRestoreModal.vue` (+2) | library; theme override: no; `:ui` on 0 tags | 10 tags in 5 files | keep | #72 |
| `UAlert` | compound | Feedback | variant: subtle ×8, soft ×1; color: warning ×6, error ×1, info ×1, dynamic ×1; orientation: horizontal ×1 | `components/notion/setup/wizard/steps/PriorityMappingStep.vue`, `components/notion/setup/wizard/steps/StatusMappingStep.vue`, `components/notion/setup/wizard/steps/TokenStep.vue` (+3) | library; theme override: yes; `:ui` on 2 tags | 9 tags in 6 files | keep: the system notice; plain coloured text lines merge into it (see Duplicates: notices) | #74 |
| `UBadge` | primitive | Darstellung | variant: subtle ×2, soft ×2; color: neutral ×4; size: sm ×2, xs ×1, dynamic ×1 | `components/notion/setup/wizard/steps/CustomPropertiesStep.vue`, `components/settings/SourceRow.vue`, `components/task/TaskPriorityBadge.vue` (+1) | library; theme override: yes; `:ui` on 0 tags | 9 tags in 4 files | keep: `neutral` `soft`/`subtle`; domain chips stay custom | #76 |
| `UKbd` | primitive | Navigation | no variant props set | `components/CommandPalette.vue`, `components/nav/MorePanel.vue` | library; theme override: no; `:ui` on 0 tags | 6 tags in 2 files | keep: shortcut hints | #73 |
| `UTooltip` | primitive | Overlay | no variant props set | `components/feedback/FeedbackAnnotator.vue`, `components/nav/AppNav.vue`, `components/task/TaskCarryOverDots.vue` (+1) | library; theme override: yes; `:ui` on 0 tags | 5 tags in 4 files | keep | #75 |
| `UPopover` | primitive | Overlay | no variant props set | `components/board/NewCardFlow.vue`, `components/nav/AppNav.vue`, `components/task/DatePickerField.vue` (+1) | library; theme override: yes; `:ui` on 2 tags | 4 tags in 4 files | keep | #75 |
| `USeparator` | primitive | Layout | no variant props set | `components/nav/MorePanel.vue` | library; theme override: no; `:ui` on 0 tags | 4 tags in 1 files | keep | #77 |
| `USwitch` | primitive | Eingabe | color: neutral ×1; size: lg ×1 | `components/nav/MorePanel.vue`, `components/notion/setup/wizard/steps/CustomPropertiesStep.vue`, `components/recap/NewDayRecap.vue` (+1) | library; theme override: yes; `:ui` on 1 tags | 4 tags in 4 files | keep: off-state override in `app.config.ts` (#683) | #72 |
| `UTabs` | compound | Navigation | size: sm ×1; orientation: dynamic ×1 | `components/statistics/StatsTiles.vue`, `pages/settings/index.vue`, `pages/settings/notion.vue` (+1) | library; theme override: yes; `:ui` on 3 tags | 4 tags in 4 files | keep: the one tab implementation (guarded by `design-patterns.test.ts`); the raw segmented control in `NewDayRecap` moves onto its `pill` variant | #73 |
| `UCard` | compound | Darstellung | variant: task ×1 | `components/task/TaskCard.vue` | library; theme override: yes; `:ui` on 1 tags | 3 tags in 1 files | keep: only `variant="task"` in the app; `variant="subtle"` is styleguide-only | #76 |
| `UDrawer` | compound | Overlay | no variant props set | `components/board/NewCardFlow.vue`, `components/topic/TopicEditorHost.vue`, `components/ui/ResponsiveOverlay.vue` | library; theme override: yes; `:ui` on 2 tags | 3 tags in 3 files | keep: through `ResponsiveOverlay` and `TopicEditorHost` | #75 |
| `USelectMenu` | compound | Eingabe | variant: property ×1; size: lg ×1, md ×1 | `components/notion/setup/wizard/steps/PriorityMappingStep.vue`, `components/task/TaskPropertySelect.vue` | library; theme override: yes; `:ui` on 1 tags | 3 tags in 2 files | keep: searchable and the `property` text trigger; the reason `USelect` stays separate is recorded in #72 | #72 |
| `UTextarea` | primitive | Eingabe | no variant props set | `components/feedback/FeedbackDialog.vue`, `components/task/TaskDetailNotes.vue`, `components/task/TaskForm.vue` | library; theme override: yes; `:ui` on 0 tags | 3 tags in 3 files | keep | #72 |
| `UContainer` | primitive | Layout | – | `pages/styleguide.vue` | library; theme override: no; `:ui` on 0 tags | 2 tags in 1 files | replace: styleguide-only; gone with `/styleguide`, no replacement needed | #86 |
| `UDropdownMenu` | compound | Aktion | no variant props set | `components/board/ColumnSortingControl.vue`, `components/task/TaskDetailContent.vue` | library; theme override: yes; `:ui` on 1 tags | 2 tags in 2 files | keep | #71 |
| `ULink` | primitive | Aktion | no variant props set | `components/feedback/FeedbackDialog.vue` | library; theme override: no; `:ui` on 0 tags | 2 tags in 1 files | keep: wrapped by `ExternalLink` for external links | #71 |
| `UProgress` | primitive | Feedback | color: dynamic ×1; size: 2xl ×1 | `components/task/TaskProgressBar.vue` | library; theme override: no; `:ui` on 1 tags | 2 tags in 1 files | keep until #86, then unused: its only app user is the dead `TaskProgressBar`; left out of `/ui` (the epic leaves unused components out) unless #74 finds a use | #86 |
| `UApp` | primitive | Layout | no variant props set | `app.vue` | library; theme override: no; `:ui` on 0 tags | 1 tags in 1 files | keep: required Nuxt UI provider (toasts, tooltips, overlays) | #77 |
| `UCalendar` | compound | Eingabe | no variant props set | `components/task/DatePickerField.vue` | library; theme override: no; `:ui` on 0 tags | 1 tags in 1 files | keep: one use (`DatePickerField`) | #72 |
| `UChip` | primitive | Darstellung | color: error ×1; size: lg ×1 | `components/nav/AppNav.vue` | library; theme override: no; `:ui` on 1 tags | 1 tags in 1 files | keep: one use (the app bar problem dot) | #73 |
| `UCollapsible` | compound | Darstellung | no variant props set | `components/task/TaskDetailMetadata.vue` | library; theme override: yes; `:ui` on 0 tags | 1 tags in 1 files | keep: one use (`TaskDetailMetadata`); candidate for the `StatsTile` disclosure | #76 |
| `UCommandPalette` | compound | Navigation | loading ×1 | `components/CommandPalette.vue` | library; theme override: no; `:ui` on 1 tags | 1 tags in 1 files | keep: one use (`CommandPalette`) | #73 |
| `UContextMenu` | compound | Overlay | size: md ×1 | `components/task/TaskCardContextMenu.vue` | library; theme override: no; `:ui` on 1 tags | 1 tags in 1 files | keep: one use (`TaskCardContextMenu`) | #75 |
| `UForm` | compound | Eingabe | no variant props set | `components/task/TaskForm.vue` | library; theme override: no; `:ui` on 0 tags | 1 tags in 1 files | keep: one use (`TaskForm`) | #72 |
| `URadioGroup` | primitive | Eingabe | color: neutral ×1 | `components/settings/DataFolderChangeModal.vue` | library; theme override: no; `:ui` on 1 tags | 1 tags in 1 files | keep: one use; the swatch groups in `TopicEditor` are raw buttons (see raw buttons) | #72 |
| `USlideover` | compound | Overlay | side: right ×1 | `components/ui/ResponsiveOverlay.vue` | library; theme override: yes; `:ui` on 1 tags | 1 tags in 1 files | keep: only inside `ResponsiveOverlay` | #75 |
| `UTable` | compound | Darstellung | no variant props set | `components/statistics/TasksTable.vue` | library; theme override: no; `:ui` on 1 tags | 1 tags in 1 files | keep: one use (`TasksTable`); `StatsWeekTable` is a hand-built table, justify or merge | #76 |

## Raw `<button>` call sites

`rg -n '<button\b' components pages layouts app.vue` (2026-11-09): 33 matches, 32 elements (one match is a comment in `StatsTile.vue:6`), in 18 files. "Becomes" names the target; `UButton` means `variant="ghost"` or `"soft"` as the DESIGN.md "Buttons" ladder says, `color="neutral"`, with the 44 px phone floor from `app.config.ts`.

| Where | What it is | Becomes / decision | Sub-issue |
|---|---|---|---|
| `pages/welcome.vue:68` | choice card (icon, two lines, arrow) | keep: rich two-line card is not a button look; name it a documented "choice row" primitive | #71 |
| `components/nav/AppNav.vue:81` | the app bar "more" pill with a status dot | keep: part of the app bar pill (`app-nav-more`, `is-open` state), not a button | #73 |
| `components/setup/NotionSetupFlow.vue:31` | text back link (`arrow-left`) | replace: `UButton` ghost neutral, back icon of the semantic map | #73 |
| `components/setup/LocalSetupFlow.vue:14` | text back link (`arrow-left`) | replace: same as above, one back control for both flows | #73 |
| `pages/settings/topics.vue:30` | topic row button | merge: the one list-row primitive (see Duplicates: list rows) | #76 |
| `components/recap/NewDayRecap.vue:37` | two-way kind switch with hand-written focus outline | replace: `UTabs` `pill` variant (already in `app.config.ts`) | #73 |
| `components/task/TaskTimeboxNudge.vue:44` | minute chip | merge: the choice-chip primitive | #72 |
| `components/task/TaskTimeboxNudge.vue:54` | "custom" icon chip | replace: `UButton` icon, ghost | #72 |
| `components/task/TaskTimeboxNudge.vue:80` | apply (check) icon | replace: `UButton` icon, soft primary | #72 |
| `components/task/DatePickerField.vue:15` | property value trigger (`task-property-value`) | keep: the sheet's text-style trigger; one documented primitive with the three below | #72 |
| `components/task/TaskDetailContent.vue:195` | timebox suggestion (`task-property-value`) | keep: same primitive | #72 |
| `components/task/TaskForm.vue:123` | timebox minute option (`task-property-value`) | keep: same primitive | #72 |
| `components/task/TaskForm.vue:136` | timebox suggestion (`task-property-value`) | keep: same primitive | #72 |
| `components/statistics/StatsTile.vue:20` | disclosure toggle inside an `<h2>` (`aria-expanded`) | keep: the heading wraps the toggle; check whether `UCollapsible` can carry it | #76 |
| `components/task/TopicPropertyPicker.vue:46` | picker row (`picker-edit-row`) | merge: list-row primitive | #76 |
| `components/board/NewCardOptionList.vue:35` | "create new" option row | keep: option row of a searchable list; same look as the next row | #72 |
| `components/board/NewCardOptionList.vue:45` | option row with `aria-current` | keep: see above; one option-row primitive with `NewCardFlow` pills | #72 |
| `components/board/BoardColumnYesterdayNote.vue:25` | disclosure toggle | replace: `UButton` ghost | #71 |
| `components/board/BoardColumnYesterdayNote.vue:48` | "Gesehen" acknowledge | replace: `UButton` ghost | #71 |
| `components/board/BoardColumnYesterdayNote.vue:67` | task title as link | replace: `UButton` `link` variant | #71 |
| `components/board/NewCardFlow.vue:58` | confirm title (check) | replace: `UButton` icon, soft primary | #71 |
| `components/board/NewCardFlow.vue:85` | step back (`caret-left`) | replace: back control of the semantic map | #73 |
| `components/board/NewCardFlow.vue:97` | skip (`arrow-right`) | replace: forward control of the semantic map | #73 |
| `components/board/NewCardFlow.vue:124` | save pill | replace: `UButton` primary | #71 |
| `components/board/NewCardFlow.vue:139` | option pill | merge: choice-chip primitive | #72 |
| `components/board/NewCardFlow.vue:160` | "more options" pill | merge: choice-chip primitive | #72 |
| `components/board/NewCardFlow.vue:181` | "more options" pill (second branch) | merge: same | #72 |
| `components/topic/TopicEditor.vue:46` | colour swatch (`role="radio"`) | keep: swatches are not buttons; a documented swatch radio primitive | #72 |
| `components/topic/TopicEditor.vue:75` | symbol picker trigger | replace: `UButton` soft | #72 |
| `components/topic/TopicEditor.vue:91` | symbol option (`role="radio"`) | keep: with the swatch primitive | #72 |
| `components/statistics/StatsOutliers.vue:15` | outlier row button | merge: list-row primitive | #76 |
| `components/board/AddTaskSlot.vue:21` | the column's add-task slot (`add-task-button`) | keep until baselines (#63) exist; then decide whether `UButton ghost block` reproduces it | #71 |

Result: 13 replace (onto `UButton` or `UTabs`), 7 merge (into the list-row and choice-chip primitives), 12 keep with a reason. The two guards today: `tests/config/button-ladder.test.ts` covers `UButton` only; nothing stops a new raw `<button>` (ratchet for #78).

## One job, several implementations

Each family lists the implementations found (counts from `rg` on 2026-11-09), the decision and the owner. A rule that fixes a notation or a hierarchy is a DESIGN.md change and one-way (#68 files the decision request); the sub-issue named here only implements the answer.

### Back and forward

| Site | Implementation | Icon |
|---|---|---|
| `components/board/NewCardFlow.vue:85,97` | raw `<button class="ncf__nav">` | `caret-left` / `arrow-right` |
| `components/setup/LocalSetupFlow.vue:14`, `NotionSetupFlow.vue:31` | raw `<button>` with text | `arrow-left` |
| `components/recap/RecapDeck.vue:66,80` | `UButton` icon | `caret-left` / `caret-right` |
| `components/board/Board.vue:109,118` | `UButton` with a `UIcon` slot | `caret-left-bold` / `caret-right-bold` (`size-6`) |
| `pages/welcome.vue:78`, `components/settings/SettingsSubpageLink.vue:25`, `components/recap/NewDayRecap.vue:83` | affordance arrow on a row or CTA (not a step control) | `arrow-right` |

**Decision: merge** the four step-control implementations into `UButton` ghost neutral with one icon pair; the proposal for #68 is `caret-left` / `caret-right` for stepping and `arrow-right` only as the "go on" affordance of a row or CTA (a different job, kept). The `-bold` weight in `Board.vue` goes with the notation decision. Owner: #67 (icon map), #68 (rule), #73 (call sites).

### Open external, open details

| Icon | Uses | Job |
|---|---|---|
| `arrow-square-out` | 6 uses in 5 files: `useFeedback.ts:527` and `FeedbackDialog.vue:240` (external page); `useCommandPalette.ts:102` and `TaskDetailContent.vue:717` (open the task details, not external) | mixed: external and internal |
| `arrow-up-right` | 4 uses in 3 files: `GithubTokenRow.vue:85,103` (external link); `FeedbackAnnotator.vue:101` (the annotation arrow tool, unrelated) | external |

**Decision: merge.** One icon for "opens outside the app" (proposal: `arrow-square-out`), `arrow-up-right` stays only as the annotator's arrow tool, and "open details" gets an internal icon. The external anchor is `ExternalLink` (3 users). Owner: #67, rule #68, call sites #71.

### Icon notation

`i-ph-*` appears 240 times in 61 files; `ph:*` 31 times in 9 files (`rg -o 'i-ph-[\w-]+'` and `rg -o 'ph:[a-z][\w-]+'` over `components pages layouts app.vue lib composables utils app.config.ts`). The issue's "47 files" has grown to 61. **Decision: merge** to `i-ph-*` (the form Nuxt Icon and `tests/config/icons-bundled.test.ts` already assume, static and greppable); `ph:*` stays only where a string is built or stored in data. Owner #67.

### Tabs and segmented controls

`UTabs` in 4 files (`pages/settings/index.vue:29`, `topics.vue:17`, `notion.vue:39`, `StatsTiles.vue:59`); no hand-rolled `role="tab"` left (U9 done, guarded by `design-patterns.test.ts`). Still hand-built: the two-way kind switch in `NewDayRecap.vue:37` (raw buttons), the group-by chips in `MorePanel`, the app bar pill (`app-nav.css`, a place switcher by decision). **Decision:** `NewDayRecap` moves onto `UTabs` `pill`; `MorePanel` chips are re-checked against it; the app bar pill stays (it navigates places, DESIGN.md "App bar"). Owner #73.

### Notices

| Implementation | Count |
|---|---|
| `UAlert` | 9 tags in 6 files (`SyncWarningModal` ×3, `DisconnectSourceDialog` ×2, `PriorityMappingStep`, `StatusMappingStep`, `TokenStep`, `DataStorageNotice`) |
| plain `<p class="text-error-700">` or `text-warning-700/800` lines with `role="alert"`/`status` | 28 lines in 18 files (19 `text-error-700` in 14 files, 9 warning lines in 8 files): the `Data*` modals, `FeedbackDialog`, `FeedbackAnnotator`, `UpdateDialog`, `DataBackupList:40`, `GithubTokenRow:70,92` |
| toasts (`useToast`/`toast.add`) | 11 files (composables and components); the error path is `useErrorHandler` |
| hand-rolled bordered boxes (`border-warning/20`) | 0 (U10 done) |

**Decision: merge** the plain lines that explain a failure or a state into `UAlert` subtle; keep an inline field error as the `UFormField` error. Which of toast, alert and inline line is right is the #68 rule. Owner #74.

### Empty states

One muted sentence: `pages/trash.vue:37`, `WhatsNewDialog.vue:32`, `DataBackupList.vue:50`, `StatsOutliers.vue:12`, `TasksTable.vue:15`, `CommandPalette.vue:32`, `CustomPropertiesStep.vue:53`. Two lines (sentence plus hint): `DatabaseSelectionStep.vue:41`. Empty board columns stay blank (P5, open in `docs/design/backlog.md`, not re-filed). The orange icon empty state is gone (U11 done). **Decision: keep** the muted sentence as the one empty state; the two-line step becomes sentence plus `UAlert` hint only if the #68 rule asks for it. Owner #74.

### List rows

Hand-built, none through a shared component: `SourceRow` (canonical per audit-2026-11), `TrashEntryRow`, `DataBackupList`, `DataConflictCopies`, `DayCloseTaskRow`, `MorePanel` rows, `SettingsSubpageLink`, the topic rows in `pages/settings/topics.vue:30`, `StatsOutliers`, `StatsWeekTable`, `CustomPropertiesStep`; `divide-y divide-default` in 12 files. **Decision: merge** into one list-row primitive built from the `SourceRow` / `TrashEntryRow` look; raw-button rows (`topics.vue`, `TopicPropertyPicker`, `StatsOutliers`) become its action variant. Owner #76.

### Choice chips (pick one of a few)

Four hand-built looks: `ncf__pill` (`NewCardFlow`), `nudge__button` (`TaskTimeboxNudge`), the option rows of `NewCardOptionList`, the group-by chips of `MorePanel`; the sheet's `task-property-value` triggers (`DatePickerField`, `TaskDetailContent`, `TaskForm` ×2) are a fifth. **Decision: merge** the first four into one choice-chip primitive and document the property-value trigger as its own primitive. Owner #72.

### Buttons, overlays, overrides

- **Button size:** `size="lg"` 50, `sm` 53, `xs` 6, `md` 4, `xl` 3 call sites; the ladder of #552 is in force and guarded by `button-ladder.test.ts`. `variant="outline"` appears only in the styleguide. **Keep.**
- **Overlay shells:** one `ResponsiveOverlay` (U12 done) for the day-close dialog and the sheet; `TopicEditorHost` is a drawer on every width. `useMediaQuery`/`matchMedia` remain in 8 component and page files (`AppNav`, `MorePanel`, `Board`, `NewCardFlow`, `TaskDraftCard`, `TaskCard`, `welcome`, `NotionSetupFlow`) and two composables, for layout and motion switches. **Decision:** keep the hook (`useIsDesktop`), move the remaining direct `matchMedia` calls onto it. Owner #75.
- **`:ui` overrides:** 29 files pass a `ui` prop. Placement (`MODAL_WIDTH`, imported in 13 files, `touch-target`, `max-h`) is what D1 allows; identity strings are not (`text-error`, `text-error-800`, `font-display text-lg font-semibold` in `TopicEditorHost`, `DataStorageNotice`, `DisconnectSourceDialog`, `GithubTokenRow`, `DataFolderChangeModal`). **Decision:** move identity strings into the `app.config.ts` theme or a named utility; the owner is the category of the component. Owners #72, #74, #75.

## Hard-coded values per token group

Counted in `components/`, `pages/` (without the styleguide), `layouts/`, `app.vue`, `assets/css/` and `app.config.ts` on 2026-11-09, comments excluded. A "literal" is a value written in place of a token: an arbitrary Tailwind value (`text-[0.5rem]`, `p-[…]`), a CSS declaration with a number, a hex or `rgb()` colour. The 66 custom-property definitions in `assets/css/main.css` (the tokens themselves, `--x: #hex`) are the source and are excluded. The script is a set of one regex per group (kept out of the repo; the patterns are in the first column's description) so the numbers are reproducible but approximate: neighbours such as `transition: color 150ms` count as motion literals.

| Token group | What counts | Literals | Files | Top offenders (`file:line`, count in file) | Feeds |
|---|---|---|---|---|---|
| Colour | hex, `rgb()`, `oklch()`, `hsl()` | 20 | 2 | `assets/css/integrations.css:8` (18, the Todoist colour map), `components/task/TaskProgressBar.vue:214` (2) | #69 |
| Colour (derived) | `color-mix()` and `/NN` opacity on a token | 45 | 17 | `assets/css/app-nav.css:75` (9), `assets/css/board-focus-overlay.css:82` (9), `assets/css/dnd.css:29` (6) | #69 |
| Colour (palette step) | `text-warning-800`, `bg-primary-50` style steps (no raw hue class exists: `bg-red-500` and friends 0) | 39 | 23 | `app.config.ts:229` (6), `components/settings/GithubTokenRow.vue:52` (4), `components/feedback/FeedbackDialog.vue:121` (3) | #69 |
| Typography | `text-[…]`, `leading-[…]`, `tracking-[…]`, `font-size:` | 50 | 13 | `components/board/NewCardFlow.vue:682` (9), `components/task/TaskCard.vue:618` (6), `components/task/TaskProgressChip.vue:202` (6), `components/task/TaskTimeboxNudge.vue:272` (6) | #70 |
| Spacing | arbitrary `p-`/`m-`/`gap-`/size values, `padding:` `margin:` `gap:` in px or rem | 73 | 26 | `components/board/BoardColumnYesterdayNote.vue:171` (8), `assets/css/app-nav.css:122` (8), `components/board/NewCardFlow.vue:837` (6), `components/trash/TrashEntryRow.vue:133` (5) | #70 |
| Radius | `rounded-[…]`, `border-radius:` px or rem | 20 | 10 | `components/board/NewCardFlow.vue:869` (4), `assets/css/app-nav.css:130` (4), `components/board/BoardColumnYesterdayNote.vue:208` (3) | #69 |
| Shadow | `shadow-[…]`, `box-shadow:` | 6 | 4 | `components/board/NewCardFlow.vue:993` (2), `assets/css/dnd.css:213` (2), `components/task/TaskTimeboxNudge.vue:355` (1) | #69 |
| z-index | `z-N`, `z-index: N` | 54 | 24 | `app.config.ts:104` (9, the Nuxt UI overlay slots), `assets/css/board.css:180` (7), `components/board/NewCardFlow.vue:715` (4), `components/task/TaskCard.vue:348` (4) | #70 |
| Motion | `duration-`, `transition:`, `animation:`, `cubic-bezier`, `ease-[…]`, `@keyframes` | 133 | 35 | `components/task/TaskCard.vue:376` (19), `components/task/TaskDeletedGap.vue:115` (17), `components/task/TaskTimeboxNudge.vue:241` (9), `components/board/NewCardFlow.vue:667` (8) | #70 |
| Breakpoint | `@media (…px)`, `matchMedia('(…px)')`, `useMediaQuery('(…px)')`, `@container (…)` | 34 | 24 | `components/board/NewCardFlow.vue:654` (4), `assets/css/app-nav.css:42` (3), `assets/css/board.css:49` (3), `components/board/Board.vue:382` (2) | #70 |
| Icon size | `size-N`, `w-N h-N`, `text-Nxl` or a `size`/`width` attribute on an icon | 47 | 28 | `components/board/NewCardFlow.vue:67` (8), `components/settings/GithubTokenRow.vue:85` (3), `components/topic/TopicEditor.vue:34` (3), `components/settings/SettingsSubpageLink.vue:20` (2) | #70 |

Reading it: motion and z-index are the largest groups and the least tokenised (no motion or z-index token exists in `main.css`; the checks of `tests/config/design-tokens.test.ts` cover `var()` references, not literals). Colour is nearly clean outside the Todoist map. Three files carry most of the rest: `NewCardFlow.vue` (1132 lines), `TaskCard.vue` and `TaskTimeboxNudge.vue`; they are drag-and-drop or visual-regression risk areas, so #69 and #70 must start after the baselines (#63). The icon-size group overlaps the notation decision (#67).

### Status after #69 (colour, shadow, radius)

Re-measured on `main` before the change; the guard is `checkTokenLiterals` in `scripts/lint/design-tokens.mjs` (per edit, `npm run verify` through `tests/config/design-tokens.test.ts`). No token was added or renamed.

| Row | Outcome |
|---|---|
| Colour (20) | Stays: `assets/css/integrations.css:8-27` is Todoist's brand map, third-party data keyed by colour name at runtime (like `lib/topicStyles.ts`); allowlisted. `TaskProgressBar.vue:217-218` is dead (#86 deletes it); allowlisted until then. One named colour was a `var()` fallback (`mobile-nav.css:40`, never used): removed. |
| Colour (derived, 45) | Stays: `color-mix()` and `/NN` opacity compose existing tokens, they hold no value of their own. The guard passes them. |
| Colour (palette step, 39) | Stays: a semantic role plus a contrast step (`text-error-700`, `var(--ui-color-success-700)`) is the status-text rule in DESIGN.md ("Inline notice and warning text", "Status text sits on its own wash in the deep step"), guarded for contrast by `warning-notices.test.ts` and `error-soft-contrast.test.ts`. A raw hue or `custom-*` class, `white` or `black` fails the guard (none exist). Role tokens for these steps would be a DESIGN.md decision, not part of #69. |
| Radius (20) | Moved onto the scale: `0.25rem` ×6 to `var(--radius-xs)` (same 4px), `1rem` (`RecapDeck.vue`) to `var(--radius-lg)` (same 16px), `999px` to `9999px` (`BoardPageDots.vue`), and `2px` (`task-detail.css`, the detector's advisory) to `var(--radius-xs)`: the one intentional change, on the focus outline of a link in task notes. Stays: `9999px` (the pill, `rounded.pill` in DESIGN.md), `50%` (circle), `0`, and `calc()` over `--ui-radius` (`TaskCompletionBurst.vue`, `TopicEditor.vue`). |
| Shadow (6) | Stays: rings built from tokens (`inset 0 0 0 1px var(--ui-border-accented)` ×3, the focus pulse in `dnd.css`, the nav hairline in `app-nav.css`) carry no colour literal; the `--shadow-*` definitions in `main.css` are the token source (allowlisted). |

## Dead code

Run on 2026-11-09 at `2a511228`. `knip@6.4.2` (the version the issue pins) was attempted with `npx --yes knip@6.4.2` and refused by the audit sandbox, so no knip result is claimed. The import-graph scan the issue allows replaced it; the commands below reproduce each finding. Nuxt auto-imports components by tag, so a component counts as used when its tag or an import path appears in a non-test file.

### Unused components

Command: for each `components/**/*.vue`, `rg -l "<Name[ >/]|<kebab-name[ >/]|['\"].*/Name(\.vue)?['\"]" components pages layouts composables app.vue`, excluding the file itself and `tests/`.

| Component | Users | Finding |
|---|---|---|
| `components/task/TaskProgressBar.vue` | `pages/styleguide.vue` only | dead once `/styleguide` goes (#65); `TaskProgressChip` is the live one |
| `components/task/TaskTimebox.vue` | `pages/styleguide.vue` only | same |
| `components/task/TaskTimer.vue` | `pages/styleguide.vue` only | same |
| `components/ui/ExpandingButton.vue` | `pages/styleguide.vue` only | same |

The other 101 components each have at least one non-test user. The U5 and U6 candidates of audit-2026-11 (`OnboardingWelcome`, `ui/feedback/ProgressBar`, `ui/Section`, `TaskStatisticsModal`) are deleted. Owner: #86 (new).

### Unused CSS classes

Command: every `.class` selector in `assets/css/*.css` searched as a whole word in `components pages layouts composables utils lib plugins stores integrations app.vue app.config.ts nuxt.config.ts`.

| Selector | Where | Finding |
|---|---|---|
| `.inline-editable-trigger` (3 rules) | `assets/css/task-detail.css:35,41,175` | no template or script references it; a backlog row (A6) mentions it |
| `.task-context-bar` | `assets/css/task-detail.css:46` | unused (`add-task-context-bar` in `TaskForm.vue:50` is a test id) |
| `.todoist-color-*` (20), `.page-enter-*`/`.page-leave-*` (6) | `integrations.css`, `transitions.css` | false positives: built from a colour name at runtime and Nuxt page transition hooks |

Owner: #86.

### `app.config.ts` keys

The 18 component keys under `ui` (`modal`, `slideover`, `drawer`, `popover`, `tooltip`, `toaster`, `toast`, `dropdownMenu`, `collapsible`, `input`, `select`, `selectMenu`, `textarea`, `button`, `tabs`, `alert`, `badge`, `switch`, `card`) each map to a component the app renders (`toaster` and `toast` through `UApp`). The two feature flags are read (`useFeatureFlags()`: `notionDataSourceSelection` in `DatabaseSelectionStep`/`WizardController`/`notion.vue`, `openColumnAddButton` in `BoardColumn`). Custom theme variants in use: `card` `task` (`TaskCard`), `selectMenu` `property` (`TaskPropertySelect`). No dead key found. `UCard variant="subtle"` and `variant="outline"` buttons exist only in the styleguide.

### Dependencies

Command: for each name in `package.json`, `rg -l "['\"]<pkg>" components pages layouts composables utils lib plugins stores integrations server scripts tests app.vue nuxt.config.ts` plus the config files (`.prettierrc`, `.eslintrc.cjs`, `eslint.config.mjs`, `vitest.config.ts`).

| Finding | Evidence | Owner |
|---|---|---|
| `reka-ui` is declared (#53 is fixed: `package.json:89`, commit `c74b1c34`); imported in `LocalSetupFlow.vue` and `DatePickerField.vue` | declared and used | none (done) |
| `.eslintrc.cjs` is dead: ESLint 10 reads `eslint.config.mjs` only (`package.json` `lint` is `eslint .`); it is the only user of `@nuxt/eslint-config`, `eslint-config-prettier`, `eslint-plugin-prettier` | `rg 'eslintrc\|eslint-config-prettier\|eslint-plugin-prettier'` | #86 |
| `@nuxt/test-utils` has no import and no config reference (vitest uses `jsdom`) | `rg '@nuxt/test-utils'` finds `package.json` only | #86 |
| `prettier` itself is not declared although `.prettierrc` loads `prettier-plugin-tailwindcss` | `package.json` | #86 |
| Imported, not declared (resolved through another package): `vue-i18n` (app code, 100+ imports), `@vueuse/core` (3), `vue-router` (2), `@internationalized/date` (1), `yaml` (2, tests), `@typescript-eslint/parser` (1, test), `playwright` (1, `scripts/motion-film.mts`) | `rg -oN "from '(@?[a-z][^'./][^']*)'"` per folder minus `package.json` | #86 |
| `@iconify-json/simple-icons` looks unused by code but is the icon collection of `nuxt.config.ts:58` (`simple-icons:todoist`, `simple-icons:notion`) | used | none |

## audit-2026-11 status

Checked against `main` on 2026-11-09. "Done" has the evidence; nothing that `docs/design/backlog.md` tracks is re-filed (open items keep their backlog row).

| ID | Finding | Status | Evidence |
|---|---|---|---|
| U1 | translucent sticky header | done 2026-11-03 | `rg 'bg-page/80\|backdrop-blur' components layouts` finds none; `PageHeader` publishes `--page-header-height` |
| U2 | app bar row transparent | open | layout decision, backlog U2 |
| U3 | day-close hierarchy and footer | done 2026-11-03 | backlog U3 |
| U4 | no button size and variant ladder | done (backlog row is stale: "filed, needs-design") | `tests/config/button-ladder.test.ts`; sizes now lg 50, sm 53, xs 6, md 4, xl 3 |
| U5 | unused components and CSS | done 2026-11-03 | the three components are gone; two new unused classes found (see Dead code) |
| U6 | legacy statistics modal | done 2026-11-03 | `TaskStatisticsModal.vue` absent |
| U7 | statistics opens `TaskDetailModal` | open | layout decision, backlog U7 (`pages/statistics.vue:34`) |
| U8 | section-heading class string ×11 | done (backlog row stale: "filed, ready") | `@utility section-heading` (`assets/css/utilities.css:93`), 13 uses in 10 files; the 10 remaining `font-display tracking-display` strings are other sizes (welcome, stats, recap, setup) |
| U9 | three tab looks | done 2026-11-03 | `UTabs` ×4, 0 `role="tab"` |
| U10 | hand-rolled warning boxes | done for boxes (backlog row stale: "filed, needs-spec"); plain coloured lines remain | `rg 'border-warning/20'` finds none; 28 plain lines, see Duplicates: notices (#74) |
| U11 | orange empty state, eyebrow | done 2026-11-03 | backlog U11, `design-patterns.test.ts` |
| U12 | overlay shell copied | done 2026-11-03 | `ResponsiveOverlay.vue`; 8 files still call `matchMedia` directly (Duplicates: overlays) |
| U13 | `defineOptions` and doc blocks | done for components (backlog row stale: "filed, ready"); 7 pages lack `defineOptions` by design | `component-conventions.test.ts` enforces components; pages are exempt |
| U14 | focus ring ×11 | done (backlog row stale) | `@utility focus-ring` (`utilities.css:108`), 19 uses in 13 files; one hand-written ring remains at `components/recap/NewDayRecap.vue:41` (goes with its move to `UTabs`) |
| U15 | `.touch-target` by hand | done with U3 and U4 | backlog U15 |
| U16 | large components | open, backlog only | drag-and-drop and baseline risk area; not in #58 |
| U17 | 40 test ids without a test | open, backlog only | not re-measured here |
| U18 | page title scale | open | layout decision, backlog U18 |
| U19 | card title stragglers | open | `components/task/TaskCard.vue:58` has no `text-wrap`; baseline change, backlog U19 |
| U20 | "Statistik" wording | done 2026-11-06 | backlog U20 |

Part 1 of audit-2026-11 (the job-to-implementation inventory) is superseded by the component table and the duplicates section above; its "canonical" column stays valid for page header, section heading, list row (`SourceRow` / `TrashEntryRow`) and notice (`UAlert` subtle). This PR corrects the stale rows U4, U8, U10, U13, U14 in `docs/design/backlog.md`.

## `pages/styleguide.vue` (what `/ui` replaces)

858 lines, a hand-typed page with five sections (`#tokens`, `#ui-kit`, `#aufgaben`, `#board`, `#dialoge`), reachable in production builds today. It names `a11y.spec.ts` (focus ring), `eslint.config.mjs`, `composables/useAppNav.ts`, `types/pageMeta.d.ts`, `components/task/TaskDetailContent.vue`, `tests/config/button-ladder.test.ts` and `tests/config/design-patterns.test.ts` (`rg -l styleguide`); #65 carries those.

What it shows that has **no component behind it** (hand-typed markup, a second source):

| Section | Lines | Shows | Replacement |
|---|---|---|---|
| Design-Tokens | 60 to 298 | semantic surfaces, colour roles, primitive palettes, typography specimens, radius, shadows: swatches and values typed by hand | generated Tokens part of `/ui` from the real token sources (#65) |
| UI-Kit | 299 to 416 | `UButton` matrix (including `variant="outline"`, unused in the app), `UCard` incl. `variant="subtle"` (not in the theme, not used in the app), `InlineEditable`, hand-assembled form fields | Components part with entries per variant and state (#66, category slices) |
| Aufgaben-Komponenten | 417 to 519 | `TaskPriorityBadge`, `TaskTimebox`, `TaskTimer`, `TaskProgressBar` (three of them dead), `TaskDetailModal`, `TaskForm` | entries for the live ones; the three dead ones go (#86) |
| Board | 520 to 577 | four `BoardColumn` states with hand-built tasks | block entries (#77) |
| Dialoge | 578 to 612 | `SyncWarningModal`, `NotionSetupModal` triggers | Overlay entries (#75) |

What it does **not** show: 91 of the 105 components, every settings, statistics and navigation block, loading, empty, error and disabled states, German long-text overflow and the phone width. Decision for #65 and #66: the styleguide is replaced, not migrated; nothing in it is worth keeping as a source.

## What is already guarded

| Test | Guards | Gap this audit found |
|---|---|---|
| `tests/config/button-ladder.test.ts` | `UButton` size and variant ladder, 44 px floor | does not see raw `<button>` (32), nor `UButton` in the 4 styleguide-only files |
| `tests/config/design-patterns.test.ts` | no `role="tab"` in pages, no uppercase class | components are not checked for hand-rolled tabs (`NewDayRecap`) |
| `tests/config/component-conventions.test.ts` | `defineOptions` and `@component` on every component | no `@kind` or `@category` yet (#64) |
| `tests/config/design-tokens.test.ts` | every `var(--x)` resolves; no colour, shadow-colour or off-scale radius literal (#69) | no check on motion 133, z-index 54, spacing 73 (#70, #78) |
| `tests/config/icons-bundled.test.ts`, `nuxt-ui-icons.test.ts` | icons come from an installed collection | does not pin one notation (`i-ph-*` vs `ph:*`) |
| `tests/config/warning-notices.test.ts`, `error-soft-contrast.test.ts` | warning and error colours meet contrast | boxes are banned and the text step is fixed, but a plain coloured line is allowed |
| ESLint `better-tailwindcss` | no arbitrary values, unknown classes | arbitrary values inside `:ui` strings and CSS are not seen |

These gaps are inputs for #78 (ratchet guards).

## Hand-off to the sub-issues of #58

Every decision in this document has exactly one owner. A rule (DESIGN.md) is always #68's decision request; the sub-issue named for the same item implements the answer.

| Sub-issue | Takes from this audit |
|---|---|
| #62 FigCraft frames | the category column of the component table: one frame per category, rows as the frame contents |
| #63 baselines | the risk files named under "Hard-coded values" (`NewCardFlow`, `TaskCard`, `TaskTimeboxNudge`, `AppNav`) and the raw `AddTaskSlot` button, which wait for the baselines |
| #64 taxonomy and doc-block tags | the `kind` and `category` columns are the proposed values for `@kind` and `@category` of all 105 components and the 33 Nuxt UI components |
| #65 `/ui` shell | "`pages/styleguide.vue`": what to carry over (the files naming it) and what to drop |
| #66 `/ui` Components engine | the "variant or state" columns (props of custom components, theme axes of Nuxt UI components) as the list of entries to render |
| #67 icons | icon notation (`i-ph-*`), external-link icon, the back/forward icon pair, `-bold` weights; the 47 icon-size literals |
| #68 DESIGN.md guidelines | the rules behind: back/forward vs go-on arrow, external vs internal open, notices vs toast vs inline error, the one empty state, choice chip and property-value trigger |
| #69 colour, shadow, radius tokens | rows "Colour", "Colour (derived)", "Colour (palette step)", "Radius", "Shadow" |
| #70 type, spacing, icon size, z-index, motion, breakpoint tokens | the remaining rows; motion (133) and z-index (54) have no token yet |
| #71 Aktion | `UButton`, `ULink`, `UDropdownMenu`, `ExternalLink`, `ColumnSortingControl`, `TaskCarryOverTriage`; the raw buttons marked #71 |
| #72 Eingabe and form structure | `UFormField`, inputs, selects, `UForm`, `UCalendar`; raw buttons marked #72; the choice-chip primitive; the `USelect` vs `USelectMenu` justification; `:ui` identity strings in field components |
| #73 Navigation and keyboard | `UTabs`, `UKbd`, `UCommandPalette`, `UChip`, `AppNav`, `MorePanel`, `SetupRail`; raw buttons marked #73; the back/forward call sites; `NewDayRecap` onto `UTabs` |
| #74 Feedback | `UAlert`, `UProgress`, toasts, the plain coloured lines, empty states |
| #75 Overlay | `UModal`, `UDrawer`, `USlideover`, `UPopover`, `UTooltip`, `UContextMenu`; remaining `matchMedia`; `:ui` identity strings in modals |
| #76 Darstellung | `UBadge`, `UCard`, `UTable`, `UCollapsible`, charts, the list-row primitive and the raw buttons that merge into it |
| #77 Layout and blocks | `UApp`, `USeparator`, `PageHeader`, `SectionHeader`, every block |
| #78 ratchet guards | "What is already guarded": raw `<button>`, literal counts, one icon notation, plain notice lines |
| #79 Pattern check | the duplicates sections as the Pattern list to search first |
| #86 (new, linked to #58) | "Dead code": 4 orphan components, 2 unused CSS classes, legacy ESLint config and its 3 devDependencies, `@nuxt/test-utils`, the undeclared direct imports |

No decision is without an owner. Not owned on purpose: U2, U7, U18 (layout decisions of the redesign, #1), U16 (component splits, risk area), U17 (test ids), U19 (baseline change): all stay in `docs/design/backlog.md`.
