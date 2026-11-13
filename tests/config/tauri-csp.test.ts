import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guard for the desktop CSP (ADR 012, #228). The CSP only applies to the Tauri bundle and breakage
// shows only in the built app, so the shape is pinned here.

type Csp = Record<string, string>

const root = resolve(__dirname, '../..')
const conf = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')) as {
  app: { security: { csp: Csp | string | null, devCsp?: Csp | string | null, dangerousDisableAssetCspModification?: unknown } }
}
const capabilities = JSON.parse(readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8')) as {
  permissions: Array<string | { identifier: string, allow?: Array<{ url: string }> }>
}

const sources = (csp: Csp, directive: string) => (csp[directive] ?? '').split(/\s+/).filter(Boolean)

describe.each([['csp'], ['devCsp']] as const)('tauri.conf.json app.security.%s', (key) => {
  const raw = conf.app.security[key]

  it('is a directive map, not null or a wildcard string', () => {
    expect(raw).toBeTypeOf('object')
    expect(raw).not.toBeNull()
  })

  const csp = (raw ?? {}) as Csp

  it('never uses a wildcard source or unsafe-eval', () => {
    for (const [directive, value] of Object.entries(csp)) {
      expect(sources(csp, directive), directive).not.toContain('*')
      expect(value, directive).not.toContain('unsafe-eval')
      expect(value, directive).not.toContain('wasm-unsafe-eval')
    }
  })

  it('starts closed: default-src self, no plugins, no base, no framing, no form posts', () => {
    expect(csp['default-src']).toBe("'self'")
    expect(csp['object-src']).toBe("'none'")
    expect(csp['base-uri']).toBe("'none'")
    expect(csp['frame-ancestors']).toBe("'none'")
    expect(csp['form-action']).toBe("'none'")
  })

  it('keeps scripts, fonts and images on the app origin (no data: or blob:)', () => {
    expect(sources(csp, 'font-src')).toEqual(["'self'"])
    expect(sources(csp, 'img-src')).toEqual(["'self'"])
    expect(sources(csp, 'script-src')).toContain("'self'")
  })

  it('connect-src lists IPC, the one webview-side integration host and the feedback relay, and no GitHub or release host', () => {
    const connect = sources(csp, 'connect-src')
    expect(connect).toEqual(expect.arrayContaining(["'self'", 'ipc:', 'http://ipc.localhost', 'https://api.todoist.com', 'https://kan-do-zeta.vercel.app']))
    const hosts = connect.filter(s => !s.startsWith("'"))
    // GitHub (#223 github_request, #225 updater) is reached by Rust only; allowing it would let the page reach it
    expect(hosts.filter(h => /github/i.test(h))).toEqual([])
    // Notion goes through the Tauri http plugin (IPC), never a direct webview fetch
    expect(hosts.filter(h => /notion/i.test(h))).toEqual([])
  })
})

describe('production csp', () => {
  const csp = conf.app.security.csp as Csp

  it('allows exactly the expected connect-src hosts', () => {
    expect(sources(csp, 'connect-src')).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', 'https://api.todoist.com', 'https://kan-do-zeta.vercel.app'])
  })

  it('the feedback relay host is the one the build posts to (#268)', () => {
    const config = readFileSync('nuxt.config.ts', 'utf8')
    const url = /FEEDBACK_RELAY_PRODUCTION_URL = '([^']+)'/.exec(config)?.[1]
    expect(url).toBeDefined()
    expect(sources(csp, 'connect-src')).toContain(new URL(url!).origin)
  })

  it('has no inline script and no localhost dev host', () => {
    expect(sources(csp, 'script-src')).toEqual(["'self'"])
    expect(JSON.stringify(csp)).not.toContain('localhost:')
  })

  it('only style-src allows unsafe-inline (Nuxt UI injects its colour <style> at runtime)', () => {
    const withUnsafeInline = Object.keys(csp).filter(d => sources(csp, d).includes("'unsafe-inline'"))
    expect(withUnsafeInline).toEqual(['style-src'])
  })
})

describe('dangerousDisableAssetCspModification (ADR 012)', () => {
  // Exactly the list form: a boolean `true` would also stop Tauri hashing the two inline scripts of the
  // generated HTML, and the bundle would not start. Excluding style-src keeps `'unsafe-inline'` effective
  // (a nonce or hash in style-src makes browsers ignore it, which drops Nuxt UI's runtime colour <style>).
  it('excludes style-src only, as a list', () => {
    expect(conf.app.security.dangerousDisableAssetCspModification).toEqual(['style-src'])
  })
})

describe('dev csp', () => {
  const csp = conf.app.security.devCsp as Csp

  it('adds only localhost for the Nuxt dev server and HMR socket', () => {
    const extra = sources(csp, 'connect-src').filter(s => !sources(conf.app.security.csp as Csp, 'connect-src').includes(s))
    expect(extra).toEqual(['http://localhost:*', 'ws://localhost:*'])
  })
})

describe('capabilities/default.json', () => {
  it('keeps the Notion host allow-list for the http plugin and no GitHub host for it', () => {
    const http = capabilities.permissions.find(
      (p): p is { identifier: string, allow?: Array<{ url: string }> } => typeof p === 'object' && p.identifier === 'http:default',
    )
    expect(http?.allow?.map(a => a.url)).toEqual(['https://api.notion.com/**'])
  })
})
