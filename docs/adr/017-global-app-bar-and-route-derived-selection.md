# ADR 017: Global app bar, the Mehr panel and route-derived selection

## Status

Accepted (#470; decisions D1 to D12 on #470). The ADR number was taken as the next free one on `main` and may be renumbered at merge.

## Context

Places (statistics, trash, settings, app update) and board controls (stacking, closing the day, sync) shared one row of icon buttons at the foot of the Erledigt column, which on a phone became an action dock under a column tab bar. Pages had a back arrow each, the trash had a second surface (a dock icon and a quick sheet) next to its page, and a failing source was only visible on a sync icon that existed on the board.

## Decision

- **One shell, mounted once.** `components/nav/AppNav.vue` is rendered in `app.vue` beside `<NuxtLayout>` (D1), so it survives page transitions: the bar keeps its DOM, focus and an open panel across Heute -> Statistik. Rejected: a `default` layout (remounts on layout change, touches every page) and a bar per page (duplicated, loses the panel state). Routes opt out with `definePageMeta({ appNav: false })` (D6: `/welcome`, `/error-test`, `/`; `/styleguide` became the dev-only `/ui`, #65), never by path sniffing in the component.
- **Selection is a pure function of the route (the binding rule).** `useAppNav().currentPlace` maps `route.path` to `board` (`/tasks*`), `statistics` (`/statistics`), `more` (`/trash`, `/settings*`) or `null`; the open state of the Mehr panel is never an input. An open panel is an overlay, not a navigation, so Heute keeps its selected state while it is open and ⋯ shows only a soft "open" fill with `aria-expanded`. `aria-current="page"` sits on exactly one control. *Amended by #583 (2026-11-03; originally ⋯ was selected on a page behind it): on `/trash` and `/settings*` the page is shown as a third segment in the pill and that segment is selected and `aria-current`; ⋯ is never selected, and the Mehr panel leaves out the page the pill shows.* This is unit-tested as a matrix and as sequences (`tests/composables/useAppNav.test.ts`, `tests/components/nav/AppNav.spec.ts`) and in E2E (`app-nav.spec.ts`).
- **The Mehr panel is a popover, not a menu (D4).** It holds a switch, a toggle group and a status footer, which are not menu items, so it is a `UPopover` with links and buttons (`aria-haspopup="dialog"`). `Tag abschließen` closes it and returns focus to ⋯ before opening the dialog, so the dialog's focus-return target is not a removed row.
- **No back arrow anywhere.** `PageHeader` renders title, description and actions only; the way out of a page is the bar or ⋯ -> Einstellungen. The trash has one surface, the Papierkorb page (D10: `TrashSheet` and `TrashDockButton` are gone).
- **Phone: swipe only (D5), one palette (D3).** The column tabs and the action dock are removed; `.board` carries `data-mobile-page` and `focusin` makes an off-screen page active. The phone bar uses the desktop palette (grey track, raised white chip, no ink fill) with a frosted-glass surface over a paper veil (#615, DESIGN.md "The Glass Chrome Rule"), so DESIGN.md's "one filled ink element per view" holds next to the Erledigt CTA.
- **Offsets are declared once.** `assets/css/app-nav.css` owns `--app-bar-offset-top` (desktop) and `--phone-bar-offset` (phone, includes the safe-area inset); `--mobile-dock-offset` is gone (D8). The bar sits at z-index 40: below the sheets, dialogs, drawers, palette and popovers (z-50 and up), below toasts.
- **Shared entries.** The bar links to `/statistics` and the palette navigates there (`useStatisticsEntry` and the modal behind the `statisticsPageEnabled` flag were removed in #554); `useManualSync().resync()` (the old refresh, now reachable from any page). `boardStatisticsButton` is retired (D12).
- **Erledigt CTA is the column footer.** "Tag abschließen" sits in `.column-footer` under the Erledigt list (sticky, above the phone bar), hidden while nothing is done today. It is the column's footer, not a list item: the list is flex-grown so the whole column is the drop target.

## Consequences

- No data model or persisted-shape change.
- The Papierkorb is one tap deeper than the dock icon was (accepted); the count is in the panel row.
- On a phone the only cue for three column pages is the swipe and the drag edge arrows until a headline-based column navigation exists (accepted, out of scope).
- Board controls act on the board: from `/settings` Ansicht and Tag abschließen are reached by going to Heute first.
- Every board baseline moved (the bar is in the frame); the E2E migration is mechanical through `tests/e2e/helpers/appNav.ts`.
