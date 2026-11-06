/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// SUT
import { NotionClientAPI, NotionAPIError } from '../../integrations/NotionClientAPI'

const TEST_TOKEN = 'test-notion-token'

describe('NotionClientAPI', () => {
  let api: NotionClientAPI

  beforeEach(() => {
    api = new NotionClientAPI(TEST_TOKEN)
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('stores the API token', () => {
      expect(api).toBeDefined()
    })
  })

  describe('unarchivePage() (#422)', () => {
    it('goes through its own proxy route with only the page id', async () => {
      ;(fetch as any).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) })
      await api.unarchivePage('page-1')
      expect(fetch).toHaveBeenCalledWith(
        '/api/notion/unarchive-page',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ pageId: 'page-1' }) }),
      )
    })

    it('does not reuse the archive route', async () => {
      ;(fetch as any).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true }) })
      await api.archivePage('page-1')
      expect((fetch as any).mock.calls[0][0]).toBe('/api/notion/archive-page')
    })
  })

  describe('request()', () => {
    it('makes authenticated request to Notion API with correct headers', async () => {
      const mockResponse = { results: [] }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      await api.request('POST', '/search', { query: 'test' })

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/search`,
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': `Bearer ${TEST_TOKEN}` }) })
      )
    })

    it('makes GET request without body', async () => {
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'db-123' }),
      })

      await api.request('GET', '/databases/db-123')

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/database?id=db-123`,
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': `Bearer ${TEST_TOKEN}` }) })
      )
    })

    it('returns parsed JSON response on success', async () => {
      const mockData = { id: 'page-1', properties: {} }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData),
      })

      const result = await api.request('GET', '/pages/page-1')

      expect(result).toEqual(mockData)
    })

    it('throws NotionAPIError on 401 Unauthorized', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ message: 'Invalid token' }),
      })

      let caughtError: NotionAPIError | undefined
      try {
        await api.request('GET', '/databases/x')
      } catch (e) {
        caughtError = e as NotionAPIError
      }
      
      expect(caughtError).toBeInstanceOf(NotionAPIError)
      expect(caughtError?.statusCode).toBe(401)
    })

    it('throws NotionAPIError on 404 Not Found', async () => {
      ;(fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () => Promise.resolve({ message: 'Database not found' }),
      })

      await expect(api.request('GET', '/databases/missing')).rejects.toThrow(NotionAPIError)
    })

    it('retries on 429 rate limit with backoff', async () => {
      ;(fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: () => Promise.resolve({ message: 'Rate limited' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

      const result = await api.request('GET', '/databases/db-1')

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ success: true })
    })

    it('retries on 500+ server errors', async () => {
      ;(fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ recovered: true }),
        })

      const result = await api.request('GET', '/pages/p1')

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ recovered: true })
    })

    it('throws after max retries exceeded', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ message: 'Server error' }),
      })

      await expect(api.request('GET', '/pages/p1')).rejects.toThrow(NotionAPIError)
      // Default 1 retry = 2 total calls
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('handles network errors with retry', async () => {
      ;(fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })

      const result = await api.request('GET', '/databases/db-1')

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ success: true })
    })
  })

  describe('searchDatabases()', () => {
    it('calls search endpoint with database filter', async () => {
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [{ id: 'db-1', object: 'database' }] }),
      })

      const result = await api.searchDatabases()

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/databases`,
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': `Bearer ${TEST_TOKEN}` }) })
      )
      expect(result.results).toHaveLength(1)
    })
  })

  describe('getDatabase()', () => {
    it('retrieves database by ID', async () => {
      const mockDb = { id: 'db-123', title: [{ plain_text: 'My DB' }], properties: {} }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDb),
      })

      const result = await api.getDatabase('db-123')

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/database?id=db-123`,
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': `Bearer ${TEST_TOKEN}` }) })
      )
      expect(result.id).toBe('db-123')
    })
  })

  describe('queryDataSource()', () => {
    it('queries data source with filter', async () => {
      const mockResults = { results: [{ id: 'page-1' }] }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResults),
      })

      const filter = { property: 'Status', select: { equals: 'Today' } }
      const result = await api.queryDataSource('ds-123', { filter })

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/query-data-source`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"dataSourceId":"ds-123"'),
        })
      )
      expect(result.results).toHaveLength(1)
    })

    describe('pagination', () => {
      const filter = { property: 'Status', select: { equals: 'Today' } }
      const listResponse = (results: unknown[], nextCursor: string | null) => ({
        ok: true,
        json: () => Promise.resolve({ results, has_more: nextCursor !== null, next_cursor: nextCursor }),
      })
      const sentBody = (call: number) => JSON.parse((fetch as any).mock.calls[call][1].body)
      const failure = (status: number) => ({
        ok: false,
        status,
        statusText: 'Server Error',
        json: () => Promise.resolve({ message: 'boom' }),
      })

      it('follows next_cursor until has_more is false and concatenates results', async () => {
        ;(fetch as any)
          .mockResolvedValueOnce(listResponse([{ id: 'a' }, { id: 'b' }], 'cursor-1'))
          .mockResolvedValueOnce(listResponse([{ id: 'c' }, { id: 'd' }], 'cursor-2'))
          .mockResolvedValueOnce(listResponse([{ id: 'e' }], null))

        const result = await api.queryDataSource('ds-123', { filter, page_size: 2 })

        expect(fetch).toHaveBeenCalledTimes(3)
        expect(result.results.map((page) => (page as { id: string }).id)).toEqual(['a', 'b', 'c', 'd', 'e'])
        expect(sentBody(0).start_cursor).toBeUndefined()
        expect(sentBody(1)).toMatchObject({ dataSourceId: 'ds-123', filter, page_size: 2, start_cursor: 'cursor-1' })
        expect(sentBody(2)).toMatchObject({ dataSourceId: 'ds-123', filter, page_size: 2, start_cursor: 'cursor-2' })
      })

      it('makes exactly one request when the first page has no more results', async () => {
        ;(fetch as any).mockResolvedValueOnce(listResponse([{ id: 'a' }], null))

        const result = await api.queryDataSource('ds-123', { filter })

        expect(fetch).toHaveBeenCalledTimes(1)
        expect(sentBody(0).page_size).toBe(100)
        expect(sentBody(0)).not.toHaveProperty('start_cursor')
        expect(result.results).toHaveLength(1)
      })

      it('rejects without a partial result when a later page keeps failing', async () => {
        ;(fetch as any)
          .mockResolvedValueOnce(listResponse([{ id: 'a' }], 'cursor-1'))
          .mockResolvedValueOnce(failure(500))
          .mockResolvedValueOnce(failure(500))

        await expect(api.queryDataSource('ds-123', { filter })).rejects.toBeInstanceOf(NotionAPIError)
        expect(fetch).toHaveBeenCalledTimes(3)
      })

      it('recovers when a later page succeeds on the existing retry', async () => {
        ;(fetch as any)
          .mockResolvedValueOnce(listResponse([{ id: 'a' }], 'cursor-1'))
          .mockResolvedValueOnce(failure(503))
          .mockResolvedValueOnce(listResponse([{ id: 'b' }], null))

        const result = await api.queryDataSource('ds-123', { filter })

        expect(result.results).toHaveLength(2)
        expect(sentBody(2).start_cursor).toBe('cursor-1')
      })

      it('throws when has_more is true but next_cursor is missing', async () => {
        ;(fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ results: [{ id: 'a' }], has_more: true, next_cursor: null }),
        })

        await expect(api.queryDataSource('ds-123', { filter })).rejects.toBeInstanceOf(NotionAPIError)
        expect(fetch).toHaveBeenCalledTimes(1)
      })

      it('throws when next_cursor repeats the previous one', async () => {
        ;(fetch as any)
          .mockResolvedValueOnce(listResponse([{ id: 'a' }], 'cursor-1'))
          .mockResolvedValueOnce(listResponse([{ id: 'b' }], 'cursor-1'))

        await expect(api.queryDataSource('ds-123', { filter })).rejects.toBeInstanceOf(NotionAPIError)
        expect(fetch).toHaveBeenCalledTimes(2)
      })

      it('throws at the 100-page ceiling instead of truncating', async () => {
        let page = 0
        ;(fetch as any).mockImplementation(() => Promise.resolve(listResponse([{ id: `p${page}` }], `cursor-${++page}`)))

        await expect(api.queryDataSource('ds-123', { filter })).rejects.toMatchObject({
          name: 'NotionAPIError',
          message: expect.stringContaining('100'),
        })
        expect(fetch).toHaveBeenCalledTimes(100)
      })

      it('returns all pages when the last allowed page ends the list', async () => {
        let page = 0
        ;(fetch as any).mockImplementation(() => {
          page += 1
          return Promise.resolve(listResponse([{ id: `p${page}` }], page < 100 ? `cursor-${page}` : null))
        })

        const result = await api.queryDataSource('ds-123', { filter })

        expect(result.results).toHaveLength(100)
        expect(fetch).toHaveBeenCalledTimes(100)
      })
    })
  })

  describe('getPage()', () => {
    it('retrieves page by ID', async () => {
      const mockPage = { id: 'page-1', properties: { Name: { title: [] } } }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPage),
      })

      const result = await api.getPage('page-1')

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/pages?pageId=page-1`,
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': `Bearer ${TEST_TOKEN}` }) })
      )
      expect(result.id).toBe('page-1')
    })
  })

  describe('createPage()', () => {
    it('creates page in database', async () => {
      const mockCreated = { id: 'new-page', object: 'page' }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockCreated),
      })

      const result = await api.createPage('db-123', {
        Name: { title: [{ text: { content: 'New Task' } }] },
      })

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/create-task`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"databaseId":"db-123"'),
        })
      )
      expect(result.id).toBe('new-page')
    })
  })

  describe('updatePage()', () => {
    it('updates page properties', async () => {
      const mockUpdated = { id: 'page-1', object: 'page' }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockUpdated),
      })

      const result = await api.updatePage('page-1', {
        Status: { select: { name: 'Done' } },
      })

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/update-task`,
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"pageId":"page-1"'),
        })
      )
      expect(result.id).toBe('page-1')
    })
  })

  describe('searchDataSources()', () => {
    it('searches for data sources', async () => {
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ results: [{ id: 'ds-1', object: 'data_source' }] }),
      })

      const result = await api.searchDataSources()

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/data-sources`,
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': `Bearer ${TEST_TOKEN}` }) })
      )
      expect(result.results).toHaveLength(1)
    })
  })

  describe('getDataSource()', () => {
    it('retrieves data source details', async () => {
      const mockDs = { id: 'ds-123', name: 'My View', location: { database_id: 'db-1' } }
      ;(fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDs),
      })

      const result = await api.getDataSource('ds-123')

      expect(fetch).toHaveBeenCalledWith(
        `/api/notion/data-sources?id=ds-123`,
        expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'Authorization': `Bearer ${TEST_TOKEN}` }) })
      )
      expect(result.id).toBe('ds-123')
    })

    it('returns the schema and title of the data source', async () => {
      const mockDs = {
        id: 'ds-123',
        title: [{ plain_text: 'My View' }],
        parent: { database_id: 'db-1' },
        properties: { Status: { id: 's', name: 'Status', type: 'select' } },
      }
      ;(fetch as any).mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockDs) })

      const result = await api.getDataSource('ds-123')

      expect(result.properties?.['Status']?.type).toBe('select')
      expect(result.title?.[0]?.plain_text).toBe('My View')
      expect(result.parent?.database_id).toBe('db-1')
    })
  })
})

describe('NotionAPIError', () => {
  it('contains status code and message', () => {
    const error = new NotionAPIError(401, 'Unauthorized', { code: 'unauthorized' })
    
    expect(error.statusCode).toBe(401)
    expect(error.message).toBe('Unauthorized')
    expect(error.data).toEqual({ code: 'unauthorized' })
    expect(error.name).toBe('NotionAPIError')
  })
})
