import { Client } from '@notionhq/client'
import { defineEventHandler, createError } from 'h3'
import { validateRequest, handleNotionError } from '~/server/utils/apiError'
import { getStubPages, isNotionStubEnabled } from '~/server/utils/notionStub'

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

    if (isNotionStubEnabled(token)) {
      return getStubPages(token)
    }

    const notion = new Client({ auth: token, notionVersion: '2025-09-03' })
    
    // Build filter array with mapped status values
    const statusFilters = [
      {
        property: propertyMapping.status,
        select: {
          equals: statusMapping.today,
        },
      },
      {
        property: propertyMapping.status,
        select: {
          equals: statusMapping.doing,
        },
      },
      {
        property: propertyMapping.status,
        select: {
          equals: statusMapping.done,
        },
      },
    ]
    
    // Add waiting status if it's configured
    if (statusMapping.waiting) {
      statusFilters.push({
        property: propertyMapping.status,
        select: {
          equals: statusMapping.waiting,
        },
      });
    }

    let response: { results?: unknown[] } | undefined
    try {
      response = await notion.request({
        method: 'post',
        path: `data_sources/${dataSourceId}/query`,
        body: {
          filter: {
            or: statusFilters,
          },
        },
      }) as { results?: unknown[] }
    } catch (error) {
      handleNotionError(error)
    }

    // Debug logging for response inspection (dev only)
    if (process.env.NODE_ENV !== 'production' && response) {
      console.log("=== NOTION API RESPONSE DEBUG ===");
      console.log("Response object keys:", Object.keys(response));
      console.log("Response.results length:", response.results?.length || 0);
      console.log("Full response structure:", JSON.stringify(response, null, 2));
    }
    
    if (process.env.NODE_ENV !== 'production' && response?.results && response.results.length > 0) {
      const firstResult = response.results[0] as unknown;
      console.log("First result structure:", JSON.stringify(firstResult, null, 2));
      if (firstResult && typeof firstResult === 'object') {
        const fr = firstResult as Record<string, unknown>;
        if ('properties' in fr && typeof fr.properties === 'object' && fr.properties) {
          console.log("First result properties:", Object.keys(fr.properties as Record<string, unknown>));
        } else if ('object' in fr) {
          console.log("First result type:", (fr as Record<string, unknown>).object);
        }
      }
      console.log("=== END DEBUG ===");
    }

    return response?.results ?? [];
});
