import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Behaviour-side check of the desktop CSP (ADR 012, #261): the generated HTML must stay compatible with
// the policy in src-tauri/tauri.conf.json, which Tauri completes with script hashes at build time.
//
// It reads the static build, so it needs one first:
//   npm run generate && npx vitest tests/config/csp-build-output.test.ts
// Without `.output/public/index.html` the suite is skipped. That is why it is not part of the skip-free
// run of `npm run verify`: nothing there generates the site. Run it after changing nuxt.config.ts, a
// module, a plugin that adds head tags, or the CSP.

const indexHtml = resolve(__dirname, '../../.output/public/index.html')

describe.skipIf(!existsSync(indexHtml))('generated index.html under the desktop CSP', () => {
  const html = existsSync(indexHtml) ? readFileSync(indexHtml, 'utf8') : ''
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(m => ({ attrs: m[1] ?? '', body: m[2] ?? '' }))
  const inline = scripts.filter(s => !/\bsrc\s*=/.test(s.attrs))

  it('has no inline <style> (Tauri would add a nonce to it and browsers then ignore style-src unsafe-inline)', () => {
    expect(html).not.toMatch(/<style\b/i)
  })

  it('has no inline event-handler attributes', () => {
    expect(html).not.toMatch(/\son\w+\s*=/i)
  })

  it('has no javascript: URLs', () => {
    expect(html).not.toMatch(/javascript:/i)
  })

  it('has exactly the inline scripts ADR 012 names: the import map and the window.__NUXT__ config', () => {
    // Data blocks (type application/json, e.g. Nuxt's __NUXT_DATA__) are not executed and need no hash
    const executable = inline.filter(s => !/\btype\s*=\s*["']application\/json["']/.test(s.attrs))
    const kinds = executable.map(s => (/\btype\s*=\s*["']importmap["']/.test(s.attrs) ? 'importmap' : s.body.trimStart().startsWith('window.__NUXT__') ? 'nuxt-config' : 'other'))
    expect(kinds.sort()).toEqual(['importmap', 'nuxt-config'])
  })

  it('references only same-origin resources', () => {
    const urls = [...html.matchAll(/(?<![\w-])(?:src|href|action|poster|data)\s*=\s*"([^"]*)"/g)].map(m => m[1] ?? '')
    expect(urls.length).toBeGreaterThan(0)
    // connect-src hosts are fetched by script, never referenced from markup; anything absolute here is new
    expect(urls.filter(u => !/^\/(?!\/)/.test(u))).toEqual([])
    expect(html).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i)
  })
})
