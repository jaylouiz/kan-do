import { describe, expect, it } from 'vitest'
import {
  APPLE_VARIABLES, SECRET_VARIABLES, containerVerification, buildSigningEnv, githubEnv, identityInstalled, installedIdentityName, isDeveloperIdCertificateName,
  isDeveloperIdIdentity, neutralEnv, signingPlan, signingState, verificationSteps,
} from '../../scripts/release/signing.mjs'

const NAME = 'Developer ID Application: Example Name (ABCDE12345)'
const apiKey = { APPLE_API_ISSUER: true, APPLE_API_KEY: true, APPLE_API_KEY_PATH: true }
const appleId = { APPLE_ID: true, APPLE_PASSWORD: true, APPLE_TEAM_ID: true }

describe('signing state', () => {
  it('is ad-hoc without an identity, with an empty one or with "-", whatever else is set', () => {
    for (const identity of [undefined, null, '', '  ', '-']) {
      expect(signingState({ identity, present: apiKey })).toMatchObject({ mode: 'ad-hoc', identity: null, notarization: null })
    }
  })

  it('is Developer ID with a complete API key or Apple ID set', () => {
    expect(signingState({ identity: NAME, present: apiKey })).toMatchObject({ mode: 'developer-id', notarization: 'api-key', identity: NAME })
    expect(signingState({ identity: NAME, present: appleId })).toMatchObject({ mode: 'developer-id', notarization: 'apple-id' })
    expect(signingState({ identity: NAME, present: { ...apiKey, ...appleId } }).notarization).toBe('apple-id')
  })

  it('refuses Developer ID without notarization credentials and names the closest method', () => {
    const none = signingState({ identity: NAME, present: {} })
    expect(none.mode).toBe('missing-credentials')
    expect(none.message).toContain('Tauri would only warn')
    const partial = signingState({ identity: NAME, present: { APPLE_API_ISSUER: true, APPLE_API_KEY: true } })
    expect(partial.missing).toEqual(['APPLE_API_KEY_PATH'])
    const noTeam = signingState({ identity: NAME, present: { APPLE_ID: true, APPLE_PASSWORD: true } })
    expect(noTeam.missing).toEqual(['APPLE_TEAM_ID'])
  })

  it('refuses an identity that cannot be notarized', () => {
    for (const identity of ['Apple Development: Example (ABCDE12345)', 'Mac Developer: x', 'My Cert']) {
      expect(signingState({ identity, present: apiKey }).mode, identity).toBe('invalid-identity')
    }
    expect(isDeveloperIdIdentity('A'.repeat(40))).toBe(true)
    expect(isDeveloperIdIdentity('A'.repeat(39))).toBe(false)
    expect(signingState({ identity: 'a1'.repeat(20), present: apiKey }).mode).toBe('developer-id')
  })

  it('never puts a variable value in a label or message', () => {
    const state = signingState({ identity: NAME, present: {} })
    expect(JSON.stringify(state)).not.toMatch(/password=|secret/i)
  })
})

describe('installed identity', () => {
  const listing = `  1) 0123456789ABCDEF0123456789ABCDEF01234567 "${NAME}"\n     1 valid identities found`
  it('finds the identity by name or hash and not a lookalike', () => {
    expect(identityInstalled(listing, NAME)).toBe(true)
    expect(identityInstalled(listing, '0123456789abcdef0123456789abcdef01234567')).toBe(true)
    expect(identityInstalled(listing, 'Developer ID Application: Someone Else (ZZZZZ99999)')).toBe(false)
    expect(identityInstalled('     0 valid identities found', NAME)).toBe(false)
  })
})

describe('signing plan', () => {
  it('lists only the ad-hoc codesign for an ad-hoc build', () => {
    const plan = signingPlan(signingState({ identity: '-', present: {} }))
    expect(plan).toHaveLength(1)
    expect(plan[0]).toContain("codesign --force -s '-' --options runtime --entitlements src-tauri/entitlements.plist")
  })

  it('adds notarytool and stapler for Developer ID, with placeholders instead of credentials', () => {
    const plan = signingPlan(signingState({ identity: NAME, present: apiKey })).join('\n')
    expect(plan).toContain('xcrun notarytool submit')
    expect(plan).toContain('--key-id <APPLE_API_KEY>')
    expect(plan).toContain('xcrun stapler staple')
    const viaAppleId = signingPlan(signingState({ identity: NAME, present: appleId })).join('\n')
    expect(viaAppleId).toContain('--password <redacted>')
  })

  it('verifies signature, Gatekeeper and the stapled ticket after a Developer ID build', () => {
    const lines = verificationSteps('/x/kan-do.app').map(step => [step.cmd, ...step.args].join(' '))
    expect(lines).toEqual([
      'codesign --verify --deep --strict --verbose=2 /x/kan-do.app',
      'spctl -a -vv --type execute /x/kan-do.app',
      'xcrun stapler validate /x/kan-do.app',
    ])
  })
})

