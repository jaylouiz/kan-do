import { createError, getQuery, getHeader } from 'h3'
import type { H3Event } from 'h3'

/**
 * Validates that required query parameters are present in the request
 * 
 * @param {H3Event} event - The H3 event object
 * @param {string[]} requiredParams - Array of required parameter names
 * @returns {Record<string, any>} The query parameters object
 * @throws {H3Error} 400 error if required parameters are missing
 * 
 * @example
 * const query = validateRequest(event, ['token', 'databaseId'])
 * const token = query.token as string
 */
/**
 * Extracts the Notion token from the Authorization header.
 * Use this in POST/PATCH handlers that receive the token via header.
 */
export function getTokenFromEvent(event: H3Event): string | null {
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  return null
}

export function validateRequest(event: H3Event, requiredParams: string[] = []): Record<string, unknown> {
  const query = { ...getQuery(event) }

  // Accept token from Authorization: Bearer <token> header as alternative to query param
  if (!query['token']) {
    const token = getTokenFromEvent(event)
    if (token) query['token'] = token
  }

  const missing = requiredParams.filter(param => !query[param])
  if (missing.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: {
        error: 'MISSING_PARAMETERS',
        message: `Missing required parameters: ${missing.join(', ')}`,
        missing
      }
    })
  }
  
  return query
}

/**
 * Creates a standardized API error using H3's createError
 * 
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {any} data - Additional error data
 * @returns {never} Throws an H3Error
 * 
 * @example
 * throwApiError(404, 'Resource not found', { resource: 'task', id: '123' })
 */
export function throwApiError(statusCode: number, message: string, data?: unknown): never {
  throw createError({
    statusCode,
    statusMessage: getStatusMessage(statusCode),
    data: {
      error: getErrorCode(statusCode),
      message,
      ...(data && typeof data === 'object' ? (data as Record<string, unknown>) : {})
    }
  })
}

/**
 * Handles Notion API errors and converts them to standardized H3 errors
 * 
 * @param {unknown} error - The caught error
 * @throws {H3Error} Standardized error response
 * 
 * @example
 * try {
 *   await notion.databases.query(...)
 * } catch (error) {
 *   handleNotionError(error)
 * }
 */
export function handleNotionError(error: unknown): never {
  console.error('[Notion API Error]', error)
  
  if (error instanceof Error && error.name === 'APIResponseError') {
    // Try to read common fields exposed by @notionhq/client APIResponseError
    const anyErr = error as unknown as { status?: number; code?: string; message?: string }
    const status = anyErr?.status
    const code = anyErr?.code

    // Map clear auth failures to 401
    if (status === 401 || code === 'unauthorized') {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: {
          error: 'UNAUTHORIZED',
          message: error.message
        }
      })
    }

    // Rate limiting hint (Notion may surface 429)
    if (status === 429 || code === 'rate_limited') {
      throw createError({
        statusCode: 429,
        statusMessage: 'Too Many Requests',
        data: {
          error: 'RATE_LIMITED',
          message: error.message
        }
      })
    }

    // A refused or missing resource (deleted or unshared database or page) keeps its status, so the client
    // classifies it like the desktop client does (`broken` for a source, a task-level failure for a write).
    // So does a request Notion refuses as invalid (400 validation_error) or in conflict (409): a create the
    // add form must keep open for (#321) must not look like a gateway fault (502 is retried as transient)
    if (status === 400 || status === 403 || status === 404 || status === 409) {
      throw createError({
        statusCode: status,
        statusMessage: { 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict' }[status],
        data: {
          error: 'NOTION_API_ERROR',
          message: error.message
        }
      })
    }

    // Default external service error mapping
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      data: {
        error: 'NOTION_API_ERROR',
        message: error.message
      }
    })
  }
  
  // Re-throw if it's already an H3 error
  if (error && typeof error === 'object' && 'statusCode' in error) {
    throw error
  }
  
  // Generic error fallback
  throw createError({
    statusCode: 500,
    statusMessage: 'Internal Server Error',
    data: {
      error: 'UNKNOWN_ERROR',
      message: error instanceof Error ? error.message : 'An unknown error occurred'
    }
  })
}

/**
 * Gets the standard HTTP status message for a status code
 */
function getStatusMessage(statusCode: number): string {
  const messages: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable'
  }
  return messages[statusCode] || 'Error'
}

/**
 * Gets a standardized error code for a status code
 */
function getErrorCode(statusCode: number): string {
  const codes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    422: 'VALIDATION_ERROR',
    500: 'INTERNAL_ERROR',
    502: 'EXTERNAL_SERVICE_ERROR',
    503: 'SERVICE_UNAVAILABLE'
  }
  return codes[statusCode] || 'ERROR'
}
