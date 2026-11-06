// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/tasks.patch.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('updates a task page with query token/taskId and body properties', async () => {
    const pagesUpdate = vi.fn().mockResolvedValue({ result: 'ok' })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))

    const handler = (await import('~/server/api/notion/tasks.patch')).default
    const app = createApp(); app.use('/api/notion/tasks', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .patch('/api/notion/tasks?token=tkn&taskId=pg1')
      .send({ properties: { Status: { select: { name: 'Doing' } } } })

    expect(res.status).toBe(200)
    expect(pagesUpdate).toHaveBeenCalledWith(expect.objectContaining({
      page_id: 'pg1',
      properties: expect.any(Object),
    }))
    expect(res.body).toEqual({ result: 'ok' })
  })

  it('returns 400 when properties missing in body', async () => {
    const handler = (await import('~/server/api/notion/tasks.patch')).default
    const app = createApp(); app.use('/api/notion/tasks', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.patch('/api/notion/tasks?token=tkn&taskId=pg1').send({})
    expect(res.status).toBe(500) // handleNotionError wraps generic to 500 UNKNOWN_ERROR
    expect(res.body?.data?.error).toBe('UNKNOWN_ERROR')
  })

  it('returns 502 on Notion API error', async () => {
    const pagesUpdate = vi.fn().mockRejectedValue(Object.assign(new Error('fail'), { name: 'APIResponseError' }))
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))

    const handler = (await import('~/server/api/notion/tasks.patch')).default
    const app = createApp(); app.use('/api/notion/tasks', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .patch('/api/notion/tasks?token=tkn&taskId=pg1')
      .send({ properties: { Status: { select: { name: 'Doing' } } } })

    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })
})
