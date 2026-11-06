// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

async function makeRequest() {
  const handler = (await import('~/server/api/notion/unarchive-page.post')).default
  const app = createApp(); app.use('/api/notion/unarchive-page', handler)
  return supertest(toNodeListener(app))
}

describe('server/api/notion/unarchive-page.post.ts (#422)', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('takes the page out of the trash (happy path)', async () => {
    const pagesUpdate = vi.fn().mockResolvedValue({})
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { pages: { update: pagesUpdate } } }),
    }))
    vi.stubEnv('E2E_NOTION_STUB', '0')

    const res = await (await makeRequest())
      .post('/api/notion/unarchive-page')
      .set('Authorization', 'Bearer tkn')
      .send({ pageId: 'p1' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, pageId: 'p1', archived: false })
    expect(pagesUpdate).toHaveBeenCalledWith({ page_id: 'p1', archived: false })
  })

  it('stub: archive, then un-archive brings the page back into the data-source query', async () => {
    vi.stubEnv('E2E_NOTION_STUB', '1')
    const stub = await import('~/server/utils/notionStub')
    const token = 'notion_test_stub:unarchive-spec'
    const created = stub.createStubPage(token, { Name: { title: [{ text: { content: 'Zurück' } }] } })
    stub.archiveStubPage(token, created.id)
    expect(stub.queryStubPages(token).results.map(page => page.id)).not.toContain(created.id)

    const res = await (await makeRequest())
      .post('/api/notion/unarchive-page')
      .set('Authorization', `Bearer ${token}`)
      .send({ pageId: created.id })

    expect(res.status).toBe(200)
    expect(stub.queryStubPages(token).results.map(page => page.id)).toContain(created.id)
  })

  it('stub: a page the stub does not have answers 404 (the client then creates a new page)', async () => {
    vi.stubEnv('E2E_NOTION_STUB', '1')
    const res = await (await makeRequest())
      .post('/api/notion/unarchive-page')
      .set('Authorization', 'Bearer notion_test_stub:unarchive-gone')
      .send({ pageId: 'gone' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when pageId or token is missing', async () => {
    const res = await (await makeRequest()).post('/api/notion/unarchive-page').send({})
    expect(res.status).toBe(400)
  })
})
