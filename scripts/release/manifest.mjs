/**
 * `latest.json` for the Tauri updater (#225, ADR 009). The bundle `url` is the GitHub API asset URL, not
 * `browser_download_url`: the repo is private, so the app downloads it with its token and
 * `Accept: application/octet-stream` (see `src-tauri/src/updater.rs`).
 */

export const REPO = 'jaylouiz/kan-do'
/** Both keys point at the same bundle: the plugin looks for `darwin-aarch64-app` first. */
export const PLATFORM_KEYS = ['darwin-aarch64', 'darwin-aarch64-app']

export function assetApiUrl(assetId, repo = REPO) {
  return `https://api.github.com/repos/${repo}/releases/assets/${assetId}`
}

/** Names the three files carry on the release (versioned and stable). */
export function assetNames(version) {
  return {
    bundle: `kan-do_${version}_aarch64.app.tar.gz`,
    signature: `kan-do_${version}_aarch64.app.tar.gz.sig`,
    dmg: `kan-do_${version}_aarch64.dmg`,
    manifest: 'latest.json',
  }
}

/**
 * @param {{ version: string, notes: string, pubDate: string, signature: string, bundleAssetId: number | string, repo?: string }} input
 */
export function buildManifest({ version, notes, pubDate, signature, bundleAssetId, repo = REPO }) {
  const entry = { signature: signature.trim(), url: assetApiUrl(bundleAssetId, repo) }
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: Object.fromEntries(PLATFORM_KEYS.map(key => [key, { ...entry }])),
  }
}

export function renderManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * The version recorded in a `.sig` file's trusted comment (`...\tversion:1.2.3`), or null. The
 * updater runs with `requireSignedVersion`, so a bundle signed without it can never be installed;
 * the release script checks this before anything is uploaded.
 * @param {string} signature content of the `.sig` file (base64 of the minisign text)
 */
export function signedVersion(signature) {
  const trimmed = signature.trim()
  const text = trimmed.startsWith('untrusted comment:') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8')
  const comment = text.split(/\r?\n/).find(line => line.startsWith('trusted comment:'))
  const field = comment?.slice('trusted comment:'.length).split('\t').find(part => part.trim().startsWith('version:'))
  return field ? field.trim().slice('version:'.length) : null
}
