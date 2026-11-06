// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from 'supertest'
import { proxyFetch } from '../contract/helpers/proxyFetch'

describe('proxyFetch', () => {
  it('delegates absolute URLs to the captured original fetch', async () => {
    const original = vi.fn(async () => new Response('{"ok":true}'))
    const post = vi.fn()
    const bridge = proxyFetch({ post } as unknown as Agent, original as unknown as typeof fetch)

    const res = await bridge('https://api.notion.com/v1/data_sources/x/query', { method: 'POST' })

    expect(original).toHaveBeenCalledWith('https://api.notion.com/v1/data_sources/x/query', { method: 'POST' })
    expect(post).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ ok: true })
  })

  it('serves relative /api/ URLs through supertest', async () => {
    const original = vi.fn()
    const send = vi.fn(async () => ({ text: '{"results":[]}', status: 200 }))
    const post = vi.fn(() => ({ set: vi.fn(), send }))
    const bridge = proxyFetch({ post } as unknown as Agent, original as unknown as typeof fetch)

    const res = await bridge('/api/notion/query-data-source', { method: 'POST', body: '{"a":1}' })

    expect(post).toHaveBeenCalledWith('/api/notion/query-data-source')
    expect(send).toHaveBeenCalledWith({ a: 1 })
    expect(original).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })
})
