# What Kan-Do can learn from Sunsama

Date: 2026-10-21
Inputs: Sunsama help center (106 articles, `sunsama-help.md`), kan-do `PRODUCT.md`, `docs/application-purpose.md`, `docs/acceptance-criteria.md`, `docs/design/backlog.md`, `docs/features/*`, the open GitHub issues (#62, #63, #65, #71, #93, #96) and a look at the current code (`types/task.ts`, `components/statistics/`, `composables/`).

This is inspiration, not a spec. Every idea below should be triaged into a lane (`/design-gh-issue` or `/specify-gh-issue`) before it becomes work.

## 1. The filter used

Sunsama is a day planner that owns your tasks, calendar and weekly goals. Kan-Do is a focus layer on top of Notion/Todoist/local tasks that "deliberately does only today". So most of Sunsama is out of scope by design (see section 5). What transfers is the **daily loop and its small mechanics**, not the planning machinery.

Each idea was checked against:
- **Non-goals:** no backlog manager, no hierarchy, no replacing integration dashboards.
- **Principles:** one thing at a time, space is content, quiet confirmation, invisible infrastructure.
- **Invariants:** four fixed columns, WIP limit 1 in Jetzt, offline-first, keyboard-operable, Tauri parity, light-only, i18n keys.

Effort guide: **S** = about a day, **M** = a few days, **L** = a week or more.

## 2. Top picks

| # | Idea | Why it stands out | Effort |
|---|---|---|---|
| 1 | A quiet end-of-day closing step | Completes the "review" journey and gives #63/#71 a home | M |
| 2 | "Carried over N days" cue plus a keep/shrink/drop nudge | Directly serves "fewer things in flight" | S-M |
| 3 | Always-on-top mini timer for the Jetzt task (Tauri) | Makes the desktop app worth having over the web app | M-L |
| 4 | ~~Quick-add directives~~ (withdrawn, timebox presets already exist) | | |
| 5 | Command palette with per-card actions | Natural follow-up to P3 and the keyboard goal | M |
| 6 | "Today at a glance" capacity line | Gives the WIP idea a time dimension, still calm | M |

## 3. Ideas in detail

### 3.1 A quiet end-of-day closing step

**Sunsama:** the daily shutdown ritual (`usage-guides__daily-highlights`, `settings__user-settings`). It shows what you worked on with a time breakdown, lets you add a short personal reflection, and ends with an optional message: rotating encouragement, nothing, or your own text. The ritual can open automatically at a set time, or on demand with the `O` key. Daily Highlights additionally produces a shareable summary.

**Kan-Do hook:** PRODUCT.md names review as one of three canonical journeys ("streaks, time distribution, pending follow-ups"), and #63 and #71 already circle "yesterday". The statistics store has the data. Note that streaks are promised in `application-purpose.md` but I found no streak code in the repo, so this may be the place they finally land.

**Shape (small):** one calm screen when the user chooses to close the day:
1. Done today, with total time (a single line, not a dashboard).
2. What is still open or in Wartet, with one quiet action per card: keep for tomorrow / back to the source's backlog.
3. One closing line, optionally user-defined (copy Sunsama's three modes: encouragement, none, custom).

**Why it fits:** it turns "close" in the core loop (glance, move, timer, close) into a real moment, in the "quiet confirmation" register.

**Risks:** keep it optional and skippable or it becomes the "second system to maintain" the product avoids. Don't make it a nag popup; a visible entry point at the board's end is enough. The `Wartet` follow-ups are a real strength to showcase, because Sunsama has nothing first-class for waiting.

**Optional extra:** "Copy day summary" as plain markdown (Sunsama publishes highlights to email/Slack; Kan-Do can offer just a clipboard copy, no AI, no integrations).

### 3.2 "Carried over N days" cue and a stale-task nudge

**Sunsama:** a number-in-a-circle on each card shows how many consecutive days it rolled over. After a threshold (default four days) tasks move to an archive with a badge, and the docs give three triage reasons: not important (drop), too much planned (plan less), important but avoided (block time) (`usage-guides__archive`, `getting-started__basics__task-rollover-and-recurring-tasks-the-basics`).

**Kan-Do hook:** `Task` has `createdAt`, `updatedAt`, `completedAt`; there is already an archive section and archive toast. Kan-Do has no "age in Today" signal yet.

**Shape:** a small, muted "3d" marker on a card that has stayed in Offen/Wartet across days, and when it crosses a threshold, a single gentle line: "Still here after 4 days. Keep, make smaller, or let go?" The "make smaller" option reflects the product's bite-sized stance.

**Risks:** Kan-Do tasks live upstream, so "let go" must not delete anything in Notion/Todoist; it should only remove the task from Today. Check how Today membership works in `useTaskSync` before shaping. Age must be measured in days on the board, not task age in the source. Avoid colour escalation (anti-reference: clutter, urgency).

### 3.3 Always-on-top mini timer for the Jetzt task (Tauri only)

**Sunsama:** the **focus bar** is a small floating window that shows the current task and timer with play/pause/done buttons. A **menu-bar item** shows the timer and the task name, a global shortcut starts/stops the timer from any app, and clicking the bar brings the app forward (`usage-guides__focus-bar`, `usage-guides__menu-bar`). Both need the desktop app.

**Kan-Do hook:** PRODUCT.md requires web/desktop parity "unless explicitly noted". A desktop-only extra is a legitimate, explicit exception, and it is the one place where a wrapper (Tauri v2) can do something a browser tab cannot. The product's core loop includes "check a timer", and the WIP limit means there is exactly one task to show.

**Shape, in increasing ambition:**
1. Tray/menu-bar title showing the running time (cheapest, quietest).
2. Small floating window with title, timer, pause, done.
3. Global shortcut to pause/resume.

**Risks:** the parity rule needs a documented exception (ADR). Window and tray plumbing in Tauri differ per OS. Sunsama itself warns that macOS hides menu-bar items when there is no room beside the notch, so don't make this the only place the timer appears. State must stay single-sourced in the store (the timer persists across reload per the acceptance criteria).

### 3.4 Quick-add directives (withdrawn)

Withdrawn on review: `TaskForm.vue` already has a timebox input with presets and a history-based suggestion, plus topic, activity and priority chips. A `~30min` directive would duplicate that. What remains is only a typing shortcut for the same fields, which is not worth the extra syntax to learn. Note also that issue #36 (quick add, `n`/`⌘K`, `j`/`k`) was closed as not planned, so any quick-add work needs the author's reasons first.

### 3.5 Command palette with per-card actions

**Sunsama:** `⌘K` opens a searchable list of nearly every action. When a task is hovered, task actions (start timer, change channel, ...) appear. Each command shows its shortcut, so the palette teaches shortcuts (`usage-guides__keyboard-driven-actions__command-palette`).

**Kan-Do hook:** I found no global shortcut handling or command palette in the code yet. P3 already plans `⌘K` and `j`/`k`. Keyboard operability is binding under WCAG AA. Nuxt UI has a command palette component (look it up through the Nuxt UI MCP as CLAUDE.md requires).

**Shape:** commands for "move focused card to Jetzt/Wartet/Erledigt", "start/pause timer", "set timebox", "add task", "open statistics", "switch integration". Show the shortcut beside each.

**Why it fits:** it keeps the board free of buttons (principle 1: remove chrome before adding it) while adding capability.

**Risks:** the Jetzt WIP rule must apply to palette moves too (go through the same store action, not around it). Don't ship the palette without German labels for every command.

### 3.6 "Today at a glance" capacity line

**Sunsama:** a **workload counter** at the top of each day's column sums planned time and compares it with a threshold you set; planning warns when you are over and shows an estimated finish time against your shutdown time. Their advice is to plan well below total hours, about 5.5 h for an eight-hour day. The "playlist method" projects a day purely from task order and remaining time, "not calculated using AI... we want you to feel in control" (`usage-guides__daily-planning`, `usage-guides__playlisting`, `usage-guides__tasks__planned-and-actual-times`).

**Kan-Do hook:** `application-purpose.md` asks to "highlight overload quickly". Kan-Do has timeboxes per task but, as far as I can see, no day-level view of them. A WIP limit of one controls *parallelism*; this would add a gentle view of *volume*.

**Shape:** a single muted line under the board title, such as "4 tasks, about 5 h planned, finishing around 16:30". No red state. Show it only when most tasks have a timebox, otherwise say how many are unestimated (Sunsama's own warning: accuracy requires estimates).

**Risks:** Offen can hold many tasks that aren't really "today"; count only tasks the user pulled into Today, otherwise it becomes the overwhelming number the principles warn about. Needs a user-set "day length" setting, which is more configuration; consider a default and a single field. Don't escalate to a warning colour (see C8 in the design backlog: overrun means orange, never raspberry).

## 4. Smaller ideas worth a look

| Idea | Sunsama source | Kan-Do angle | Effort |
|---|---|---|---|
| **Timer sounds** before timebox ends (10, 5, 0 min, volume and sound choice) | `usage-guides__focus-bar` | The acceptance criteria already require visual feedback near and at the timebox end; sound is an opt-in addition, off by default | S |
| **Break reminders** (after N minutes: take a break / snooze 5 min / skip) and a countdown "Pomodoro view" | `usage-guides__breaks` | Fits "assistive" personality if gentle and opt-in; needs a notification path on web and Tauri | M |
| **Count planned time as actual** when a task is completed with no tracked time | `settings__user-settings` | Keeps statistics honest when users forget the timer; or ask once at completion ("log the timebox as time spent?") | S |
| **Global add-task hotkey** that doesn't open the main window | `usage-guides__keyboard-driven-actions__global-add-task` | Tauri-only, and pairs with the ad-hoc flow ("something just came up, start tracking") | M |
| **Pinned running task**: auto-sort never moves the task with the running timer | `usage-guides__tasks__auto-sort` | Relevant if Kan-Do ever sorts columns automatically; today the invariant is already implied by Jetzt | S (note only) |
| **Daily priority that decays** back to normal next day | `usage-guides__tasks__task-priority` | Today board is re-pulled each morning; a priority flag that doesn't silently persist matches that rhythm, but Kan-Do's priority likely comes from the source system, so check ownership first | S-M |
| **Add via URL** (paste a Notion/Todoist link to pull one task in) | `usage-guides__tasks__add-via-url` | Possible faster "morning planning" path; needs a server route per integration | M |
| **Light future planning**: peek at tomorrow's list | `usage-guides__today-view` | Conflicts with "only today"; at most a read-only "tomorrow" hint inside the closing step | skip or S |

## 5. What not to take (and why)

| Sunsama feature | Why it doesn't fit |
|---|---|
| Backlog with buckets, folders and braindump | Explicit non-goal ("no backlog, no second system to maintain"). My first report listed this as a seed idea; after reading PRODUCT.md I'm withdrawing it. |
| Weekly objectives, weekly planning/review | Adds a second time horizon and hierarchy (objectives to tasks). Non-goal ("no project/epic hierarchy"). |
| Calendar timeboxing, auto-schedule, auto-reschedule, calendar import | Kan-Do's timebox is a *duration*, not a calendar slot. Reading and writing calendars is a large integration surface and pulls toward the "dense" Sunsama look. Revisit only if users ask. |
| Sunny (AI assistant), AI predictions | Conflicts with offline-first and with the preference for explainable local heuristics. The existing local timebox suggestion (`docs/features/timebox-auto-suggestion.md`) already covers the useful part. |
| Merge tasks, subtasks, `>` directive | Data stays flat; also complicates sync identity with Notion/Todoist. |
| Slack/Teams status and posting, Zapier, MCP, ~20 other integrations | "Integration setup is infrastructure, not the product." Maybe MCP later as a developer feature, not as inspiration. |
| Channels with per-channel schedules | Kan-Do already has topic/activity; schedules need a calendar model. |
| Shared workspaces, roles, SSO, billing | Kan-Do is solo. |
| Email courses, pricing manifesto, security docs | Not product features. |

## 6. Where Kan-Do is already ahead

Worth protecting while borrowing:
- **A real "waiting" state.** Sunsama has no first-class equivalent; its pro-tips page has a "pending/blocked task advice" section (headings only; I did not read it in full) which suggests users work around it.
- **A hard WIP limit of one.** Sunsama only warns about volume. Kan-Do constrains attention structurally.
- **Offline-first.** Sunsama's AI features and cloud ritual flows depend on connectivity.
- **Local, explainable estimation help** instead of an AI black box, with an unplanned-vs-planned split (`isUnplanned`) that Sunsama does not surface in this way.
- **Calm by restraint.** Sunsama's feature breadth is also its weight: 100+ help articles for one app. Every idea above should be judged by what it adds to the glance, not to the feature list.

## 7. Suggested order

1. **Command palette (3.5):** issue #101. First find out why P3 (#36) was closed as not planned.
2. **Shape 3.2 (carried-over cue)** as a small standalone issue; it's cheap and measures something Kan-Do doesn't yet know.
3. **Shape 3.1 (closing step)** together with #63/#71, so "yesterday" gets one coherent design instead of three.
4. **Spike 3.3 (tray/mini timer)** on one OS to learn the Tauri cost before committing.
5. **Decide on 3.6 (capacity line)** after a few weeks of timebox data exist, since it only helps if estimates are common.

## 8. Confidence and gaps

- **Read in full:** daily planning, weekly objectives and review, Sunny, focus mode, focus bar, breaks, menu bar, today view, archive, rollover basics, task priority, auto-sort, creating tasks, planned/actual time, command palette, global add task, playlist method, auto-scheduling, daily highlights, workspace settings.
- **Outline only:** all integration articles, the pro-tips tutorials, billing and security. The "pending/blocked" claim in section 6 comes from a heading, not its text.
- **Docs, not product:** Sunsama was not run; behaviour is as documented, and docs can lag.
- **Kan-Do side:** I read the product docs and skimmed code structure, not the full implementation. Claims such as "no streak code" and "no command palette" come from searching `components/`, `composables/`, `pages/` and `store/`; verify before shaping an issue. The `gh` binary was at `/opt/homebrew/bin/gh`, not the path CLAUDE.md names.
- **No user research exists** (PRODUCT.md says so). Everything here is judgement about fit, not evidence of demand.
