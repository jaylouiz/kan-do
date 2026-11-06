import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/create-task.post.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('creates a Notion page and returns success (happy path)', async () => {
    const mockPage = { id: 'page-abc', object: 'page' }
    const pagesCreate = vi.fn().mockResolvedValue(mockPage)
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { create: pagesCreate } } }),
    }))

    const handler = (await import('~/server/api/notion/create-task.post')).default
    const app = createApp()
    app.use('/api/notion/create-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/create-task')
      .set('Authorization', 'Bearer test-token')
      .send({
        databaseId: 'db-123',
        properties: { Name: { title: [{ text: { content: 'My Task' } }] } },
      })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, pageId: 'page-abc', page: mockPage })
    expect(pagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { database_id: 'db-123' },
        properties: { Name: { title: [{ text: { content: 'My Task' } }] } },
      }),
    )
  })

  it('returns 400 when token is missing', async () => {
    const handler = (await import('~/server/api/notion/create-task.post')).default
    const app = createApp()
    app.use('/api/notion/create-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/create-task')
      .send({ databaseId: 'db-123', properties: {} })

    expect(res.status).toBe(400)
  })

  it('returns 400 when databaseId is missing', async () => {
    const handler = (await import('~/server/api/notion/create-task.post')).default
    const app = createApp()
    app.use('/api/notion/create-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/create-task')
      .set('Authorization', 'Bearer test-token')
      .send({ properties: {} })

    expect(res.status).toBe(400)
  })

  it('returns 400 when properties are missing', async () => {
    const handler = (await import('~/server/api/notion/create-task.post')).default
    const app = createApp()
    app.use('/api/notion/create-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/create-task')
      .set('Authorization', 'Bearer test-token')
      .send({ databaseId: 'db-123' })

    expect(res.status).toBe(400)
  })

  it('returns 502 when Notion API throws APIResponseError', async () => {
    const pagesCreate = vi.fn().mockRejectedValue(
      Object.assign(new Error('Notion API error'), { name: 'APIResponseError' }),
    )
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { create: pagesCreate } } }),
    }))

    const handler = (await import('~/server/api/notion/create-task.post')).default
    const app = createApp()
    app.use('/api/notion/create-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/create-task')
      .set('Authorization', 'Bearer test-token')
      .send({ databaseId: 'db-123', properties: {} })

    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })

  it.each([
    [400, 'validation_error', 'Bad Request'],
    [403, 'restricted_resource', 'Forbidden'],
    [404, 'object_not_found', 'Not Found'],
    [409, 'conflict_error', 'Conflict'],
  ])('passes a Notion %i refusal through with its status (#321: the add form keeps the draft)', async (status, code, statusMessage) => {
    const pagesCreate = vi.fn().mockRejectedValue(
      Object.assign(new Error('Notion refused'), { name: 'APIResponseError', status, code }),
    )
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { create: pagesCreate } } }),
    }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const handler = (await import('~/server/api/notion/create-task.post')).default
    const app = createApp()
    app.use('/api/notion/create-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/create-task')
      .set('Authorization', 'Bearer test-token')
      .send({ databaseId: 'db-123', properties: { Name: { title: [] } } })

    expect(res.status).toBe(status)
    expect(res.body?.statusMessage).toBe(statusMessage)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })

  it('a stub token with create-fail=<status> fails only the create, with the production mapping', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = (await import('~/server/api/notion/create-task.post')).default
    const app = createApp()
    app.use('/api/notion/create-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .post('/api/notion/create-task')
      .set('Authorization', 'Bearer notion_test_stub:create-fail=400:s1')
      .send({ databaseId: 'db-123', properties: { Name: { title: [] } } })

    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })
})
