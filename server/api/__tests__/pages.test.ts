// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

// Batch A: Tests for server/api/notion/pages.ts

describe('server/api/notion/pages.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('maps large dataset to expected {id,title} shape', async () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i+1}`,
      properties: { title: { title: [{ plain_text: `Page ${i+1}` }] } },
    }))
    const searchSpy = vi.fn().mockResolvedValue({ results })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { search: searchSpy } }),
    }))

    const handler = (await import('~/server/api/notion/pages')).default
    const app = createApp(); app.use('/api/notion/pages', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/pages?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(8)
    expect(res.body[0]).toEqual({ id: 'p1', title: 'Page 1' })
  })

  it('returns simplified pages array (happy path)', async () => {
    const searchSpy = vi.fn().mockResolvedValue({
      results: [
        { id: 'p1', properties: { title: { title: [{ plain_text: 'Alpha' }] } } },
        { id: 'p2', properties: { Name: { title: [{ plain_text: 'Beta' }] } } },
      ],
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { search: searchSpy } }),
    }))

    const handler = (await import('~/server/api/notion/pages')).default
    const app = createApp(); app.use('/api/notion/pages', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/pages?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'p1', title: 'Alpha' },
      { id: 'p2', title: 'Beta' },
    ])
    expect(searchSpy).toHaveBeenCalledWith({
      filter: { property: 'object', value: 'page' },
      page_size: 100,
    })
  })

  it('returns [] on empty results', async () => {
    const searchSpy = vi.fn().mockResolvedValue({ results: [] })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { search: searchSpy } }),
    }))

    const handler = (await import('~/server/api/notion/pages')).default
    const app = createApp(); app.use('/api/notion/pages', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/pages?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns 400 when token missing', async () => {
    const handler = (await import('~/server/api/notion/pages')).default
    const app = createApp(); app.use('/api/notion/pages', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/pages')
    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toBe('MISSING_PARAMETERS')
  })

  it('returns 502 when Notion API throws APIResponseError', async () => {
    const searchSpy = vi.fn().mockRejectedValue(Object.assign(new Error('fail'), { name: 'APIResponseError' }))
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { search: searchSpy } }),
    }))

    const handler = (await import('~/server/api/notion/pages')).default
    const app = createApp(); app.use('/api/notion/pages', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/pages?token=tkn')
    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })
})
