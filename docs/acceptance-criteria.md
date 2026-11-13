# Acceptance Criteria

Persistent functional and design invariants. All features, refactors, and improvements must satisfy these before being considered done. Expressed as observable behaviour.

---

## Board & Task Flow

- The board has exactly four columns in this order: **Offen → Jetzt → Wartet → Erledigt**.
  - It is fine if Waiting and In-Progress visually share one column, one top half, one lower half.
- **WIP limit**: The "Jetzt" column accepts at most one task. Dragging a second task onto it is visibly blocked and the task does not transfer.
- Tasks can be dragged between any columns and reordered within any column.
- Moving a task to a new column is reflected immediately in the UI and persisted after a page reload.
- When offline, the board remains fully usable. Changes made offline survive a reconnect without data loss.

## Topics and Activities (#430, #431)

- A topic or activity can be renamed in one place (Einstellungen -> "Themen und Aktivitäten", or the edit mode of the task sheet's picker: Bearbeiten, then the name's row); the new name appears on every task of every status, in the trash, in the statistics and in the option lists, and the old name appears nowhere. A name that already exists merges into it.
- A rename never sends anything to Notion or Todoist. A name a source owns cannot be renamed here (the field says why); its colour and symbol stay editable and apply only in kan-do.
- A topic can carry one of nine hues and one of 24 symbols, shown as a mark before its name (card, sheet, picker, lists); the name itself stays plain text. A topic with neither shows no mark and no gap.
- Colours and symbols survive a reload, an export/import and the desktop data file; an old data file without them loads unchanged.

## Day Counter (Carried-over Cue)

- A not-done card shows nothing on its first board day (no dots, numeral, sheet line or tooltip) on the card and the task sheet; the closing sheet's open list adds "Tag n auf dem Board" to a row only from day 4 on.
- From day 2 the cue reads as a day number: day 2 shows 2 dots, the numeral `2` and "Tag 2 auf dem Board" (tooltip and accessible name). Day 7 and later show 6 dots, a `+` and the exact numeral.
- A board day is a local calendar date on which the board was opened; days the board stays closed do not count.
- The triage nudge still appears after 4 carried days and its title reads "Tag 5"; Keep re-arms it unchanged.
- Done cards, cards without a counter entry and pending syncs show nothing.

## Day Closing (#98, #237)

- "Tag abschließen" opens one sheet (modal from 768px, drawer below): the date, the headline "n von n geplanten Aufgaben erledigt" (planned = done today + still open), the total time and a time-box bar. With nothing left open the headline reads "Alle Aufgaben erledigt" with a green trophy. There is no motivation sentence.
- The bar has one segment per done task with a timebox and tracked time (one aggregated segment above 10), the overrun as a dark tail, and the caption "k von n Timeboxen eingehalten"; without a boxed task there is no bar. A task counts as in its timebox when spent and planned time are less than 5 minutes apart, and as kept unless it is over.
- Done tasks are rows: title, "Erledigt" plus "In der Timebox" / "n Min unter der Timebox" / "n Min über der Timebox", the time at the end; no buttons.
- "Für morgen" is one sentence and a disclosure with a checkbox per open task, all selected. Escape, the scrim and swipe change nothing. "Fertig" puts a selected Jetzt task back to Offen with its timer stopped and deletes each deselected task through the shared delete (trash, 5 s undo on the board; Notion and Todoist are named on the row). The selection starts fresh on every opening.

## Drag-and-Drop Visual Behaviour

- While a task is being dragged, its original slot in the list shows a neutral placeholder / ghost item (same size, no content) — the card does not disappear.
- A visual representation of the dragged card follows the pointer (slight tilt, elevated appearance).
- The floating drag card does not intercept pointer events on the board beneath it.
- When dragging over an empty column, a visual drop hint appears to indicate the area is a valid drop target.
- When the WIP limit would be violated, hovering over that column shows a distinct rejection state (no drop accepted).
- After the drag completes or is cancelled, all visual drag states are removed cleanly.

## Time Tracking

- Time spent on a task only ever increases unless a feature for manual correcting timer spent allows it; it never resets or decreases when data is refreshed from an integration.
- A running timer continues counting after a page reload without losing accumulated time.
- If a time sync to an integration fails, the locally tracked time is not discarded — it is retried automatically.
- Optional time box can be set per task.
  - The app provides visual feedback when a time box is soon to be reached.
  - The app provides visual feedback when a time box is reached.

## Integration Setup & Sync

- The setup wizard flow completes end-to-end: credential entry → database/project selection → property mapping → status mapping → board ready.
- All property and status name mappings reflect what the user configured; no values are assumed or hardcoded by the application.
- If the integration service is unreachable, the board still loads and displays the last known task data.
- Status changes made in the app are eventually reflected in the connected integration after sync.

## Visual & UX Invariants

- All user-facing text is in **German**.
- The UI looks correct in both light mode and dark mode — no missing colours, invisible text, or broken contrast.
- Typography: body text uses the sans-serif brand font; headings use the display font. No fonts are loaded from external CDNs.
- The visual style is calm: generous whitespace, flat hierarchy, minimal container nesting. No heavy cards-within-cards patterns.
- When a task is moved to "Erledigt" (drag, keyboard, menu, sheet or palette), a short completion burst of teal pieces flies out around the card once, within about 1 s, as positive reinforcement (#692). It never blocks input, adds no text or sound and does not play on load or undo. Under reduced motion the task completes without animation.

## Accessibility

- Text on all backgrounds meets WCAG AA contrast in both colour modes.
- Every interactive control (button, input, link) has a visible label or accessible name.
- The entire UI is navigable by keyboard: Tab moves focus through all controls; ESC closes any open modal or drawer.
- Delete (the Mac "delete" key, Backspace, too) on a focused board card deletes it with the usual undo, and focus moves to the next card (#579).
- When a modal or overlay opens, focus moves into it. When it closes, focus returns to the triggering element.

## Build & Runtime

- The project builds without TypeScript errors.
- No JavaScript errors appear in the browser console during normal use.
- Application state (board layout, tasks) is restored correctly after a hard reload.
