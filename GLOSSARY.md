# Glossary

Developer glossary. UI wording (preferred terms, forms to avoid, German and English) lives in `docs/copy/terms.json`.

**Task source** (UI: "Verbindung"): where a task lives. One of Local, Notion and, later, Todoist. Every task belongs to exactly one task source.

**Task id and external id**: `Task.id` is the app's own identity of a task and never changes (statistics, order, timers and routes use it); `Task.externalId` is the id the task's integration knows it by (the Notion page id), `null` for a Local task. Integrations only ever receive the external id. See ADR 015.

**Integration**: a task source outside the app (Notion, Todoist). Local is a task source but not an integration.

**Default source** (UI: "Standard"): the task source that newly created tasks go to unless the user picks another one in the add form.

**Ad-hoc task**: a task added straight into Jetzt because the user starts it right now. The only quick add; it always goes to the default source.

**Connect / disconnect**: adding an integration to the board, or removing it. Disconnecting takes that source's tasks off the board; they stay in the integration. Local can't be disconnected.

**Needs attention**: a connected integration that can't sync right now (broken token, unreachable). Its tasks stay on the board and usable; it is still connected.

**Save pending**: a task with changes that haven't reached its integration yet because that source can't sync right now.

**Move**: a task changes its task source. It stays the same task (history, tracked time, dates); the original is deleted from the old source once the task exists in the new one. Never a copy.

**Pattern**: a recurring UI solution to one user job (confirming a destructive action, showing a task's state, adding a task). Two elements share a pattern when they do the same job for the user, whatever they look like.
_Avoid_: component (that's the code unit; one pattern can span several components)

**Token**: a named design value (colour, size, shadow, radius) that components use instead of a raw value, so one place retunes it. Example: `--topic-blue` and the semantic colour `bg-page`, defined in `assets/css/main.css` and `app.config.ts`; `DESIGN.md` lists them.

**Primitive**: the smallest UI unit: one visual job, driven by props alone, no store and no knowledge of other components. Example: `StatsRing` (a ring), `TopicMark` (the dot before a topic name). `@kind primitive`.

**Component**: a UI unit with one job in the app's domain that composes primitives or Nuxt UI parts and is used by one or more parents, and that is not designed to be assembled with siblings. Example: `DayCloseTaskRow` (one "not done yet" row), `SourceRow` (one connected source). `@kind component`.

**Compound component**: a parent together with the child components that only work in it, wired through slots or provide/inject, so the parts are used together. Example: `ResponsiveOverlay` (shell with `#body`, `#footer` slots), `TaskStack` with `TaskStackHeader` and `TaskStackPill`. `@kind compound`.

**Block**: a feature-sized surface that a page or `app.vue` mounts, feeding itself from stores and composables rather than props, and that orchestrates components. Example: `DayCloseDialog`, `StatsTiles`, `AppNav`. `@kind block`.

**Layout**: a component or file whose only job is arrangement: where things sit, not what they say or do. Example: `layouts/sub-page.vue`, `SectionHeader`, the board's `BoardColumn` container. As a doc-block `@category`, `layout` marks such components; `layouts/` holds the page layouts Nuxt picks per route.
