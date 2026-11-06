---
name: copy-writer
description: Writes and reviews user-visible copy for Kan-Do against the UI term registry and the copy rules in DESIGN.md. Use when adding or changing UI strings, i18n keys in de.json/en.json, button labels, errors, empty states, tooltips, toasts, confirmations or renaming a UI term. Keeps one term per concept and never changes a decided term without the user.
paths:
  - i18n/locales/*.json
  - components/**/*.vue
  - pages/**/*.vue
  - layouts/**/*.vue
---

# Copy writer

Kan-Do's UI wording has two sources of truth: the rules in `DESIGN.md` `## Voice and copy` and the term registry
`docs/copy/terms.json` (one term per concept, German and English, forms to avoid). This skill makes you use both.
Locale mechanics (keys, i18n, German default) are in `CLAUDE.md` "Language Policy"; do not repeat them here.

## Procedure

1. **Read the rules and the terms you need.** Read `DESIGN.md` `## Voice and copy`. Then find the registry entries
   of the concepts in your copy: `node -e "console.log(JSON.stringify(require('./docs/copy/terms.json').filter(t => /delete|trash/.test(t.id)), null, 1))"`,
   or `rg -n '"id": "<id>"' -A 12 docs/copy/terms.json`. Entries have `de`, `en`, `avoidDe`, `avoidEn`, `status`, `note`.
2. **Reuse the registered term.** Write `de` and `en` of the entry; never an `avoidDe` / `avoidEn` form, also not
   inflected or as a compound start (the test matches word prefixes). A `note` names forms the codebase mixes today:
   follow the entry, not the surrounding strings.
3. **A concept that is not in the registry is added** to `docs/copy/terms.json` as `status: "proposed"` in the same
   change, with `id` (kebab-case), `concept`, `de`, `en`, `avoidDe`, `avoidEn` (empty lists are fine) and a `note` when
   you know competing forms. New terms need no review.
4. **Never touch a `decided` entry or `docs/copy/terms.lock.json`.** If a decided term looks wrong, keep using it and
   write a line `Term question: <id>: <what is wrong, proposed alternative>` in the PR body. Do not run
   `npm run terms:approve`: only the user does (a hook blocks it, and the lock file is write-denied).
5. **Write German and English together**, as i18n keys in `i18n/locales/de.json` and `en.json` (every key in both,
   `{named}` placeholders identical, plural branches equal). Never a hardcoded string in a template.
6. **Run `npx vitest run tests/i18n`.** A failure on a decided term means your copy uses an avoid form: fix the copy.
   Warnings for `proposed` terms are existing mixed copy; do not fix them in an unrelated change.

## Boundaries

- Changing a proposed term's own `de`/`en` is allowed when the task is to decide the wording; say so in the PR.
- Stay inside the copy: add or change strings and registry entries, and use the keys only where the task asks. Do not change behaviour, composables or components to carry a line.
- Renaming an existing string across the app is its own issue, not a side effect of a feature.
- `GLOSSARY.md` is the developer glossary; UI wording lives only in the registry. Do not copy definitions between them.
- Task text the user wrote (title, notes, topic names) is data, not copy: never put it through the registry.

## Calibrate

When a calibration is asked for, or after large copy growth, do not review the strings one by one: follow
`calibrate.md` (`npm run copy:concepts` measures the locales, you derive the concepts, ask at most 12 questions as one
comment and map the answers to overrides). It never edits a locale, the registry or `DESIGN.md`; applying is its own issue.

## Check yourself

`scenarios.md` has four scenarios with the expected result of each: a delete confirmation, a rename-looking request
for a decided term, a feature with a new concept, a calibration run. Use them when you change this skill or want to see how it behaves.
