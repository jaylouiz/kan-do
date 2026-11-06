// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

const buildDatabase = (id: string, title: string, parentId: string) => ({ id, title, parentId })

const buildSearchResult = (databaseId: string, dataSourceId: string, name: string | null = null) => ({
  object: 'data_source',
  id: dataSourceId,
  data_source: {
    id: dataSourceId,
    name,
    location: {
      database_id: databaseId,
    },
  },
})

const buildDatabaseResponse = (
  database: ReturnType<typeof buildDatabase>,
  dataSources: Array<{ id: string; name: string | null }> = [],
) => ({
  title: [{ plain_text: database.title }],
  parent: { type: 'page_id', page_id: database.parentId },
  data_sources: dataSources,
})

type SearchFilter = 'data_source' | 'page' | 'unfiltered'

const createRequestSpy = (options: {
  searchResults?: Partial<Record<SearchFilter, unknown[]>>
  searchErrors?: Partial<Record<SearchFilter, Error>>
  databaseResponses?: Record<string, unknown>
}) => {
  return vi.fn().mockImplementation(async ({ path, method: _method, body }: { path: string; method?: string; body?: unknown }) => {
    if (path === 'search') {
      const filterValue = (body as { filter?: { value?: SearchFilter } } | null)?.filter?.value

      const key = filterValue ?? 'unfiltered'

      const error = options.searchErrors?.[key]
      if (error) throw error

      return { results: options.searchResults?.[key] ?? [] }
    }

    if (path.startsWith('databases/')) {
      const id = path.slice('databases/'.length)
      if (options.databaseResponses?.[id]) {
        return options.databaseResponses[id]
      }
      throw new Error(`Unexpected database fetch for ${id}`)
    }

    throw new Error(`Unexpected request path: ${path}`)
  })

  it('infers databaseId from query probe and details.parent when location is missing', async () => {
    // Build search results without location
    const searchResults = [
      { object: 'data_source', id: 'ds1', data_source: { id: 'ds1', name: 'Alpha Quelle' } },
      { object: 'data_source', id: 'ds2', data_source: { id: 'ds2', name: 'Beta Quelle' } },
    ]

    // Mock request function that supports search, data_sources, and databases
    const requestSpy = vi.fn().mockImplementation(async ({ path, method, body }: { path: string; method?: string; body?: unknown }) => {
      if (path === 'search') {
        const filterValue = (body as { filter?: { value?: unknown } } | null)?.filter?.value
        if (filterValue === 'data_source') return { results: searchResults }
        if (filterValue === 'page') return { results: [] }
        return { results: [] }
      }
      if (path.startsWith('data_sources/') && method === 'post' && path.endsWith('/query')) {
        const id = path.slice('data_sources/'.length, -('/query'.length + 1))
        if (id === 'ds1') {
          // Provide parent.database_id through probe
          return { results: [ { parent: { type: 'data_source_id', data_source_id: 'ds1', database_id: 'db1' } } ] }
        }
        if (id === 'ds2') {
          // No results from probe
          return { results: [] }
        }
        return { results: [] }
      }
      if (path.startsWith('data_sources/') && (method === 'get' || !method)) {
        const id = path.slice('data_sources/'.length)
        if (id === 'ds2') {
          // Provide parent.database_id through details
          return { parent: { type: 'database_id', database_id: 'db2' }, name: 'Beta Quelle' }
        }
        return {}
      }
      if (path.startsWith('databases/')) {
        const id = path.slice('databases/'.length)
        if (id === 'db1') {
          return { title: [{ plain_text: 'Alpha' }], parent: { type: 'page_id', page_id: 'p1' }, data_sources: [{ id: 'ds1', name: 'Alpha Quelle' }] }
        }
        if (id === 'db2') {
          return { title: [{ plain_text: 'Beta' }], parent: { type: 'page_id', page_id: 'p2' }, data_sources: [{ id: 'ds2', name: 'Beta Quelle' }] }
        }
        throw new Error(`Unexpected database fetch for ${id}`)
      }
      throw new Error(`Unexpected request path: ${path}`)
    })

    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/databases?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'db1',
        title: 'Alpha',
        dataSources: [ { id: 'ds1', name: 'Alpha Quelle', databaseId: 'db1', databaseTitle: 'Alpha' } ],
      },
      {
        id: 'db2',
        title: 'Beta',
        dataSources: [ { id: 'ds2', name: 'Beta Quelle', databaseId: 'db2', databaseTitle: 'Beta' } ],
      },
    ])
  })
}

