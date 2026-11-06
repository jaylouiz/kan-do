import { Client } from '@notionhq/client'
import { defineEventHandler, createError } from 'h3'
import { validateRequest, handleNotionError } from '~/server/utils/apiError'
import { isNotionStubEnabled } from '~/server/utils/notionStub'

type NotionSelect = { select?: { name?: string | null } | null }
type NotionCheckbox = { checkbox?: boolean | null }
type NotionNumber = { number?: number | null }
type NotionTitle = { title?: Array<{ plain_text?: string | null }> | null }
type NotionDate = { date?: { start?: string | null } | null }

type NotionArchivedPage = {
  id: string
  properties?: Record<string, unknown>
}

export default defineEventHandler(async (event) => {
  // Validate required query parameters
  const query = validateRequest(event, ['token', 'databaseId', 'dataSourceId', 'propertyMapping', 'statusMapping'])
  const token = query.token as string
  const _databaseId = query.databaseId as string
  const dataSourceId = query.dataSourceId as string
  
  // Parse JSON parameters with error handling
  let propertyMapping, statusMapping
  try {
    propertyMapping = JSON.parse(query.propertyMapping as string)
    statusMapping = JSON.parse(query.statusMapping as string)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        error: 'INVALID_JSON',
        message: 'Invalid propertyMapping or statusMapping format'
      }
    })
  }

  // Check if archive status is configured
  if (!statusMapping.archive) {
    // Return empty array if no archive status is configured
    return []
  }

  if (isNotionStubEnabled(token)) {
    // Return empty array for stub mode (no archived tasks in stub)
    return []
  }

  const notion = new Client({ auth: token, notionVersion: '2025-09-03' })
  
  // Build filter for archived status only
  const archivedFilter = {
    property: propertyMapping.status,
    select: {
      equals: statusMapping.archive,
    },
  }

  // Fetch all archived tasks with pagination support
  const allResults: NotionArchivedPage[] = []
  let hasMore = true
  let startCursor: string | undefined = undefined

  try {
    while (hasMore) {
      const response = await notion.request({
        method: 'post',
        path: `data_sources/${dataSourceId}/query`,
        body: {
          filter: archivedFilter,
          page_size: 100, // Maximum page size
          ...(startCursor ? { start_cursor: startCursor } : {}),
        },
      }) as { results?: unknown[]; has_more?: boolean; next_cursor?: string | null }

      if (response.results) {
        allResults.push(...(response.results as NotionArchivedPage[]))
      }

      hasMore = response.has_more ?? false
      startCursor = response.next_cursor ?? undefined

      // Debug logging for pagination (dev only)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Archived Tasks] Fetched ${response.results?.length || 0} tasks, total: ${allResults.length}, has_more: ${hasMore}`);
      }
    }
  } catch (error) {
    handleNotionError(error)
  }

  // Debug logging for final response (dev only)
  if (process.env.NODE_ENV !== 'production') {
    console.log("=== NOTION ARCHIVED TASKS API RESPONSE DEBUG ===");
    console.log("Total archived tasks fetched:", allResults.length);
    console.log("=== END DEBUG ===");
  }

  const readTitle = (props: Record<string, unknown>, key: string): string | null => {
    const val = props[key] as NotionTitle | undefined
    const first = val?.title?.[0]
    const text = first?.plain_text
    return typeof text === 'string' && text.trim().length > 0 ? text : null
  }

  const readSelect = (props: Record<string, unknown>, key: string): string | null => {
    const val = props[key] as NotionSelect | undefined
    const name = val?.select?.name
    return typeof name === 'string' && name.trim().length > 0 ? name : null
  }

  const readCheckbox = (props: Record<string, unknown>, key: string): boolean => {
    const val = props[key] as NotionCheckbox | undefined
    return Boolean(val?.checkbox)
  }

  const readNumber = (props: Record<string, unknown>, key: string): number | null => {
    const val = props[key] as NotionNumber | undefined
    return typeof val?.number === 'number' ? val.number : null
  }

  const readDateStartIso = (props: Record<string, unknown>, key: string): string | null => {
    const val = props[key] as NotionDate | undefined
    const start = val?.date?.start
    if (typeof start !== 'string' || start.trim().length === 0) return null
    const d = new Date(start)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }

  // Map raw Notion pages to a stable DTO expected by the frontend/tests.
  // Note: status is surfaced as a string label for this endpoint.
  const mapped = allResults.map((page) => {
    const props = (page.properties ?? {}) as Record<string, unknown>

    const title = readTitle(props, propertyMapping.title)
    const topic = propertyMapping.topic ? readSelect(props, propertyMapping.topic) : null
    const timeBoxSeconds = propertyMapping.timeBox ? readNumber(props, propertyMapping.timeBox) : null
    const timeSpentSeconds = propertyMapping.timeSpent ? readNumber(props, propertyMapping.timeSpent) : 0
    const isUnplanned = propertyMapping.isUnplanned ? readCheckbox(props, propertyMapping.isUnplanned) : false
    const completedAt = propertyMapping.completed ? readDateStartIso(props, propertyMapping.completed) : null

    return {
      id: page.id,
      title,
      status: 'Done',
      timeBoxSeconds,
      timeSpentSeconds,
      topic,
      isUnplanned,
      completedAt,
    }
  })

  return mapped;
});
