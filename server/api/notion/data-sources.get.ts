import { Client } from '@notionhq/client'
import { defineEventHandler } from 'h3'
import { validateRequest, handleNotionError } from '~/server/utils/apiError'
import { getStubbedDataSource, getStubbedDataSources, isNotionStubEnabled } from '~/server/utils/notionStub'

interface NormalizedDataSourceLocation {
  type?: string
  database_id?: string
  page_id?: string
}

interface NormalizedDataSource {
  id: string
  name: string | null
  location: NormalizedDataSourceLocation | null
}

export default defineEventHandler(async (event) => {
  // Required: token. Optional: id (retrieve one data source), pageSize, includeDetails, debug
  const query = validateRequest(event, ['token'])
  const token = query.token as string
  const pageSize = Math.min(parseInt(String(query.pageSize ?? '25'), 10) || 25, 100)
  const includeDetails = String(query.includeDetails ?? 'true') === 'true'
  const debug = String(query.debug ?? 'false') === 'true'
  const dataSourceId = typeof query.id === 'string' && query.id ? query.id : null

  if (isNotionStubEnabled(token)) {
    if (dataSourceId) {
      try {
        return getStubbedDataSource(dataSourceId, token)
      } catch (error) {
        handleNotionError(error)
      }
    }
    const stubbed = getStubbedDataSources<NormalizedDataSource[]>()
    if (!debug) {
      return stubbed
    }
    return stubbed.map((source) => ({
      ...source,
      location: source.location ?? null,
      debug: {
        detailsError: null,
        probeError: null,
        detailsLocationPresent: !!source.location,
        detailsParentDbId: source.location?.database_id ?? null,
        probeDbId: source.location?.database_id ?? null,
      },
    }))
  }

  const notion = new Client({ auth: token, notionVersion: '2025-09-03' })

  // One data source with its schema (`properties`), as Notion returns it
  if (dataSourceId) {
    try {
      return await notion.request<Record<string, unknown>>({ method: 'get', path: `data_sources/${dataSourceId}` })
    } catch (error) {
      handleNotionError(error)
    }
  }

  try {
    const search = await notion.request<{ results: any[] }>({
      path: 'search',
      method: 'post',
      body: {
        filter: { property: 'object', value: 'data_source' },
        page_size: pageSize,
      },
    })

    const normalized: NormalizedDataSource[] = []

    for (const entry of search.results as any[]) {
      if (entry?.object !== 'data_source') continue

      // Support both shapes: nested `data_source` object or top-level
      const ds = entry?.data_source ?? entry
      const dsId: string | undefined = ds?.id ?? entry?.id
      let name: string | null = (ds?.name ?? null) as string | null
      let location: NormalizedDataSourceLocation | null = ds?.location ?? null

      if (!dsId) continue

      // Optionally enrich when location is missing
      let detailsError: any = null
      let probeError: any = null
      let detailsLocationPresent = false
      let detailsParentDbId: string | undefined
      let probeDbId: string | undefined
      if (includeDetails && (!location || !location.database_id)) {
        // 1) Try details endpoint first
        try {
          const details = await notion.request<any>({ method: 'get', path: `data_sources/${dsId}` })
          name = (name ?? details?.name ?? null) as string | null
          // Prefer explicit location if present; otherwise map from parent.database_id
          const parentDbId = details?.parent?.database_id as string | undefined
          detailsParentDbId = parentDbId
          if (details?.location) {
            location = details.location
            detailsLocationPresent = true
          } else if (parentDbId) {
            location = { ...(location ?? {}), type: 'database_id', database_id: parentDbId }
          }
        } catch (e: any) {
          if (debug) {
            detailsError = {
              name: e?.name,
              status: e?.status,
              code: e?.code,
              message: e?.message,
            }
          }
        }

        // 2) If still missing, probe via query to infer parent database
        if (!location || !location.database_id) {
          try {
            const probe = await notion.request<any>({
              method: 'post',
              path: `data_sources/${dsId}/query`,
              body: { page_size: 1 },
            })
            const first = Array.isArray(probe?.results) ? probe.results[0] : undefined
            const parent = first?.parent
            const dbId = parent?.database_id as string | undefined
            if (dbId) {
              location = { ...(location ?? {}), type: 'database_id', database_id: dbId }
              probeDbId = dbId
            }
          } catch (pe: any) {
            if (debug) {
              probeError = {
                name: pe?.name,
                status: pe?.status,
                code: pe?.code,
                message: pe?.message,
              }
            }
            // swallow
          }
        }
      }

      const base: any = { id: dsId, name, location: location ?? null }
      if (debug) {
        base.debug = {
          detailsError,
          probeError,
          detailsLocationPresent,
          detailsParentDbId: detailsParentDbId ?? null,
          probeDbId: probeDbId ?? null,
        }
      }
      normalized.push(base)
    }

    return normalized
  } catch (error) {
    handleNotionError(error)
  }
})
