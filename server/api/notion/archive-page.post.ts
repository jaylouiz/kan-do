import { Client } from '@notionhq/client'
import { defineEventHandler, readBody } from 'h3'
import { handleNotionError, getTokenFromEvent, throwApiError } from '~/server/utils/apiError'
import { archiveStubPage, isNotionStubEnabled } from '~/server/utils/notionStub'

interface ArchivePageRequest {
  pageId?: unknown;
}

/**
 * Archives a Notion page: the task leaves the database and lands in Notion's trash,
 * where it can still be restored. Used by the upstream-aware delete (#99).
 */
export default defineEventHandler(async (event) => {
  try {
    const token = getTokenFromEvent(event)
    const body = await readBody<ArchivePageRequest>(event)
    const pageId = typeof body?.pageId === 'string' ? body.pageId.trim() : ''

    if (!token || !pageId) {
      throwApiError(400, 'Missing required parameters: token (Authorization header) and a non-empty string pageId are required')
    }

    if (isNotionStubEnabled(token)) {
      archiveStubPage(token, pageId)
      return { success: true, pageId, archived: true }
    }

    const notion = new Client({ auth: token, notionVersion: '2025-09-03' })
    await notion.pages.update({ page_id: pageId, archived: true })

    return { success: true, pageId, archived: true }
  } catch (error) {
    handleNotionError(error)
  }
})
