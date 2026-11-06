import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

describe('server/api/notion/database.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('returns 400 when token is missing', async () => {
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database')
    expect(res.status).toBe(400)
  })

  it('retrieves a specific database by id', async () => {
    const mockDatabase = {
      id: 'db-123',
      title: [{ plain_text: 'My DB' }],
    }
    const databasesRetrieve = vi.fn().mockResolvedValue(mockDatabase)
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return {
        databases: { retrieve: databasesRetrieve },
        }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?token=test-token&id=db-123')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('db-123')
    expect(databasesRetrieve).toHaveBeenCalledWith({ database_id: 'db-123' })
  })

  it('accepts the token from the Authorization header (client proxy mode)', async () => {
    const mockDatabase = { id: 'db-123', title: [{ plain_text: 'My DB' }] }
    const databasesRetrieve = vi.fn().mockResolvedValue(mockDatabase)
    const clientCtor = vi.fn().mockImplementation(function () {
      return { databases: { retrieve: databasesRetrieve } }
    })
    vi.doMock('@notionhq/client', () => ({ Client: clientCtor }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request
      .get('/api/notion/database?id=db-123')
      .set('Authorization', 'Bearer header-token')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('db-123')
    expect(clientCtor).toHaveBeenCalledWith(expect.objectContaining({ auth: 'header-token' }))
    expect(databasesRetrieve).toHaveBeenCalledWith({ database_id: 'db-123' })
  })

  it('lists all databases when no id is provided', async () => {
    const searchResults = [
      { id: 'db-1', title: [{ plain_text: 'First' }] },
      { id: 'db-2', title: [{ plain_text: 'Second' }] },
    ]
    const notionSearch = vi.fn().mockResolvedValue({ results: searchResults })
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return {
        search: notionSearch,
        }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?token=test-token')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0]).toEqual({ id: 'db-1', title: [{ plain_text: 'First' }] })
    expect(notionSearch).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { property: 'object', value: 'database' } }),
    )
  })

  it('returns stubbed databases when stub mode is enabled (list)', async () => {
    const stubbedDatabases = [
      { id: 'stub-db-1', title: 'Stub DB 1' },
      { id: 'stub-db-2', title: 'Stub DB 2' },
    ]
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      getStubbedDatabases: vi.fn().mockReturnValue(stubbedDatabases),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?token=test-token')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { id: 'stub-db-1', title: 'Stub DB 1' },
      { id: 'stub-db-2', title: 'Stub DB 2' },
    ])
  })

  it('returns stubbed single database when stub mode is enabled with id', async () => {
    const stubbedDatabases = [
      { id: 'stub-db-1', title: 'Stub DB 1' },
      { id: 'stub-db-2', title: 'Stub DB 2' },
    ]
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      getStubbedDatabases: vi.fn().mockReturnValue(stubbedDatabases),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?token=test-token&id=stub-db-1')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('stub-db-1')
  })

  it('returns 404 when stub database not found by id', async () => {
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(true),
      getStubbedDatabases: vi.fn().mockReturnValue([]),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?token=test-token&id=nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns 500 when Notion API throws an error', async () => {
    const databasesRetrieve = vi.fn().mockRejectedValue(
      Object.assign(new Error('not found'), { status: 404 }),
    )
    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () {
        return {
        databases: { retrieve: databasesRetrieve },
        }
      }),
    }))
    vi.doMock('~/server/utils/notionStub', () => ({
      isNotionStubEnabled: vi.fn().mockReturnValue(false),
      getStubbedDatabases: vi.fn(),
    }))

    const handler = (await import('~/server/api/notion/database.get')).default
    const app = createApp()
    app.use('/api/notion/database', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/database?token=test-token&id=db-bad')
    expect(res.status).toBe(404)
  })
})
