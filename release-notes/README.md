# Release notes

One Markdown file per released version: `release-notes/<X.Y.Z>.md` (plain semver, equal to the version being released). `npm run release <version>` refuses to release without a valid file. The app bundles every file named `[0-9]*.md` here and, after an update, offers the **Highlights** of each version you skipped in a toast (button "Was ist neu"). The release script uses the file verbatim as the GitHub release body and the `notes` of `latest.json`.

## Format

```md
## Highlights
### de
- **Kurzer Titel.** Ein Satz: was ändert sich für mich.
### en
- **Short title.** One sentence: what changes for me.

## Fixes
- Free text, never shown in the app, may be anything.
```

- Stage (#693): the notes of a release record its stage as a line `Stage: alpha`, `Stage: beta` or `Stage: stable`, under `## Fixes` (free text, never shown in the app, so the parser needs no change). `npm run release` refuses a file whose stage differs from `--stage` (default `alpha`).
- Sections: `## Highlights` (required, first) and `## Fixes` (optional, never shown, not validated). Any other `##` heading or content before `## Highlights` is an error.
- `## Highlights` is **either** the single line `None.` (a release without user-facing highlights, shows no button, only the "updated" toast) **or** has `### de` and `### en`, each with 1 to 5 bullets and **the same number of bullets** in both.
- A bullet is one line: `- **Title.** Text`. The title is bold and ends in a full stop inside the bold run; at least one word of text follows. Plain text otherwise: no HTML, links, images or nested lists. The app renders the text as text, never as Markdown or HTML.
- Errors are reported with file, line and a hint, e.g. `release-notes/0.3.0.md:7: de has 3 bullets, en has 2`.

## What belongs in Highlights

Significant UX updates and new features only: one user-visible change per bullet, one sentence, no ticket numbers. Fixes, small improvements and tech debt go under `## Fixes` or nowhere. A fix-only release uses `None.`.

## Template

```md
## Highlights
### de
- **Titel.** Satz.
### en
- **Title.** Sentence.

## Fixes
- ...
Stage: alpha
```

The format is implemented by `lib/releaseNotesFormat.mjs` (shared by the release script and the app).
