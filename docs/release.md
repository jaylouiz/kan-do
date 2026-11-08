# Releasing kan-do (desktop)

One command publishes a release from your Mac, and the installed app finds it on the public `jaylouiz/kan-do` repository (no token needed), asks you, saves your data, installs it and relaunches. Decisions and rationale: [ADR 009](adr/009-release-pipeline-and-updater.md). Epic: #221, issue #225.

> **One rule:** no agent ever generates, reads, copies or stores the updater signing key or its password, the Developer ID certificate (`.p12`) or the notarization credentials, and no agent runs a real release or triggers the release workflow. All of that is yours. Agents may run `npm run release <version> -- --dry-run` and nothing else of this document.

## One-time setup (you)

1. **Signing key.** Generate it with a password:
   ```bash
   npm run tauri -- signer generate -w ~/.tauri/kan-do-updater.key
   ```
   This writes the private key to that file and prints the **public** key (also in `~/.tauri/kan-do-updater.key.pub`).
2. **Store the key and its password in the Keychain** (the release script reads them from there; they are never printed or written to disk by the script):
   ```bash
   security add-generic-password -a "$USER" -s kan-do-updater-key -w "$(cat ~/.tauri/kan-do-updater.key)"
   security add-generic-password -a "$USER" -s kan-do-updater-key-password -w   # prompts for the password
   ```
   Alternatively export `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for the run; values already set win over the Keychain.
3. **Back the key up a second time** (password manager, encrypted disk image, ...). **If the key is lost, installed apps can no longer verify updates**: you would have to generate a new key, put the new public key into the app and reinstall by hand everywhere. There is no recovery.
4. **Paste the public key** into `src-tauri/tauri.conf.json` as `plugins.updater.pubkey` (replacing `REPLACE_WITH_UPDATER_PUBLIC_KEY`) and commit it to `main`. Until then the app reports "Updates sind in diesem Build nicht eingerichtet" and the release script refuses.
5. **GitHub CLI:** `gh auth login` (the account needs push access to `jaylouiz/kan-do`).
6. **Tauri CLI >= 2.11.5.** Older versions do not record the version in the update signature, and the app (`requireSignedVersion`) would refuse every update. Check with `cargo tauri --version`; install or upgrade with:
   ```bash
   cargo install tauri-cli --version "^2" --locked
   ```
   The release script checks this in the preflight, before the build, and refuses with that command.
7. **Updates token for the app (optional):** the repository is public, so the app checks for updates without a token (unauthenticated, 60 GitHub API requests per hour and IP; a limit shows "try later"). If you want more headroom, open *GitHub-Zugriff* (`/settings/github`) in the desktop app and paste a fine-grained token for `jaylouiz/kan-do` with **Contents: read** only; it is then sent with every check.

## Developer ID signing and notarization (optional)

By default a release is **ad-hoc signed** (`signingIdentity: "-"` in `tauri.conf.json`): it runs, but a first install needs right-click → *Open*, and macOS asks for Keychain access again after every update, because Keychain items are tied to the app's code identity and an ad-hoc identity changes with every build. A **Developer ID Application** certificate plus **notarization** fixes both. It needs the Apple Developer Program (paid). Decisions: [ADR 013](adr/013-signing-notarization-and-ci-release.md); issue #228 phase 2.

Nothing about this is committed: the repository keeps `-`, and the script switches to Developer ID only when `APPLE_SIGNING_IDENTITY` is set. Everything below is yours; agents only run `--dry-run`, which reports the state without any credential.

1. **Enrol** in the Apple Developer Program and note your **Team ID** (developer.apple.com → Membership).
2. **Create the certificate.** Keychain Access → *Certificate Assistant* → *Request a Certificate from a Certificate Authority* (save to disk), then developer.apple.com → *Certificates* → **Developer ID Application**, upload the request, download the `.cer` and double-click it. Check:
   ```bash
   security find-identity -v -p codesigning
   # 1) 0123...  "Developer ID Application: Your Name (TEAMID)"
   ```
3. **Back the certificate up.** Keychain Access → *My Certificates* → export the certificate **with its private key** as `.p12` with a strong password; keep it in your password manager or an encrypted disk image. The private key exists only on this Mac until you do; Apple cannot give it back. (You also need this `.p12` for [CI](#ci-release).)
4. **Create a notarization API key** (recommended over an Apple ID password): App Store Connect → *Users and Access* → *Integrations* → *Team Keys* → new key with the **Developer** role. Note the **Issuer ID** (top of the page) and the **Key ID**; download `AuthKey_<KEYID>.p8` **once** (Apple offers it only once; back it up like the `.p12`). Keep it outside the repository, for example `~/.appstoreconnect/private_keys/`.
5. **Give the script the credentials.** The environment wins over the Keychain:
   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
   export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8"
   security add-generic-password -a "$USER" -s kan-do-apple-api-issuer -w   # prompts for the Issuer ID
   security add-generic-password -a "$USER" -s kan-do-apple-api-key-id -w   # prompts for the Key ID
   ```
   (or export `APPLE_API_ISSUER` and `APPLE_API_KEY`). The alternative without an API key is `APPLE_ID` + an app-specific password (`APPLE_PASSWORD`, stored as Keychain item `kan-do-apple-app-password`) + `APPLE_TEAM_ID`. If both methods are complete, Tauri uses the Apple ID one.
