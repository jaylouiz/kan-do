// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

async function makeRequest() {
  const handler = (await import('~/server/api/notion/archive-page.post')).default
  const app = createApp(); app.use('/api/notion/archive-page', handler)
  return supertest(toNodeListener(app))
}

describe('server/api/notion/archive-page.post.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('archives the page and returns success (happy path)', async () => {
    const pagesUpdate = vi.fn().mockResolvedValue({})
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))
    vi.stubEnv('E2E_NOTION_STUB', '0')

    const res = await (await makeRequest())
      .post('/api/notion/archive-page')
      .set('Authorization', 'Bearer tkn')
      .send({ pageId: 'p1' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, pageId: 'p1', archived: true })
    expect(pagesUpdate).toHaveBeenCalledWith({ page_id: 'p1', archived: true })
  })

  it('stub: an archived page leaves the data-source query but can still be retrieved (#322)', async () => {
    vi.stubEnv('E2E_NOTION_STUB', '1')
    const stub = await import('~/server/utils/notionStub')
    const token = 'notion_test_stub:archive-spec'
    const created = stub.createStubPage(token, { Name: { title: [{ text: { content: 'Weg' } }] } })
    expect(stub.queryStubPages(token).results.map(page => page.id)).toContain(created.id)

    const res = await (await makeRequest())
      .post('/api/notion/archive-page')
      .set('Authorization', `Bearer ${token}`)
      .send({ pageId: created.id })

    expect(res.status).toBe(200)
    expect(stub.queryStubPages(token).results.map(page => page.id)).not.toContain(created.id)
    expect(stub.getStubPage(token, created.id).archived).toBe(true)
  })

  it('returns 400 when pageId or token is missing', async () => {
    const res = await (await makeRequest()).post('/api/notion/archive-page').send({})
    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toBe('BAD_REQUEST')
  })

  it.each([
    ['a number', { pageId: 42 }],
    ['an empty string', { pageId: '   ' }],
    ['an object', { pageId: { id: 'p1' } }],
  ])('returns 400 when pageId is %s', async (_label, body) => {
    const pagesUpdate = vi.fn()
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))
    const res = await (await makeRequest())
      .post('/api/notion/archive-page')
      .set('Authorization', 'Bearer tkn')
      .send(body)
    expect(res.status).toBe(400)
    expect(pagesUpdate).not.toHaveBeenCalled()
  })

  it('returns 502 on Notion API error', async () => {
    const pagesUpdate = vi.fn().mockRejectedValue(Object.assign(new Error('fail'), { name: 'APIResponseError' }))
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))
    vi.stubEnv('E2E_NOTION_STUB', '0')

    const res = await (await makeRequest())
      .post('/api/notion/archive-page')
      .set('Authorization', 'Bearer tkn')
      .send({ pageId: 'p1' })

    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })

  it('does not call Notion when the stub token is used', async () => {
    const pagesUpdate = vi.fn()
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))

    const res = await (await makeRequest())
      .post('/api/notion/archive-page')
      .set('Authorization', 'Bearer notion_test_stub')
      .send({ pageId: 'p1' })

    expect(res.status).toBe(200)
    expect(pagesUpdate).not.toHaveBeenCalled()
  })
})
