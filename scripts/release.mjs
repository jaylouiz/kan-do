#!/usr/bin/env node
/**
 * `npm run release <version> -- [--dry-run] [--skip-verify] [--skip-e2e] [--require-developer-id] [--ci | --bump-only] [--stage alpha|beta|stable]` (#225, #228, ADR 009, ADR 013, docs/release.md).
 *
 * Bumps the version, builds the signed updater bundle on this Mac, and publishes it to a GitHub release
 * of the private repo in an order that never exposes a half-published release (draft first, publish
 * last). Helpers live in `scripts/release/*.mjs` and are pure; this file does the I/O.
 *
 * The updater signing key and the Apple signing and notarization credentials are read from the
 * environment or the Keychain, never printed or written to disk, and handed to exactly one child: the
 * bundling step (`tauri bundle`). The compile step (`nuxt generate`, `cargo`, every `build.rs`) and
 * every other child get a neutral environment; the GitHub token goes to `gh` only (`signing.mjs`
 * `SECRET_VARIABLES`). This script itself imports no npm package, so it is the only code that holds the
 * secrets as a whole. Agents run this script with `--dry-run` only.
 *
 * After `npm run verify` and before the build it runs the full E2E suite (#355): PRs are only gated by the
 * tiered pre-merge hook, so this is the one place the whole suite is mandatory. A pass is stamped for `HEAD`
 * (`scripts/release/e2e.mjs`, shared with the hook), a failure refuses before anything is committed, pushed or
 * uploaded. `--skip-verify` skips only verify, `--skip-e2e` only the E2E step; `--ci` never runs it (the tag was
 * gated by `--bump-only`, which runs verify and E2E).
 *
 * Stage and testing mode (#693): `--stage alpha|beta|stable` (default `alpha`) is recorded as a `Stage: <stage>` line in
 * the release notes, which the preflight checks against the flag; the version stays plain `X.Y.Z` on the one update
 * channel (ADR 009). In `fast` testing mode (`.claude/testing-mode`) an alpha or beta release runs neither
 * `npm run verify` nor E2E (its PRs were gated by CI); a `stable` release always runs the full suite and is refused
 * in `fast` mode. `quality` mode behaves as before.
 *
 * `--ci` is the GitHub Actions path (`.github/workflows/release.yml`): the tag was pushed first, so the
 * script builds, checks and uploads to a draft for that tag and stops there; publishing the draft stays
 * a human click. `--require-developer-id` (the workflow sets it) refuses an ad-hoc build, so a missing
 * Apple secret fails the run instead of silently shipping ad-hoc. `--bump-only` prepares that tag: bump,
 * commit and push `main`, then stop (the tag push that starts the workflow is yours).
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { KEYCHAIN_KEY_SERVICE, KEYCHAIN_PASSWORD_SERVICE } from './release/config.mjs'
import { dirtyOutside, e2eArgs, e2eRefusal, findFreePort, FULL_KEY, parseSummary, stampKey, stampPath } from './release/e2e.mjs'
import { assetNames, buildManifest, renderManifest, REPO, signedVersion } from './release/manifest.mjs'
import { loadReleaseNotes, notesPath, STAGES } from './release/notes.mjs'
import { formatChecks, refusals, runChecks, BUMP_FILES, TAURI_CLI_INSTALL } from './release/preflight.mjs'
import {
  buildArtifacts, checkAssets, manifestSteps, publishSteps, requiredAssets, uploadSteps,
} from './release/publish.mjs'
import {
  APPLE_KEYCHAIN_SERVICES, APPLE_VARIABLES, buildSigningEnv, githubEnv, installedIdentityName, isDeveloperIdIdentity, neutralEnv,
  containerVerification, signingPlan, signingState, verificationSteps,
} from './release/signing.mjs'
import { fastReleaseSpecs, listSpecs } from './e2e-gate.mjs'
import { readTestingMode } from './testing-mode.mjs'
import { VERSION_FILES, bumpAll, isBumped, latestTagVersion } from './release/version.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const USAGE = 'Usage: npm run release <version> -- [--dry-run] [--skip-verify] [--skip-e2e] [--require-developer-id] [--ci | --bump-only] [--stage alpha|beta|stable]'
const APP_PATH = 'src-tauri/target/release/bundle/macos/kan-do.app'

/**
 * `npm run release 0.2.0 --dry-run` (without the `--`) makes npm swallow the flag and set
 * `npm_config_dry_run`; honouring it keeps that typo from turning into a real release.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function parseArgs(argv, env = {}) {
  const options = { version: '', dryRun: env.npm_config_dry_run === 'true', skipVerify: false, skipE2e: false, ci: false, bumpOnly: false, requireDeveloperId: false, stage: 'alpha', stageGiven: false, error: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--stage' || arg.startsWith('--stage=')) {
      const value = arg === '--stage' ? argv[++i] : arg.slice('--stage='.length)
      if (STAGES.includes(value ?? '')) Object.assign(options, { stage: value, stageGiven: true })
      else options.error = `--stage takes ${STAGES.join(' | ')}, got "${value ?? ''}". ${USAGE}`
    } else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--skip-verify') options.skipVerify = true
    else if (arg === '--skip-e2e') options.skipE2e = true
    else if (arg === '--ci') options.ci = true
    else if (arg === '--bump-only') options.bumpOnly = true
    else if (arg === '--require-developer-id') options.requireDeveloperId = true
    else if (arg.startsWith('-')) options.error = `Unknown option ${arg}. ${USAGE}`
    else if (!options.version) options.version = arg
    else options.error = `Unexpected argument ${arg}. ${USAGE}`
  }
  if (options.ci && options.bumpOnly && !options.error) options.error = `--ci and --bump-only exclude each other. ${USAGE}`
  if (!options.version && !options.error) options.error = USAGE
  return options
}

// ---------------------------------------------------------------------------------------------
// I/O helpers

/** Shell-style rendering for the printed plan: arguments with spaces or parentheses are quoted. */
function quote(arg) {
  return /^[\w@%+=:,./#-]+$/.test(arg) || arg.startsWith('<') ? arg : `'${arg.replaceAll("'", "'\\''")}'`
}

function show(cmd, args) {
  return [cmd, ...args.map(quote)].join(' ')
}

/**
 * Environment of a child that gets no explicit one: never a credential, except the GitHub token for
 * `gh`. The updater key and the Apple credentials go to the bundling child alone (`buildAndStage`).
 */
function childEnv(cmd) {
  return cmd === 'gh' ? githubEnv(process.env) : neutralEnv(process.env)
}

/** Runs a command and returns `{ ok, stdout }`; output is captured, nothing is printed. */
function capture(cmd, args, { env, cwd = ROOT, trim = true } = {}) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: env ?? childEnv(cmd) })
  const stdout = result.stdout ?? ''
  return { ok: result.status === 0, stdout: trim ? stdout.trim() : stdout.replace(/\n$/, '') }
}

