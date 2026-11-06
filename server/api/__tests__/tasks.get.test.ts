// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/tasks.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns results from Notion query (happy path)', async () => {
    const mockResults = [{ id: 'a' }, { id: 'b' }]
    const requestSpy = vi.fn().mockResolvedValue({ results: mockResults })
    await vi.resetModules()
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/tasks.get')).default
    const app = createApp(); app.use('/api/notion/tasks', handler)
    const req = supertest(toNodeListener(app))

    const propertyMapping = encodeURIComponent(JSON.stringify({ title: 'Name', status: 'Status' }))
    const statusMapping = encodeURIComponent(JSON.stringify({ today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting' }))

    const res = await req.get(`/api/notion/tasks?token=tkn&databaseId=db1&dataSourceId=ds1&propertyMapping=${propertyMapping}&statusMapping=${statusMapping}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(mockResults)
    expect(requestSpy).toHaveBeenCalledTimes(1)
    expect(requestSpy.mock.calls[0]![0]).toMatchObject({
      method: 'post',
      path: 'data_sources/ds1/query',
    })
  })

  it('returns 400 when propertyMapping/statusMapping invalid JSON', async () => {
    const handler = (await import('~/server/api/notion/tasks.get')).default
    const app = createApp(); app.use('/api/notion/tasks', handler)
    const request = supertest(toNodeListener(app))
    const res = await request.get('/api/notion/tasks')
      .query({ token: 'tkn', databaseId: 'db1', dataSourceId: 'ds1', propertyMapping: 'not-json', statusMapping: '{}' })
    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toBe('INVALID_JSON')
  })

  it('returns 502 when Notion API throws APIResponseError', async () => {
    const requestSpy = vi.fn().mockRejectedValue(Object.assign(new Error('fail'), { name: 'APIResponseError' }))
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))
    const handler = (await import('~/server/api/notion/tasks.get')).default
    const app = createApp(); app.use('/api/notion/tasks', handler)
    const req = supertest(toNodeListener(app))

    const propertyMapping = encodeURIComponent(JSON.stringify({ title: 'Name', status: 'Status' }))
    const statusMapping = encodeURIComponent(JSON.stringify({ today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting' }))

    const res = await req.get(`/api/notion/tasks?token=tkn&databaseId=db1&dataSourceId=ds1&propertyMapping=${propertyMapping}&statusMapping=${statusMapping}`)
    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })

  it('adds waiting filter only when provided', async () => {
    const spyCalls: any[] = []
    const requestSpy = vi.fn().mockImplementation((args: any) => {
      spyCalls.push(args)
      return Promise.resolve({ results: [] })
    })
    await vi.resetModules()
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))
    const handler = (await import('~/server/api/notion/tasks.get')).default
    const app = createApp(); app.use('/api/notion/tasks', handler)
    const req = supertest(toNodeListener(app))

    const pm = encodeURIComponent(JSON.stringify({ status: 'Status' }))

    // Without waiting
    let sm = encodeURIComponent(JSON.stringify({ today: 'Today', doing: 'Doing', done: 'Done' }))
    await req.get(`/api/notion/tasks?token=tkn&databaseId=db1&dataSourceId=ds1&propertyMapping=${pm}&statusMapping=${sm}`)
    const firstCall = spyCalls.pop()
    expect(firstCall).toBeDefined()
    expect(firstCall.body.filter.or).toHaveLength(3)

    // With waiting
    sm = encodeURIComponent(JSON.stringify({ today: 'Today', doing: 'Doing', done: 'Done', waiting: 'Waiting' }))
    await req.get(`/api/notion/tasks?token=tkn&databaseId=db1&dataSourceId=ds1&propertyMapping=${pm}&statusMapping=${sm}`)
    const secondCall = spyCalls.pop()
    expect(secondCall).toBeDefined()
    expect(secondCall.body.filter.or).toHaveLength(4)
    expect(secondCall.path).toBe('data_sources/ds1/query')
  })
})
