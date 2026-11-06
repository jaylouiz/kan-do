import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_PUBKEY } from '../../scripts/release/config.mjs'
import { parseArgs } from '../../scripts/release.mjs'

const root = resolve(__dirname, '../..')

describe('release arguments', () => {
  it('parses the version and flags', () => {
    expect(parseArgs(['0.2.0'], {})).toMatchObject({ version: '0.2.0', dryRun: false, skipVerify: false, error: '' })
    expect(parseArgs(['0.2.0', '--dry-run', '--skip-verify'], {})).toMatchObject({ dryRun: true, skipVerify: true })
    expect(parseArgs(['0.2.0'], {}).ci).toBe(false)
    expect(parseArgs(['0.2.0', '--ci'], {})).toMatchObject({ ci: true, error: '' })
    expect(parseArgs(['0.2.0', '--bump-only'], {})).toMatchObject({ bumpOnly: true, ci: false, error: '' })
    expect(parseArgs(['0.2.0', '--bump-only', '--ci'], {}).error).toMatch(/exclude each other/)
    expect(parseArgs(['0.2.0'], {}).requireDeveloperId).toBe(false)
    expect(parseArgs(['0.2.0', '--ci', '--require-developer-id'], {})).toMatchObject({ ci: true, requireDeveloperId: true, error: '' })
  })

  it('keeps --skip-e2e independent of --skip-verify (#355)', () => {
    expect(parseArgs(['0.2.0'], {})).toMatchObject({ skipE2e: false, skipVerify: false })
    expect(parseArgs(['0.2.0', '--skip-e2e'], {})).toMatchObject({ skipE2e: true, skipVerify: false, error: '' })
    expect(parseArgs(['0.2.0', '--skip-verify'], {})).toMatchObject({ skipE2e: false, skipVerify: true })
    expect(parseArgs(['0.2.0', '--ci', '--skip-verify'], {})).toMatchObject({ ci: true, skipE2e: false, error: '' })
  })

  it('runs the E2E step after verify and before the build, and names the flag in the usage', () => {
    const script = readFileSync(resolve(root, 'scripts/release.mjs'), 'utf8')
    expect(script.indexOf("run('npm', ['run', 'verify'])")).toBeGreaterThan(-1)
    expect(script.indexOf('await runE2e(options)')).toBeGreaterThan(script.indexOf("run('npm', ['run', 'verify'])"))
    expect(script.indexOf('await runE2e(options)')).toBeLessThan(script.indexOf('const tempDir = mkdtempSync('))
    expect(parseArgs([], {}).error).toContain('[--skip-e2e]')
  })

  it('treats npm swallowing --dry-run (no "--" before it) as a dry run, never as a real one', () => {
    expect(parseArgs(['0.2.0'], { npm_config_dry_run: 'true' }).dryRun).toBe(true)
  })

  it('takes a stage (#693): alpha by default, --stage x or --stage=x, nothing else', () => {
    expect(parseArgs(['0.2.0'], {})).toMatchObject({ stage: 'alpha', stageGiven: false, error: '' })
    expect(parseArgs(['0.2.0', '--stage', 'beta'], {})).toMatchObject({ stage: 'beta', stageGiven: true, version: '0.2.0', error: '' })
    expect(parseArgs(['--stage=stable', '0.2.0'], {})).toMatchObject({ stage: 'stable', stageGiven: true, version: '0.2.0', error: '' })
    expect(parseArgs(['0.2.0', '--stage', 'gamma'], {}).error).toMatch(/--stage takes alpha \| beta \| stable, got "gamma"/)
    expect(parseArgs(['0.2.0', '--stage'], {}).error).toMatch(/--stage takes/)
    expect(parseArgs([], {}).error).toContain('--stage alpha|beta|stable')
  })

  it('runs the fast E2E tier only for a non-stable stage in fast mode, after verify', () => {
    const script = readFileSync(resolve(root, 'scripts/release.mjs'), 'utf8')
    expect(script).toContain("const fast = mode === 'fast' && stage !== 'stable'")
  })

  it('rejects a missing version, unknown flags and extra arguments', () => {
    expect(parseArgs([], {}).error).toMatch(/Usage/)
    expect(parseArgs(['0.2.0', '--force'], {}).error).toMatch(/Unknown option --force/)
    expect(parseArgs(['0.2.0', '0.3.0'], {}).error).toMatch(/Unexpected argument 0.3.0/)
  })
})

describe('updater placeholder', () => {
  it('is the same string in the release script, tauri.conf.json and updater.rs', () => {
    const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
    const rust = readFileSync(resolve(root, 'src-tauri/src/updater.rs'), 'utf8')
    expect(rust).toContain(`pub const PLACEHOLDER_PUBKEY: &str = "${PLACEHOLDER_PUBKEY}";`)
    // Until the user pastes their public key the config holds the placeholder (the script then refuses).
    const pubkey: string = conf.plugins.updater.pubkey
    expect(pubkey === PLACEHOLDER_PUBKEY || /^[A-Za-z0-9+/=]{20,}$/.test(pubkey)).toBe(true)
  })

  it('is wired as the release npm script', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(pkg.scripts.release).toBe('node scripts/release.mjs')
  })

  it('configures the updater bundle', () => {
    const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
    expect(conf.bundle.createUpdaterArtifacts).toBe(true)
    expect(conf.bundle.targets).toEqual(['app', 'dmg'])
    expect(conf.bundle.macOS.signingIdentity).toBe('-')
    expect(conf.identifier).toBe('com.julius.kan-do')
    expect(conf.plugins.updater.endpoints).toBeUndefined()
  })
})