describe('credential scoping (#228 review M1)', () => {
  const secrets = {
    TAURI_SIGNING_PRIVATE_KEY: 'SECRET-updater-key',
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'SECRET-updater-password',
    GH_TOKEN: 'SECRET-gh-token',
    GITHUB_TOKEN: 'SECRET-github-token',
    ACTIONS_RUNTIME_TOKEN: 'SECRET-actions-runtime',
    APPLE_SIGNING_IDENTITY: NAME,
    APPLE_CERTIFICATE: 'SECRET-p12',
    APPLE_CERTIFICATE_PASSWORD: 'SECRET-p12-password',
    APPLE_API_ISSUER: 'SECRET-issuer',
    APPLE_API_KEY: 'SECRET-key-id',
    APPLE_API_KEY_PATH: '/runner/AuthKey.p8',
    APPLE_ID: 'a@b.c',
    APPLE_PASSWORD: 'SECRET-app-password',
    APPLE_TEAM_ID: 'TEAM',
  }
  const base = { PATH: '/usr/bin', HOME: '/Users/x', ...secrets }
  const leaked = (env: Record<string, string | undefined>) => Object.values(env).filter(value => String(value).includes('SECRET-'))

  it('lists every credential the workflow or the runbook can hand the script', () => {
    for (const name of Object.keys(secrets)) expect(SECRET_VARIABLES, name).toContain(name)
  })

  it('gives a neutral child (git, npm, nuxt generate, cargo compile, the checks) none of them', () => {
    const env = neutralEnv(base)
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/x' })
    expect(leaked(env)).toEqual([])
  })

  it('gives gh the GitHub token and nothing else, and a local gh (no token) an empty addition', () => {
    const env = githubEnv(base)
    expect(env).toMatchObject({ PATH: '/usr/bin', GH_TOKEN: 'SECRET-gh-token', GITHUB_TOKEN: 'SECRET-github-token' })
    expect(Object.keys(env).sort()).toEqual(['GITHUB_TOKEN', 'GH_TOKEN', 'HOME', 'PATH'].sort())
    expect(githubEnv({ PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' })
  })

  it('gives the bundling child the updater key and the chosen Apple method, never a GitHub token', () => {
    const state = signingState({ identity: NAME, present: apiKey })
    const env = buildSigningEnv(state, base, {}, { key: 'SECRET-updater-key', password: 'SECRET-updater-password' })
    expect(env).toMatchObject({
      TAURI_SIGNING_PRIVATE_KEY: 'SECRET-updater-key',
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'SECRET-updater-password',
      APPLE_SIGNING_IDENTITY: NAME,
      APPLE_CERTIFICATE: 'SECRET-p12',
      APPLE_API_ISSUER: 'SECRET-issuer',
      APPLE_API_KEY_PATH: '/runner/AuthKey.p8',
    })
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']) expect(env).not.toHaveProperty(name)
  })

  it('gives an ad-hoc bundling child the updater key and no Apple variable, so Tauri cannot try to notarize', () => {
    const env = buildSigningEnv(signingState({ identity: '', present: {} }), base, {}, { key: 'SECRET-updater-key', password: 'SECRET-updater-password' })
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH', 'TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'])
    for (const name of APPLE_VARIABLES) expect(env).not.toHaveProperty(name)
  })

  it('keeps only the chosen notarization method for a Developer ID build', () => {
    const viaId = buildSigningEnv(signingState({ identity: NAME, present: { ...apiKey, ...appleId } }), base)
    expect(viaId).toMatchObject({ APPLE_PASSWORD: 'SECRET-app-password', APPLE_ID: 'a@b.c' })
    expect(viaId).not.toHaveProperty('APPLE_API_KEY')
    expect(viaId).not.toHaveProperty('APPLE_API_KEY_PATH')
  })

  it('adds Keychain values of the chosen method only, and the environment wins over the Keychain', () => {
    const state = signingState({ identity: NAME, present: apiKey })
    const env = buildSigningEnv(state, { PATH: '/usr/bin', APPLE_SIGNING_IDENTITY: NAME, APPLE_API_ISSUER: 'env-issuer' }, { APPLE_API_ISSUER: 'keychain', APPLE_API_KEY: 'key-id', APPLE_PASSWORD: 'unused' })
    expect(env).toMatchObject({ APPLE_API_ISSUER: 'env-issuer', APPLE_API_KEY: 'key-id' })
    expect(env).not.toHaveProperty('APPLE_PASSWORD')
  })

  it('does not mutate the environment it was given', () => {
    const input = { ...base }
    buildSigningEnv(signingState({ identity: '-', present: {} }), input)
    neutralEnv(input)
    githubEnv(input)
    expect(input).toEqual(base)
  })
})

describe('installed identity name (#228 review L6)', () => {
  const HASH = '0123456789ABCDEF0123456789ABCDEF01234567'
  const listing = `  1) ${HASH} "${NAME}"\n  2) ${'F'.repeat(40)} "Apple Development: Dev (ABCDE12345)"\n     2 valid identities found`
  it('resolves a hash to the certificate name, so a development certificate is not taken for Developer ID', () => {
    expect(installedIdentityName(listing, HASH.toLowerCase())).toBe(NAME)
    expect(installedIdentityName(listing, 'F'.repeat(40))).toBe('Apple Development: Dev (ABCDE12345)')
    expect(isDeveloperIdCertificateName(installedIdentityName(listing, 'F'.repeat(40))!)).toBe(false)
    expect(isDeveloperIdCertificateName(installedIdentityName(listing, NAME)!)).toBe(true)
    expect(installedIdentityName(listing, 'E'.repeat(40))).toBeNull()
  })
})

describe('neutral environment deny-list (#262 N3)', () => {
  it('drops the legacy Tauri signing names and any credential-looking variable', () => {
    const base = {
      TAURI_SIGNING_PRIVATE_KEY_PATH: '/k', TAURI_PRIVATE_KEY: 'k', TAURI_PRIVATE_KEY_PASSWORD: 'p', TAURI_KEY_PASSWORD: 'p',
      NPM_TOKEN: 't', MY_SERVICE_SECRET: 's', DB_PASSWORD: 'p', AWS_SECRET_ACCESS_KEY: 'a', OPENAI_API_KEY: 'o', CARGO_REGISTRY_TOKEN: 'c',
      APPLE_ANYTHING_NEW: 'x', GCP_CREDENTIALS: 'g',
    }
    expect(neutralEnv({ PATH: '/usr/bin', ...base })).toEqual({ PATH: '/usr/bin' })
    for (const name of ['TAURI_SIGNING_PRIVATE_KEY_PATH', 'TAURI_PRIVATE_KEY', 'TAURI_PRIVATE_KEY_PASSWORD', 'TAURI_KEY_PASSWORD']) {
      expect(SECRET_VARIABLES).toContain(name)
    }
  })

  it('keeps the ordinary build variables', () => {
    const ordinary = {
      PATH: '/usr/bin', HOME: '/Users/x', CARGO_HOME: '/c', CARGO_TARGET_DIR: '/t', RUSTUP_HOME: '/r', RUSTUP_TOOLCHAIN: 'stable',
      SSH_AUTH_SOCK: '/s', HTTPS_PROXY: 'http://p', NO_PROXY: 'x', npm_config_user_agent: 'npm', npm_lifecycle_event: 'release', GITHUB_ACTIONS: 'true',
    }
    expect(neutralEnv(ordinary)).toEqual(ordinary)
  })
})

describe('hash identity in CI (#262 N5)', () => {
  const HASH = 'a1'.repeat(20)
  it('refuses a SHA-1 hash with ci or APPLE_CERTIFICATE and tells to use the name', () => {
    for (const input of [{ ci: true, present: apiKey }, { present: { ...apiKey, APPLE_CERTIFICATE: true } }]) {
      const state = signingState({ identity: HASH, ...input })
      expect(state.mode).toBe('invalid-identity')
      expect(state.message).toContain('certificate name')
    }
  })

  it('keeps hash support locally and the name in CI', () => {
    expect(signingState({ identity: HASH, present: apiKey }).mode).toBe('developer-id')
    expect(signingState({ identity: NAME, present: apiKey, ci: true }).mode).toBe('developer-id')
  })
})

describe('container verification (#262 L7)', () => {
  const targets = containerVerification({ bundlePath: '/b/kan-do.app.tar.gz', dmgPath: '/b/kan-do.dmg', extractDir: '/t/x', mountPoint: '/t/m' })
  it('unpacks the updater bundle and mounts the DMG read-only, detaching afterwards', () => {
    expect(targets.map(target => target.appPath)).toEqual(['/t/x/kan-do.app', '/t/m/kan-do.app'])
    expect(targets[0]!.setup[0]).toMatchObject({ cmd: 'tar', args: ['-xzf', '/b/kan-do.app.tar.gz', '-C', '/t/x'] })
    expect(targets[1]!.setup[0]).toMatchObject({ cmd: 'hdiutil', args: ['attach', '-readonly', '-nobrowse', '-mountpoint', '/t/m', '/b/kan-do.dmg'] })
    expect(targets[1]!.teardown[0]).toMatchObject({ cmd: 'hdiutil', args: ['detach', '/t/m'] })
    expect(targets[0]!.teardown).toEqual([])
  })
})