/** Runs a command with its output on the terminal; throws on a non-zero exit. */
function run(cmd, args, { env } = {}) {
  console.log(`$ ${show(cmd, args)}`)
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: env ?? childEnv(cmd) })
  if (result.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} failed (exit ${result.status})`)
}

/** Like `run` for gh/git steps, but only prints in a dry run. */
function execute(step, dryRun) {
  if (dryRun) console.log(`$ ${show(step.cmd, step.args)}   # ${step.title}`)
  else run(step.cmd, step.args)
}

function readText(relative) {
  return readFileSync(join(ROOT, relative), 'utf8')
}

function readVersionFiles() {
  return {
    packageJson: readText(VERSION_FILES.packageJson),
    packageLock: readText(VERSION_FILES.packageLock),
    tauriConf: readText(VERSION_FILES.tauriConf),
    cargoToml: readText(VERSION_FILES.cargoToml),
  }
}

/** Key and password from the environment, else the Keychain. Values stay in memory. */
function resolveSigning(env, { keychain = true } = {}) {
  const fromKeychain = service => {
    if (!keychain) return null
    const result = capture('security', ['find-generic-password', '-s', service, '-w'])
    return result.ok && result.stdout ? result.stdout : null
  }
  return {
    key: env.TAURI_SIGNING_PRIVATE_KEY || fromKeychain(KEYCHAIN_KEY_SERVICE),
    password: env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || fromKeychain(KEYCHAIN_PASSWORD_SERVICE),
  }
}

