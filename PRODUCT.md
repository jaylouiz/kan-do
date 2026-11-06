# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Shipped as a browser app (static Nuxt build, mobile web down to ~390px) and as a Tauri v2 desktop app wrapping the same frontend. Feature parity between web and desktop is required unless explicitly noted.

## Users

Primary: a solo knowledge worker managing their own day — currently the author, open to others with the same workflow. They open Kan-Do in the morning, pull a small set of tasks from their source of truth into Today, and use it as a quiet command centre throughout the day. Sessions are short and frequent: glance, move a card, check a timer, close.

## Product Purpose

Kan-Do narrows attention to the work already chosen for today. It provides a frictionless flow for updating state, tracking time, and celebrating wins without duplicating upstream task management tooling. Success: the user ends the day with fewer things in flight, better estimates, and a sense of calm satisfaction.

## Positioning

A focus layer on top of an existing source of truth (Notion or local tasks, Todoist planned), not a replacement for it. The board deliberately shows only today: one active task (WIP limit 1 in "Jetzt"), timeboxes, and a short review. No second system to maintain.

Outlook: a light backlog, first for local tasks, then as a looser link to external tools. It stays light (no hierarchy, no grooming) and never takes the focus away from today.

## Operating Context

- Canonical journeys: **morning planning** (pull tasks into Today, confirm sync), **in-flow update** (Offen → Jetzt → Wartet → Erledigt; notes and timeboxes inline), **review** (close the day, the new-day recap, statistics).
- Core loop: glance → move → timer → close.
- Offline-first: the local cache is authoritative during network gaps and reconciles on reconnect.

## Jobs to be done

What the user needs to get done, independent of any solution (no board, column or timer in a job). Changing the list is the user's call.

| ID | Job | Journey |
|---|---|---|
| J1 | Plan the day | morning planning |
| J2 | Capture a new ad-hoc task | in-flow update |
| J3 | Decide and pick the next work item | in-flow update |
| J4 | Get the planned work done | in-flow update |
| J5 | Review the past day's work | review (day close, new-day recap) |
| J6 | Learn from previous work | review (statistics) |

Emotional side of every job: calm, focused, satisfied ("Brand Commitments"). Infrastructure (sync, offline, data safety) is no job of its own; it serves these.

## Capabilities and Constraints

- Four fixed columns in fixed order: Offen, Jetzt, Wartet, Erledigt. "Jetzt" accepts at most one task.
- Sources: Notion (via server API) and local tasks, side by side on one board if wanted (mixed board). Todoist is planned: the adapter exists, the UI does not offer it yet. Integration setup, sync status and settings are infrastructure, not the product.
- Time tracking per task, timebox presets and auto-suggestion, an in-card nudge to add a timebox, statistics page.
- Day rhythm: an optional "Tag abschließen" at the end of the day, a short recap ("Kurzer Rückblick") on the first start of a new day, yesterday's finished tasks acknowledged before they leave the board.
- Desktop-only exceptions to web/desktop parity (the rest is identical): data folder with backups and conflict safety (ADR 008, 011), self-updater (ADR 009), "What's new" after an update (`release-notes/README.md`), in-app feedback to GitHub issues with an optional redacted screenshot (ADR 010, 014), API tokens in the macOS Keychain (ADR 007), Todoist OAuth is web only (ADR 007), and a restrictive Content Security Policy that applies to the Tauri bundle only (ADR 012).
- UI copy is German by default, English supported; all copy via i18n keys.
- Non-goals: full backlog manager, CRM, document store; replacing integration dashboards; project/epic hierarchy. Data stays flat and bite-sized.

## Brand Commitments

- Name: Kan-Do.
- Personality: **Natural · Helpful · Assistive** — a quiet tool, like a well-made notebook or a good desk lamp: present when needed, invisible when not.
- Emotional goal: calm, focused, satisfied. Never urgent, cluttered, or overwhelming.
- Positive reference: Airbnb (calm, generous layouts; friendly, rounded warmth; in-place, low-friction flows; polished micro-motion).
- Anti-references: Trello (gamified clutter, rainbow labels), Notion (dense, technical, information overload).

## Evidence on Hand

- Product docs: `docs/application-purpose.md`, `docs/acceptance-criteria.md`, `docs/adr/`.
- No testimonials, user research, or usage metrics exist; do not fabricate any.

## Product Principles

1. **One thing at a time** — every screen and interaction narrows attention instead of expanding it. Remove chrome before adding it. (The app bar of #470 follows it: the action dock, the column tabs and three board icons went, one bar came.)
2. **Space is content** — calm comes from restraint; avoid nesting and dense rows.
3. **Typography over decoration** — reach for a typographic solution before a visual one; above all in page composition and layout, where headings, type scale and space structure the page instead of boxes, lines and fills.
4. **Quiet confirmation, earned celebration** — everyday actions feel resolved, not celebrated: positive reinforcement is a whisper, not a fanfare. Completing a task is an achievement and earns a short, contained reward (DESIGN.md "Earned celebration", #692).
5. **Invisible infrastructure** — hide integration complexity behind calm, guided flows. If a user sees a technical detail, the design has failed.
6. **Ask in place** — a question that belongs to a card or a row is asked right there, not in a dialog. Dialogs are for flows that need the whole stage.

## Accessibility & Inclusion

WCAG 2.2 AA is the goal, not yet binding: it becomes a hard requirement once the product is published. Deliberate exceptions are recorded with their component and exempted narrowly in the test. Fully keyboard-operable (including board moves), `prefers-reduced-motion` respected. The app is light-only for now (`colorMode: false`); dark mode would be a future new feature. Enforced by `tests/e2e/a11y.spec.ts` (axe, serious/critical).
