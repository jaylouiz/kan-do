import type { Agent } from 'supertest'

/**
 * `fetch` stand-in for contract tests: forwards the relative `/api/notion/...` requests the
 * browser-mode `NotionClientAPI` / `NotionIntegration` send to a supertest app that mounts the
 * unmocked proxy routes. Pair with `vi.stubGlobal('fetch', proxyFetch(request))` so the client
 * code (pagination loop, `getProxyUrl` / `getProxyOptions` mapping) runs end to end against
 * the real routes and real Notion, which hand-written route bodies cannot cover.
 *
 * The stub replaces the global `fetch` the server routes' `@notionhq/client` uses too, so call
 * `proxyFetch` BEFORE stubbing: it captures the real `fetch` then and hands every absolute URL
 * (the route's own outbound Notion call) to it. Only relative `/api/` URLs go to supertest.
 */
export const proxyFetch = (request: Agent, passthrough: typeof fetch = globalThis.fetch): typeof fetch =>
  (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (!url.startsWith('/api/')) {
      if (/^https?:\/\//.test(url)) return passthrough(input, init)
      throw new Error(`proxyFetch only serves relative /api/ URLs, got ${url}`)
    }

    const method = (init.method ?? 'GET').toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'
    let pending = request[method](url)
    for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      pending = pending.set(name, value)
    }
    if (typeof init.body === 'string') pending = pending.send(JSON.parse(init.body))

    const res = await pending
    return new Response(res.text, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
