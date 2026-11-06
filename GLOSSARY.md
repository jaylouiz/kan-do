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
