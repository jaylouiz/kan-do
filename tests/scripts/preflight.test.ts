import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_PUBKEY } from '../../scripts/release/config.mjs'
import { formatChecks, parseTauriCliVersion, refusals, runChecks, tauriCliSupportsSignedVersion } from '../../scripts/release/preflight.mjs'

type Facts = Parameters<typeof runChecks>[0]

const good = (): Facts => ({
  version: '0.2.0',
  branch: 'main',
  dirtyFiles: [],
  alreadyBumped: false,
  behind: 0,
  latestTag: '0.1.0',
  release: { exists: false, draft: false },
  ghAuthenticated: true,
  notes: { ok: true, body: 'Notes' },
  signing: { key: true, password: true },
  pubkey: 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6',
  tauriCli: 'tauri-cli 2.12.4',
  platform: 'darwin',
  arch: 'arm64',
  ci: false,
  githubActions: false,
  apple: { identity: '', present: {}, identityInstalled: null },
})

const refusedIds = (facts: Facts, options?: { dryRun?: boolean, bumpOnly?: boolean }) =>
  refusals(runChecks(facts, options)).map(check => check.id)

describe('release preflight', () => {
  describe('stage and testing mode (#693)', () => {
    const staged = (stage: string, mode: string, notesStage: string | null | undefined = stage): Facts =>
      ({ ...good(), stage, mode, notes: { ok: true, body: 'Notes', stage: notesStage } })

    it('adds no stage check when the facts carry no stage', () => {
      expect(runChecks(good()).map(check => check.id)).not.toContain('stage')
    })

    it('accepts alpha and beta in either mode and stable in quality', () => {
      for (const [stage, mode] of [['alpha', 'fast'], ['beta', 'fast'], ['alpha', 'quality'], ['stable', 'quality']]) {
        expect(refusedIds(staged(stage!, mode!)), `${stage}/${mode}`).toEqual([])
      }
    })

    it('refuses stable in fast mode and names the switch to quality', () => {
      const found = refusals(runChecks(staged('stable', 'fast')))
      expect(found.map(check => check.id)).toEqual(['stageMode'])
      expect(found[0]?.message).toMatch(/quality/)
      expect(found[0]?.message).toMatch(/\.claude\/testing-mode/)
    })

    it('refuses notes whose Stage line is missing or differs from the flag', () => {
      expect(refusedIds(staged('alpha', 'quality', null))).toEqual(['stage'])
      const found = refusals(runChecks(staged('beta', 'quality', 'alpha')))
      expect(found.map(check => check.id)).toEqual(['stage'])
      expect(found[0]?.message).toContain('Stage: beta')
    })
  })

  it('passes a clean main with everything in place', () => {
    expect(refusals(runChecks(good()))).toEqual([])
  })

  it('refuses each problem with one clear message', () => {
    const cases: Array<[string, Partial<Facts>, string]> = [
      ['version', { version: 'v0.2.0' }, 'plain X.Y.Z'],
      ['version', { version: '0.2' }, 'plain X.Y.Z'],
      ['greater', { version: '0.1.0' }, 'not greater than the latest tag v0.1.0'],
      ['greater', { version: '0.0.9' }, 'not greater'],
      ['branch', { branch: 'feat/x' }, 'cut from main'],
      ['clean', { dirtyFiles: ['components/A.vue'] }, 'uncommitted changes'],
      ['behind', { behind: 2 }, '2 commit(s) behind'],
      ['tag', { release: { exists: true, draft: false } }, 'already published'],
      ['gh', { ghAuthenticated: false }, 'gh auth login'],
      ['notes', { notes: { ok: false, reason: 'release-notes/0.2.0.md is missing' } }, 'release-notes/0.2.0.md is missing'],
      ['key', { signing: { key: false, password: true } }, 'signing key'],
      ['key', { signing: { key: true, password: false } }, 'signing key'],
      ['pubkey', { pubkey: PLACEHOLDER_PUBKEY }, 'still the placeholder'],
      ['pubkey', { pubkey: '' }, 'still the placeholder'],
      ['tauriCli', { tauriCli: 'tauri-cli 2.7.1' }, 'cargo install tauri-cli --version "^2" --locked'],
      ['tauriCli', { tauriCli: null }, 'not found'],
      ['platform', { platform: 'linux' }, 'Apple silicon'],
      ['platform', { arch: 'x64' }, 'Apple silicon'],
    ]
    for (const [id, patch, text] of cases) {
      const found = refusals(runChecks({ ...good(), ...patch }))
      expect(found.map(check => check.id), JSON.stringify(patch)).toEqual([id])
      expect(found[0]!.message, JSON.stringify(patch)).toContain(text)
    }
  })

  it('accepts a re-run on an already-bumped tree and a leftover draft', () => {
    const rerun = {
      ...good(),
      alreadyBumped: true,
      dirtyFiles: ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'],
      release: { exists: true, draft: true },
    }
    expect(refusedIds(rerun)).toEqual([])
    // The same dirty files without the bump are stray changes.
    expect(refusedIds({ ...rerun, alreadyBumped: false })).toEqual(['clean'])
    // Other dirty files are never forgiven.
    expect(refusedIds({ ...rerun, dirtyFiles: [...rerun.dirtyFiles, 'README.md'] })).toEqual(['clean'])
  })

  it('skips the key in a dry run and reports it as skipped', () => {
    const facts = { ...good(), signing: { key: false, password: false } }
    const checks = runChecks(facts, { dryRun: true })
    expect(refusals(checks)).toEqual([])
    expect(formatChecks(checks)).toContain('signing key: skipped in dry run')
  })

  it('formats refusals as the bare message', () => {
    const text = formatChecks(runChecks({ ...good(), branch: 'dev' }))
    expect(text).toContain('REFUSED  Releases are cut from main (you are on "dev").')
  })

  it('compares the tauri CLI version against 2.11.5', () => {
    expect(parseTauriCliVersion('tauri-cli 2.7.1')).toBe('2.7.1')
    expect(parseTauriCliVersion('garbage')).toBeNull()
    const supported = (output: string | null) => tauriCliSupportsSignedVersion(output)
    expect(supported('tauri-cli 2.11.4')).toBe(false)
    expect(supported('tauri-cli 2.11.5')).toBe(true)
    expect(supported('tauri-cli 2.12.4')).toBe(true)
    expect(supported('tauri-cli 2.9.0')).toBe(false)
    expect(supported('tauri-cli 3.0.0')).toBe(true)
    expect(supported(null)).toBe(false)
  })

  it('still refuses an old tauri CLI in a dry run, so the rehearsal reports it', () => {
    const found = refusals(runChecks({ ...good(), tauriCli: 'tauri-cli 2.7.1' }, { dryRun: true }))
    expect(found.map(check => check.id)).toEqual(['tauriCli'])
  })

  describe('Apple signing (#228)', () => {
    const NAME = 'Developer ID Application: Example Name (ABCDE12345)'
    const apiKey = { APPLE_API_ISSUER: true, APPLE_API_KEY: true, APPLE_API_KEY_PATH: true }

    it('treats a release without an identity as ad-hoc and passes', () => {
      const checks = runChecks(good())
      expect(refusals(checks)).toEqual([])
      expect(formatChecks(checks)).toContain('signing: ad-hoc')
    })

    it('passes Developer ID with notarization credentials and an installed certificate', () => {
      const apple = { identity: NAME, present: apiKey, identityInstalled: true }
      const checks = runChecks({ ...good(), apple })
      expect(refusals(checks)).toEqual([])
      expect(formatChecks(checks)).toContain('notarized via api-key')
    })

    it('refuses Developer ID without notarization credentials, also in a dry run', () => {
      const facts = { ...good(), apple: { identity: NAME, present: {}, identityInstalled: true } }
      for (const dryRun of [false, true]) {
        const found = refusals(runChecks(facts, { dryRun }))
        expect(found.map(check => check.id)).toEqual(['appleSigning'])
        expect(found[0]!.message).toContain('notarization credentials')
      }
    })

    it('refuses a certificate that is not in the Keychain, but not when it was never looked up', () => {
      const apple = { identity: NAME, present: apiKey }
      expect(refusedIds({ ...good(), apple: { ...apple, identityInstalled: false } })).toEqual(['appleIdentity'])
      expect(refusedIds({ ...good(), apple: { ...apple, identityInstalled: null } })).toEqual([])
    })

    it('refuses an ad-hoc build when Developer ID is required, with a clear message', () => {
      const facts = { ...good(), requireDeveloperId: true }
      const found = refusals(runChecks(facts))
      expect(found.map(check => check.id)).toEqual(['developerIdRequired'])
      expect(found[0]!.message).toContain('ad-hoc')
      expect(refusedIds({ ...facts, apple: { identity: '-', present: apiKey } })).toEqual(['developerIdRequired'])
      // A configured identity with missing credentials is reported once, by the signing check.
      expect(refusedIds({ ...facts, apple: { identity: NAME, present: {} } })).toEqual(['appleSigning'])
      expect(refusedIds({ ...facts, apple: { identity: NAME, present: apiKey, identityInstalled: true } })).toEqual([])
      expect(refusedIds({ ...good(), requireDeveloperId: false })).toEqual([])
    })

    it('refuses a notarization key path that is not a file, but not when it was not checked', () => {
      const apple = { identity: NAME, present: apiKey, identityInstalled: true }
      expect(refusedIds({ ...good(), apple: { ...apple, keyFile: false } })).toEqual(['appleKeyFile'])
      expect(refusedIds({ ...good(), apple: { ...apple, keyFile: true } })).toEqual([])
      expect(refusedIds({ ...good(), apple: { ...apple, keyFile: null } })).toEqual([])
      // The Apple ID method has no key file.
      expect(refusedIds({ ...good(), apple: { identity: NAME, present: { APPLE_ID: true, APPLE_PASSWORD: true, APPLE_TEAM_ID: true }, keyFile: false } })).toEqual([])
    })

    it('refuses a 40-hex identity that resolves to a certificate other than Developer ID Application', () => {
      const hash = '0123456789ABCDEF0123456789ABCDEF01234567'
      const apple = { identity: hash, present: apiKey, identityInstalled: true }
      expect(refusedIds({ ...good(), apple: { ...apple, identityName: 'Apple Development: Dev (ABCDE12345)' } })).toEqual(['appleIdentityKind'])
      expect(refusedIds({ ...good(), apple: { ...apple, identityName: NAME } })).toEqual([])
      expect(refusedIds({ ...good(), apple: { ...apple, identityName: null } })).toEqual([])
    })

    it('refuses an identity that is not a Developer ID Application certificate', () => {
      const apple = { identity: 'Apple Development: Someone (ABCDE12345)', present: apiKey, identityInstalled: true }
      expect(refusedIds({ ...good(), apple })).toEqual(['appleSigning'])
    })
  })

  describe('--bump-only (#228)', () => {
    it('does not need the build, the signing key, Apple signing or the Apple silicon machine', () => {
      const facts: Facts = {
        ...good(), signing: { key: false, password: false }, tauriCli: null, platform: 'linux', arch: 'x64',
        apple: {
          identity: 'Developer ID Application: X (ABCDE12345)',
          present: { APPLE_API_ISSUER: true, APPLE_API_KEY: true, APPLE_API_KEY_PATH: true },
          identityInstalled: false,
        },
      }
      expect(refusedIds(facts, { bumpOnly: true })).toEqual([])
      expect(refusedIds(facts).sort()).toEqual(['appleIdentity', 'key', 'platform', 'tauriCli'])
    })

    it('still enforces the repository guards', () => {
      expect(refusedIds({ ...good(), branch: 'feat/x', behind: 1 }, { bumpOnly: true })).toEqual(['branch', 'behind'])
    })
  })

  describe('CI mode (#228)', () => {
    const ci = (patch: Partial<Facts> = {}): Facts => ({
      ...good(), ci: true, githubActions: true, branch: 'HEAD', alreadyBumped: true, latestTag: '0.2.0', behind: 7,
      dirtyFiles: ['package-lock.json'], release: { exists: false, draft: true }, ...patch,
    })

    it('refuses a SHA-1 hash identity (#262 N5) but accepts the certificate name', () => {
      const NAME = 'Developer ID Application: Example Name (ABCDE12345)'
      const apiKey = { APPLE_API_ISSUER: true, APPLE_API_KEY: true, APPLE_API_KEY_PATH: true }
      const hash = '0123456789ABCDEF0123456789ABCDEF01234567'
      expect(refusedIds(ci({ apple: { identity: hash, present: apiKey } }))).toEqual(['appleSigning'])
      expect(refusedIds(ci({ apple: { identity: NAME, present: apiKey } }))).toEqual([])
    })

    it('skips the local-release guards: main, clean tree, behind origin, greater than the latest tag', () => {
      expect(refusedIds(ci())).toEqual([])
    })

    it('only runs inside GitHub Actions, but can be rehearsed locally with --dry-run', () => {
      expect(refusedIds(ci({ githubActions: false }))).toEqual(['ci'])
      expect(refusedIds(ci({ githubActions: false }), { dryRun: true })).toEqual([])
    })

    it('refuses a tag whose commit did not bump the version files', () => {
      expect(refusedIds(ci({ alreadyBumped: false }))).toEqual(['bumped'])
    })

    it('still refuses a published release, missing notes and a missing updater key', () => {
      expect(refusedIds(ci({ release: { exists: true, draft: false } }))).toEqual(['tag'])
      expect(refusedIds(ci({ notes: { ok: false, reason: 'missing' } }))).toEqual(['notes'])
      expect(refusedIds(ci({ signing: { key: false, password: false } }))).toEqual(['key'])
    })
  })
})
