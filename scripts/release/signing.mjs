/**
 * Apple code signing and notarization state for `npm run release` (#228, ADR 013). Pure: the script
 * gathers which variables exist, this module decides what that means, so every refusal is unit-tested
 * and `--dry-run` can describe the steps without any credential.
 *
 * `tauri build` does the work: it reads `APPLE_SIGNING_IDENTITY` (which overrides
 * `bundle.macOS.signingIdentity`, `-` = ad-hoc), signs with `codesign`, and notarizes and staples when
 * notarization credentials are present. When they are missing it only logs "skipping app
 * notarization" and still produces a signed bundle, so the preflight here is the only guard against a
 * Developer ID release that Gatekeeper would reject.
 */

/** Identity string of an ad-hoc signature (no Apple account). Also the committed default. */
export const AD_HOC_IDENTITY = '-'

/**
 * Variables Tauri reads for notarization, grouped by method (the API key is the recommended one).
 */
export const NOTARIZATION_METHODS = {
  'api-key': ['APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_PATH'],
  'apple-id': ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'],
}

/**
 * Keychain items (generic passwords) that stand in for an unset variable on a local release. Only the
 * values that are secrets or tied to the account; the identity, the `.p8` path, the Apple ID and the
 * team id are plain configuration and come from the environment.
 */
export const APPLE_KEYCHAIN_SERVICES = {
  APPLE_API_ISSUER: 'kan-do-apple-api-issuer',
  APPLE_API_KEY: 'kan-do-apple-api-key-id',
  APPLE_PASSWORD: 'kan-do-apple-app-password',
}

/** Every variable a signing run may read (the `.p12` certificate pair is listed in `SECRET_VARIABLES`). */
export const APPLE_VARIABLES = [
  'APPLE_SIGNING_IDENTITY',
  ...Object.values(NOTARIZATION_METHODS).flat(),
]

/** Updater signing key and its password; only the bundling child needs them. */
export const UPDATER_KEY_VARIABLES = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']

/** Legacy and alternative spellings of the updater key variables (older Tauri CLIs); never needed, always dropped. */
export const LEGACY_UPDATER_KEY_VARIABLES = [
  'TAURI_SIGNING_PRIVATE_KEY_PATH',
  'TAURI_PRIVATE_KEY',
  'TAURI_PRIVATE_KEY_PASSWORD',
  'TAURI_KEY_PASSWORD',
]

/** GitHub tokens; only `gh` needs them (the upload and release steps). */
export const GITHUB_TOKEN_VARIABLES = ['GH_TOKEN', 'GITHUB_TOKEN']

/**
 * Everything a release child process must not inherit by default: the updater key, every Apple
 * credential and the GitHub tokens (plus the runner's own Actions tokens). Each child gets exactly the
 * subset it needs (`neutralEnv`, `buildSigningEnv`, `githubEnv`), so a compromised npm or crate
 * dependency that runs during `nuxt generate` or a `build.rs` sees none of them.
 */
export const SECRET_VARIABLES = [
  ...UPDATER_KEY_VARIABLES,
  ...LEGACY_UPDATER_KEY_VARIABLES,
  ...GITHUB_TOKEN_VARIABLES,
  ...APPLE_VARIABLES,
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_API_KEY_P8',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
]

/**
 * Names that look like a credential. `neutralEnv` drops them on top of `SECRET_VARIABLES`, so a secret this
 * list has never heard of (a new CI secret, a `*_TOKEN` in a developer's shell) does not reach the compile
 * child either. A deny-list on purpose: an allow-list would break git, cargo, npm and SSH on a developer machine.
 */
export const SECRET_NAME_PATTERN = /TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|PRIVATE_KEY|API_?KEY|^APPLE_|^TAURI_SIGNING/i

/**
 * @typedef {'ad-hoc' | 'developer-id' | 'missing-credentials' | 'invalid-identity'} SigningMode
 * @typedef {object} SigningState
 * @property {SigningMode} mode
 * @property {string | null} identity certificate name (not a secret) or null for ad-hoc
 * @property {'api-key' | 'apple-id' | null} notarization method that will be used
 * @property {string[]} missing variable names that are needed and unavailable
 * @property {string} label one line for the preflight list
 * @property {string} message why this state is refused (empty when it is not)
 */

/** A Developer ID Application certificate by name, or the 40-hex SHA-1 hash `codesign` also accepts. */
export function isDeveloperIdIdentity(identity) {
  return /^Developer ID Application: .+/.test(identity) || /^[0-9A-Fa-f]{40}$/.test(identity)
}

/**
 * @param {{ identity?: string | null, present: Record<string, boolean | undefined>, ci?: boolean }} input
 *   `present[name]` is true when the variable is set or its Keychain item exists; values never enter here.
 *   `ci` (or `present.APPLE_CERTIFICATE`: the certificate is imported into a fresh keychain) refuses a SHA-1
 *   hash identity: it cannot be resolved against an installed identity, so an "Apple Development" hash
 *   would pass unchecked and fail only at notarization.
 * @returns {SigningState}
 */
