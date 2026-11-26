// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { COOKIE_NAME, sha256Hex } from './gate'
import { buildCsp } from './csp'
import { handleRequest, type WorkerEnv } from './pipeline'

const SECRET = 'test-token'
const SITE = 'https://kando.example.workers.dev'
const HASHES = [`sha256-${'A'.repeat(43)}=`]
const CSP = buildCsp(HASHES)

/** Records whether the app sees a request. */
function setup(env: Partial<WorkerEnv> = {}) {
  const calls: string[] = []
  const app = vi.fn(async () => { calls.push('app'); return new Response('{}') })
  const full: WorkerEnv = { GATE: 'on', GATE_SECRET: SECRET, ...env }
  const run = async (path: string, headers: Record<string, string> = {}, gated = true) => {
    const h = new Headers(headers)
    if (gated) h.set('Cookie', `${COOKIE_NAME}=${await sha256Hex(SECRET)}`)
    return handleRequest(new Request(SITE + path, { headers: h }), full, app, HASHES)
  }
  return { app, calls, run }
}

describe('canonical redirect: workers.dev → custom domain (#118)', () => {
  const WORKERS_DEV = 'https://kando.julius-wuestefeld.workers.dev'
  const DOMAIN = 'https://kan-do.julius-wuestefeld.de'
  const app = vi.fn(async () => new Response('{}'))
  const env: WorkerEnv = { GATE: 'off' }
  const run = (url: string) => handleRequest(new Request(url), env, app, HASHES)

  it('the production workers.dev host redirects 301 to the domain, same path and query', async () => {
    const res = await run(`${WORKERS_DEV}/tasks?secret=abc`)
    expect(res.status).toBe(301)
    expect(res.headers.get('Location')).toBe(`${DOMAIN}/tasks?secret=abc`)
    expect(app).not.toHaveBeenCalled()
  })

  it('preview subdomains are not redirected', async () => {
    const preview = 'https://abc123.kando.julius-wuestefeld.workers.dev'
    const res = await run(`${preview}/tasks`)
    expect(res.status).not.toBe(301)
  })

  it('the custom domain itself is not redirected', async () => {
    const res = await run(`${DOMAIN}/tasks`)
    expect(res.status).not.toBe(301)
    expect(app).toHaveBeenCalled()
  })
})

