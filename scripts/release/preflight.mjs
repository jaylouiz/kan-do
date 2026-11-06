/**
 * Preflight for `npm run release` (#225): turns facts about the checkout and the machine into a list
 * of checks. Pure, so every refusal is unit-tested; `release.mjs` gathers the facts.
 *
 * One clear message per refusal, nothing else printed with it.
 */
import { compareSemver, isPlainSemver } from './version.mjs'
import { notesPath } from './notes.mjs'
import { PLACEHOLDER_PUBKEY } from './config.mjs'
import { isDeveloperIdCertificateName, signingState } from './signing.mjs'

/**
 * @typedef {object} Facts
 * @property {string} version requested version
 * @property {string} branch current branch
 * @property {string[]} dirtyFiles paths with uncommitted changes
 * @property {boolean} alreadyBumped the three version files already carry `version`
 * @property {number} behind commits `origin/main` has that HEAD lacks
 * @property {string | null} latestTag highest plain-semver tag version, null if none
 * @property {{ exists: boolean, draft: boolean }} release the GitHub release for the tag
 * @property {boolean} ghAuthenticated
 * @property {{ ok: boolean, body?: string, reason?: string, summary?: string, stage?: string | null }} notes result of `loadReleaseNotes`
 * @property {string} [stage] release stage (`alpha` | `beta` | `stable`, #693); with `mode` it adds the stage checks
 * @property {string} [mode] testing mode of the checkout (`fast` | `quality`, `.claude/testing-mode`)
 * @property {{ key: boolean, password: boolean }} signing signing key and password available
 * @property {string} pubkey `plugins.updater.pubkey` from tauri.conf.json
 * @property {string | null} tauriCli installed `cargo tauri --version` output, null if the command failed
 * @property {string} platform `process.platform`
 * @property {string} arch `process.arch`
 * @property {boolean} [ci] CI mode (`--ci`): the tag exists and the version files are already bumped, nothing is committed or published
 * @property {boolean} [githubActions] running inside GitHub Actions (`GITHUB_ACTIONS=true`)
 * @property {boolean} [requireDeveloperId] `--require-developer-id`: refuse an ad-hoc build (CI sets it, so a missing or renamed secret fails the run instead of shipping ad-hoc)
 * @property {{ identity?: string | null, present: Record<string, boolean | undefined>, identityInstalled?: boolean | null, identityName?: string | null, keyFile?: boolean | null }} [apple]
 *   Apple signing inputs (#228): `present` says which variables exist, never their values; `identityInstalled`
 *   is null when it was not checked (dry run, or the certificate arrives with `APPLE_CERTIFICATE`);
 *   `identityName` is the certificate name the Keychain lists for it; `keyFile` says whether
 *   `APPLE_API_KEY_PATH` points at an existing file (null when not checked)
 */

/**
 * @typedef {{ id: string, ok: boolean, skipped?: boolean, label: string, message?: string }} Check
 */

/** Files the version bump may leave dirty on a re-run for the same version. */
export const BUMP_FILES = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']

/** First tauri-cli that records the version in the `.sig` trusted comment (needed by `requireSignedVersion`). */
export const MIN_TAURI_CLI = '2.11.5'

/** Command that installs a new enough tauri CLI (the one `npm run tauri:build` calls). */
export const TAURI_CLI_INSTALL = 'cargo install tauri-cli --version "^2" --locked'

/**
 * Version out of `cargo tauri --version` output ("tauri-cli 2.7.1"), null if there is none.
 * @param {string | null | undefined} output
 */
export function parseTauriCliVersion(output) {
  return /(\d+\.\d+\.\d+)/.exec(output ?? '')?.[1] ?? null
}

/** @param {string | null | undefined} output */
export function tauriCliSupportsSignedVersion(output) {
  const version = parseTauriCliVersion(output)
  return version !== null && compareSemver(version, MIN_TAURI_CLI) >= 0
}

/**
 * @param {Facts} facts
 * `bumpOnly` is `--bump-only`: the commit that a tag push will release in CI. Nothing is built or signed on
 * this Mac, so the build, key and signing checks do not apply.
 * @param {{ dryRun?: boolean, bumpOnly?: boolean }} [options]
 * @returns {Check[]}
 */
