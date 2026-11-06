import { afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Every icon key Nuxt UI uses by default points to Lucide, which is not installed: an unmapped key
// would be fetched from api.iconify.design at runtime, which the desktop CSP blocks (ADR 012, #261).
// The default key list lives in a hashed `@nuxt/ui` dist chunk with no stable import, so it is pinned
// here together with the version it was read from. Update both on every @nuxt/ui bump: diff the
// `defaultIcons` object in node_modules/@nuxt/ui/dist/shared/ui.*.mjs against NUXT_UI_ICON_KEYS.

const PINNED_NUXT_UI_VERSION = '4.12.0'
const NUXT_UI_ICON_KEYS = [
  'arrowDown', 'arrowLeft', 'arrowRight', 'arrowUp', 'caution', 'check', 'chevronDoubleLeft',
  'chevronDoubleRight', 'chevronDown', 'chevronLeft', 'chevronRight', 'chevronUp', 'close', 'copy',
  'copyCheck', 'dark', 'drag', 'ellipsis', 'error', 'external', 'eye', 'eyeOff', 'file', 'folder',
  'folderOpen', 'hash', 'info', 'light', 'loading', 'menu', 'minus', 'panelClose', 'panelOpen', 'plus',
  'reload', 'search', 'star', 'stop', 'success', 'system', 'tip', 'upload', 'warning',
]

const root = resolve(__dirname, '../..')

async function mappedIcons(): Promise<Record<string, string>> {
  vi.stubGlobal('defineAppConfig', (config: unknown) => config)
  const { default: config } = await import('~/app.config')
  return (config as { ui: { icons: Record<string, string> } }).ui.icons
}

describe('app.config.ts ui.icons', () => {
  afterAll(() => vi.unstubAllGlobals())

  it('pins the list to the installed @nuxt/ui version (a bump forces a review)', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'node_modules/@nuxt/ui/package.json'), 'utf8')) as { version: string }
    expect(pkg.version).toBe(PINNED_NUXT_UI_VERSION)
  })

  it('maps every Nuxt UI default icon key', async () => {
    const icons = await mappedIcons()
    expect(NUXT_UI_ICON_KEYS.filter(key => !(key in icons))).toEqual([])
  })

  it('maps each key to a Phosphor icon (i-ph-*) and nothing else', async () => {
    const icons = await mappedIcons()
    const offenders = Object.entries(icons).filter(([, value]) => !/^i-ph-[a-z0-9-]+$/.test(value))
    expect(offenders).toEqual([])
  })
})
