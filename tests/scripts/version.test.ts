import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  VERSION_FILES, bumpAll, bumpCargoToml, bumpJsonVersion, bumpPackageLock, compareSemver, isBumped, isPlainSemver,
  latestTagVersion, readPackageLockVersion, readVersions,
} from '../../scripts/release/version.mjs'
import { BUMP_FILES } from '../../scripts/release/preflight.mjs'

const root = resolve(__dirname, '../..')
const read = (relative: string) => readFileSync(resolve(root, relative), 'utf8')

const PACKAGE_JSON = `{
  "name": "kan-do",
  "version": "0.1.0",
  "dependencies": {
    "version": "^1.0.0"
  }
}
`
const PACKAGE_LOCK = `{
  "name": "kan-do",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "kan-do",
      "version": "0.1.0",
      "dependencies": {
        "pinia": "^3.0.0"
      }
    },
    "node_modules/pinia": {
      "version": "3.0.1"
    }
  }
}
`
const TAURI_CONF = `{
  "productName": "kan-do",
  "version": "0.1.0",
  "identifier": "io.github.jaylouiz.kan-do"
}
`
const CARGO_TOML = `[package]
name = "app"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
`

describe('semver helpers', () => {
  it('accepts plain X.Y.Z only', () => {
    for (const ok of ['0.1.0', '1.2.3', '10.20.30']) expect(isPlainSemver(ok), ok).toBe(true)
    for (const bad of ['v1.2.3', '1.2', '1.2.3-beta.1', '1.2.3+5', '01.2.3', '1.2.3.4', '', 'latest']) {
      expect(isPlainSemver(bad), bad).toBe(false)
    }
  })

  it('compares numerically, not as text', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('0.1.9', '0.2.0')).toBeLessThan(0)
  })

  it('finds the latest tag version and ignores foreign tags', () => {
    expect(latestTagVersion(['v0.1.0', 'v0.10.0', 'v0.9.0', 'nightly', 'v1.0.0-beta'])).toBe('0.10.0')
    expect(latestTagVersion([])).toBeNull()
  })
})

describe('version bump', () => {
  it('changes only the version value in each file', () => {
    const next = bumpAll({ packageJson: PACKAGE_JSON, packageLock: PACKAGE_LOCK, tauriConf: TAURI_CONF, cargoToml: CARGO_TOML }, '0.2.0')
    expect(next.packageJson).toBe(PACKAGE_JSON.replace('"version": "0.1.0"', '"version": "0.2.0"'))
    expect(next.packageLock).toBe(PACKAGE_LOCK.replaceAll('"version": "0.1.0"', '"version": "0.2.0"'))
    expect(next.tauriConf).toBe(TAURI_CONF.replace('"version": "0.1.0"', '"version": "0.2.0"'))
    expect(next.cargoToml).toBe(CARGO_TOML.replace('version = "0.1.0"', 'version = "0.2.0"'))
  })

  it('leaves dependency versions alone', () => {
    expect(bumpJsonVersion(PACKAGE_JSON, '9.9.9')).toContain('"version": "^1.0.0"')
    expect(bumpCargoToml(CARGO_TOML, '9.9.9')).toContain('serde = { version = "1.0"')
    expect(bumpPackageLock(PACKAGE_LOCK, '9.9.9')).toContain('"node_modules/pinia": {\n      "version": "3.0.1"')
  })

  it('reads the lock version only when both root fields agree', () => {
    expect(readPackageLockVersion(PACKAGE_LOCK)).toBe('0.1.0')
    const halfBumped = PACKAGE_LOCK.replace('"version": "0.1.0"', '"version": "0.2.0"')
    expect(readPackageLockVersion(halfBumped)).toBeNull()
    expect(readPackageLockVersion(bumpPackageLock(halfBumped, '0.2.0'))).toBe('0.2.0')
  })

  it('reads the three versions and knows when a tree is already bumped', () => {
    const texts = { packageJson: PACKAGE_JSON, packageLock: PACKAGE_LOCK, tauriConf: TAURI_CONF, cargoToml: CARGO_TOML }
    expect(readVersions(texts)).toEqual({ packageJson: '0.1.0', packageLock: '0.1.0', tauriConf: '0.1.0', cargoToml: '0.1.0' })
    expect(isBumped(texts, '0.1.0')).toBe(true)
    expect(isBumped(texts, '0.2.0')).toBe(false)
    expect(isBumped(bumpAll(texts, '0.2.0'), '0.2.0')).toBe(true)
    // A half-done bump (one file) is not "already bumped"; a lock left behind (the pre-fix release) is half-done too.
    expect(isBumped({ ...texts, packageJson: bumpJsonVersion(PACKAGE_JSON, '0.2.0') }, '0.2.0')).toBe(false)
    expect(isBumped({ ...bumpAll(texts, '0.2.0'), packageLock: PACKAGE_LOCK }, '0.2.0')).toBe(false)
  })

  it('refuses a file without a version field', () => {
    expect(() => bumpJsonVersion('{}', '1.0.0', 'x.json')).toThrow(/x\.json/)
    expect(() => bumpCargoToml('[dependencies]\n', '1.0.0')).toThrow(/Cargo\.toml/)
    expect(() => bumpPackageLock('{\n  "version": "0.1.0"\n}\n', '1.0.0')).toThrow(/packages\[""\]/)
  })
})

describe('the shipped version files', () => {
  it('carry the same version (guard for `npm run release`)', () => {
    const versions = readVersions({
      packageJson: read(VERSION_FILES.packageJson),
      packageLock: read(VERSION_FILES.packageLock),
      tauriConf: read(VERSION_FILES.tauriConf),
      cargoToml: read(VERSION_FILES.cargoToml),
    })
    expect(versions.packageJson).toMatch(/^\d+\.\d+\.\d+$/)
    // A lock behind package.json makes the next `npm install` rewrite it: a dirty tree after every merge.
    expect(versions.packageLock).toBe(versions.packageJson)
    expect(versions.tauriConf).toBe(versions.packageJson)
    expect(versions.cargoToml).toBe(versions.packageJson)
  })

  it('stage every bumped file in the release commit', () => {
    expect(BUMP_FILES).toEqual(expect.arrayContaining(Object.values(VERSION_FILES)))
  })
})
