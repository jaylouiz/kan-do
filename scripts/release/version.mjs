/**
 * Version helpers for `npm run release` (#225). Pure: strings in, strings out.
 *
 * The bump is a targeted text edit per file (no JSON/TOML round trip), so formatting and key order
 * stay as they are. `package-lock.json` gets the same text edit on its two root `version` fields and nothing
 * else: npm never runs, so the lock's dependency entries stay as committed, and a later `npm install` finds
 * nothing to rewrite (before this, every release left the lock one version behind).
 */

import { compareVersions } from '../../lib/releaseNotesFormat.mjs'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

/** Files that carry the app version, relative to the repo root. `Cargo.lock` follows from the build. */
export const VERSION_FILES = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  tauriConf: 'src-tauri/tauri.conf.json',
  cargoToml: 'src-tauri/Cargo.toml',
}

/** Plain `X.Y.Z` only: no `v` prefix, pre-release or build metadata. */
export function isPlainSemver(version) {
  return typeof version === 'string' && SEMVER.test(version)
}

/** @returns {number} negative, 0 or positive like `Array.sort` (one shared implementation with the app) */
export const compareSemver = compareVersions

/** Highest plain-semver version among tags like `v0.1.0`; null when there is none. */
export function latestTagVersion(tags) {
  const versions = tags
    .map(tag => tag.trim().replace(/^v/, ''))
    .filter(isPlainSemver)
    .sort(compareSemver)
  return versions.length ? versions[versions.length - 1] : null
}

const TOP_LEVEL_JSON_VERSION = /^(\s*"version"\s*:\s*")([^"]*)(")/m
/** The root package's entry `packages[""]`; its `version` precedes the first nested object. */
const LOCK_ROOT_PACKAGE_VERSION = /("packages"\s*:\s*\{\s*""\s*:\s*\{[^{}]*?"version"\s*:\s*")([^"]*)(")/s
const CARGO_PACKAGE_VERSION = /(\[package\][^[]*?^version\s*=\s*")([^"]*)(")/ms

export function readPackageJsonVersion(text) {
  return TOP_LEVEL_JSON_VERSION.exec(text)?.[2] ?? null
}

/** The lock's root version, or null when its two root fields (top level, `packages[""]`) disagree. */
export function readPackageLockVersion(text) {
  const top = readPackageJsonVersion(text)
  const root = LOCK_ROOT_PACKAGE_VERSION.exec(text)?.[2] ?? null
  return top !== null && top === root ? top : null
}

export function readCargoVersion(text) {
  return CARGO_PACKAGE_VERSION.exec(text)?.[2] ?? null
}

function replaceOnce(text, pattern, version, label) {
  if (!pattern.test(text)) throw new Error(`No version field found in ${label}`)
  return text.replace(pattern, (_all, before, _old, after) => `${before}${version}${after}`)
}

/** `package.json` and `tauri.conf.json` keep `"version"` as a top-level key; the first one is the app's. */
export function bumpJsonVersion(text, version, label = 'JSON file') {
  return replaceOnce(text, TOP_LEVEL_JSON_VERSION, version, label)
}

/** The lock's top-level `version` and the one of `packages[""]`; dependency versions stay as they are. */
export function bumpPackageLock(text, version) {
  const top = replaceOnce(text, TOP_LEVEL_JSON_VERSION, version, 'package-lock.json')
  return replaceOnce(top, LOCK_ROOT_PACKAGE_VERSION, version, 'package-lock.json (packages[""])')
}

/** Only the `version` of the `[package]` table. */
export function bumpCargoToml(text, version) {
  return replaceOnce(text, CARGO_PACKAGE_VERSION, version, 'Cargo.toml')
}

/**
 * Reads the versions from file contents: `{ packageJson, packageLock, tauriConf, cargoToml }`.
 * @param {{ packageJson: string, packageLock: string, tauriConf: string, cargoToml: string }} texts
 */
export function readVersions(texts) {
  return {
    packageJson: readPackageJsonVersion(texts.packageJson),
    packageLock: readPackageLockVersion(texts.packageLock),
    tauriConf: readPackageJsonVersion(texts.tauriConf),
    cargoToml: readCargoVersion(texts.cargoToml),
  }
}

/**
 * Bumps all version files.
 * @param {{ packageJson: string, packageLock: string, tauriConf: string, cargoToml: string }} texts
 */
export function bumpAll(texts, version) {
  return {
    packageJson: bumpJsonVersion(texts.packageJson, version, VERSION_FILES.packageJson),
    packageLock: bumpPackageLock(texts.packageLock, version),
    tauriConf: bumpJsonVersion(texts.tauriConf, version, VERSION_FILES.tauriConf),
    cargoToml: bumpCargoToml(texts.cargoToml, version),
  }
}

/** True when every version file already carries `version`. */
export function isBumped(texts, version) {
  return Object.values(readVersions(texts)).every(found => found === version)
}