/**
 * Apple signing inputs (#228). The environment wins; a local release falls back to the Keychain items in
 * `APPLE_KEYCHAIN_SERVICES`, but only when `APPLE_SIGNING_IDENTITY` names a Developer ID certificate: an
 * ad-hoc release and `--bump-only` read nothing from the Keychain. A dry run only asks whether an item
 * exists (no `-w`: that needs no authorization and shows no prompt), so it reports the state without
 * reading a secret. CI has no Keychain fallback. Values stay in memory and only ever go to the bundling
 * child. The `.p8` file is only stat'ed, never read.
 */
function resolveApple(env, { dryRun, ci, lookup = true }) {
  const identity = (env.APPLE_SIGNING_IDENTITY ?? '').trim()
  const present = Object.fromEntries([...APPLE_VARIABLES, 'APPLE_CERTIFICATE'].map(name => [name, Boolean(env[name])]))
  /** @type {Record<string, string>} */
  const values = {}
  const developerId = lookup && isDeveloperIdIdentity(identity)
  if (developerId && !ci) {
    for (const [name, service] of Object.entries(APPLE_KEYCHAIN_SERVICES)) {
      if (present[name]) continue
      if (dryRun) {
        present[name] = capture('security', ['find-generic-password', '-s', service]).ok
      } else {
        const item = capture('security', ['find-generic-password', '-s', service, '-w'])
        if (item.ok && item.stdout) {
          values[name] = item.stdout
          present[name] = true
        }
      }
    }
  }
  // CI imports the certificate into a temporary keychain itself (APPLE_CERTIFICATE), so there is nothing to look up.
  const listing = developerId && !env.APPLE_CERTIFICATE ? capture('security', ['find-identity', '-v', '-p', 'codesigning']).stdout : null
  const identityName = listing === null ? null : installedIdentityName(listing, identity)
  // CI hands over the `.p8` contents (APPLE_API_KEY_P8); the file only exists while the bundling child runs.
  const keyContents = env.APPLE_API_KEY_P8 ?? ''
  if (keyContents !== '') present.APPLE_API_KEY_PATH = true
  const keyPath = env.APPLE_API_KEY_PATH ?? ''
  const keyFile = !developerId || (keyContents === '' && keyPath === '') ? null : keyContents !== '' || (existsSync(keyPath) && statSync(keyPath).isFile())
  return { identity, present, values, identityInstalled: listing === null ? null : identityName !== null, identityName, keyFile }
}

function findRelease(version) {
  const listed = capture('gh', [
    'api', `repos/${REPO}/releases?per_page=100`, '--paginate',
    '--jq', `.[] | select(.tag_name == "v${version}") | "\\(.id) \\(.draft)"`,
  ])
  if (!listed.ok || !listed.stdout) return { id: null, draft: false }
  const [id, draft] = listed.stdout.split('\n')[0].split(' ')
  return { id: Number(id), draft: draft === 'true' }
}

