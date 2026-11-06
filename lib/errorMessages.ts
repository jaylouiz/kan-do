import { translate } from '~/lib/i18n'

export type ErrorContext = 'notion_setup' | 'todoist_setup' | 'task_sync' | 'task_operation' | 'setup' | 'network' | 'statistics_backfill' | 'task_delete' | 'task_restore' | 'task_create' | 'clipboard' | 'secrets' | 'secrets_reset' | 'external_link' | 'feedback'

/** Locale keys of the user-facing error messages produced by `getErrorMessageKey`. */
export type ErrorMessageKey =
  | 'errors.configuration'
  | 'errors.integrationSetupMissing'
  | 'errors.integrationNotSupported'
  | 'errors.notionNotConfigured'
  | 'errors.notionTokenInvalid'
  | 'errors.notionDatabaseNotFound'
  | 'errors.notionSyncFailed'
  | 'errors.todoistTokenMissing'
  | 'errors.todoistSyncFailed'
  | 'errors.taskNotFound'
  | 'errors.taskUpdateFailed'
  | 'errors.taskDeleteFailed'
  | 'errors.taskRestoreFailed'
  | 'errors.taskCreateFailed'
  | 'errors.clipboardFailed'
  | 'errors.secretsFailed'
  | 'errors.secretsResetFailed'
  | 'errors.externalLinkFailed'
  | 'errors.feedbackFailed'
  | 'errors.networkError'
  | 'errors.networkOffline'
  | 'errors.apiError'
  | 'errors.default'

/**
 * An error whose user-facing text is a locale key. Display sites check
 * `instanceof LocalizedError` and translate `key` (with `named`) in the active locale;
 * `message` carries the text in the locale active at throw time for logs and fallbacks.
 */
export class LocalizedError extends Error {
  readonly key: string
  readonly named: Record<string, unknown> | undefined

  constructor(key: string, named?: Record<string, unknown>) {
    super(translate(key, named))
    this.name = 'LocalizedError'
    this.key = key
    this.named = named
  }
}

/** User-facing text for a thrown value: translated key for LocalizedError, else its message or the fallback. */
export const getDisplayMessage = (error: unknown, fallback: string): string => {
  if (error instanceof LocalizedError) return translate(error.key, error.named)
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * Maps an error (and optional context) to the locale key of its friendly message.
 *
 * A `LocalizedError` is routed by its `key` and never by its translated text, so rewording a locale string
 * cannot change the mapping (#487); a localized error with no key rule gets the context mapping only.
 * A plain string (or message) keeps the English substring mapping for server and upstream texts.
 */
export const getErrorMessageKey = (error: string | LocalizedError, errContext?: ErrorContext): ErrorMessageKey => {
  const errorLower = error instanceof LocalizedError ? '' : error.toLowerCase()
  // Notion is not set up: the localized key, or the plain texts "Notion ... not configured / not set up"
  const notionNotSetUp = error instanceof LocalizedError
    ? error.key === 'errors.notionNotConfiguredShort'
    : errorLower.includes('notion') && (errorLower.includes('not configured') || errorLower.includes('not set up'))

  // Context-specific mapping

  if (errContext === 'clipboard') {
    return 'errors.clipboardFailed'
  }

  if (errContext === 'secrets') {
    return 'errors.secretsFailed'
  }

  if (errContext === 'secrets_reset') {
    return 'errors.secretsResetFailed'
  }

  if (errContext === 'external_link') {
    return 'errors.externalLinkFailed'
  }

  if (errContext === 'feedback') {
    return 'errors.feedbackFailed'
  }

  if (errContext === 'task_delete') {
    return 'errors.taskDeleteFailed'
  }

  if (errContext === 'task_restore') {
    return 'errors.taskRestoreFailed'
  }

  if (errContext === 'setup') {
    if (errorLower.includes('missing')) {
      return 'errors.integrationSetupMissing'
    }
    if (errorLower.includes('invalid')) {
      return 'errors.integrationSetupMissing'
    }
    if (errorLower.includes('not supported') || errorLower.includes('unsupported')) {
      return 'errors.integrationNotSupported'
    }
  }

  if (errContext === 'notion_setup') {
    if (errorLower.includes('token') || errorLower.includes('invalid')) {
      return 'errors.notionTokenInvalid'
    }
    if (errorLower.includes('database')) {
      return 'errors.notionDatabaseNotFound'
    }
    return 'errors.notionSyncFailed'
  }

  if (errContext === 'task_sync') {
    if (errorLower.includes('notion')) {
      return 'errors.notionSyncFailed'
    }
    if (errorLower.includes('todoist')) {
      return 'errors.todoistSyncFailed'
    }
    if (errorLower.includes('not found')) {
      return 'errors.taskNotFound'
    }
  }

  // Create failures: actionable setup errors keep their specific text, everything else
  // (including api/not-found pattern matches) falls back to the create message
  if (errContext === 'task_create') {
    if (notionNotSetUp) {
      return 'errors.notionNotConfigured'
    }
    if (errorLower.includes('todoist') && errorLower.includes('token')) {
      return 'errors.todoistTokenMissing'
    }
    return 'errors.taskCreateFailed'
  }

  // General error mapping
  if (notionNotSetUp) {
    return 'errors.notionNotConfigured'
  }

  if (errorLower.includes('todoist') && errorLower.includes('token')) {
    return 'errors.todoistTokenMissing'
  }

  if (errorLower.includes('task') && errorLower.includes('not found')) {
    return 'errors.taskNotFound'
  }

  if (errorLower.includes('network') || errorLower.includes('fetch')) {
    return 'errors.networkError'
  }

  if (errorLower.includes('api') || errorLower.includes('http')) {
    return 'errors.apiError'
  }

  return 'errors.default'
}

/**
 * Detects if an error is a network/connectivity error
 */
export const isNetworkError = (error: unknown): boolean => {
  if (!error) return false

  const message = typeof error === 'string' ? error : (error as Error)?.message || ''
  const errorLower = message.toLowerCase()

  // Check for common network error patterns
  return (
    error instanceof TypeError || // Most fetch errors are TypeErrors
    errorLower.includes('failed to fetch') ||
    errorLower.includes('fetch failed') || // Server-side fetch errors
    errorLower.includes('network request failed') ||
    errorLower.includes('networkerror') ||
    errorLower.includes('fetch error') ||
    errorLower.includes('load failed') ||
    errorLower.includes('connection') ||
    errorLower.includes('timeout') ||
    errorLower.includes('aborted') ||
    errorLower.includes('unreachable') ||
    (error as { name?: string })?.name === 'AbortError' || // AbortController timeout
    (error as { code?: string })?.code === 'ECONNREFUSED' ||
    (error as { code?: string })?.code === 'ENOTFOUND' ||
    (error as { code?: string })?.code === 'ETIMEDOUT'
  )
}