describe('Worker pipeline: gate, then the Notion 404, then the app', () => {
  it('through the gate, a Notion request is 404 and the app never runs (#742)', async () => {
    const { calls, run } = setup()
    expect((await run('/api/notion/pages', { Origin: SITE, Authorization: 'Bearer secret_x' })).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('the gate comes first: without the cookie a Notion request is 401, not 404', async () => {
    const { app, run } = setup()
    const res = await run('/api/notion/pages', {}, false)
    expect(res.status).toBe(401)
    expect(app).not.toHaveBeenCalled()
  })

  it('with the gate off (the public launch) a Notion request is still 404', async () => {
    const { calls, run } = setup({ GATE: 'off' })
    expect((await run('/api/notion/pages', {}, false)).status).toBe(404)
    expect((await run('/tasks', {}, false)).status).toBe(200)
    expect(calls).toEqual(['app'])
  })

  it('the feedback relay stays exempt from the gate', async () => {
    const app = vi.fn(async () => new Response('{}'))
    const env: WorkerEnv = { GATE: 'on', GATE_SECRET: SECRET }
    const res = await handleRequest(new Request(`${SITE}/api/feedback`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' }), env, app, HASHES)
    expect(res.status).toBe(200)
    expect(app).toHaveBeenCalledOnce()
  })

  describe('Content Security Policy (#504)', () => {
    const html = () => new Response('<!doctype html><p>shell</p>', { headers: { 'Content-Type': 'text/html;charset=utf-8' } })
    const json = () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })
    const run = (path: string, app: () => Response, env: Partial<WorkerEnv> = {}, gated = true) =>
      sha256Hex(SECRET).then(hash => handleRequest(
        new Request(SITE + path, { headers: gated ? { Cookie: `${COOKIE_NAME}=${hash}` } : {} }),
        { GATE: 'on', GATE_SECRET: SECRET, ...env },
        async () => app(),
        HASHES,
      ))

    it('the app\'s HTML answer carries the policy, nosniff and no-referrer', async () => {
      const res = await run('/tasks', html)
      expect(res.headers.get('Content-Security-Policy')).toBe(CSP)
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow') // the gate still tags it
    })

    it('the policy is on with the gate off too (the public launch)', async () => {
      expect((await run('/', html, { GATE: 'off' }, false)).headers.get('Content-Security-Policy')).toBe(CSP)
    })

    it('the app\'s JSON answers carry none', async () => {
      const res = await run('/api/feedback', json)
      expect(res.headers.has('Content-Security-Policy')).toBe(false)
    })

    it('the gate\'s answers are unchanged: the 401 page and the redirect carry no CSP', async () => {
      const denied = await run('/', html, {}, false)
      expect(denied.status).toBe(401)
      expect(denied.headers.has('Content-Security-Policy')).toBe(false)
      const redirect = await handleRequest(new Request(`${SITE}/tasks?secret=${SECRET}`), { GATE: 'on', GATE_SECRET: SECRET }, async () => html(), HASHES)
      expect(redirect.status).toBe(302)
      expect(redirect.headers.has('Content-Security-Policy')).toBe(false)
    })

    it('the Notion 404 carries none', async () => {
      const { run: guarded } = setup()
      expect((await guarded('/api/notion/pages')).headers.has('Content-Security-Policy')).toBe(false)
    })

    it('a malformed hash list fails the request instead of serving a widened policy', async () => {
      await expect(handleRequest(new Request(SITE + '/'), { GATE: 'off' }, async () => html(), ["'unsafe-inline'"])).rejects.toThrow(/sha256/)
    })
  })

  describe('root files and brand assets (#736, #738)', () => {
    const upstream = () => new Response('bytes', { headers: { 'Content-Type': 'application/octet-stream' } })
    const call = (path: string, env: Partial<WorkerEnv>, gated: boolean, app: () => Response = upstream) =>
      sha256Hex(SECRET).then(hash => handleRequest(
        new Request(SITE + path, { headers: gated ? { Cookie: `${COOKIE_NAME}=${hash}` } : {} }),
        { GATE: 'on', GATE_SECRET: SECRET, ...env }, async () => app(), HASHES))

    it('gate off: robots.txt, sitemap.xml and security.txt are the Worker\'s own, with no noindex', async () => {
      for (const path of ['/robots.txt', '/sitemap.xml', '/.well-known/security.txt']) {
        const res = await call(path, { GATE: 'off' }, false, () => { throw new Error('the app must not run') })
        expect(res.status, path).toBe(200)
        expect(res.headers.get('X-Robots-Tag'), path).toBeNull()
      }
      expect(await (await call('/robots.txt', { GATE: 'off' }, false)).text()).toContain(`Sitemap: ${SITE}/sitemap.xml`)
    })

    it('gate on: robots.txt stays disallow-all, the other two are gated, a cookie gets them', async () => {
      expect(await (await call('/robots.txt', {}, false)).text()).toBe('User-agent: *\nDisallow: /\n')
      expect((await call('/sitemap.xml', {}, false)).status).toBe(401)
      expect((await call('/.well-known/security.txt', {}, false)).status).toBe(401)
      const withCookie = await call('/sitemap.xml', {}, true)
      expect(withCookie.status).toBe(200)
      expect(withCookie.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    })

    it('brand assets get their type and cache lifetime, with and without the gate, and need no cookie while it is on', async () => {
      for (const [env, gated] of [[{}, false], [{}, true], [{ GATE: 'off' }, false]] as const) {
        const res = await call('/icon-192.png', env, gated)
        expect(res.status).toBe(200)
        expect(res.headers.get('Content-Type')).toBe('image/png')
        expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400')
        expect(res.headers.has('Content-Security-Policy')).toBe(false)
      }
      const manifest = await call('/manifest.webmanifest', {}, false)
      expect(manifest.headers.get('Content-Type')).toBe('application/manifest+json')
      expect(manifest.headers.get('Cache-Control')).toBe('public, max-age=3600')
    })

    it('a listed file missing from the build (the shell answers) is denied, not served as app HTML', async () => {
      const shell = () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })
      const res = await call('/og-image.png', {}, false, shell)
      expect(res.status).toBe(401)
      expect(await res.text()).not.toBe('<!doctype html>')
      expect((await call('/_nuxt/entry.js', {}, false)).status).toBe(401)
    })
  })
})
