import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/query-data-source.post.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns 400 when the Authorization header is missing', async () => {
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      queryStubPages: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/query-data-source.post')).default
    const app = createApp()
    app.use('/api/notion/query-data-source', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.post('/api/notion/query-data-source').send({ dataSourceId: 'ds-123' })
    expect(res.status).toBe(400)
  })

  it('returns stubbed pages in Notion query-response shape when stub mode is enabled', async () => {
    const pages = [{ id: 'page-1', properties: {} }]
    const queryStubPages = vi.fn().mockReturnValue({ results: pages, has_more: true, next_cursor: 'stub-cursor:1' })
    const clientCtor = vi.fn()
    vi.doMock('@notionhq/client', () => ({ Client: clientCtor }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      assertStubStatusShape: vi.fn(),
      queryStubPages,
    }))

    const handler = (await import('~/server/api/notion/query-data-source.post')).default
    const app = createApp()
    app.use('/api/notion/query-data-source', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/query-data-source')
      .set('Authorization', 'Bearer notion_test_stub')
      .send({ dataSourceId: 'ds-123', page_size: 25, start_cursor: 'stub-cursor:0' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ object: 'list', results: pages, has_more: true, next_cursor: 'stub-cursor:1' })
    expect(queryStubPages).toHaveBeenCalledWith('notion_test_stub', { pageSize: 25, startCursor: 'stub-cursor:0' })
    expect(clientCtor).not.toHaveBeenCalled()
  })

  it('forwards the query to Notion when stub mode is disabled', async () => {
    const notionRequest = vi.fn().mockResolvedValue({ object: 'list', results: [], has_more: false })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return { request: notionRequest }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      queryStubPages: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/query-data-source.post')).default
    const app = createApp()
    app.use('/api/notion/query-data-source', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/query-data-source')
      .set('Authorization', 'Bearer real-token')
      .send({ dataSourceId: 'ds-123', page_size: 50 })
    expect(res.status).toBe(200)
    expect(notionRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      path: 'data_sources/ds-123/query',
      body: expect.objectContaining({ page_size: 50 }),
    }))
  })
  const forwardedBody = async (sent: Record<string, unknown>) => {
    const notionRequest = vi.fn().mockResolvedValue({
      object: 'list',
      results: [{ id: 'p1' }],
      has_more: true,
      next_cursor: 'notion-cursor-2',
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return { request: notionRequest }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      queryStubPages: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/query-data-source.post')).default
    const app = createApp()
    app.use('/api/notion/query-data-source', handler)
    const res = await supertest(toNodeListener(app))
      .post('/api/notion/query-data-source')
      .set('Authorization', 'Bearer real-token')
      .send({ dataSourceId: 'ds-123', ...sent })
    return { res, body: notionRequest.mock.calls[0]?.[0].body as Record<string, unknown> }
  }

  it('forwards start_cursor to Notion and returns has_more / next_cursor unchanged', async () => {
    const { res, body } = await forwardedBody({ page_size: 100, start_cursor: 'notion-cursor-1' })
    expect(body).toMatchObject({ page_size: 100, start_cursor: 'notion-cursor-1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      object: 'list',
      results: [{ id: 'p1' }],
      has_more: true,
      next_cursor: 'notion-cursor-2',
    })
  })

  it('leaves start_cursor out of the Notion body when it is not set', async () => {
    const { body } = await forwardedBody({ page_size: 100 })
    expect(body).not.toHaveProperty('start_cursor')
  })
})