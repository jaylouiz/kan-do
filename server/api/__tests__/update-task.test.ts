// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/update-task.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('updates page and returns success true (happy path)', async () => {
    const pagesUpdate = vi.fn().mockResolvedValue({})
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))

    const handler = (await import('~/server/api/notion/update-task')).default
    const app = createApp(); app.use('/api/notion/update-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .patch('/api/notion/update-task')
      .set('Authorization', 'Bearer tkn')
      .send({ pageId: 'p1', properties: { Status: { select: { name: 'Doing' } } } })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(pagesUpdate).toHaveBeenCalledWith(expect.objectContaining({ page_id: 'p1' }))
  })

  it('returns 500 when required parameters are missing', async () => {
    const handler = (await import('~/server/api/notion/update-task')).default
    const app = createApp(); app.use('/api/notion/update-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.patch('/api/notion/update-task').send({})
    expect(res.status).toBe(500)
    expect(res.body?.data?.error).toBe('UNKNOWN_ERROR')
  })

  it('returns 502 on Notion API error', async () => {
    const pagesUpdate = vi.fn().mockRejectedValue(Object.assign(new Error('fail'), { name: 'APIResponseError' }))
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))

    const handler = (await import('~/server/api/notion/update-task')).default
    const app = createApp(); app.use('/api/notion/update-task', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .patch('/api/notion/update-task')
      .set('Authorization', 'Bearer tkn')
      .send({ pageId: 'p1', properties: { Status: { select: { name: 'Doing' } } } })

    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })
})
