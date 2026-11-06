import { Client } from '@notionhq/client'
import { defineEventHandler } from 'h3'
import type { DatabaseObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import { validateRequest, handleNotionError } from '~/server/utils/apiError'
import { getStubbedDatabases, isNotionStubEnabled } from '~/server/utils/notionStub'

interface DataSourceSearchResult {
  object: string
  id: string
  data_source?: {
    id?: string
    name?: string | null
    location?: {
      type?: string
      database_id?: string
    }
  }
}

interface LightweightDataSource {
  id: string
  name: string | null
}

interface DatabaseSummary {
  id: string
  title: string
  dataSources: Array<{
    id: string
    name: string | null
    databaseId: string
    databaseTitle: string
  }>
}

export default defineEventHandler(async (event) => {
  // Validate required query parameters
  const query = validateRequest(event, ['token'])
  const token = query.token as string
  const parentId = query.parentId as string | undefined

  if (isNotionStubEnabled(token)) {
    const databases = getStubbedDatabases<DatabaseSummary[]>()
    if (parentId) {
      return databases.filter((db) =>
        db.dataSources.some((source) => source.databaseId === parentId),
      )
    }
    return databases
  }

  const notion = new Client({ auth: token, notionVersion: '2025-09-03' })
  
  try {
    const dataSourceMap = new Map<string, LightweightDataSource[]>()
    const fallbackTitles = new Map<string, string>()

    const performSearch = async (value: 'data_source' | 'page') =>
      notion.request<{ results: DataSourceSearchResult[] }>({
        path: 'search',
        method: 'post',
        body: {
          filter: {
            property: 'object',
            value,
          },
          page_size: 100,
        },
      })

    const ensureEntry = (databaseId: string) => {
      if (!dataSourceMap.has(databaseId)) {
        dataSourceMap.set(databaseId, [])
      }
    }

    const dataSourceResponse = await performSearch('data_source')

    for (const entry of dataSourceResponse.results as DataSourceSearchResult[]) {
      if (entry?.object !== 'data_source') continue
      // Support both nested and top-level data source shapes
      const ds = (entry?.data_source ?? entry) as { id?: string; name?: string | null; location?: { type?: string; database_id?: string } }
      let databaseId: string | undefined = ds?.location?.database_id
      let dsName: string | null = (ds?.name ?? null) as string | null
      const dsId: string = ds?.id ?? entry.id

      // If the search result didn't include location.database_id, try two probes to infer it
      if (!databaseId && dsId) {
        try {
          // 1) Try a lightweight query to infer parent database_id
          const probe = await notion.request({
            method: 'post',
            path: `data_sources/${dsId}/query`,
            body: { page_size: 1 },
          }) as { results?: unknown[] }
          const first = Array.isArray(probe?.results) ? probe.results[0] as { parent?: { database_id?: string } } : undefined
          const parent = first?.parent
          // Accept database_id even if parent.type is 'data_source_id'
          const inferredDbId = parent?.database_id as string | undefined
          if (inferredDbId) {
            databaseId = inferredDbId
          }
        } catch {
          // ignore and try details
        }
        try {
          const dsDetails = await notion.request({
            method: 'get',
            path: `data_sources/${dsId}`,
          }) as { location?: { database_id?: string }; parent?: { database_id?: string }; name?: string | null }
          // Prefer explicit location; otherwise map from parent.database_id
          databaseId = dsDetails?.location?.database_id || dsDetails?.parent?.database_id || databaseId
          dsName = (dsName ?? dsDetails?.name ?? null) as string | null
        } catch {
          // No action needed
        }
      }

      if (!databaseId) continue

      const normalized: LightweightDataSource = {
        id: dsId,
        name: dsName,
      }

      const current = dataSourceMap.get(databaseId) || []
      current.push(normalized)
      dataSourceMap.set(databaseId, current)
    }

    if (dataSourceMap.size === 0) {
      const pageResponse = await performSearch('page')
      for (const entry of pageResponse.results as DataSourceSearchResult[]) {
        // Some workspaces may return mixed objects; attempt to pick database-like entries
        if (entry?.object === 'database' && entry?.id) {
          const database = entry as DatabaseObjectResponse
          ensureEntry(database.id)
          const title = database.title?.map((t) => t.plain_text).join('') || 'Untitled Database'
          fallbackTitles.set(database.id, title)
        }
      }
    }

    // Final fallback: unfiltered search, pick database objects
    if (dataSourceMap.size === 0) {
      const unfiltered = await notion.request<{ results: (DataSourceSearchResult | DatabaseObjectResponse)[] }>({
        path: 'search',
        method: 'post',
        body: { page_size: 100 },
      })
      for (const entry of unfiltered.results as (DataSourceSearchResult | DatabaseObjectResponse)[]) {
        if (entry?.object === 'database' && entry?.id) {
          const database = entry as DatabaseObjectResponse
          ensureEntry(database.id)
          const title = database.title?.map((t) => t.plain_text).join('') || 'Untitled Database'
          fallbackTitles.set(database.id, title)
        }
      }
    }

    if (dataSourceMap.size === 0) {
      return []
    }

    const databaseSummaries = await Promise.all(
      Array.from(dataSourceMap.entries()).map(async ([databaseId, fallbackDataSources]) => {
        try {
          const details = await notion.request({
            method: 'get',
            path: `databases/${databaseId}`,
          }) as DatabaseObjectResponse & { data_sources?: Array<{ id: string; name: string | null }> }

          const parent = 'parent' in details ? details.parent : undefined
          if (
            parentId &&
            (!parent || parent.type !== 'page_id' || parent.page_id !== parentId)
          ) {
            return null
          }

          const title = details.title?.map((t) => t.plain_text).join('') || 'Untitled Database'

          const detailDataSources = (details.data_sources || []).map((ds) => ({
            id: ds.id,
            name: ds.name ?? null,
            databaseId,
            databaseTitle: title,
          }))

          const fallback = fallbackDataSources.map((ds) => ({
            id: ds.id,
            name: ds.name,
            databaseId,
            databaseTitle: title,
          }))

          const summary: DatabaseSummary = {
            id: databaseId,
            title,
            dataSources: detailDataSources.length > 0 ? detailDataSources : fallback,
          }
          return summary
        } catch (error) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[Notion] Failed to retrieve data sources for database', databaseId, error)
          }

          if (!parentId) {
            const fallbackTitle = fallbackTitles.get(databaseId) ?? 'Untitled Database'
            const summary: DatabaseSummary = {
              id: databaseId,
              title: fallbackTitle,
              dataSources: fallbackDataSources.map((ds) => ({
                id: ds.id,
                name: ds.name,
                databaseId,
                databaseTitle: fallbackTitle,
              })),
            }
            return summary
          }

          return null
        }
      }),
    )

    return databaseSummaries.filter((summary): summary is DatabaseSummary => summary !== null)
  } catch (error) {
    handleNotionError(error)
  }
})