6. **Rehearse:** `npm run release 0.2.0 -- --dry-run` prints the signing state (`signing: ad-hoc`, `signing: Developer ID "..." notarized via api-key`, or a refusal) and the exact steps `tauri bundle` performs: `codesign` with the hardened runtime and `src-tauri/entitlements.plist`, `ditto`, `xcrun notarytool submit --wait`, `xcrun stapler staple`. Credentials appear as placeholders.

**What the script enforces.** If `APPLE_SIGNING_IDENTITY` is set, the preflight refuses unless it is a *Developer ID Application* certificate (name or SHA-1 hash), the certificate is in the Keychain (not checked in CI, where `APPLE_CERTIFICATE` imports it), and a complete set of notarization credentials exists. This matters because Tauri alone only logs "skipping app notarization" and ships a bundle Gatekeeper then rejects. An ad-hoc build gets none of the `APPLE_*` variables in its build environment, so stray variables in your shell cannot make Tauri try to notarize it. With `--ci` (or `APPLE_CERTIFICATE` set) a 40-hex hash identity is refused outright, because it cannot be resolved against an installed certificate there: set the secret to the certificate name. Locally the hash is resolved against the Keychain. It also refuses a 40-hex hash that the Keychain lists as anything but a *Developer ID Application* certificate (an "Apple Development" hash has the same shape), and an `APPLE_API_KEY_PATH` that is not an existing file (use an absolute path; `~` is not expanded). The Keychain items above are read only when the identity is a Developer ID one: an ad-hoc release and `--bump-only` read nothing from the Keychain. `--require-developer-id` turns an ad-hoc result into a refusal (CI uses it). After a Developer ID build, and before anything is uploaded, the script runs and requires success of (on the built app, then again on the app unpacked from the `.app.tar.gz` and on the app inside the `.dmg`, mounted read-only and detached afterwards, since those are what users receive):

```bash
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/kan-do.app
spctl -a -vv --type execute src-tauri/target/release/bundle/macos/kan-do.app
xcrun stapler validate src-tauri/target/release/bundle/macos/kan-do.app
```

**The identity switch (one-time).** The first Developer ID release changes the app's code identity once. macOS therefore asks one last time for Keychain access to each stored item (`github-updates`, `github-feedback`, the Notion and Todoist tokens): choose *Always Allow*. From then on the identity is stable across updates (the designated requirement names the bundle id and your Team ID, not the individual certificate, so even renewing the certificate keeps it) and updates no longer prompt. The updater's minisign signature is independent of the Apple signature and keeps working. Going back to ad-hoc would change the identity again.

**Entitlements.** `src-tauri/entitlements.plist` is empty on purpose: WKWebView's JIT runs in Apple's own WebContent process, the Keychain and network need no entitlement outside the sandbox, and no third-party libraries are loaded. Do not add `com.apple.security.cs.allow-jit` or similar "just in case". If the first notarized build fails to launch or notarization reports a hardened-runtime problem, add exactly the key the log asks for, with the reason, in the plist and ADR 013.

