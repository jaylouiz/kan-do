import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/ping.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    delete process.env['NODE_ENV']
  })

  it('returns 404 in production environment', async () => {
    process.env['NODE_ENV'] = 'production'

    const handler = (await import('~/server/api/notion/ping.get')).default
    const app = createApp()
    app.use('/api/notion/ping', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/ping?token=test-token')
    expect(res.status).toBe(404)
  })

  it('returns 400 when token is missing in dev mode', async () => {
    process.env['NODE_ENV'] = 'development'

    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedPing: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/ping.get')).default
    const app = createApp()
    app.use('/api/notion/ping', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/ping')
    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toBe('MISSING_PARAMETERS')
  })

  it('returns stubbed data when stub mode is enabled', async () => {
    process.env['NODE_ENV'] = 'development'

    const stubbedPing = { ok: true, me: { name: 'Stub User' }, counts: {}, samples: {} }
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      getStubbedPing: vi.fn().mockReturnValue(stubbedPing),
    }))

    const handler = (await import('~/server/api/notion/ping.get')).default
    const app = createApp()
    app.use('/api/notion/ping', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/ping?token=test-token')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(stubbedPing)
  })

  it('returns ok:true with me and counts on successful ping', async () => {
    process.env['NODE_ENV'] = 'development'

    const mockMe = { object: 'user', id: 'user-1', name: 'Test User' }
    const requestSpy = vi.fn().mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'users/me') return mockMe
      if (path === 'search') return { results: [] }
      return {}
    })

    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedPing: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/ping.get')).default
    const app = createApp()
    app.use('/api/notion/ping', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/ping?token=test-token')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.me).toEqual(mockMe)
    expect(res.body.counts).toBeDefined()
    expect(res.body.samples).toBeDefined()
  })

  it('returns 502 when Notion API throws APIResponseError', async () => {
    process.env['NODE_ENV'] = 'development'

    const requestSpy = vi.fn().mockRejectedValue(
      Object.assign(new Error('Notion error'), { name: 'APIResponseError' }),
    )

    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedPing: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/ping.get')).default
    const app = createApp()
    app.use('/api/notion/ping', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/ping?token=test-token')
    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })
})
