---
name: design-rule
description: Turns a design reason from the user into a challenged rule proposal for DESIGN.md, a component doc block or the workflow rules. Use when the user gives a reason with design feedback ("because…", "so that…", "weil…", "damit…") in chat, a PR or issue comment, a prototype comment, a decision answer or a canvas thread, or when the Pattern check records a `diverged from` reason. A bare preference without a reason does not trigger it. Proposes only; the user adopts.
---

# Design rule from design feedback (#587)

A reason the user gives is applied once and then lost unless it is turned into a rule. This skill challenges the reason, reports one verdict and proposes the rule. **It never edits DESIGN.md, a component doc block, `.claude/rules/` or the profile before the user's explicit yes.** The user's call always wins.

## Procedure

1. **Reason or preference?** A reason says why ("because the label is read before the control"). A bare preference ("make it bigger") is applied and no rule is mentioned. Stop here for a preference.
2. **Apply the request as asked.** The challenge is about turning the reason into a rule, not about refusing the change.
3. **Challenge with three tests**, naming the source of each:
   - (a) UX convention: Nuxt UI defaults (`app.config.ts`, Nuxt UI MCP `get-component-metadata`), platform guidelines (Apple HIG, Material), WCAG 2.2, named heuristics.
   - (b) `PRODUCT.md` principles: quote the one that applies.
   - (c) existing `DESIGN.md` rules, Do's and Don'ts, Components and component doc blocks: `rg` the topic words.
4. **One verdict**:
   - `matches convention`: propose adopting as is.
   - `conflicts`: name the convention or rule and give the counter-argument.
   - `personal preference only`: argue against generalising; suggest a one-off decision (no rule, no issue).
5. **Propose** with this block (in your reply when the user is in the session; as the body of a `rule-candidate` issue when nobody is, see below):
   ```
   Rule proposal: <the rule, one sentence>
   Your reason: <quote, with channel and link>
   Challenge: matches convention | conflicts | personal preference only: <1-3 lines, source named>
   Where it goes: DESIGN.md Named Rule "<Name>" in <section> | <Component> doc block | .claude/rules/<file> or .claude/issue-workflow.md
   Adopt? yes / as one-off / no
   ```
   Destination: beyond one component → a DESIGN.md Named Rule (the section's `### Named Rules`, or Do's/Don'ts); one component → its doc block; how agents work → `.claude/issue-workflow.md` or `.claude/rules/`. Never the `custom-ink` palette.
6. **Unattended** (an orchestrated worker, a PR, no live user): do not wait. Dedupe first: `gh issue list --label rule-candidate --state all --search "<keywords>"`; a repeat reason is a comment on the existing candidate, not a second issue. Otherwise `gh label create rule-candidate --force --description "Design-rule proposal waiting for the user's adopt/decline"` and `gh issue create --label rule-candidate` with the block, its body starting `<!-- rule-candidate -->`. Report it in the PR as `Rule candidate: #<n>` (or `Rule candidate: none (<reason>)` when the verdict is a one-off).
7. **Adopt: the only write, and only after the user's explicit yes** ("adopt", "yes", "adopt #<n> as <destination>"). Write the rule at the destination. For DESIGN.md follow the profile's "design records" (`/impeccable document`, asks before overwriting), then `npm run lint`. A `conflicts` or `personal preference only` verdict the user overrules is written with both sides: `Deliberate exception (user, <date>): <reason>. Challenge was: <verdict>: <one line>.` Close the candidate issue with the commit. `no` or `as one-off`: close it as not planned with the user's words; do not propose the same reason again.

## Examples

- "Put the delete button last, because the primary action should be on the right." Matches the Buttons rule (neutral first, primary last) and Nuxt UI footers → `matches convention`, already a DESIGN.md rule: say so, no new rule.
- "Hide the sync dot entirely, because it distracts me." Conflicts with DESIGN.md "Sync status" (a source that cannot sync shows a dot; a healthy sync is already silent) → `conflicts`; counter-argument: the dot appears only when something needs the user, hiding it makes a failing sync silent.
- "Make the card corners sharper because I like it." No reason beyond taste → `personal preference only`; apply it where asked, keep it a one-off.
