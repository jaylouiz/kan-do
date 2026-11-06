// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import supertest from 'supertest'

/**
 * Mocks Notion client behaviour for /api/notion/data-sources endpoint
 */

describe('server/api/notion/data-sources.get.ts', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('maps database_id from details.parent when location missing', async () => {
    const requestSpy = vi.fn().mockImplementation(async ({ path, method, body: _body }: { path: string; method?: string; body?: unknown }) => {
      if (path === 'search') {
        return {
          results: [
            { object: 'data_source', id: 'ds1', data_source: { id: 'ds1', name: 'Alpha Quelle' } },
          ],
        }
      }
      if (path.startsWith('data_sources/') && (method === 'get' || !method)) {
        const id = path.slice('data_sources/'.length)
        if (id === 'ds1') {
          return { parent: { type: 'database_id', database_id: 'db1' }, name: 'Alpha Quelle' }
        }
        return {}
      }
      if (path.startsWith('data_sources/') && method === 'post' && path.endsWith('/query')) {
        return { results: [] }
      }
      throw new Error(`Unexpected request path: ${path}`)
    })

    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/data-sources.get')).default
    const app = createApp(); app.use('/api/notion/data-sources', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/data-sources?token=tkn&includeDetails=true&debug=true')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'ds1',
        name: 'Alpha Quelle',
        location: { type: 'database_id', database_id: 'db1' },
        debug: expect.objectContaining({ detailsParentDbId: 'db1' }),
      },
    ])
  })

  it('maps database_id from probe query when details gives no location/parent', async () => {
    const requestSpy = vi.fn().mockImplementation(async ({ path, method, body: _body }: { path: string; method?: string; body?: unknown }) => {
      if (path === 'search') {
        return {
          results: [
            { object: 'data_source', id: 'ds2', data_source: { id: 'ds2', name: null } },
          ],
        }
      }
      if (path.startsWith('data_sources/') && (method === 'get' || !method)) {
        return {} // no details
      }
      if (path.startsWith('data_sources/') && method === 'post' && path.endsWith('/query')) {
        return { results: [ { parent: { type: 'data_source_id', data_source_id: 'ds2', database_id: 'db2' } } ] }
      }
      throw new Error(`Unexpected request path: ${path}`)
    })

    vi.doMock('@notionhq/client', () => ({
      Client: vi.fn().mockImplementation(function () { return { request: requestSpy } }),
    }))

    const handler = (await import('~/server/api/notion/data-sources.get')).default
    const app = createApp(); app.use('/api/notion/data-sources', handler)
    const request = supertest(toNodeListener(app))

    const res = await request.get('/api/notion/data-sources?token=tkn&includeDetails=true&debug=true')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      {
        id: 'ds2',
        name: null,
        location: { type: 'database_id', database_id: 'db2' },
        debug: expect.objectContaining({ probeDbId: 'db2' }),
      },
    ])
  })
})