**Credential rotation.** Certificate: expires after 5 years; create a new one the same way, update `APPLE_SIGNING_IDENTITY` (and the CI secrets) if the name changed. API key: create a new key, update the Keychain items and `APPLE_API_KEY_PATH`, then revoke the old one in App Store Connect. A leaked `.p12` or `.p8`: revoke it in the Apple developer portal immediately, then create new ones.

## Release notes

One file per version, `release-notes/<X.Y.Z>.md`, written before the release; `npm run release` refuses without a valid one (`--dry-run` shows the validation result). Format and template: `release-notes/README.md`.

- **Highlights** are what the app offers once after an update (toast button "Was ist neu"), in German and English: significant UX updates and new features only. One user-visible change per bullet, one sentence, what changes for the user, no ticket numbers.
- A fix-only release writes `None.` under `## Highlights`: the update toast has no button.
- **Fixes** (optional) are free text for the GitHub release page; the app never shows them.
- **Stage** (#693): a line `Stage: alpha`, `Stage: beta` or `Stage: stable` under `## Fixes` records the release stage on the GitHub release page. The preflight refuses a file whose line differs from the `--stage` flag (default `alpha`). The version stays plain `X.Y.Z` on the single `stable` update channel (ADR 009).

## Releasing

Shortcut: `/prepare-release [version or scope]` in Claude Code picks the version from the unreleased changes, writes and validates the notes, pushes them and hands you the `npm run release <version>` command (steps 1 to 3 below).

1. On `main`, up to date with `origin/main`, clean tree.
2. Write the release notes: `release-notes/<version>.md` in the Highlights format (see [Release notes](#release-notes)). The script validates it; its text verbatim becomes the release body and the `notes` of `latest.json`.
3. Rehearse:
   ```bash
   npm run release 0.2.0 -- --dry-run
   ```
   The `--` matters: without it npm swallows the flag (the script still treats that as a dry run, as a safety net). The dry run runs the preflight, bumps a **temp copy**, prints every command it would run and writes a `latest.json` with fake asset ids to a temp folder. It pushes, uploads and signs nothing and needs no key ("signing key: skipped in dry run"). Refusals are listed but do not stop a dry run.
4. Release:
   ```bash
   npm run release 0.2.0
   ```
   After `npm run verify` the script runs the **full E2E suite** (`PORT=<free port> npm run test:e2e -- --reporter=line --retries=1`: it builds the app first and runs the specs against that production build, 5 to 6 minutes on a quiet machine (10 under heavy load), a neutral environment plus `PORT`) before it bumps or builds anything. PRs are gated by `ci.yml` (lint, typecheck, unit tests) and the tiered pre-merge hook, so this is where the whole suite is mandatory. A failure prints `Release refused: the full E2E suite failed (<n> failing)` and exits 1 with nothing committed, pushed or uploaded. A pass leaves a `<sha>.full` stamp for `HEAD` (the pre-merge hook writes the same one, so a head that already passed the full suite prints `E2E: full suite already passed for <short sha> (stamp)` and does not rerun; a merge commit is a new SHA, so a normal release after merges runs it). `--skip-verify` skips only `npm run verify` (use it only when you just ran it), `--skip-e2e` skips only the E2E step (prints `E2E: skipped (--skip-e2e)`); neither implies the other. `--dry-run` prints the E2E command (or the stamp line) right after the verify line and never runs it.

**Stage and testing mode (#693).** `npm run release 0.2.0 -- --stage alpha|beta|stable` (default `alpha`) chooses the stage per release. The project's testing mode (`.claude/testing-mode`, `fast` or `quality`) decides how much runs: in `quality` every stage runs `npm run verify` and the full E2E suite as above. In `fast` an `alpha` or `beta` release still runs `npm run verify` but replaces the full suite by the **fast tier** (the smoke set plus the specs of every risk-area rule, `fastReleaseSpecs` in `scripts/e2e-gate.mjs`; stamped by its spec list). A `stable` release always runs the full suite and is refused in `fast` mode with a message naming the switch to `quality`.

### What the script does

1. **Preflight**, one clear message per refusal: not on `main`, dirty tree, behind `origin/main`, version not plain `X.Y.Z` or not greater than the latest tag, tag already published, `gh` not authenticated, release notes missing or empty or without the matching `Stage:` line, a `stable` release in fast testing mode, signing key or password unavailable, Developer ID configured without notarization credentials or without its certificate (see [above](#developer-id-signing-and-notarization-optional)), Tauri CLI older than 2.11.5, public key still the placeholder, `npm run verify` red, the full E2E suite red or a tree left dirty by it (version files excepted).
2. Bumps the version in `package.json`, `package-lock.json` (its two root `version` fields only), `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml` (targeted text edits, npm never runs; `Cargo.lock` follows from the build and is committed). A unit test fails when the lock's root version differs from `package.json`: a lock left behind makes every later `npm install` rewrite it.
3. `tauri build --no-bundle` (frontend and compile, **no credential in its environment**), then `tauri bundle` (package, sign, notarize) for Apple silicon with the key from the environment/Keychain, the only child that sees the updater key and the Apple credentials; `gh` alone gets the GitHub token, every other child (npm, git, `cargo`, `build.rs` of every crate, the post-build checks) a neutral environment ([ADR 013](adr/013-signing-notarization-and-ci-release.md)); checks that the `.app.tar.gz`, its `.sig` and the `.dmg` exist and are non-empty, and that the signature records the release version (the app runs with `requireSignedVersion`, so a bundle signed without it could never be installed; if the check fails, the preflight already refuses a Tauri CLI older than 2.11.5), **before anything is pushed**. A failing build or check lands in the same handler as the publish steps and prints how to recover.
4. **Publishes in an atomic order:** commit `chore(release): v<version>` and push `main` → create a **draft** release on that commit → upload bundle, signature and dmg → read the asset ids back → write and upload `latest.json` (bundle URLs are API asset URLs) → verify that all four assets are `uploaded` and non-empty → only then publish the draft (`--latest`), which creates the tag. `releases/latest` ignores drafts, so installed apps never see a half-published release.

The bundle is ad-hoc signed unless `APPLE_SIGNING_IDENTITY` names a Developer ID certificate, in which case it is also notarized and stapled ([above](#developer-id-signing-and-notarization-optional)).

## First install from the DMG

A **notarized** release (Developer ID) opens without any of this: drag `kan-do.app` to `/Applications` and double-click. For an **ad-hoc** release: the DMG you download in a browser is quarantined by macOS. Open it, drag `kan-do.app` to `/Applications` (or `~/Applications`), then either right-click → *Open* once or run:

```bash
xattr -dr com.apple.quarantine /Applications/kan-do.app
```

Updates the app downloads itself are not quarantined. Install into a folder you can write to: a non-writable location makes the update ask for an administrator password.

## Verify a release (checklist)

- [ ] `gh release view v<version> --repo jaylouiz/kan-do` lists the dmg, the `.app.tar.gz`, its `.sig` and `latest.json`.
- [ ] The release is marked *Latest* and not a draft.
- [ ] An installed older version, without an `updates` token (the case every user has): *Nach Updates suchen* shows the new version, the dialog says data is backed up first, *Installieren und neu starten* installs and relaunches.
- [ ] After the relaunch `/settings/updates` shows the new version; your tasks are intact and the `pre-update` backup exists in `backups/`.
- [ ] `~/Library/Logs/io.github.jaylouiz.kan-do/kan-do.log` contains the check and install steps (status names and versions, never tokens or task titles).
- [ ] Ad-hoc release: macOS asks once for Keychain access after the update (the ad-hoc signature changes with every build). Choose *Always Allow*; this is expected (#223). Developer ID release: it asks once at the identity switch and never again.
- [ ] Developer ID release, on a Mac that never saw the app: opening the DMG-installed app passes Gatekeeper without right-click → *Open*, `spctl -a -vv /Applications/kan-do.app` says `accepted source=Notarized Developer ID`, and an update from release N to N+1 shows no Keychain prompt.
- [ ] **First release under `io.github.jaylouiz.kan-do` (#42, [ADR 019](adr/019-bundle-identifier-and-migration.md)), on a Mac with 0.11.0 installed, with real data and tokens (back up `~/Library/Application Support/com.julius.kan-do/` first):**
  - `codesign -dv /Applications/kan-do.app 2>&1 | grep Identifier` says `Identifier=io.github.jaylouiz.kan-do`, for the ad-hoc and for the Developer ID build; notarization accepted the new bundle.
  - The in-place update from 0.11.0 starts; tasks, board, settings and `backups/` are as before, `/settings/data` shows `~/Library/Application Support/io.github.jaylouiz.kan-do`, and with a custom data folder the same custom folder.
  - The four tokens work without re-entering them (Notion sync, Todoist if used, `/settings/github` shows both as present). Count the Keychain prompts (reading and deleting each legacy entry: up to eight, *Always Allow*) and note the number in ADR 019, which still lists it as `unverified`.
  - `~/Library/Application Support/com.julius.kan-do/` still exists unchanged; `~/Library/Logs/io.github.jaylouiz.kan-do/kan-do.log` has `data copied from the legacy folder and verified` and `Keychain step done`.
  - A second start migrates nothing (no new log lines about copying) and shows no Keychain prompt.
- [ ] Offline: no toast at launch. With an `updates` token set: the check still finds the release (the token is sent, not required).

## CI release

`.github/workflows/release.yml` builds, signs, notarizes and uploads on a macOS runner so that a release does not need your Mac. It runs the same `scripts/release.mjs` in `--ci` mode, so the preflight, signing, asset names and `latest.json` are identical to a local release. The repository is public, so its Actions minutes (macOS included) are free; a local `npm run release` stays the default, and `ci.yml` and its docs-only path filters are untouched by it.

**Flow.** CI starts from a pushed tag on a commit that already bumped the version, so the commit and the tag are two steps of yours:

1. Write `release-notes/<version>.md` and merge it to `main`.
2. `npm run release 0.2.0 -- --bump-only` (add `--dry-run` first): runs the preflight, `npm run verify` **and the full E2E suite**, bumps the version files, commits `chore(release): v0.2.0` and pushes `main`. It builds nothing and needs no key.
3. `git tag v0.2.0 && git push origin v0.2.0`. (Or start the workflow from the Actions tab with the version; the tag must exist. A tag push and a dispatch of the same version share one concurrency group, so they never build at once.)
4. An ubuntu `gate` job resolves the version and looks the release up first, so an already published release costs no macOS minutes. The macOS job then checks the tag is on `main`, builds, signs, notarizes, verifies (`codesign`, `spctl`, `stapler`) and creates a **draft** release `v0.2.0` with `.app.tar.gz`, `.sig`, `.dmg` and `latest.json`. It stops there: **publishing the draft is your click** on the Releases page (after the [checklist](#verify-a-release-checklist)).

A local `npm run release` also fires the workflow (publishing creates the tag); the `gate` job notices the release is already published and the macOS job is skipped. It skips `npm run verify` and the E2E suite on purpose (`--ci` never runs E2E: the tagged commit was gated by `--bump-only`; `ci.yml` runs on PRs and pushes to `main`, and the pre-merge hook gates PRs locally).

**Secrets** (repository → Settings → Secrets and variables → Actions). They reach the job only through the environment of the build step, where the script hands each to exactly one child; the workflow never echoes them. The workflow **requires Developer ID** (`--require-developer-id`): an empty, renamed or missing `APPLE_*` secret fails the run instead of shipping an ad-hoc build over a Developer ID release. A manual dispatch with *allow_adhoc* ticked builds ad-hoc on purpose, and the run then carries a warning annotation.

| Secret | Content |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the updater key file's contents (`~/.tauri/kan-do-updater.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |
| `APPLE_CERTIFICATE` | the Developer ID `.p12`, base64: `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_API_ISSUER`, `APPLE_API_KEY` | Issuer ID and Key ID of the notarization API key |
| `APPLE_API_KEY_P8` | the contents of `AuthKey_<KEYID>.p8` (the script writes it to a mode-600 temp file only while `tauri bundle` runs and deletes it right after; the compile step never sees it) |
| or `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID notarization instead of the API key |

Setting a secret is yours (`gh secret set NAME < file`); agents never do. **Rotation:** replace the secret value (same command), then re-run or push a new tag; revoke the old credential at its source (Apple portal, App Store Connect). **The updater key is the exception:** it must never change (see setup step 3), only its storage location in Actions.

The workflow pins the Tauri CLI exactly (`TAURI_CLI_VERSION` in `release.yml`, >= 2.11.5); the install step is skipped only when `cargo tauri --version` already equals it. Bump the value deliberately.

**Trust model.** Third-party actions in both workflows are pinned by commit SHA with the version as a comment (`tests/config/deploy-triggers.test.ts` enforces it); bump them deliberately. **If you ever store the signing secrets in GitHub, store them in an `environment:` with a required reviewer, not as repository secrets:** add `environment: <name>` to the `release` job and move the secrets there, so every run waits for your approval before it can read them.

A repository secret is readable by any workflow a repository writer can run (a workflow file on another branch included, and `workflow_dispatch` can run from any branch); the environment's required reviewer is what stops that. Pull requests from forks never see secrets (`ci.yml` uses `pull_request`, read-only, never `pull_request_target`). Review changes to `.github/workflows/` before merging. The workflow can only write repository contents (`permissions: contents: write`).

**Manual check on the first CI release:** a tag push produces a draft with the four assets, and `latest.json` has the same shape as the local script's (`gh release download v0.2.0 -p latest.json` and compare keys with a previous release).

## Recovery

- **The script failed before publishing** (including a failed build, which leaves the version files bumped). Nothing is public. A draft release may be left on GitHub. Fix the cause and re-run the **same command**: it deletes the stale draft for that version, accepts a tree that is already bumped for that version (and a version-bump commit that is not pushed yet) and continues.
- **Failed after the push.** The bump commit is on `main`, no tag exists. Re-run the same command; it detects the commit and skips committing.
- **"Release refused".** Fix what the message says. The script prints nothing else for a refused run.
- **The CI release failed or was cancelled.** Nothing is public (it only ever creates a draft). Fix the cause and re-run the failed workflow run (or start it again with the version): it deletes the stale draft for that version and recreates it. A bump commit or tag that is wrong is fixed with a higher version, not by moving the tag.
- **Notarization is rejected or times out.** `xcrun notarytool log <submission id> --key-id ... --key ... --issuer ...` shows why (the id is in the build output). A hardened-runtime complaint means an entitlement is needed ([above](#developer-id-signing-and-notarization-optional)); the first-ever submission of a team can take hours, re-run later.
- **A published release is broken.** Do not edit it. Release a higher version. (Deleting a published release does not recall installed apps.)
- **Signing key lost.** See setup step 3: new key, new public key in `tauri.conf.json`, manual reinstall of every installed app.
- **Token rotated or revoked.** Paste a new `updates` token in *GitHub-Zugriff*, or delete it (updates work without one). A 401 marks a stored token as rejected for the session and the app shows one calm line; saving a new token clears it.
- **404 from GitHub in the app.** There is no published (non-draft) release yet. The app says so and does not mark a stored token as rejected.
- **"GitHub nimmt gerade keine weiteren Anfragen an".** The unauthenticated limit (60 requests per hour and IP, shared by everything on that network) is used up; a later check works. A stored `updates` token raises the limit.
- **403 with "rate limited".** GitHub's request limit; try again later.
- **If the real update cannot parse `latest.json`** from the signed-storage redirect, stop and hand issue #225 back. The documented fallback is a manifest on a dedicated branch (ADR 009, direction B); it is a decision, not a silent switch.

## Where things live

| What | Where |
|---|---|
| Release script | `scripts/release.mjs`, helpers in `scripts/release/*.mjs` (signing state: `signing.mjs`) |
| CI release (#228) | `.github/workflows/release.yml`, guard `tests/config/release-signing.test.ts` |
| Signing config (#228) | `src-tauri/tauri.conf.json` `bundle.macOS`, `src-tauri/entitlements.plist`, [ADR 013](adr/013-signing-notarization-and-ci-release.md) |
| Updater (Rust) | `src-tauri/src/updater.rs`, log setup `src-tauri/src/logging.rs` |
| Updater UI | `pages/settings/updates.vue`, `components/updates/UpdateDialog.vue`, `composables/useAppUpdater.ts` |
| Release notes (#226) | `release-notes/`, parser `lib/releaseNotesFormat.mjs`, gate `scripts/release/notes.mjs`, app `lib/releaseNotes.ts`, `composables/useWhatsNew.ts`, `components/updates/WhatsNewDialog.vue`, `lib/updateNotes.ts` |
| Log file | `~/Library/Logs/io.github.jaylouiz.kan-do/kan-do.log` (5 files, about 1 MB each) |
