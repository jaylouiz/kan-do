import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/data-sources.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.doUnmock('@notionhq/client')
    vi.doUnmock('~/server/utils/notionStub')
  })

  const buildRequest = async () => {
    const handler = (await import('~/server/api/notion/data-sources.get')).default
    const app = createApp()
    app.use('/api/notion/data-sources', handler)
    return supertest(toNodeListener(app))
  }

  const mockClient = (notionRequest: ReturnType<typeof vi.fn>) => {
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return { request: notionRequest }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDataSources: vi.fn(),
      getStubbedDataSource: vi.fn(),
    }))
  }

  it('returns 400 when the token is missing', async () => {
    mockClient(vi.fn())
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources?id=ds-1')
    expect(res.status).toBe(400)
  })

  it('retrieves one data source with its properties when id is given', async () => {
    const dataSource = {
      object: 'data_source',
      id: 'ds-1',
      title: [{ plain_text: 'Heute' }],
      parent: { type: 'database_id', database_id: 'db-1' },
      properties: { Status: { id: 's', name: 'Status', type: 'select' } },
    }
    const notionRequest = vi.fn().mockResolvedValue(dataSource)
    mockClient(notionRequest)
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources?token=test-token&id=ds-1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(dataSource)
    expect(notionRequest).toHaveBeenCalledTimes(1)
    expect(notionRequest).toHaveBeenCalledWith({ method: 'get', path: 'data_sources/ds-1' })
  })

  it('accepts the token from the Authorization header', async () => {
    const notionRequest = vi.fn().mockResolvedValue({ id: 'ds-1', properties: {} })
    mockClient(notionRequest)
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources?id=ds-1').set('Authorization', 'Bearer test-token')
    expect(res.status).toBe(200)
  })

  it.each([
    [401, 'UNAUTHORIZED'],
    [429, 'RATE_LIMITED'],
    [404, 'NOTION_API_ERROR'],
  ])('surfaces a Notion %i error for an id lookup as %s', async (status, code) => {
    const notionRequest = vi.fn().mockRejectedValue(
      Object.assign(new Error('boom'), { name: 'APIResponseError', status, code: 'object_not_found' }),
    )
    mockClient(notionRequest)
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources?token=test-token&id=missing')
    expect(res.status).toBe(status)
    expect(res.body.data?.error).toBe(code)
  })

  it('keeps returning the normalized list when id is absent', async () => {
    const notionRequest = vi.fn().mockResolvedValue({
      results: [{ object: 'data_source', id: 'ds-1', name: 'Heute', location: { type: 'database_id', database_id: 'db-1' } }],
    })
    mockClient(notionRequest)
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources?token=test-token')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'ds-1', name: 'Heute', location: { type: 'database_id', database_id: 'db-1' } },
    ])
    expect(notionRequest).toHaveBeenCalledWith(expect.objectContaining({ path: 'search', method: 'post' }))
  })

  it('returns the stubbed data source with properties for an id in stub mode', async () => {
    const clientCtor = vi.fn()
    vi.doMock('@notionhq/client', () => ({ Client: clientCtor }))
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources?id=ds-123').set('Authorization', 'Bearer notion_test_stub')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('ds-123')
    expect(res.body.parent.database_id).toBe('db-123')
    expect(Object.keys(res.body.properties)).toContain('Status')
    expect(clientCtor).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown stub data source id (Notion error mapping)', async () => {
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources?id=nope').set('Authorization', 'Bearer notion_test_stub')
    expect(res.status).toBe(404)
  })

  it('keeps returning the stubbed list without id', async () => {
    const request = await buildRequest()

    const res = await request.get('/api/notion/data-sources').set('Authorization', 'Bearer notion_test_stub')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'ds-123', name: 'Heute', location: { type: 'database_id', database_id: 'db-123' } },
    ])
  })
})
