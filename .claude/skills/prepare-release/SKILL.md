---
name: prepare-release
description: Prepare a kan-do desktop release - pick the version from the unreleased changes on main, write and validate release-notes/<version>.md, dry-run the release script, push the notes and hand the user the real `npm run release` command. Use when asked to release, cut, ship or prepare a new version.
argument-hint: "[version | major|minor|patch] [what the notes should cover]"
---

# Prepare a release

Releases are cut from HEAD of `main` by `npm run release <version>` (`docs/release.md`). This skill does
everything before that and hands the user the final command. **Never run `npm run release` without
`--dry-run`**, never read or touch the signing key, Apple credentials or the release workflow.

Default scope: every change on `main` since the latest tag. The argument (free text) may pin the version
(`0.4.0`, `patch`, ...) and/or narrow what the notes mention ("only highlight the sources work"). It never
changes the shipped code: the script always releases all of `main`.

## 1. Preconditions

In the main checkout (no worktree): on `main`, clean tree, `git fetch origin` and not behind `origin/main`
(fast-forward if only behind; stop and report otherwise). `gh auth status` must pass.

## 2. Collect unreleased changes

```bash
TAG=$(git describe --tags --abbrev=0 --match 'v[0-9]*')
git log --first-parent --format='%h %s' "$TAG"..origin/main
gh pr list --state merged --limit 200 --search "merged:>=$(git log -1 --format=%cs "$TAG")" \
  --json number,title,headRefName,labels,mergedAt
```

Keep only PRs merged after the tag commit. Classify each change:
- **feat**: branch `feat/...` or `feat:` subject; **fix**: `fix/...`, `fix:`;
- **breaking**: `!` after the type or `BREAKING CHANGE` in the body (also: a data or settings change users must act on);
- **internal**: `docs`, `chore`, `test`, `refactor`, workflow/retro/skill commits. Not in the notes.

Read a PR body (`gh pr view <n> --json body`) when the title does not tell what changes for the user.

## 3. Version (semver)

Unless the argument pins it:

| Latest tag | breaking | feat | only fixes |
|---|---|---|---|
| `>= 1.0.0` | major | minor | patch |
| `0.x.y` | minor | minor | patch |

Nothing user-facing since the tag: stop and say so, unless the argument forces a release. The version must
be greater than the latest tag.

## 4. Release notes

Format and rules: `release-notes/README.md` (parser `lib/releaseNotesFormat.mjs`). If
`release-notes/<version>.md` already exists (a PR may have started it), extend it and keep its bullets.

- **Highlights**: 1 to 5 bullets per language, same count in `### de` and `### en`, `- **Titel.** Ein Satz.`,
  only significant user-visible features and UX changes, merged where they belong together, no ticket
  numbers. German first, in the app's voice and terms (Offen, Jetzt, Wartet, Erledigt, Verbindungen; look
  up the UI wording in `i18n/locales/de.json`). Fix-only release: `None.`
- Write the Highlights with the `release-copywriting` skill.
- **Fixes**: one short English line per user-noticeable fix or smaller improvement, with `(#n)`.
  Internal work stays out.
- A scope in the argument narrows the Highlights (and Fixes) to that scope.
- **Stage** (#693): `alpha` | `beta` | `stable`, default `alpha`. An `alpha`/`beta`/`stable` word in the argument pins it. Write it as the last `## Fixes` line, `Stage: <stage>` (a `None.`-highlights file still gets a `## Fixes` section for it). Read `.claude/testing-mode`: a `stable` release needs `quality`; when it says `fast`, stop and tell the user to switch it first (one-way, theirs to decide).

## 5. Validate

```bash
npm run release <version> -- --dry-run [--stage <stage>]
```

It validates the notes and runs the preflight without signing or pushing. On a notes error, fix the file
and re-run. Refusals that only concern the uncommitted notes file (dirty tree) are expected here.

## 6. Confirm and push the notes

Ask once (AskUserQuestion): the version with its reason and the rendered Highlights; options "commit as
is" / "edit". After a yes commit only the notes file (`docs(release): notes for v<version>`) and push
`main`. Then re-run the dry run: it must show no refusal.

## 7. Hand over

Tell the user to run, in this session:

```
! npm run release <version> -- --stage <stage>
```

It runs `npm run verify` and the full E2E suite (about 6 minutes on a quiet machine, against a production build; an alpha or beta release in fast testing mode runs the fast tier instead, a stable one always the full suite), builds, signs and publishes. Afterwards
point at the "Verify a release" checklist in `docs/release.md`; on a failure, its "Recovery" section.
