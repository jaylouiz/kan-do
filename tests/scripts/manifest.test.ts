import { describe, expect, it } from 'vitest'
import { PLATFORM_KEYS, assetApiUrl, assetNames, buildManifest, renderManifest, signedVersion } from '../../scripts/release/manifest.mjs'

describe('latest.json', () => {
  const manifest = buildManifest({
    version: '0.2.0',
    notes: 'What changed',
    pubDate: '2026-10-27T09:00:00.000Z',
    signature: 'untrusted comment: signature\nABC123\n',
    bundleAssetId: 4242,
  })

  it('uses the API asset URL of the bundle, never a browser download URL', () => {
    for (const key of PLATFORM_KEYS) {
      const platform = (manifest.platforms as Record<string, { url: string, signature: string }>)[key]!
      expect(platform.url).toBe('https://api.github.com/repos/jaylouiz/kan-do/releases/assets/4242')
      expect(platform.url).not.toContain('browser_download_url')
      expect(platform.url).not.toContain('github.com/jaylouiz/kan-do/releases/download')
    }
  })

  it('has both platform keys and carries the signature over (trimmed)', () => {
    expect(PLATFORM_KEYS).toEqual(['darwin-aarch64', 'darwin-aarch64-app'])
    expect(Object.keys(manifest.platforms)).toEqual(PLATFORM_KEYS)
    expect((manifest.platforms as Record<string, { signature: string }>)['darwin-aarch64']!.signature)
      .toBe('untrusted comment: signature\nABC123')
  })

  it('carries version, notes and pub_date', () => {
    expect(manifest).toMatchObject({ version: '0.2.0', notes: 'What changed', pub_date: '2026-10-27T09:00:00.000Z' })
  })

  it('renders valid JSON with a trailing newline', () => {
    const text = renderManifest(manifest)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(manifest)
  })

  it('names the assets with the version', () => {
    expect(assetNames('0.2.0')).toEqual({
      bundle: 'kan-do_0.2.0_aarch64.app.tar.gz',
      signature: 'kan-do_0.2.0_aarch64.app.tar.gz.sig',
      dmg: 'kan-do_0.2.0_aarch64.dmg',
      manifest: 'latest.json',
    })
    expect(assetApiUrl(7)).toBe('https://api.github.com/repos/jaylouiz/kan-do/releases/assets/7')
  })
})

describe('signedVersion', () => {
  const minisign = (trusted: string) => `untrusted comment: signature from tauri secret key\nRWQabc==\ntrusted comment: ${trusted}\nGLOBAL==\n`
  const asSigFile = (text: string) => Buffer.from(text).toString('base64')

  it('reads the version from the trusted comment of a Tauri .sig file', () => {
    expect(signedVersion(asSigFile(minisign('timestamp:1700000000\tfile:kan-do.app.tar.gz\tversion:0.2.0')))).toBe('0.2.0')
  })

  it('returns null for a signature made without the version', () => {
    expect(signedVersion(asSigFile(minisign('timestamp:1700000000\tfile:kan-do.app.tar.gz')))).toBeNull()
    expect(signedVersion('')).toBeNull()
  })

  it('accepts the plain minisign text too', () => {
    expect(signedVersion(minisign('timestamp:1\tversion:1.2.3'))).toBe('1.2.3')
  })
})
