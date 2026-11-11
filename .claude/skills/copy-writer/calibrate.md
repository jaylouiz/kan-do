# Calibrate the copy (questionnaire)

Use when a calibration is asked for, or after large copy growth (many new keys, a new area). Instead of reviewing
every string, measure the locales, derive the language concepts that matter, ask the user at most 12 questions and map
each answer to the keys that need an override. The procedure is reusable: a rerun skips what is already settled.

Hard rules: this procedure never edits a locale, `docs/copy/terms.json`, `docs/copy/terms.lock.json` or `docs/copy/voice.md`
(the apply step does, as its own issue), never runs `npm run terms:approve`, and writes the questions in English
(before/after examples quote the real German and English strings unchanged).

## 1. Read what is settled

Read `docs/copy/voice.md` and `docs/copy/terms.json`. **Skip every question they already settle**: the address
(du), every `decided` term, the rules (no exclamation marks, no praise, sentence case, `…` not three dots, buttons are
verbs, errors say what happened and what to do, no raw technical detail), and answers of earlier calibrations (they
are in `docs/copy/voice.md` or the registry `note`s, e.g. "User answer (#473)"). A `proposed` term with no user answer behind it
is not settled: mixed forms of it may be asked. A violation of a settled rule whose fix is mechanical (`...` to `…`,
an exclamation mark) is not a question: list it under "Settled, no question" so the apply step fixes it. If the fix
needs a choice (what to show instead of a raw `{error}`), ask it.

## 2. Measure

```bash
npm run copy:concepts                      # markdown report
npm run copy:concepts -- --json            # same, for machines
npm run copy:concepts -- --keys <id>       # every key of a detector (id from the report)
npm run copy:concepts -- --keys word:<p>   # every key with a word starting with <p> (a cluster, both locales)
```

The report has per detector (data table in `scripts/copy-concepts.mjs`, each with a `why`) the count per locale and
8 example `key = text` pairs, the mixed forms of registry terms with a `note` (live count per form), and the top 40
recurring words per locale that are in no registry field. Detectors are heuristics: read the example keys before you
trust a count (`address-formal` also hits the pronoun "sie" at a sentence start). `word:<p>` is a prefix match in both
locales ("wir" also hits "wird"): re-filter by hand, and use `rg` for the context of a form (button or state). Never
copy numbers from an old report: the questionnaire quotes today's counts.

## 3. Derive concepts

A concept is a place where the copy makes a choice and the user may want it otherwise. Take:

- detector findings that are not already settled (error phrasing, "Bitte"/please, empty-state phrasing, English
  contractions, period style, button-like values),
- mixed forms of a registry term (`Fertig` 7 vs `Erledigt` 39),
- clusters the script cannot name, from the candidate list: synonyms for one thing (Einstellungen / Konfiguration /
  Einrichtung, Token / Zugang / Schlüssel, Verbindung / Quelle), anglicisms, several labels for one value (time spent).
  Check a suspicion with `--keys word:<prefix>` and `rg` before it becomes a question.
- voice: who speaks ("wir", passive, imperative), progress phrasing, spelling variant of English.

Drop a concept when fewer than ~3 strings are affected and no rule is at stake. More than 12 concepts left: keep the 12
with the most affected strings and name the rest in the "Left out" line; never merge two concepts into one question.
Every concept you drop is named in that line.

## 4. Write at most 12 questions

Order by number of affected strings (de plus en, the strings an answer can change; overlapping detector counts are
fine, say which count you quote), largest first. Each question has:

1. **What the data shows**: the count per locale and 2-3 real keys with their strings (`key = text`).
2. **2-3 options**, lettered, one marked **(recommended)** with the reason in one sentence. "Leave as is" is an option
   when it is defensible; free text (`3: text`) is always allowed and needs no option.
3. Principle or example: at most 4 of the 12 are **concrete before/after examples** taken from real strings (the answer
   decides the whole cluster: "a string like this one becomes ..."), aim for at least 3. The rest are principle questions.
4. **A `Keys:` line**: the `--keys` selector(s) that list the question's strings (`error-phrasing`, `word:einstell`),
   or an `rg` pattern when no detector fits (`{error}`). Section 6 reads the key list from it.

Keep each question answerable in a letter. No question about something section 1 settled.

## 5. Post one comment

One comment, numbered questions, lettered options, answerable as `1A 2B 3: free text`. Order: the one-line goal (it is
the first line of the file), the questions (one line each, options inline: `1. <question> A: … · B: … (rec B)`), then
one `<details><summary>Details</summary>` block holding the paragraph on what was measured and what is not asked, each
question's `Keys:` line, the "Settled, no question" list and the "Left out" line. Where
`~/.claude/skills/orchestrate-gh-issues/decide.sh` exists, post it with `WF_COMMENT_CAP=2500 decide.sh request <issue>
<file>` (the first line of the file is the one-line question; it parks the issue and shows in the digest; the raised
cap is for this questionnaire only, answered in one go); else a plain issue comment. Do not wait for answers in the run that posts them. In
an interactive session the user is present: ask the same questions with `AskUserQuestion` in batches of 4 (no free
text, the "Settled" and "Left out" lists stay in the comment) and still post the comment, so the answers are on the issue.

## 6. Apply the answers

Its own issue (`Copy: apply the calibration questionnaire answers`, `consistency`), a normal Specify then Build once
the answers are in. The Build:

1. **Keys per answer.** The `Keys:` line of the question gives the key list (`--keys <id>`, `--keys word:<prefix>`
   or its `rg` pattern). An answer "leave as is" produces no override.
2. **Draft a table** `key | lang | current | new` for those keys under the decided rule (the shape the #473 export
   uses), in the PR body or an issue comment before editing. A string the rule does not clearly cover goes into the PR
   as a question, not a guess.
3. **Edit** `i18n/locales/de.json` and `en.json` only for the keys in the table, both languages together; run
   `npm run i18n:check`.
4. **Terms.** An answer that decides a term sets or adds its registry entry as `proposed` (`de`, `en`, `avoidDe`,
   `avoidEn`, `note: "User answer (#<issue>): ..."`) and the PR names the ids for the user's `npm run terms:approve`.
   Never touch a `decided` entry or the lock.
5. **Principles.** Write each settled principle into `docs/copy/voice.md` `## Rules` (one line, in the existing
   style), so a rerun of this procedure skips it. Changing a named rule or token is a one-way decision: request it.
6. **Verify.** Rerun `npm run copy:concepts`: the counts of the answered concepts moved as expected; `npx vitest run
   tests/i18n`, then `npm run verify`.

Start the next calibration at section 1: the answers of this one are now settled.
