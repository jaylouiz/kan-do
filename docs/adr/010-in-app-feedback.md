# ADR 010: In-app feedback to GitHub issues

## Status

Accepted (#227, part of epic #221). The screenshot part is built in #247: see [ADR 014](014-feedback-screenshots.md).

## Context

The author dogfoods the desktop app and wants to file feedback as a GitHub issue (label `inbox`) in under a minute, with enough context for a future self or an agent to act on it without a long description. The repository is private, the `feedback` token is write-only for JS (ADR 007), and task text on the board is private.

## Decision

- **Direction A, form-first dialog, attachments on demand.** One `UModal` opened from the command palette (desktop only, same after-leave pattern as day close, so two dialogs never overlap). Two steps in one modal: *Form* (title, description, optional element, a one-line context summary) then *Prüfen und senden*. Picking an element dismisses the dialog, runs the picker and reopens it with the result. Rejected: capture-first (capture on entry conflicts with opt-in per report) and context-only as the target design (it is only the degrade path, below).
- **Privacy rules (binding).** (1) Nothing is picked or sent unless the user adds it. (2) The review step renders the exact issue body (`lib/feedback/buildIssueBody.ts`, the same string that is posted) and every context item (element, route/viewport/locale, version/OS) has a checkbox; a removed item is absent from the body, not blank. The task title behind a picked element is only sent when the user ticks "Titel einfügen"; the task id is sent otherwise. (3) The draft (title, description, selection) lives in module memory only (`composables/useFeedback.ts`): never browser storage, never a persisted store, so it can never reach the synced data folder of ADR 008. Closing keeps it for the session, "Entwurf verwerfen" drops it. (4) The only way anything leaves the app is the primary button of the review step. (5) The log tail (30 lines of the #225 log file) is shown in the review step, has its own checkbox, and Rust drops any line that looks like a credential before it returns; see "Seams".
- **Element picker** (`composables/useElementPicker.ts`, `ElementPickerBar.vue`). While picking, pointer, key and drag events are intercepted in the capture phase on `document` and stopped before the page (dnd-kit included) sees them; only `click` is used to pick, and the listeners are removed when the pick ends, so nothing is left behind (no stuck drag state, no `preventDefault` leaks). Keyboard: Tab/Shift+Tab walk focusable elements, ArrowUp parent, ArrowDown first child, Enter picks, Escape cancels; the candidate is announced in a live region as "<Komponente>, <Selektor>". The record (`lib/feedback/describeElement.ts`): component chain (nearest 3, framework wrappers skipped), `data-testid` of the element or nearest ancestor, a short selector anchored at the nearest test id or unique id plus a tag/`:nth-of-type` path (never class names), rounded bounding box, nearest `[data-task-id]`.
- **Component names come from a marker, not from Vue internals.** `plugins/component-name.client.ts` (desktop and dev only) sets `data-component` from `$options.name` on each component's root element after mount; nested components sharing a root append their names. `el.__vueParentComponent` does not exist in production builds. Web production builds are untouched.
- **Send goes through Rust only.** `useSecrets().githubRequest('github-feedback', 'POST', '/repos/jaylouiz/kan-do/issues', { title, body, labels: ['inbox'] })`. The page never reads the token and never calls `fetch` for GitHub (a Vitest guard greps the feedback code for token reads, storage and `fetch`). A `rejected` flag (401 earlier in the session) or a missing token never reaches the network: the primary action becomes the fallback. HTTP 403/429 and 5xx, offline and timeouts are shown inline with "Erneut versuchen" and keep the draft; there is no automatic retry. Unexpected answers go through `useErrorHandler` (`feedback` context).
- **Fallback without a token (D5-C).** Status `absent` or `rejected` turns the primary action into "Im Browser öffnen": a prefilled `https://github.com/jaylouiz/kan-do/issues/new?title=…&body=…&labels=inbox` through the opener plugin (capability scope `…/issues/new*`; the success toast opens `…/issues/*`). The URL stays within about 7.5 KB encoded (`lib/feedback/trimPrefilledUrl.ts`): log tail dropped first, then the context table shortened, then dropped, and a note names what was left out. The user's own description is never cut; when it alone exceeds the limit the link is built anyway and the dialog says so.
- **Success** shows a quiet toast ("Danke, das Feedback ist als Issue #N angelegt.") with "Im Browser öffnen", closes the dialog and discards the draft.

## Amendment: public repository, browser path for everyone without a token (2026-11-06)

The repository `jaylouiz/kan-do` becomes public under the same name, and reports become public issues there. Public users have no feedback token, and none can be handed out (a shared token would be extractable from every install). Owner decision, option a):

- **Without a token the browser path is the normal path, not a fallback.** "Auf GitHub öffnen" opens the prefilled `issues/new` link as described under D5-C; the user sends the issue on github.com with their own account. The owner keeps the in-app send and the screenshot upload (ADR 014) unchanged.
- **Gate: write access, not "a token is stored".** Any user may store a token (the updates token is optional for everyone), so a stored feedback token no longer means "the owner". On open the dialog asks `GET /repos/jaylouiz/kan-do` with the feedback token (read-only, through `github_request`) and offers the in-app send only when `permissions.push` is true (owner, collaborators); `push: false` (state `readOnly`) takes the browser path. Asked once per token and session. A failed check (offline, rate limit, 5xx) keeps the in-app send, whose own errors are shown and retried as before; a 401 marks the token rejected as before, now already on open. Rejected: a relay service that posts with a bot token (an always-on service and a spam target for a one-person app), and an issue form template with required fields (the prefilled body would not fill its fields).
- **The dialog says it.** The form step names it before anything is typed ("Dein Feedback wird ein öffentliches Issue auf GitHub."), plus "Zum Absenden brauchst du ein GitHub-Konto." when no usable token is stored; the token state is read on open for that. The review intro names the public issue (and, on the browser path, the account) again. The "Ohne GitHub-Token …" note is gone: for a public user a token is not something missing. A rejected token keeps its note and the link to GitHub-Zugriff.
- **The screenshot** goes to the clipboard as before; the review says to paste it into the issue with ⌘V, and after the link opens a toast on the board says what to do there (paste the screenshot, send the issue), because the dialog has closed.
- **Length.** The body carries title, description, version, OS, route and the redacted log tail. The link stays within about 7.5 KB encoded (under the ~8 KB that GitHub and browsers take reliably): the log tail is now shortened to its newest lines first (the summary says how many), dropped only when no line fits, then the context shortened and dropped. Title and description are never cut.
- **Label.** The link keeps `labels=inbox`; GitHub applies URL labels only for users with triage rights, so a public user's issue arrives unlabelled and is triaged by hand. That is accepted.
- **Web build.** Feedback stays desktop only (the palette offers it only in Tauri); nothing changes there.
- **Privacy.** Public issues raise the stakes of the mask: the activity value of the task sheet and the add form were not marked `data-private` (#704) and are now, with an E2E guard over the rendered text (ADR 014).

## Spike result: DOM rasterisation failed, screenshots are not built

> Superseded for the screenshot part by [ADR 014](014-feedback-screenshots.md) (native `WKWebView` snapshot, #247). The result below stays as the record of why DOM rasterisation was dropped.

The spec made a WKWebView spike the gate for the screenshot row, the annotate step and the clipboard image. A throwaway script (never committed) rasterised the seeded board (`/tasks?seed=local`, 1200x800 window) with `modern-screenshot@4.7.0` inside `tauri dev` on macOS. **Result: fail.**

| Criterion | Result |
| --- | --- |
| PNG not blank, no network request during capture | pass |
| Figtree renders, layout matches the live card rects | pass |
| Card radius and shadow present | **fail**: shadows render as hard grey blocks along the right and top edges |
| `UModal` content present | **fail**: a day-close modal that was open in the DOM (2.5 s after opening) is missing from the PNG |
| 1200x800 at 2x in < 3 s | **fail** with the modal open (3.9 s; the board alone took 0.5 s to 2.0 s across runs) |

The `tauri build` bundle was not tried: the dev result already fails three criteria. Per the spec's degrade path this slice ships context + element pick without the screenshot row, annotate step, redaction, clipboard image, `data-private` markers and the assets branch. The follow-up is #247 (`inbox`); it also notes what was not tried (other rasterisers, fixing the shadow and portal cases in the clone hook).

The design for a later screenshot stays as decided and is not built: upload the flattened PNG through the Contents API to an orphan `feedback-assets` branch (bootstrapped with blob, tree, parentless commit, ref), embed it in the issue body, redaction as an opaque fill (no blur), task text masked in the clone unless the user turns it off, originals discarded after send. The branch grows without cleanup; retention is a decision for #247.

## Seams

- **#225 (version, log), now wired.** The app version comes from `getVersion()` (the value the updates page shows). The log tail comes from the `log_tail(lines)` command in `src-tauri/src/logging.rs`: last 30 lines (hard caps 100 lines and 8 KB) of `~/Library/Logs/com.julius.kan-do/kan-do.log`, lines containing a credential marker (`ghp_`, `github_pat_`, `bearer `, `authorization`) dropped, an absent file is an empty tail (no log section). Both are loaded after the dialog opens and are best effort. The OS is still the user-agent name only: #225 added no `app_info` command.
- **`api.github.com`** is reached by Rust only; no `http:default` entry was added for it. The CSP work (#228) can list it as already needed by the Rust client only.

## Consequences

- Each report is two clicks past the palette plus a title; the review step is the audit point for what leaves the machine.
- The component-name marker costs one `mounted` hook per component on desktop and dev. It is not installed on web production builds.
- Issues created by the app come from the token's identity and carry the `inbox` label, so the existing triage flow (`inbox` → `needs-spec`) takes over.
- E2E stubs `github_request` (`tests/e2e/helpers/tauriStub.ts`: `POST …/issues` answers 201 without any network); the real send is a manual check on the Mac.