export function runChecks(facts, { dryRun = false, bumpOnly = false } = {}) {
  /** @type {Check[]} */
  const checks = []
  const add = (id, label, ok, message) => checks.push({ id, label, ok, ...(ok ? {} : { message }) })

  const ci = facts.ci === true
  const validVersion = isPlainSemver(facts.version)
  add('version', 'version is plain X.Y.Z', validVersion,
    `"${facts.version ?? ''}" is not a plain X.Y.Z version (no "v" prefix, no pre-release suffix).`)
  if (ci) {
    // CI starts from a pushed tag: the commit must already carry the bumped files and a notes file, and
    // only a GitHub Actions runner may take this path (it skips the local-release guards below).
    add('ci', 'running in GitHub Actions', dryRun || facts.githubActions === true,
      '--ci is for the GitHub Actions release workflow only. Local releases run without it from main.')
    add('bumped', 'version files match the tag', facts.alreadyBumped,
      `The checked-out version files are not at ${facts.version}. Push the tag on the commit that bumped them (docs/release.md).`)
  } else {
    add('greater', 'version is greater than the latest tag',
      !validVersion || facts.latestTag === null || compareSemver(facts.version, facts.latestTag) > 0,
      `Version ${facts.version} is not greater than the latest tag v${facts.latestTag}.`)
  }
  if (!bumpOnly) {
    add('platform', 'Apple silicon Mac', dryRun || (facts.platform === 'darwin' && facts.arch === 'arm64'),
      `Releases are built on an Apple silicon Mac (this is ${facts.platform}/${facts.arch}).`)
  }
  if (!ci) {
    add('branch', 'on main', facts.branch === 'main', `Releases are cut from main (you are on "${facts.branch}").`)
    const strayFiles = facts.dirtyFiles.filter(file => !(facts.alreadyBumped && BUMP_FILES.includes(file)))
    add('clean', 'working tree clean', strayFiles.length === 0,
      `The working tree has uncommitted changes (${strayFiles.slice(0, 3).join(', ')}${strayFiles.length > 3 ? ', ...' : ''}). Commit or stash them first.`)
    add('behind', 'up to date with origin/main', facts.behind === 0,
      `main is ${facts.behind} commit(s) behind origin/main. Pull first.`)
  }
  add('tag', 'tag not published', !facts.release.exists || facts.release.draft,
    `v${facts.version} is already published. Pick a higher version.`)
  add('gh', 'gh authenticated', facts.ghAuthenticated, 'gh is not authenticated. Run "gh auth login".')
  add('notes', `${notesPath(facts.version)} valid${facts.notes.summary ? ` (${facts.notes.summary})` : ''}`, facts.notes.ok,
    `Release notes are not ready:\n${facts.notes.reason ?? notesPath(facts.version)}\nSee release-notes/README.md.`)
  if (facts.stage) {
    add('stage', `stage ${facts.stage} recorded in the notes`, facts.notes.stage === facts.stage,
      `${notesPath(facts.version)} must record the stage of this release: add the line "Stage: ${facts.stage}" (under "## Fixes") `
      + `or release with --stage ${facts.notes.stage ?? '<alpha|beta|stable>'}. See release-notes/README.md.`)
    add('stageMode', `stage ${facts.stage} allowed in ${facts.mode ?? 'quality'} mode`, !(facts.stage === 'stable' && facts.mode === 'fast'),
      'A stable release always runs the full verification and refuses to start in fast testing mode. '
      + 'Switch to quality first: write "quality" into .claude/testing-mode (a per-checkout file, not committed), then re-run. '
      + 'An alpha or beta release (--stage alpha|beta) may run in fast mode.')
  }

  if (!bumpOnly) {
    if (dryRun) {
      checks.push({ id: 'key', ok: true, skipped: true, label: 'signing key: skipped in dry run' })
    } else {
      add('key', 'signing key and password available', facts.signing.key && facts.signing.password,
        'The updater signing key or its password is not available. Set TAURI_SIGNING_PRIVATE_KEY and '
        + 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD, or store them in the Keychain (see docs/release.md).')
    }
    const apple = signingState({ identity: facts.apple?.identity, present: facts.apple?.present ?? {}, ci })
    add('appleSigning', apple.label, apple.mode === 'ad-hoc' || apple.mode === 'developer-id', apple.message)
    if (apple.mode === 'ad-hoc' && facts.requireDeveloperId) {
      add('developerIdRequired', 'Developer ID signing', false,
        'Developer ID signing is required (--require-developer-id) but APPLE_SIGNING_IDENTITY is empty or "-": this would ship an ad-hoc build '
        + 'over a Developer ID release. Check the APPLE_* secrets (an empty or renamed one reads as unset); for a deliberate ad-hoc release '
        + 'drop the flag (CI: run the workflow by hand with "allow_adhoc", docs/release.md).')
    }
    if (apple.mode === 'developer-id' && facts.apple?.identityInstalled === false) {
      add('appleIdentity', 'Developer ID certificate in the Keychain', false,
        `The certificate "${apple.identity}" is not in the Keychain (security find-identity -v -p codesigning). `
        + 'Import the .p12 or fix APPLE_SIGNING_IDENTITY (docs/release.md).')
    }
    const listedName = facts.apple?.identityName
    if (apple.mode === 'developer-id' && listedName && !isDeveloperIdCertificateName(listedName)) {
      add('appleIdentityKind', 'Developer ID certificate type', false,
        `APPLE_SIGNING_IDENTITY resolves to "${listedName}", which is not a "Developer ID Application: ..." certificate and cannot be notarized. `
        + 'Use the hash or the name of the Developer ID Application certificate (security find-identity -v -p codesigning).')
    }
    if (apple.mode === 'developer-id' && apple.notarization === 'api-key' && facts.apple?.keyFile === false) {
      add('appleKeyFile', 'notarization API key file', false,
        'APPLE_API_KEY_PATH does not point to an existing file. Use an absolute path to the AuthKey_<id>.p8 ("~" is not expanded); '
        + 'otherwise the build would run for minutes and fail at notarization.')
    }
    const cliVersion = parseTauriCliVersion(facts.tauriCli)
    add('tauriCli', `tauri CLI ${cliVersion ?? ''} >= ${MIN_TAURI_CLI}`.replace('  ', ' '), tauriCliSupportsSignedVersion(facts.tauriCli),
      `The installed tauri CLI (${cliVersion ?? 'not found'}) is older than ${MIN_TAURI_CLI}: it does not record the version in the update signature, `
      + `so the installed apps would refuse the update. Run \`${TAURI_CLI_INSTALL}\` and re-run.`)
  }
  const pubkey = (facts.pubkey ?? '').trim()
  add('pubkey', 'updater public key configured', pubkey !== '' && pubkey !== PLACEHOLDER_PUBKEY,
    'plugins.updater.pubkey in src-tauri/tauri.conf.json is still the placeholder. Paste the public key (see docs/release.md).')
  return checks
}

/** @param {Check[]} checks */
export function refusals(checks) {
  return checks.filter(check => !check.ok)
}

/** @param {Check[]} checks */
export function formatChecks(checks) {
  return checks
    .map(check => (check.ok ? `  ok       ${check.label}` : `  REFUSED  ${check.message}`))
    .join('\n')
}