function gatherFacts(options, signing, apple) {
  const { version, ci } = options
  // CI checked out the full history without a persisted token (release.yml), so there is nothing to fetch with.
  if (!ci) capture('git', ['fetch', 'origin', 'main', '--tags', '--quiet'])
  const files = readVersionFiles()
  const status = capture('git', ['status', '--porcelain'], { trim: false })
  const dirtyFiles = status.stdout ? status.stdout.split('\n').map(line => line.slice(3)) : []
  const tags = capture('git', ['tag', '--list', 'v*']).stdout.split('\n').filter(Boolean)
  const release = findRelease(version)
  const notes = loadReleaseNotes(version, { root: ROOT })
  // CI (`--ci`) releases a tag that --bump-only already gated: without --stage it takes the stage the notes record.
  const stage = options.stageGiven || !ci ? options.stage : (notes.stage ?? options.stage)
  const tagged = tags.includes(`v${version}`)
  return {
    facts: {
      version,
      branch: capture('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout,
      dirtyFiles,
      alreadyBumped: isBumped(files, version),
      behind: Number(capture('git', ['rev-list', '--count', 'HEAD..origin/main']).stdout || 0),
      latestTag: latestTagVersion(tags),
      // In CI the tag is pushed before the draft exists, so only a published release counts as taken.
      release: ci
        ? { exists: release.id !== null, draft: release.draft }
        : { exists: tagged || release.id !== null, draft: !tagged && release.draft },
      ghAuthenticated: capture('gh', ['auth', 'status']).ok,
      notes,
      stage,
      mode: readTestingMode(ROOT),
      signing: { key: Boolean(signing?.key), password: Boolean(signing?.password) },
      pubkey: JSON.parse(files.tauriConf).plugins?.updater?.pubkey ?? '',
      tauriCli: (() => { const cli = capture('cargo', ['tauri', '--version']); return cli.ok ? cli.stdout : null })(),
      platform: process.platform,
      arch: process.arch,
      ci,
      githubActions: process.env.GITHUB_ACTIONS === 'true',
      requireDeveloperId: options.requireDeveloperId,
      apple: {
        identity: apple.identity, present: apple.present, identityInstalled: apple.identityInstalled,
        identityName: apple.identityName, keyFile: apple.keyFile,
      },
    },
    release,
    dirtyFiles,
    files,
  }
}

// ---------------------------------------------------------------------------------------------
// Steps

function bump(options, files, tempDir) {
  const next = bumpAll(files, options.version)
  if (options.dryRun) {
    const dir = join(tempDir, 'bump')
    for (const [key, relative] of Object.entries(VERSION_FILES)) {
      mkdirSync(dirname(join(dir, relative)), { recursive: true })
      writeFileSync(join(dir, relative), next[key])
    }
    console.log(`Version bump to ${options.version} written to a temp copy: ${dir}`)
    return
  }
  for (const [key, relative] of Object.entries(VERSION_FILES)) writeFileSync(join(ROOT, relative), next[key])
  console.log(`Version bumped to ${options.version} in ${Object.values(VERSION_FILES).join(', ')}`)
}

function nonEmpty(path) {
  return existsSync(path) && statSync(path).size > 0
}

/**
 * The same checks on the app as it ships: unpacked from the updater `.app.tar.gz` and inside the `.dmg`
 * (what users actually get; the built `.app` alone could pass while a container is broken). The image is
 * detached and the temp dir removed in a `finally`.
 */
function verifyContainers(bundlePath, dmgPath) {
  const dir = mkdtempSync(join(tmpdir(), 'kan-do-verify-'))
  const extractDir = join(dir, 'extracted')
  const mountPoint = join(dir, 'mount')
  mkdirSync(extractDir)
  mkdirSync(mountPoint)
  try {
    for (const target of containerVerification({ bundlePath, dmgPath, extractDir, mountPoint })) {
      try {
        for (const step of target.setup) {
          console.log(step.title)
          run(step.cmd, step.args)
        }
        console.log(`Verifying the ${target.title}`)
        for (const step of verificationSteps(target.appPath)) {
          console.log(step.title)
          run(step.cmd, step.args)
        }
      } finally {
        for (const step of target.teardown) {
          console.log(step.title)
          capture(step.cmd, step.args)
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Builds, checks the artifacts and copies them under their versioned release names. Returns the stage dir. */
function buildAndStage(options, signing, apple, appleState, stageDir) {
  const names = assetNames(options.version)
  const artifacts = buildArtifacts(options.version)
  const bundleDir = join(ROOT, 'src-tauri/target/release/bundle')
  // Two children, so the credentials never meet code that only compiles: `nuxt generate`, every npm
  // lifecycle script and every crate's `build.rs` run in the first with a neutral environment; the second
  // only packages, signs and notarizes the finished binary and is the only one with the credentials.
  run('npm', ['run', 'tauri:build', '--', '--no-bundle'], { env: neutralEnv(process.env) })
  // The compile step ran `nuxt generate` (the build in `.output`): prove it carries no dev-only page before anything is bundled (#65).
  run('npx', ['vitest', 'run', 'tests/config/ui-catalog-build-output.test.ts'], { env: { ...neutralEnv(process.env), UI_CATALOG_REQUIRE_BUILD: '1' } })
  // The notarization key (CI) is a file only while the bundling child runs, never during the compile above.
  let keyDir = null
  const bundleBase = { ...process.env }
  try {
    if (appleState.mode === 'developer-id' && appleState.notarization === 'api-key' && process.env.APPLE_API_KEY_P8) {
      keyDir = mkdtempSync(join(tmpdir(), 'kan-do-notary-'))
      const keyFile = join(keyDir, 'AuthKey.p8')
      writeFileSync(keyFile, process.env.APPLE_API_KEY_P8, { mode: 0o600 })
      bundleBase.APPLE_API_KEY_PATH = keyFile
    }
    run('npm', ['run', 'tauri:bundle'], { env: buildSigningEnv(appleState, bundleBase, apple.values, signing) })
  } finally {
    if (keyDir) rmSync(keyDir, { recursive: true, force: true })
  }
  if (appleState.mode === 'developer-id') {
    // Tauri only warns when notarization silently did not happen; prove it before anything is uploaded.
    for (const step of verificationSteps(join(ROOT, APP_PATH))) {
      console.log(`${step.title}`)
      run(step.cmd, step.args)
    }
    verifyContainers(join(bundleDir, artifacts.bundle), join(bundleDir, artifacts.dmg))
  }
  const sources = {
    bundle: join(bundleDir, artifacts.bundle),
    signature: join(bundleDir, artifacts.signature),
    dmg: join(bundleDir, artifacts.dmg),
  }
  const missing = Object.entries(sources).filter(([, path]) => !nonEmpty(path)).map(([, path]) => path)
  if (missing.length) throw new Error(`The build did not produce: ${missing.join(', ')}`)
  const signature = readFileSync(sources.signature, 'utf8')
  // The app installs only bundles whose signature carries their version (`requireSignedVersion`).
  const signed = signedVersion(signature)
  if (signed !== options.version) {
    throw new Error(`The signature records version ${signed ?? 'none'}, expected ${options.version}; the installed apps would refuse this update. Upgrade the Tauri CLI (${TAURI_CLI_INSTALL}) and re-run.`)
  }
  for (const key of ['bundle', 'signature', 'dmg']) copyFileSync(sources[key], join(stageDir, names[key]))
  return signature
}

function listAssets(releaseId) {
  const result = capture('gh', ['api', `repos/${REPO}/releases/${releaseId}`, '--jq', '.assets'])
  if (!result.ok) throw new Error('Could not read the release assets back from GitHub')
  return JSON.parse(result.stdout || '[]')
}

/**
 * The full E2E suite between verify and the build (#355). Not in `--ci`; skipped by `--skip-e2e`; reused when
 * `HEAD` already carries a `<sha>.full` stamp (the pre-merge hook writes the same one). A dry run only prints.
 * The child gets a neutral environment plus `PORT`, so no credential reaches Playwright.
 */
async function runE2e({ dryRun, ci, skipE2e, stage, mode }) {
  if (ci) return console.log('E2E: not run in --ci; the tagged commit was gated by --bump-only')
  if (skipE2e) return console.log('E2E: skipped (--skip-e2e)')
  const sha = capture('git', ['rev-parse', 'HEAD']).stdout
  const commonDir = capture('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout
  // An alpha or beta release in fast testing mode (#693) runs the fast tier: smoke + the risk-area specs. Everything else the full suite.
  const fast = mode === 'fast' && stage !== 'stable'
  const specs = fast ? fastReleaseSpecs(JSON.parse(readFileSync(join(ROOT, '.claude/hooks/e2e-gate.json'), 'utf8')), listSpecs(ROOT)) : []
  const label = fast ? `fast tier (${specs.length} specs)` : 'full suite'
  const stamp = stampPath(commonDir, sha, fast ? stampKey(specs) : FULL_KEY)
  if (existsSync(stamp) || (fast && existsSync(stampPath(commonDir, sha, FULL_KEY)))) return console.log(`E2E: ${label} already passed for ${sha.slice(0, 7)} (stamp)`)
  const args = ['run', 'test:e2e', '--', ...e2eArgs({ files: specs.map(name => `tests/e2e/${name}.spec.ts`) })]
  if (dryRun) return console.log(`$ PORT=<free port> npm ${args.join(' ')}   # would run the ${label} (${fast ? 'testing mode fast, stage ' + stage : 'about 6 min on a quiet machine, builds first'}) before the build`)

  const port = await findFreePort()
  console.log(`$ PORT=${port} npm ${args.join(' ')}`)
  let output = ''
  const code = await new Promise((resolveExit) => {
    const child = spawn('npm', args, { cwd: ROOT, env: { ...neutralEnv(process.env), PORT: String(port) } })
    for (const [stream, sink] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on('data', (chunk) => {
        sink.write(chunk)
        output += chunk
      })
    }
    child.on('error', (error) => {
      console.error(`E2E: could not start npm: ${error.message}`)
      resolveExit(1)
    })
    child.on('close', status => resolveExit(status ?? 1))
  })
  if (code !== 0) {
    console.error(`\n${e2eRefusal({ failed: parseSummary(output).failed, code })}`)
    process.exit(1)
  }
  const flaky = parseSummary(output).flaky
  for (const test of flaky) console.log(`flaky: ${test}`)
  const status = capture('git', ['status', '--porcelain'], { trim: false }).stdout
  const dirty = dirtyOutside(status, BUMP_FILES)
  if (dirty.length) {
    console.error(`\nRelease refused: the E2E run left the working tree dirty (${dirty.join('; ')}); nothing was committed, pushed or uploaded`)
    process.exit(1)
  }
  if (status.trim()) return console.log('E2E: passed; no stamp written (the version files are already modified)')
  mkdirSync(dirname(stamp), { recursive: true })
  writeFileSync(stamp, '')
  console.log(`E2E: ${label} passed for ${sha.slice(0, 7)}`)
}

function publish(options, context) {
  const { version, dryRun } = options
  const { stageDir, notes, signature, sha, needsCommit, needsPush, staleDraft } = context
  const names = assetNames(version)
  const plan = { version, sha, stageDir, notesFile: notesPath(version), needsCommit, needsPush, verifyTag: options.ci }

  if (staleDraft && !dryRun) {
    console.log(`Deleting the stale draft release v${version}`)
    run('gh', ['api', '-X', 'DELETE', `repos/${REPO}/releases/${staleDraft}`])
  } else if (staleDraft) {
    console.log(`$ gh api -X DELETE repos/${REPO}/releases/${staleDraft}   # delete the stale draft`)
  }
  for (const step of uploadSteps(plan)) execute(step, dryRun)

  let bundleAssetId = 1001 // a dry run has no real asset ids
  let releaseId = null
  if (!dryRun) {
    releaseId = findRelease(version).id
    const uploaded = checkAssets(listAssets(releaseId), [names.bundle])
    if (!uploaded.ok) throw new Error(`Upload incomplete: ${uploaded.problems.join('; ')}`)
    bundleAssetId = uploaded.ids[names.bundle]
  } else {
    console.log('$ gh api repos/jaylouiz/kan-do/releases/<release id>   # read the asset ids back (dry run: fake id 1001)')
  }

  const manifest = buildManifest({ version, notes, pubDate: new Date().toISOString(), signature, bundleAssetId })
  writeFileSync(join(stageDir, names.manifest), renderManifest(manifest))
  if (dryRun) console.log(`\nlatest.json (${join(stageDir, names.manifest)}):\n${renderManifest(manifest)}`)
  for (const step of manifestSteps({ version, stageDir })) execute(step, dryRun)

  if (!dryRun) {
    const verified = checkAssets(listAssets(releaseId), requiredAssets(version))
    if (!verified.ok) throw new Error(`Refusing to publish: ${verified.problems.join('; ')}`)
    console.log('All four assets are uploaded and non-empty.')
  } else {
    console.log('$ gh api repos/jaylouiz/kan-do/releases/<release id>   # verify bundle, sig, dmg and latest.json are "uploaded" and non-empty')
  }
  if (options.ci) {
    console.log(`CI release: v${version} stays a draft. Publish it from the Releases page after checking the assets (docs/release.md).`)
    return
  }
  for (const step of publishSteps({ version })) execute(step, dryRun)
}

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env)
  if (options.error) {
    console.error(options.error)
    process.exit(2)
  }
  const { version, dryRun, ci, bumpOnly } = options
  console.log(`${dryRun ? '[dry run] ' : ''}${bumpOnly ? 'Prepare' : 'Release'} v${version}${ci ? ' (CI)' : ''}, stage ${options.stage}${ci && !options.stageGiven ? ' (default; CI takes the notes stage)' : ''}, testing mode ${readTestingMode(ROOT)}`)

  // CI has no Keychain: the updater key and the Apple credentials come from the environment only.
  // `--bump-only` builds nothing, so it reads no key and no credential at all.
  const signing = dryRun || bumpOnly ? null : resolveSigning(process.env, { keychain: !ci })
  const apple = resolveApple(process.env, { dryRun, ci, lookup: !bumpOnly })
  const appleState = signingState({ identity: apple.identity, present: apple.present, ci })
  const { facts, release, dirtyFiles, files } = gatherFacts(options, signing, apple)
  Object.assign(options, { stage: facts.stage, mode: facts.mode }) // the effective stage (CI: from the notes) and mode, for the E2E step
  const checks = runChecks(facts, { dryRun, bumpOnly })
  console.log(formatChecks(checks))
  if (ci && !bumpOnly && appleState.mode === 'ad-hoc') {
    // On a runner `::warning::` becomes an annotation on the run; elsewhere it is just a line.
    console.log('::warning::This release is signed AD-HOC (no Developer ID configured): not notarized, and installs over a Developer ID release will re-prompt for Keychain access.')
  }
  const refused = refusals(checks)
  if (refused.length && !dryRun) {
    console.error(`\nRelease refused (${refused.length} problem${refused.length === 1 ? '' : 's'}).`)
    process.exit(1)
  }

  // An alpha or beta release in fast testing mode runs no tests of its own: its PRs were tested and gated by CI (the owner's call)
  if (!ci && options.mode === 'fast' && options.stage !== 'stable') {
    console.log(`npm run verify and E2E: skipped (testing mode fast, stage ${options.stage}); the merged PRs were gated by CI`)
  } else {
    if (options.skipVerify) console.log('npm run verify: skipped (--skip-verify)')
    else if (dryRun) console.log('$ npm run verify   # would run before the build')
    else run('npm', ['run', 'verify'])
    await runE2e(options)
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'kan-do-release-'))
  const stageDir = join(tempDir, 'stage')
  mkdirSync(stageDir)

  const bumpedFilesDirty = dirtyFiles.filter(file => BUMP_FILES.includes(file)).length > 0
  const subject = capture('git', ['log', '-1', '--format=%s']).stdout
  const bumpCommitExists = !bumpedFilesDirty && facts.alreadyBumped && subject === `chore(release): v${version}`
  // CI starts from the tagged commit: nothing to bump, commit or push.
  const needsCommit = !ci && !bumpCommitExists
  const ahead = Number(capture('git', ['rev-list', '--count', 'origin/main..HEAD']).stdout || 0)

  try {
    if (!facts.alreadyBumped) bump(options, files, tempDir)
    else console.log(`Version files already at ${version}`)

    if (bumpOnly) {
      const prepare = uploadSteps({ version, sha: '', stageDir, notesFile: '', needsCommit, needsPush: needsCommit || ahead > 0 })
        .filter(step => ['stage', 'commit', 'push'].includes(step.id))
      for (const step of prepare) execute(step, dryRun)
      console.log(`\n${dryRun ? 'Dry run done: nothing was committed or pushed. ' : ''}Next, start the release workflow by pushing the tag:`)
      console.log(`  git tag v${version} && git push origin v${version}`)
      return
    }

    let signature = 'DRY-RUN-SIGNATURE'
    let sha = ci ? `<sha of the v${version} tag>` : '<sha of the version bump commit>'
    if (dryRun) {
      console.log('$ npm run tauri:build -- --no-bundle   # frontend + compile, neutral environment: no key, no Apple credential, no token (skipped in dry run)')
      console.log('$ UI_CATALOG_REQUIRE_BUILD=1 npx vitest run tests/config/ui-catalog-build-output.test.ts   # the generated build has no /ui, /styleguide or /error-test route and no catalog string (skipped in dry run)')
      console.log('$ npm run tauri:bundle   # package, sign with the updater key and notarize; the only child with credentials (skipped in dry run)')
      console.log(`\nApple code signing (${appleState.mode}), performed by tauri bundle:`)
      for (const line of signingPlan(appleState)) console.log(`  $ ${line}`)
      if (appleState.mode === 'developer-id') {
        console.log('Then verified before anything is uploaded:')
        for (const step of verificationSteps(APP_PATH)) console.log(`  $ ${show(step.cmd, step.args)}   # ${step.title}`)
        const artifacts = buildArtifacts(version)
        const bundleDir = 'src-tauri/target/release/bundle'
        for (const target of containerVerification({
          bundlePath: `${bundleDir}/${artifacts.bundle}`, dmgPath: `${bundleDir}/${artifacts.dmg}`, extractDir: '<temp>/extracted', mountPoint: '<temp>/mount',
        })) {
          console.log(`Then the same on the ${target.title}:`)
          for (const step of target.setup) console.log(`  $ ${show(step.cmd, step.args)}   # ${step.title}`)
          for (const step of verificationSteps(target.appPath)) console.log(`  $ ${show(step.cmd, step.args)}   # ${step.title}`)
          for (const step of target.teardown) console.log(`  $ ${show(step.cmd, step.args)}   # ${step.title} (in a finally)`)
        }
      } else if (appleState.mode === 'ad-hoc') {
        console.log('  (no notarization; first installs need right-click -> Open and the Keychain re-prompts after every update)')
      }
      console.log('')
    } else {
      signature = buildAndStage(options, signing, apple, appleState, stageDir)
    }
    if (!dryRun && !ci) {
      // Commit and push first: the draft's `--target` must be a commit GitHub has.
      for (const step of uploadSteps({ version, sha: '', stageDir, notesFile: '', needsCommit, needsPush: needsCommit || ahead > 0 }).filter(s => ['stage', 'commit', 'push'].includes(s.id))) {
        execute(step, false)
      }
      sha = capture('git', ['rev-parse', 'HEAD']).stdout
    }
    publish(options, {
      stageDir,
      notes: facts.notes.body,
      signature,
      sha,
      needsCommit: dryRun ? needsCommit : false,
      needsPush: dryRun ? !ci && (needsCommit || ahead > 0) : false,
      staleDraft: release.draft ? release.id : null,
    })
  } catch (error) {
    console.error(`\nRelease v${version} was NOT published: ${error.message}`)
    console.error(`The version files may be bumped locally. Re-running the same command accepts that tree; to start over: git checkout -- ${BUMP_FILES.join(' ')}`)
    console.error('A draft release may be left on GitHub; re-running the same command replaces it (docs/release.md, "Recovery").')
    process.exit(1)
  }
  console.log(dryRun ? `\nDry run done: nothing was pushed, uploaded or published. Temp files: ${tempDir}` : `\nReleased v${version}.`)
  if (dryRun && refused.length) console.log(`Note: a real run would currently be refused (${refused.length} problem${refused.length === 1 ? '' : 's'} above).`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
