// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

/**
 * Exercises the real (unmocked) Notion stub through the proxy routes:
 * a page write must be visible to a subsequent page read and data-source query,
 * and state must be isolated per stub token.
 */
describe('Notion stub page state', () => {
  const STUB = 'notion_test_stub'

  const buildApp = async () => {
    const pages = (await import('~/server/api/notion/pages')).default
    const updateTask = (await import('~/server/api/notion/update-task')).default
    const tasksPatch = (await import('~/server/api/notion/tasks.patch')).default
    const query = (await import('~/server/api/notion/query-data-source.post')).default
    const createTask = (await import('~/server/api/notion/create-task.post')).default
    const stubFailure = (await import('~/server/middleware/notion-stub-failure')).default
    const app = createApp()
    app.use(stubFailure)
    app.use('/api/notion/create-task', createTask)
    app.use('/api/notion/pages', pages)
    app.use('/api/notion/update-task', updateTask)
    app.use('/api/notion/tasks', tasksPatch)
    app.use('/api/notion/query-data-source', query)
    return supertest(toNodeListener(app))
  }

  beforeEach(async () => {
    const { resetNotionStubState } = await import('~/server/utils/notionStub')
    resetNotionStubState()
  })

  afterEach(() => {
    vi.resetModules()
  })

  const statusOf = (page: { properties?: Record<string, { select?: { name?: string } }> }) =>
    page.properties?.['Status']?.select?.name

  it('returns the fixture page for a single-page retrieve', async () => {
    const request = await buildApp()
    const res = await request.get('/api/notion/pages?pageId=page-1').set('Authorization', `Bearer ${STUB}`)
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('page-1')
    expect(statusOf(res.body)).toBe('Today')
  })

  it('reflects an update-task status write in subsequent retrieve and query', async () => {
    const request = await buildApp()
    const write = await request
      .patch('/api/notion/update-task')
      .set('Authorization', `Bearer ${STUB}`)
      .send({ pageId: 'page-1', properties: { Status: { select: { name: 'Doing' } } } })
    expect(write.status).toBe(200)

    const read = await request.get('/api/notion/pages?pageId=page-1').set('Authorization', `Bearer ${STUB}`)
    expect(statusOf(read.body)).toBe('Doing')
    // untouched properties survive the merge
    expect(read.body.properties.Name.title[0].plain_text).toBe('Fokusaufgabe vorbereiten')

    const list = await request
      .post('/api/notion/query-data-source')
      .set('Authorization', `Bearer ${STUB}`)
      .send({ dataSourceId: 'ds-123' })
    const page1 = list.body.results.find((p: { id: string }) => p.id === 'page-1')
    expect(statusOf(page1)).toBe('Doing')
  })

  it('reflects a tasks PATCH write in a subsequent retrieve', async () => {
    const request = await buildApp()
    await request
      .patch(`/api/notion/tasks?token=${STUB}&taskId=page-2`)
      .send({ properties: { Status: { select: { name: 'Done' } } } })
    const read = await request.get(`/api/notion/pages?token=${STUB}&pageId=page-2`)
    expect(statusOf(read.body)).toBe('Done')
  })

  it('keeps written pages for ids that are not in the fixture', async () => {
    const request = await buildApp()
    await request
      .patch('/api/notion/update-task')
      .set('Authorization', `Bearer ${STUB}`)
      .send({ pageId: 'seed-open-1', properties: { Status: { select: { name: 'Waiting' } } } })
    const read = await request.get('/api/notion/pages?pageId=seed-open-1').set('Authorization', `Bearer ${STUB}`)
    expect(read.body.id).toBe('seed-open-1')
    expect(statusOf(read.body)).toBe('Waiting')
  })

  it('isolates state per stub token (notion_test_stub:<session>)', async () => {
    const request = await buildApp()
    const tokenA = `${STUB}:session-a`
    const tokenB = `${STUB}:session-b`
    await request
      .patch('/api/notion/update-task')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ pageId: 'page-1', properties: { Status: { select: { name: 'Done' } } } })

    const readA = await request.get('/api/notion/pages?pageId=page-1').set('Authorization', `Bearer ${tokenA}`)
    const readB = await request.get('/api/notion/pages?pageId=page-1').set('Authorization', `Bearer ${tokenB}`)
    const readPlain = await request.get('/api/notion/pages?pageId=page-1').set('Authorization', `Bearer ${STUB}`)
    expect(statusOf(readA.body)).toBe('Done')
    expect(statusOf(readB.body)).toBe('Today')
    expect(statusOf(readPlain.body)).toBe('Today')
  })

  it('stores a created page so a later query returns it', async () => {
    const request = await buildApp()
    const created = await request
      .post('/api/notion/create-task')
      .set('Authorization', `Bearer ${STUB}`)
      .send({
        databaseId: 'db-123',
        properties: { Name: { title: [{ plain_text: 'Neu' }] }, Status: { select: { name: 'Today' } } },
      })
    expect(created.status).toBe(200)
    expect(created.body.success).toBe(true)
    expect(created.body.page.id).toBe(created.body.pageId)

    const list = await request
      .post('/api/notion/query-data-source')
      .set('Authorization', `Bearer ${STUB}`)
      .send({ dataSourceId: 'ds-123' })
    const page = list.body.results.find((p: { id: string }) => p.id === created.body.pageId)
    expect(statusOf(page)).toBe('Today')
  })

  it('returns a written title as Notion does (plain_text), so a refresh keeps the title of a created page (#321)', async () => {
    const request = await buildApp()
    const created = await request
      .post('/api/notion/create-task')
      .set('Authorization', `Bearer ${STUB}`)
      .send({
        databaseId: 'db-123',
        properties: { Name: { title: [{ text: { content: 'Angelegt' } }] }, Status: { select: { name: 'Today' } } },
      })
    const list = await request
      .post('/api/notion/query-data-source')
      .set('Authorization', `Bearer ${STUB}`)
      .send({ dataSourceId: 'ds-123' })
    const page = list.body.results.find((p: { id: string }) => p.id === created.body.pageId)
    expect(page.properties.Name.title[0].plain_text).toBe('Angelegt')
  })

  it.each([
    [401, 401, 'UNAUTHORIZED'],
    [429, 429, 'RATE_LIMITED'],
    [404, 404, 'NOTION_API_ERROR'],
  ])('fails every route for a fail=%i stub token (%i %s)', async (fail, status, code) => {
    const request = await buildApp()
    const token = `${STUB}:fail=${fail}:session-x`
    const read = await request.get('/api/notion/pages?pageId=page-1').set('Authorization', `Bearer ${token}`)
    const write = await request.patch(`/api/notion/tasks?token=${token}&taskId=page-1`).send({ properties: {} })
    for (const res of [read, write]) {
      expect(res.status).toBe(status)
      expect(res.body.data.error).toBe(code)
    }
  })

  it('leaves a plain stub token alone', async () => {
    const request = await buildApp()
    const res = await request.get('/api/notion/pages?pageId=page-1').set('Authorization', `Bearer ${STUB}:fail-free`)
    expect(res.status).toBe(200)
  })

  describe('query paging', () => {
    const query = async (
      request: Awaited<ReturnType<typeof buildApp>>,
      token: string,
      body: Record<string, unknown> = {},
    ) =>
      request
        .post('/api/notion/query-data-source')
        .set('Authorization', `Bearer ${token}`)
        .send({ dataSourceId: 'ds-123', ...body })

    it('pads the session to n pages with a pages=<n> token and pages by page_size', async () => {
      const request = await buildApp()
      const token = `${STUB}:pages=250:paging`

      const first = await query(request, token, { page_size: 100 })
      expect(first.body.results).toHaveLength(100)
      expect(first.body.has_more).toBe(true)
      expect(typeof first.body.next_cursor).toBe('string')

      const second = await query(request, token, { page_size: 100, start_cursor: first.body.next_cursor })
      expect(second.body.results).toHaveLength(100)
      expect(second.body.has_more).toBe(true)

      const third = await query(request, token, { page_size: 100, start_cursor: second.body.next_cursor })
      expect(third.body.results).toHaveLength(50)
      expect(third.body.has_more).toBe(false)
      expect(third.body.next_cursor).toBeNull()

      const ids = [first, second, third].flatMap((res) => res.body.results.map((p: { id: string }) => p.id))
      expect(ids).toHaveLength(250)
      expect(new Set(ids).size).toBe(250)
      expect(ids).toContain('page-1')
      expect(ids).toContain('stub-filler-246')
    })

    it('builds filler pages as Today tasks with a numbered title', async () => {
      const request = await buildApp()
      const res = await query(request, `${STUB}:pages=10:filler`, { page_size: 100 })
      const filler = res.body.results.find((p: { id: string }) => p.id === 'stub-filler-001')
      expect(statusOf(filler)).toBe('Today')
      expect(filler.properties.Name.title[0].plain_text).toBe('Füllaufgabe 001')
    })

    it('defaults to 100 per page and caps larger page sizes at 100', async () => {
      const request = await buildApp()
      const token = `${STUB}:pages=130:cap`
      expect((await query(request, token)).body.results).toHaveLength(100)
      expect((await query(request, token, { page_size: 500 })).body.results).toHaveLength(100)
    })

    it('returns everything in one page without has_more for the plain stub token', async () => {
      const request = await buildApp()
      const res = await query(request, STUB)
      expect(res.body.results).toHaveLength(4)
      expect(res.body).toMatchObject({ object: 'list', has_more: false, next_cursor: null })
    })

    it('keeps writes visible across pages', async () => {
      const request = await buildApp()
      const token = `${STUB}:pages=120:writes`
      await request
        .patch('/api/notion/update-task')
        .set('Authorization', `Bearer ${token}`)
        .send({ pageId: 'stub-filler-110', properties: { Status: { select: { name: 'Done' } } } })
      const first = await query(request, token, { page_size: 100 })
      const second = await query(request, token, { page_size: 100, start_cursor: first.body.next_cursor })
      const page = second.body.results.find((p: { id: string }) => p.id === 'stub-filler-110')
      expect(statusOf(page)).toBe('Done')
    })

    it('rejects a cursor the stub did not hand out', async () => {
      const request = await buildApp()
      const res = await query(request, `${STUB}:pages=130:bad`, { start_cursor: 'not-a-cursor' })
      expect(res.status).toBe(400)
    })

    it('caps pages=<n> at 2000', async () => {
      const { getStubPages } = await import('~/server/utils/notionStub')
      expect(getStubPages(`${STUB}:pages=999999:cap`)).toHaveLength(2000)
    })
  })

  describe('getStubbedDataSource', () => {
    it('describes the data source with the database schema as properties', async () => {
      const { getStubbedDataSource } = await import('~/server/utils/notionStub')
      const dataSource = getStubbedDataSource('ds-123')
      expect(dataSource).toMatchObject({
        object: 'data_source',
        id: 'ds-123',
        title: [{ plain_text: 'Heute' }],
        parent: { type: 'database_id', database_id: 'db-123' },
      })
      expect(Object.keys(dataSource.properties)).toEqual(expect.arrayContaining(['Name', 'Status']))
    })

    it('hands out a copy that cannot corrupt the fixture', async () => {
      const { getStubbedDataSource } = await import('~/server/utils/notionStub')
      getStubbedDataSource('ds-123').properties['Injected'] = {}
      expect(getStubbedDataSource('ds-123').properties).not.toHaveProperty('Injected')
    })

    it('fails with a 404 for an unknown id', async () => {
      const { getStubbedDataSource } = await import('~/server/utils/notionStub')
      expect(() => getStubbedDataSource('nope')).toThrow(expect.objectContaining({ name: 'APIResponseError', status: 404 }))
    })
  })

  describe('native Status property (status=native, #312)', () => {
    const NATIVE = `${STUB}:status=native:s1`
    const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
    const selectFilter = { or: [{ property: 'Status', select: { equals: 'Today' } }] }
    const statusFilter = { or: [{ property: 'Status', status: { equals: 'Today' } }] }

    it('serves a select Status schema by default and a native one for status=native', async () => {
      const { getStubbedDataSource } = await import('~/server/utils/notionStub')
      expect((getStubbedDataSource('ds-123').properties['Status'] as { type: string }).type).toBe('select')
      expect((getStubbedDataSource('ds-123', STUB).properties['Status'] as { type: string }).type).toBe('select')
      const native = getStubbedDataSource('ds-123', NATIVE).properties['Status'] as { type: string; status: { options: Array<{ name: string }> } }
      expect(native.type).toBe('status')
      expect(native.status.options.map((option) => option.name)).toEqual(['Today', 'Doing', 'Waiting', 'Done'])
    })

    it('serves native Status pages, including filler pages', async () => {
      const request = await buildApp()
      const page = await request.get('/api/notion/pages?pageId=page-1').set(bearer(NATIVE))
      expect(page.body.properties.Status).toEqual({ type: 'status', status: { name: 'Today', color: 'blue' } })

      const query = await request.post('/api/notion/query-data-source').set(bearer(`${STUB}:status=native:pages=6:s2`)).send({ dataSourceId: 'ds-123', filter: statusFilter })
      expect(query.status).toBe(200)
      for (const result of query.body.results) {
        expect(result.properties.Status.type).toBe('status')
        expect(result.properties.Status).not.toHaveProperty('select')
      }
    })

    it('keeps select pages for the default token', async () => {
      const request = await buildApp()
      const page = await request.get('/api/notion/pages?pageId=page-1').set(bearer(STUB))
      expect(page.body.properties.Status).toEqual({ select: { name: 'Today', color: 'blue' } })
    })

    it('rejects a select filter with 400 NOTION_API_ERROR for a native token and accepts status', async () => {
      const request = await buildApp()
      const rejected = await request.post('/api/notion/query-data-source').set(bearer(NATIVE)).send({ dataSourceId: 'ds-123', filter: selectFilter })
      expect(rejected.status).toBe(400)
      expect(rejected.body.data.error).toBe('NOTION_API_ERROR')
      expect(rejected.body.data.message).toContain('database property status does not match filter select')

      const accepted = await request.post('/api/notion/query-data-source').set(bearer(NATIVE)).send({ dataSourceId: 'ds-123', filter: statusFilter })
      expect(accepted.status).toBe(200)
    })

    it('rejects a status filter for the default token and accepts select', async () => {
      const request = await buildApp()
      const rejected = await request.post('/api/notion/query-data-source').set(bearer(STUB)).send({ dataSourceId: 'ds-123', filter: statusFilter })
      expect(rejected.status).toBe(400)
      expect((await request.post('/api/notion/query-data-source').set(bearer(STUB)).send({ dataSourceId: 'ds-123', filter: selectFilter })).status).toBe(200)
    })

    it('finds a wrongly shaped condition nested in and / or groups', async () => {
      const request = await buildApp()
      const nested = { and: [{ or: [{ property: 'Status', status: { equals: 'Today' } }, { property: 'Status', select: { equals: 'Doing' } }] }] }
      const res = await request.post('/api/notion/query-data-source').set(bearer(NATIVE)).send({ dataSourceId: 'ds-123', filter: nested })
      expect(res.status).toBe(400)
    })

    it('rejects a Status filter or write carrying both keys or neither', async () => {
      const request = await buildApp()
      for (const token of [NATIVE, STUB]) {
        for (const filter of [
          { property: 'Status', select: { equals: 'x' }, status: { equals: 'x' } },
          { property: 'Status' },
        ]) {
          const res = await request.post('/api/notion/query-data-source').set(bearer(token)).send({ dataSourceId: 'ds-123', filter })
          expect(res.status).toBe(400)
        }
        for (const Status of [{ select: { name: 'x' }, status: { name: 'x' } }, {}]) {
          const res = await request.patch('/api/notion/update-task').set(bearer(token)).send({ pageId: 'page-1', properties: { Status } })
          expect(res.status).toBe(400)
        }
      }
    })

    it('ignores filters on other properties', async () => {
      const request = await buildApp()
      const res = await request.post('/api/notion/query-data-source').set(bearer(NATIVE)).send({ dataSourceId: 'ds-123', filter: { property: 'Topic', select: { equals: 'x' } } })
      expect(res.status).toBe(200)
    })

    it('rejects a select write with 400 for a native token and stores a status write', async () => {
      const request = await buildApp()
      const rejected = await request.patch('/api/notion/update-task').set(bearer(NATIVE)).send({ pageId: 'page-1', properties: { Status: { select: { name: 'Doing' } } } })
      expect(rejected.status).toBe(400)
      expect(rejected.body.data.message).toBe('Status is expected to be status.')

      const accepted = await request.patch('/api/notion/update-task').set(bearer(NATIVE)).send({ pageId: 'page-1', properties: { Status: { status: { name: 'Doing' } } } })
      expect(accepted.status).toBe(200)
      const read = await request.get('/api/notion/pages?pageId=page-1').set(bearer(NATIVE))
      expect(read.body.properties.Status.status.name).toBe('Doing')
    })

    it('rejects a status write for the default token', async () => {
      const request = await buildApp()
      const rejected = await request.patch('/api/notion/update-task').set(bearer(STUB)).send({ pageId: 'page-1', properties: { Status: { status: { name: 'Doing' } } } })
      expect(rejected.status).toBe(400)
      expect(rejected.body.data.message).toBe('Status is expected to be select.')
    })

    it('validates create-task writes the same way', async () => {
      const request = await buildApp()
      const base = { databaseId: 'db-123' }
      const wrong = await request.post('/api/notion/create-task').set(bearer(NATIVE)).send({ ...base, properties: { Name: { title: [] }, Status: { select: { name: 'Today' } } } })
      expect(wrong.status).toBe(400)
      const right = await request.post('/api/notion/create-task').set(bearer(NATIVE)).send({ ...base, properties: { Name: { title: [] }, Status: { status: { name: 'Today' } } } })
      expect(right.status).toBe(200)
      expect(right.body.page.properties.Status).toEqual({ status: { name: 'Today' } })
    })
  })
})
