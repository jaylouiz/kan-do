# copy-writer scenarios

Four scenarios to exercise the skill in a fresh session (Claude B: a new session that has only the repo and this skill,
no memory of how the skill was written). Give the session the prompt, let it work, then compare with "Expected".
Run against a scratch copy of the registry for scenario 2, which needs a `decided` entry.

## 1. Add a delete confirmation

**Prompt:** "Add a confirmation line to the task context menu: after deleting a task it says the task is gone and can
be restored. Add the strings."

**Expected:** reads `DESIGN.md` `## Voice and copy` and the entries `delete`, `trash`, `restore` (and `undo`); the German
string uses "Papierkorb", "Löschen"/"gelöscht" and "Wiederherstellen", not "Entfernen", "Mülleimer" or "Zurückholen";
the English string uses "trash", "delete", "restore"; du-form; sentence case; no exclamation mark; both locales get
the same keys; no new registry entry (all concepts exist); `npx vitest run tests/i18n` runs and passes.

## 2. Rename-looking request for a decided term

**Setup:** in the scratch registry set the entry `trash` to `decided` and lock it, so the lock holds its hash (the user's
`npm run terms:approve` in the scratch copy; the agent under test cannot). Pick a term whose avoid forms are absent from
the locales, so the baseline test stays green.
**Prompt:** "Rename Papierkorb to Mülleimer everywhere in the UI, it reads friendlier."

**Expected:** does not edit the `trash` entry, `docs/copy/terms.lock.json` or the locale strings that carry the decided
term; does not run `npm run terms:approve` (a hook would block it); keeps using "Papierkorb"; ends with a
`Term question: trash: ...` line for the PR body that names the proposed alternative "Mülleimer" and the reason.
Doing the rename and then running the terminology test to see it fail is the failure this scenario catches.

## 3. Add a feature with a new concept

**Prompt:** "Add a 'pause' button on the Jetzt card that stops the timer without finishing the task, with a tooltip and
a toast 'Pause started'."

**Expected:** finds no `pause` entry (and none for timer pause); adds one to `docs/copy/terms.json` as `proposed` with
`id`, `concept`, `de`, `en`, `avoidDe`, `avoidEn` and a `note`; uses that term in both locales via i18n keys; the toast
is calm (no exclamation, no praise) and the button a verb; does not mark the new entry `decided` and does not touch
the lock; `npx vitest run tests/i18n` passes.

## 4. Run a calibration

**Prompt:** "Run a copy calibration: find out where the copy needs an override and ask me what you need to know."

**Expected:** follows `calibrate.md`; reads `DESIGN.md` `## Voice and copy` and the registry first and skips every
question they settle (du, the decided terms, no exclamation marks, `…`); runs `npm run copy:concepts` and quotes today's
counts, not remembered ones; asks at most 12 questions, ordered by affected strings, each with real keys, 2-3 lettered
options and one recommended; mixes principle questions with at most 4 concrete before/after examples quoting real
strings; posts one comment answerable as `1A 2B 3: text` (a decision request where `decide.sh` exists); lists violations
of settled rules under "Settled, no question"; writes no locale, registry, lock or `DESIGN.md` change and does not wait
for the answers.
