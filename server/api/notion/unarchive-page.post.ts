import { Client } from '@notionhq/client'
import { defineEventHandler, readBody } from 'h3'
import { handleNotionError, getTokenFromEvent, throwApiError } from '~/server/utils/apiError'
import { isNotionStubEnabled, unarchiveStubPage } from '~/server/utils/notionStub'

interface UnarchivePageRequest {
  pageId?: unknown;
}

/**
 * Takes a Notion page out of the trash again: the task returns to the database. Used by the restore from
 * kan-do's trash (#422). A page Notion no longer has answers 404, which the client turns into a new page.
 */
export default defineEventHandler(async (event) => {
  try {
    const token = getTokenFromEvent(event)
    const body = await readBody<UnarchivePageRequest>(event)
    const pageId = typeof body?.pageId === 'string' ? body.pageId.trim() : ''

    if (!token || !pageId) {
      throwApiError(400, 'Missing required parameters: token (Authorization header) and a non-empty string pageId are required')
    }

    if (isNotionStubEnabled(token)) {
      if (!unarchiveStubPage(token, pageId)) throwApiError(404, `Could not find page with ID: ${pageId}`)
      return { success: true, pageId, archived: false }
    }

    const notion = new Client({ auth: token, notionVersion: '2025-09-03' })
    await notion.pages.update({ page_id: pageId, archived: false })

    return { success: true, pageId, archived: false }
  } catch (error) {
    handleNotionError(error)
  }
})
