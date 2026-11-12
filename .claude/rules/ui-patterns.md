---
paths:
  - "components/**/*.vue"
  - "pages/**/*.vue"
  - "layouts/**"
  - "app.vue"
---

# Pattern check (#586)

Applies every time you create or change a UI element: lane work and ad-hoc edits alike. A **Pattern** (GLOSSARY.md) is a recurring UI solution to one user job; two elements share one when they do the same job, whatever they look like. You decide alone and never ask the user; the record is how they veto afterwards.

1. **Name the job** in user terms (confirming a destructive action, showing a task's state, adding a task, asking a question about one card). A job with a named rule in DESIGN.md "Behaviour" (a confirm or a question is "Ask in place": never a modal) is bound by it before any component is chosen: read that section first.
2. **Search by job, not by name**, in this order: (a) `npm run ui:find -- <job words>` searches the manifest (derived from the doc blocks, #117; every component's `@description`, `@usage`, `@avoid`; prints name, tier, kind, category, `@usage`, `@avoid`, variants; prefer a `kit` hit, a `feature` hit is a part of one screen and is reused only inside its own feature; read the `@avoid` of a near hit, it names the neighbour); (b) `/ui` (dev route) for how the candidates look and their variants; (c) DESIGN.md "Components" and "Behaviour", `rg -i '@(description|responsibility).*<job words>' components/`, `ls components/<area>`. Try two or three wordings before you conclude there is none; a `new` line names them.
3. **Decide one outcome per job**:
   - **reuse**: the existing element does it as is; use it.
   - **align**: build the new element but follow the existing Pattern (same structure, tokens, copy form, a11y behaviour); name what stays different.
   - **diverge**: break from the Pattern on purpose, with a reason a reviewer can weigh (a different user situation, not taste).
   - **new**: nothing does this job; say what you searched for.
4. **Write one line per job** (no outcome needs the user's approval):
   ```
   Pattern: <user job> → reused <Element>
   Pattern: <user job> → aligned with <Element> (<what stays different>)
   Pattern: <user job> → diverged from <Element>: <reason>
   Pattern: <user job> → new (no existing pattern; searched: <terms>)
   Pattern: none (<why no element does a user job here: copy fix, spacing, bug fix>)
   ```
   `<Element>` is a component name or a DESIGN.md Components heading. Lane work: the lines go in the PR body (the PR guard `wf_pr_body_check` requires them when the diff touches these paths). Ad-hoc work: in your final report.
5. **A `diverged from` line is also a design reason**: run skill `design-rule` on it (challenge, verdict, proposal; it never writes a rule). The PR body then carries `Rule candidate: #<n>` or `Rule candidate: none (<reason>)`.

Profile: `.claude/issue-workflow.md` "Pattern check".
