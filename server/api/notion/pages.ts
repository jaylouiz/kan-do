import { Client } from '@notionhq/client'
import { defineEventHandler } from 'h3'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import { validateRequest, handleNotionError } from '~/server/utils/apiError'
import { getStubPage, isNotionStubEnabled } from '~/server/utils/notionStub'

// Define types for Notion property structures
interface NotionTitleProperty {
  title: Array<{ plain_text: string }> | undefined
}

export default defineEventHandler(async (event) => {
  try {
    // Validate required query parameters
    const query = validateRequest(event, ['token'])
    const token = query.token as string
    const pageId = query.pageId as string | undefined

    if (isNotionStubEnabled(token)) {
      return pageId ? getStubPage(token, pageId) : []
    }

    const notion = new Client({ auth: token, notionVersion: '2025-09-03' })
    
    // If pageId is provided, retrieve that specific page
    if (pageId) {
      const page = await notion.pages.retrieve({ page_id: pageId })
      return page
    }
    
    // Otherwise, search for all pages (legacy behavior)
    const response = await notion.search({
      filter: {
        property: 'object',
        value: 'page',
      },
      page_size: 100,
    })

    const pages = response.results as PageObjectResponse[]
    return pages.map((page) => ({
      id: page.id,
      title:
        (page.properties?.['title'] as NotionTitleProperty)?.title?.[0]?.plain_text ||
        (page.properties?.['Name'] as NotionTitleProperty)?.title?.[0]?.plain_text ||
        'Untitled Page',
    }))
  } catch (error) {
    handleNotionError(error)
  }
})
