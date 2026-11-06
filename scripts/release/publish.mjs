/**
 * Publish order for `npm run release` (#225). Pure: builds the ordered command list and checks the
 * uploaded assets, so the order is testable without git, gh or network.
 *
 * Atomic by construction: the release stays a draft until the bundle, its signature, the dmg and
 * `latest.json` are all listed as `uploaded` with a non-zero size. `releases/latest` ignores drafts,
 * so installed apps never see a half-published release; publishing the draft creates the tag.
 */
import { assetNames, REPO } from './manifest.mjs'

/**
 * @typedef {{ id: string, title: string, cmd: string, args: string[] }} Step
 */

export function releaseTitle(version) {
  return `v${version}`
}

export function commitMessage(version) {
  return `chore(release): v${version}`
}

/**
 * Steps up to and including the upload of the three build artifacts. `latest.json` needs the asset ids
 * these uploads create, so the rest comes from {@link manifestSteps} and {@link publishSteps}.
 * `verifyTag` is the CI path (#228): the tag was pushed first, so the draft attaches to it
 * (`--verify-tag`) instead of targeting a commit.
 * @param {{ version: string, sha: string, stageDir: string, notesFile: string, needsCommit: boolean, needsPush: boolean, verifyTag?: boolean }} input
 * @returns {Step[]}
 */
export function uploadSteps({ version, sha, stageDir, notesFile, needsCommit, needsPush, verifyTag = false }) {
  const tag = releaseTitle(version)
  const names = assetNames(version)
  /** @type {Step[]} */
  const steps = []
  if (needsCommit) {
    steps.push({
      id: 'stage',
      title: 'Stage the version bump',
      cmd: 'git',
      args: ['add', 'package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'],
    })
    steps.push({ id: 'commit', title: 'Commit the version bump', cmd: 'git', args: ['commit', '-m', commitMessage(version)] })
  }
  if (needsPush) {
    steps.push({ id: 'push', title: 'Push main', cmd: 'git', args: ['push', 'origin', 'main'] })
  }
  steps.push({
    id: 'draft',
    title: 'Create the draft release',
    cmd: 'gh',
    args: ['release', 'create', tag, '--repo', REPO, '--draft', ...(verifyTag ? ['--verify-tag'] : ['--target', sha]), '--title', tag, '--notes-file', notesFile],
  })
  steps.push({
    id: 'upload',
    title: 'Upload bundle, signature and dmg',
    cmd: 'gh',
    args: [
      'release', 'upload', tag, '--repo', REPO,
      `${stageDir}/${names.bundle}`, `${stageDir}/${names.signature}`, `${stageDir}/${names.dmg}`,
    ],
  })
  return steps
}

/** Uploads `latest.json` once its content exists. @returns {Step[]} */
export function manifestSteps({ version, stageDir }) {
  const tag = releaseTitle(version)
  return [{
    id: 'upload-manifest',
    title: 'Upload latest.json',
    cmd: 'gh',
    args: ['release', 'upload', tag, '--repo', REPO, `${stageDir}/${assetNames(version).manifest}`],
  }]
}

/** The last step: publishing the draft creates the tag and makes it `latest`. @returns {Step[]} */
export function publishSteps({ version }) {
  const tag = releaseTitle(version)
  return [{
    id: 'publish',
    title: 'Publish the release',
    cmd: 'gh',
    args: ['release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest'],
  }]
}

/**
 * Looks up the asset ids of the expected names in a release's `assets` array (REST shape).
 * @param {Array<{ id: number, name: string, state?: string, size?: number }>} assets
 * @param {string[]} expectedNames
 * @returns {{ ok: boolean, ids: Record<string, number>, problems: string[] }}
 */
export function checkAssets(assets, expectedNames) {
  /** @type {Record<string, number>} */
  const ids = {}
  const problems = []
  for (const name of expectedNames) {
    const asset = assets.find(candidate => candidate.name === name)
    if (!asset) {
      problems.push(`${name} is not on the release`)
      continue
    }
    ids[name] = asset.id
    if (asset.state !== 'uploaded') problems.push(`${name} is in state "${asset.state}", expected "uploaded"`)
    else if (!asset.size || asset.size <= 0) problems.push(`${name} has size ${asset.size ?? 0}`)
  }
  return { ok: problems.length === 0, ids, problems }
}

/** Asset names that must exist before the draft is published. */
export function requiredAssets(version) {
  const names = assetNames(version)
  return [names.bundle, names.signature, names.dmg, names.manifest]
}

/** Artifacts the build leaves behind, relative to `src-tauri/target/release/bundle`. */
export function buildArtifacts(version) {
  return {
    bundle: 'macos/kan-do.app.tar.gz',
    signature: 'macos/kan-do.app.tar.gz.sig',
    dmg: `dmg/kan-do_${version}_aarch64.dmg`,
  }
}