export function signingState({ identity, present, ci = false }) {
  const name = (identity ?? '').trim()
  if (name === '' || name === AD_HOC_IDENTITY) {
    return { mode: 'ad-hoc', identity: null, notarization: null, missing: [], label: 'signing: ad-hoc (no Developer ID configured)', message: '' }
  }
  if (!isDeveloperIdIdentity(name)) {
    return {
      mode: 'invalid-identity',
      identity: name,
      notarization: null,
      missing: [],
      label: `signing: invalid identity "${name}"`,
      message: `APPLE_SIGNING_IDENTITY "${name}" is not a "Developer ID Application: ..." certificate (or its SHA-1 hash). `
        + 'Only that certificate type can be notarized; unset the variable for an ad-hoc release.',
    }
  }
  if ((ci || present.APPLE_CERTIFICATE) && /^[0-9A-Fa-f]{40}$/.test(name)) {
    return {
      mode: 'invalid-identity',
      identity: name,
      notarization: null,
      missing: [],
      label: 'signing: invalid identity (SHA-1 hash in CI)',
      message: 'APPLE_SIGNING_IDENTITY is a SHA-1 hash, which a CI run (--ci or APPLE_CERTIFICATE) cannot check against the certificate type. '
        + 'Use the certificate name instead: "Developer ID Application: Name (TEAMID)" (docs/release.md).',
    }
  }
  // Tauri picks the Apple ID triple before the API key when both are complete; mirror that.
  const complete = ['apple-id', 'api-key'].find(method => NOTARIZATION_METHODS[method].every(variable => present[variable]))
  if (complete) {
    const notarization = /** @type {'api-key' | 'apple-id'} */ (complete)
    return { mode: 'developer-id', identity: name, notarization, missing: [], label: `signing: Developer ID "${name}", notarized via ${notarization}`, message: '' }
  }
  // Name the method that is closest to complete, so the message asks for the fewest variables.
  const [{ missing }] = Object.values(NOTARIZATION_METHODS)
    .map(names => ({ missing: names.filter(variable => !present[variable]) }))
    .sort((a, b) => a.missing.length - b.missing.length)
  return {
    mode: 'missing-credentials',
    identity: name,
    notarization: null,
    missing,
    label: `signing: Developer ID "${name}" but notarization credentials are missing`,
    message: `Developer ID signing is configured but notarization credentials are not (missing ${missing.join(', ')}). `
      + 'Tauri would only warn and ship an un-notarized bundle that Gatekeeper rejects. Set the notarization variables '
      + '(APPLE_API_ISSUER + APPLE_API_KEY + APPLE_API_KEY_PATH, or APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID; see docs/release.md) '
      + 'or unset APPLE_SIGNING_IDENTITY for an ad-hoc release.',
  }
}

/**
 * The certificate name `security find-identity -v -p codesigning` lists for the identity (given by name
 * or by SHA-1 hash), null when it is not listed. Resolving a hash to its name is what lets the preflight
 * tell a Developer ID certificate from an "Apple Development" one that has the same 40-hex shape.
 * @param {string} output
 * @param {string} identity
 * @returns {string | null}
 */
export function installedIdentityName(output, identity) {
  const line = output.split('\n').find(candidate => candidate.includes(`"${identity}"`) || candidate.toUpperCase().includes(` ${identity.toUpperCase()} `))
  return line ? (/"([^"]+)"/.exec(line)?.[1] ?? null) : null
}

/**
 * Whether the identity is listed at all (by name or hash).
 * @param {string} output
 * @param {string} identity
 */
export function identityInstalled(output, identity) {
  return installedIdentityName(output, identity) !== null
}

/** Whether a listed certificate name is a Developer ID Application certificate. */
export function isDeveloperIdCertificateName(name) {
  return /^Developer ID Application: .+/.test(name)
}

/**
 * The steps `tauri build` performs for this state, for the printed plan. Informational: nothing here is
 * executed, credentials appear as placeholders.
 * @param {SigningState} state
 * @param {{ appPath?: string, entitlements?: string }} [paths]
 * @returns {string[]}
 */
export function signingPlan(state, { appPath = 'src-tauri/target/release/bundle/macos/kan-do.app', entitlements = 'src-tauri/entitlements.plist' } = {}) {
  const identity = state.identity ?? AD_HOC_IDENTITY
  const plan = [`codesign --force -s '${identity}' --options runtime --entitlements ${entitlements} ${appPath}`]
  if (state.mode !== 'developer-id') return plan
  const auth = state.notarization === 'apple-id'
    ? '--apple-id <APPLE_ID> --password <redacted> --team-id <APPLE_TEAM_ID>'
    : '--key-id <APPLE_API_KEY> --key <APPLE_API_KEY_PATH> --issuer <APPLE_API_ISSUER>'
  plan.push(
    'ditto -c -k --keepParent --sequesterRsrc kan-do.app kan-do.zip',
    `xcrun notarytool submit kan-do.zip --wait --output-format json ${auth}`,
    `xcrun stapler staple -v ${appPath}`,
  )
  return plan
}

