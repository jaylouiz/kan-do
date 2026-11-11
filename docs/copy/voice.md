# Voice and wording

The wording rules of the Kan-Do UI. The registry `docs/copy/terms.json` is the vocabulary; the `copy-writer` skill applies both, and the live copy editor hands this file to its translation agent (`server/copy-editor/translate.ts`). The terms for address, Timebox, Löschen/Entfernen/Trennen, Verbindung and Notiz are decided; the answers of #473 and #485 are decided in the registry once the user approves them with `npm run terms:approve`.

## Rules

- **Address.** German speaks the user as "du". English has no formal form.
- **Tone.** Calm, like a well-made notebook (PRODUCT.md personality: natural, helpful, assistive). Quiet confirmation (principle 4): state what happened ("Im Papierkorb"), no exclamation marks, no praise.
- **Case.** Sentence case for labels, titles and buttons ("Tag abschließen", "Close the day"); proper names and the four column names keep their capital letters. No ALL CAPS.
- **Buttons are verbs.** The label names what happens: "Speichern", "Löschen", "Trennen", not "OK" or "Ja". A dismiss is "Abbrechen" or "Schließen".
- **Errors say what happened and what to do next.** "Notion ist gerade nicht erreichbar. Versuche es später erneut." Never a raw technical detail, status code or exception text (PRODUCT.md principle 5: if a user sees one, the design has failed).
- **Failure sentences.** A full sentence about something that was tried reads "… konnte nicht … werden" / "… could not be …"; a short status label next to a source or row keeps "fehlgeschlagen" / "failed"; "kann nicht" / "cannot" only states a rule ("cannot be negative").
- **No "Bitte".** Errors and hints use a plain imperative ("Versuche es erneut.", "Try again."), no "Bitte" / "Please".
- **Technical detail.** Only the Data settings page shows a detail, in one form: "<What happened>. Details: {error}" (the folder or file system is what the user must fix there). This is the single exception to the raw-detail rule above.
- **Empty states.** "Noch keine X." (plus how it fills, where there is something to do) when the thing appears with use; "Keine X gefunden." only for a search or filter result; never "… verfügbar".
- **Progress.** German is passive with the object first ("Datenbanken werden geladen…", "Wird geprüft…"), English the present participle ("Loading databases…"); no space before `…`; the percent sign has no space ("{percent}%").
- **English.** American spelling (color, canceled, gray); no contractions except the feature name "What's new".
- **Voice.** The app has no speaker: no "wir" / "we"; passive, or "the app" as subject.
- **Names and full stops.** "Kan-Do" in running text (the lowercase `kan-do` is only the wordmark in the app bar, `nav.brand`); German compounds with a brand name take a hyphen ("Notion-Datenbank"). A description or hint that is a sentence ends with a full stop; a noun phrase or list does not.
- **Characters.** One ellipsis character `…` (not three dots) for loading and truncated actions. Quotes are „…“ in de and “…” in en. `{named}` placeholders only, never string concatenation of translated fragments.
- **Statistik verdicts.** A verdict is a plain sentence relative to the user's own last 4 weeks ("Es läuft besser als sonst"), never an absolute target, never red, never praise; a harder week is stated plainly (#469).

## Guards

What a check already guarantees is named here once and not repeated as a rule.

| Guaranteed | By |
|---|---|
| One term per concept, in German and English, with the forms to avoid: among them Löschen / Entfernen / Trennen, the task state (erledigt, Fertig, abschließen) and settings, token and time spent. A concept that is missing is added as `proposed` in the same change; a `decided` term changes only with the user | `docs/copy/terms.json`, checked by `tests/i18n/terminology.test.ts` (`npm run i18n:check`) |
| No uppercase class in components or pages | `tests/config/design-patterns.test.ts` |
| Plurals in vue-i18n pipe syntax, every key in `de.json` and `en.json` in the same change, no hardcoded string in a template | `npm run i18n:check`, ESLint `no-raw-text` |