describe('server/api/notion/databases.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns [] safely on empty results', async () => {
    const requestSpy = createRequestSpy({ searchResults: { data_source: [] } })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/databases?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(requestSpy).toHaveBeenCalledTimes(3)
    expect(requestSpy).toHaveBeenNthCalledWith(1, {
      path: 'search',
      method: 'post',
      body: {
        filter: {
          property: 'object',
          value: 'data_source',
        },
        page_size: 100,
      },
    })
    expect(requestSpy).toHaveBeenNthCalledWith(2, {
      path: 'search',
      method: 'post',
      body: {
        filter: {
          property: 'object',
          value: 'page',
        },
        page_size: 100,
      },
    })
    expect(requestSpy).toHaveBeenNthCalledWith(3, {
      path: 'search',
      method: 'post',
      body: {
        page_size: 100,
      },
    })
  })

  it('maps large dataset down to database summaries with empty dataSources', async () => {
    const databases = Array.from({ length: 10 }, (_, i) => buildDatabase(`db${i + 1}`, `DB${i + 1}`, `p${i + 1}`))
    const searchResults = databases.map((db, index) => buildSearchResult(db.id, `ds${index + 1}`))
    const requestSpy = createRequestSpy({
      searchResults: { data_source: searchResults },
      databaseResponses: Object.fromEntries(databases.map((db) => [db.id, buildDatabaseResponse(db, [])])),
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/databases?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body[0]).toEqual({
      id: 'db1',
      title: 'DB1',
      dataSources: [{ id: 'ds1', name: null, databaseId: 'db1', databaseTitle: 'DB1' }],
    })
    expect(requestSpy).toHaveBeenCalled()
  })

  it('returns databases with enriched data source metadata (happy path)', async () => {
    const databases = [
      buildDatabase('db1', 'Alpha', 'p1'),
      buildDatabase('db2', 'Beta', 'p2'),
    ]
    const searchResults = [
      buildSearchResult('db1', 'ds1', 'Alpha Quelle'),
      buildSearchResult('db2', 'ds2', 'Beta Quelle'),
    ]
    const requestSpy = createRequestSpy({
      searchResults: { data_source: searchResults },
      databaseResponses: {
        db1: buildDatabaseResponse(databases[0]!, [{ id: 'ds1', name: 'Alpha Quelle' }]),
        db2: buildDatabaseResponse(databases[1]!, [{ id: 'ds2', name: 'Beta Quelle' }]),
      },
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/databases?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'db1',
        title: 'Alpha',
        dataSources: [{ id: 'ds1', name: 'Alpha Quelle', databaseId: 'db1', databaseTitle: 'Alpha' }],
      },
      {
        id: 'db2',
        title: 'Beta',
        dataSources: [{ id: 'ds2', name: 'Beta Quelle', databaseId: 'db2', databaseTitle: 'Beta' }],
      },
    ])
  })

  it('filters by parentId when provided', async () => {
    const databases = [
      buildDatabase('db1', 'Alpha', 'p1'),
      buildDatabase('db2', 'Beta', 'p2'),
    ]
    const searchResults = [
      buildSearchResult('db1', 'ds1'),
      buildSearchResult('db2', 'ds2'),
    ]
    const requestSpy = createRequestSpy({
      searchResults: { data_source: searchResults },
      databaseResponses: {
        db1: buildDatabaseResponse(databases[0]!, []),
        db2: buildDatabaseResponse(databases[1]!, []),
      },
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))
    const res = await request.get('/api/notion/databases?token=tkn&parentId=p1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'db1',
        title: 'Alpha',
        dataSources: [{ id: 'ds1', name: null, databaseId: 'db1', databaseTitle: 'Alpha' }],
      },
    ])
  })

  it('returns 400 when token missing', async () => {
    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/databases')
    expect(res.status).toBe(400)
    expect(res.body?.data?.error).toBe('MISSING_PARAMETERS')
  })

  it('falls back to page search when no data sources found', async () => {
    const databases = [buildDatabase('db1', 'Alpha', 'p1')]
    const pageSearchResults = [
      {
        object: 'database',
        id: 'db1',
        title: [{ plain_text: 'Alpha' }],
        parent: { type: 'page_id', page_id: 'p1' },
      },
    ]
    const requestSpy = createRequestSpy({
      searchResults: {
        data_source: [],
        page: pageSearchResults,
      },
      databaseResponses: {
        db1: buildDatabaseResponse(databases[0]!, []),
      },
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/databases?token=tkn')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'db1',
        title: 'Alpha',
        dataSources: [],
      },
    ])
  })

  it('returns 502 when Notion API throws APIResponseError', async () => {
    const requestSpy = createRequestSpy({
      searchResults: { data_source: [] },
      searchErrors: {
        data_source: Object.assign(new Error('fail'), { name: 'APIResponseError' }),
      },
    })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/databases.get')).default
    const app = createApp(); app.use('/api/notion/databases', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/databases?token=tkn')
    expect(res.status).toBe(502)
    expect(res.body?.data?.error).toBe('NOTION_API_ERROR')
  })
})