/**
 * Commands run on the built app after a Developer ID build; any non-zero exit aborts the release
 * before something is uploaded.
 * @param {string} appPath
 * @returns {Array<{ title: string, cmd: string, args: string[] }>}
 */
export function verificationSteps(appPath) {
  return [
    { title: 'Code signature is valid and hardened', cmd: 'codesign', args: ['--verify', '--deep', '--strict', '--verbose=2', appPath] },
    { title: 'Gatekeeper accepts the app', cmd: 'spctl', args: ['-a', '-vv', '--type', 'execute', appPath] },
    { title: 'Notarization ticket is stapled', cmd: 'xcrun', args: ['stapler', 'validate', appPath] },
  ]
}

/**
 * The two shipped containers of the app, unpacked for the same verification as the built `.app`: the
 * updater `.app.tar.gz` (extracted into `extractDir`) and the `.dmg` (mounted read-only at `mountPoint`).
 * `setup` and `teardown` bracket the `verificationSteps` of `appPath`; the caller runs `teardown` in a
 * `finally`, so a mounted image is always detached.
 * @param {{ bundlePath: string, dmgPath: string, extractDir: string, mountPoint: string, appName?: string }} paths
 * @returns {Array<{ title: string, appPath: string, setup: Array<{ title: string, cmd: string, args: string[] }>, teardown: Array<{ title: string, cmd: string, args: string[] }> }>}
 */
export function containerVerification({ bundlePath, dmgPath, extractDir, mountPoint, appName = 'kan-do.app' }) {
  return [
    {
      title: 'app unpacked from the updater .app.tar.gz',
      appPath: `${extractDir}/${appName}`,
      setup: [{ title: 'Unpack the updater bundle', cmd: 'tar', args: ['-xzf', bundlePath, '-C', extractDir] }],
      teardown: [],
    },
    {
      title: 'app inside the .dmg',
      appPath: `${mountPoint}/${appName}`,
      setup: [{ title: 'Mount the disk image read-only', cmd: 'hdiutil', args: ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, dmgPath] }],
      teardown: [{ title: 'Detach the disk image', cmd: 'hdiutil', args: ['detach', mountPoint] }],
    },
  ]
}

/**
 * Environment for a child that needs no credential (git, npm, `nuxt generate`, `cargo` compile, the
 * post-build checks): `base` without any `SECRET_VARIABLES` and
 * without any variable whose name matches `SECRET_NAME_PATTERN`.
 * @param {Record<string, string | undefined>} base usually `process.env`
 */
export function neutralEnv(base) {
  const env = { ...base }
  for (const name of SECRET_VARIABLES) delete env[name]
  for (const name of Object.keys(env)) if (SECRET_NAME_PATTERN.test(name)) delete env[name]
  return env
}

/**
 * Environment for `gh`: the neutral one plus the GitHub token, when there is one (a local `gh` uses its
 * own login).
 * @param {Record<string, string | undefined>} base
 */
export function githubEnv(base) {
  const env = neutralEnv(base)
  for (const name of GITHUB_TOKEN_VARIABLES) if (base[name]) env[name] = base[name]
  return env
}

/**
 * Environment for the bundling child (`tauri bundle`): the only process that signs the updater bundle,
 * codesigns and notarizes, so the only one that gets the credentials. Tauri notarizes whenever a signing
 * identity (even `-`) and notarization credentials are both present, and Apple would reject an ad-hoc
 * bundle, so an ad-hoc build gets none of the Apple variables; a Developer ID build gets the identity,
 * the certificate pair and only the variables of the method that was chosen, because Tauri prefers the
 * Apple ID triple and a half-set one would fail the build. No GitHub token, ever.
 * @param {SigningState} state
 * @param {Record<string, string | undefined>} base usually `process.env`
 * @param {Record<string, string>} [fromKeychain] values read from the Keychain for unset variables
 * @param {{ key?: string | null, password?: string | null }} [updater] updater signing key and password
 */
export function buildSigningEnv(state, base, fromKeychain = {}, updater = {}) {
  const env = neutralEnv(base)
  if (updater.key) env.TAURI_SIGNING_PRIVATE_KEY = updater.key
  if (updater.password) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = updater.password
  if (state.mode !== 'developer-id') return env
  const chosen = NOTARIZATION_METHODS[state.notarization] ?? []
  for (const name of ['APPLE_SIGNING_IDENTITY', 'APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', ...chosen]) {
    const value = base[name] || fromKeychain[name]
    if (value) env[name] = value
  }
  return env
}
