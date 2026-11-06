import { Client } from '@notionhq/client'
import { defineEventHandler, readBody } from 'h3'
import { throwApiError, handleNotionError, getTokenFromEvent } from '~/server/utils/apiError'
import { assertStubStatusShape, isNotionStubEnabled, queryStubPages } from '~/server/utils/notionStub'

/**
 * Proxy endpoint for querying one page of a Notion data source.
 * Forwards the query directly to Notion API to avoid CORS issues in browser.
 * Returns Notion's response unchanged (`has_more`, `next_cursor`); the client follows the cursor.
 */
export default defineEventHandler(async (event) => {
  try {
    const token = getTokenFromEvent(event)
    const body = await readBody(event)
    const { dataSourceId, filter, page_size, start_cursor } = body

    if (!token || !dataSourceId) {
      throwApiError(
        400,
        'Missing required parameters: token (Authorization header) and dataSourceId are required',
        { error: 'MISSING_PARAMETERS' }
      )
    }

    // E2E / dev stub: return one page of the fixture pages (with stub writes applied) in the raw Notion query-response shape; a Status filter with the wrong key for the token's mode fails like Notion (400)
    if (isNotionStubEnabled(token ?? undefined)) {
      assertStubStatusShape(token ?? undefined, { filter })
      return {
        object: 'list',
        ...queryStubPages(token ?? undefined, { pageSize: page_size, startCursor: start_cursor }),
      }
    }

    const notion = new Client({ auth: token!, notionVersion: '2025-09-03' })

    const response = await notion.request({
      method: 'post',
      path: `data_sources/${dataSourceId}/query`,
      body: {
        filter,
        page_size: page_size ?? 100,
        // Only forwarded when set; the client loops over has_more / next_cursor (see NotionClientAPI.queryDataSource)
        ...(start_cursor ? { start_cursor } : {}),
      },
    })

    return response
  } catch (error) {
    console.error('Error querying Notion data source:', error)
    handleNotionError(error)
  }
})
