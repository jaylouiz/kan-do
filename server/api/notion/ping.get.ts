import { Client } from '@notionhq/client'
import { defineEventHandler, createError } from 'h3'
import { validateRequest, handleNotionError } from '~/server/utils/apiError'
import { getStubbedPing, isNotionStubEnabled } from '~/server/utils/notionStub'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
  const query = validateRequest(event, ['token'])
  const token = query.token as string

  if (isNotionStubEnabled(token)) {
    return getStubbedPing()
  }

  const notion = new Client({ auth: token, notionVersion: '2025-09-03' })

  try {
    const me = await notion.request({ path: 'users/me', method: 'get' })

    // Try both search forms just to verify access and version compatibility
    const searchDataSources = await notion.request({
      path: 'search',
      method: 'post',
      body: {
        filter: { property: 'object', value: 'data_source' },
        page_size: 5,
      },
    })

    const searchPages = await notion.request({
      path: 'search',
      method: 'post',
      body: {
        filter: { property: 'object', value: 'page' },
        page_size: 5,
      },
    })

    const dsSamples = Array.isArray((searchDataSources as { results?: unknown[] })?.results)
      ? await Promise.all(
          (searchDataSources as { results: unknown[] }).results.slice(0, 3).map(async (r: unknown) => {
            const result = r as { object?: string; id?: string; data_source?: { id?: string; name?: string | null; location?: { type?: string; database_id?: string; page_id?: string } } }
            const dsId = result?.data_source?.id ?? result?.id
            let details: { id?: string; name?: string | null; location?: { type?: string; database_id?: string; page_id?: string } } | null = null
            if (dsId) {
              try {
                details = await notion.request({ method: 'get', path: `data_sources/${dsId}` })
              } catch {
                // ignore
              }
            }
            return {
              object: result?.object,
              id: result?.id,
              data_source: result?.data_source ? {
                id: result?.data_source?.id,
                name: result?.data_source?.name ?? null,
                location: {
                  type: result?.data_source?.location?.type,
                  database_id: result?.data_source?.location?.database_id,
                  page_id: result?.data_source?.location?.page_id,
                },
              } : null,
              details: details ? {
                id: details?.id,
                name: details?.name ?? null,
                location: {
                  type: details?.location?.type,
                  database_id: details?.location?.database_id,
                  page_id: details?.location?.page_id,
                },
              } : null,
            }
          })
        )
      : []

    const pageSamples = Array.isArray((searchPages as { results?: unknown[] })?.results)
      ? (searchPages as { results: unknown[] }).results.slice(0, 3).map((r: unknown) => {
          const result = r as { object?: string; id?: string; title?: { plain_text?: string }[] }
          return {
            object: result?.object,
            id: result?.id,
            title: Array.isArray(result?.title) ? result.title.map((t: { plain_text?: string }) => t?.plain_text).join('') : undefined,
          }
        })
      : []

    return {
      ok: true,
      me,
      counts: {
        data_sources: Array.isArray((searchDataSources as { results?: unknown[] })?.results) ? (searchDataSources as { results: unknown[] }).results.length : 0,
        pages_or_databases: Array.isArray((searchPages as { results?: unknown[] })?.results) ? (searchPages as { results: unknown[] }).results.length : 0,
      },
      samples: {
        data_sources: dsSamples,
        pages: pageSamples,
      },
    }
  } catch (error) {
    handleNotionError(error)
  }
})
