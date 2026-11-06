import { hasInjectionContext } from 'vue'
import { useNuxtApp, useToast } from '#imports'
import { getErrorMessageKey, isNetworkError, LocalizedError, type ErrorContext, type ErrorMessageKey } from "~/lib/errorMessages"
import { translate } from "~/lib/i18n"
import { useIntegrationHealthStore } from "~/store/integrationHealth"
import { useBoardStore } from "~/store/board"
import { isIntegrationSourceId } from "~/lib/taskSources"
import type { IntegrationSourceId } from "~/types/taskSource"

// Error deduplication state
let lastErrorTimestamp = 0
let lastErrorMessage = ''
const ERROR_DEBOUNCE_MS = 3000 // 3 seconds

/** Options of `handleError`: the integration the error belongs to, when the caller knows it. */
export interface HandleErrorOptions {
  source?: IntegrationSourceId
}

/**
 * The integration an error is about: the caller's say, else the setup context, else the board's default
 * source when that is an integration. `null` for an error that belongs to no integration (a Local board).
 */
const resolveSource = (errorContext: ErrorContext | undefined, explicit: IntegrationSourceId | undefined): IntegrationSourceId | null => {
  if (explicit) return explicit
  if (errorContext === 'notion_setup') return 'notion'
  if (errorContext === 'todoist_setup') return 'todoist'
  const fallback = useBoardStore().defaultSource
  return fallback !== null && isIntegrationSourceId(fallback) ? fallback : null
}

export const useErrorHandler = () => {
  // useToast() calls inject(); integration classes call this after an await, outside setup.
  // There, run it in the app context so Vue does not warn. Inside setup, call it directly:
  // an app context would shadow component provides such as the Toaster's max-toasts limit.
  const toast = hasInjectionContext()
    ? useToast()
    : useNuxtApp().vueApp.runWithContext(() => useToast())

  const handleError = (error: Error | string, errorContext?: ErrorContext, options: HandleErrorOptions = {}) => {
    const message = typeof error === 'string' ? error : error.message
    // Try to extract structured fields if available
    const anyErr = error as unknown as { statusCode?: number; code?: string; data?: { error?: string } }
    const statusCode = anyErr?.statusCode
    const code = anyErr?.code || anyErr?.data?.error
    const health = useIntegrationHealthStore()
    const source = resolveSource(errorContext, options.source)
    
    // Always log technical details for debugging
    console.error(errorContext ? `[${errorContext}] ${message}` : message, error)
    
    // Debug: Log error type and check network detection
    if (import.meta.dev) {
      console.log('[ErrorHandler] Error details:', {
        type: error?.constructor?.name,
        message,
        isNetworkError: isNetworkError(error),
        statusCode,
        code
      })
    }
    
    // Deduplicate identical errors within time window. A failed create is never deduplicated:
    // every submit the user retries needs its own feedback.
    const now = Date.now()
    if (errorContext !== 'task_create' && message === lastErrorMessage && (now - lastErrorTimestamp) < ERROR_DEBOUNCE_MS) {
      if (import.meta.dev) {
        console.log('[ErrorHandler] Suppressing duplicate error toast')
      }
      return
    }
    
    lastErrorTimestamp = now
    lastErrorMessage = message
    
    // Detect network errors and mark as offline
    if (isNetworkError(error)) {
      // Only show toast if transitioning from non-offline to offline state
      const wasOffline = source !== null && health.isOffline(source)
      if (source !== null) health.markOffline(source, message)
      
      if (import.meta.dev) {
        console.log('[ErrorHandler] Network error detected, marking as offline', { wasOffline })
      }
      
      // Show toast only on transition to offline (not if already offline)
      if (!wasOffline && toast && typeof toast.add === 'function') {
        toast.add({
          title: translate('errors.title.offline'),
          description: translate('errors.networkOffline'),
          color: 'warning',
          duration: 5000,
          icon: 'i-ph-wifi-slash'
        })
      } else if (wasOffline && errorContext === 'task_create' && toast && typeof toast.add === 'function') {
        // The offline toast already showed earlier, but this submit still failed: say so
        toast.add({
          title: translate('errors.title.error'),
          description: translate('errors.taskCreateFailed'),
          color: 'error',
          duration: 5000,
          icon: 'i-ph-warning'
        })
      } else if (wasOffline && import.meta.dev) {
        console.log('[ErrorHandler] Already offline, suppressing duplicate toast')
      }
      return
    }
    
    // An authentication or configuration failure marks the source as broken. The setup dialog never opens by
    // itself (#319): the sync button's popover offers "Verbindung reparieren" for the source.
    if (statusCode === 401 || code === 'UNAUTHORIZED' || errorContext === 'notion_setup') {
      if (source !== null) health.markBroken(source, message)
    }

    // Derive the localized message key and optionally suppress noisy toast in broken state.
    // A LocalizedError is routed by its key (its message is locale-dependent, #487), anything else by its text.
    // A failed create keeps the specific text of setup errors (LocalizedError, 401) instead of "try again"
    const messageKey: ErrorMessageKey =
      errorContext === 'task_create' && error instanceof LocalizedError ? (error.key as ErrorMessageKey)
      : errorContext === 'task_create' && statusCode === 401 ? 'errors.notionTokenInvalid'
      : getErrorMessageKey(error instanceof LocalizedError ? error : message, errorContext)

    // If Notion is in a broken state and the message is the generic sync failed one,
    // suppress the toast because the sync button already explains the situation (#319).
    if (health.isBroken('notion') && messageKey === 'errors.notionSyncFailed') {
      return
    }

    // Show localized user-friendly message
    if (toast && typeof toast.add === 'function') {
      toast.add({
        title: translate('errors.title.error'),
        description: translate(messageKey),
        color: 'error',
        duration: 5000,
        icon: 'i-ph-warning'
      });
    }
  }

  const handleSuccess = (message: string) => {
    if (toast && typeof toast.add === 'function') {
      toast.add({
        title: translate('errors.title.success'),
        description: message,
        color: 'success',
        duration: 3000,
        icon: 'i-ph-check-circle'
      });
    }
  }

  const handleWarning = (message: string) => {
    if (toast && typeof toast.add === 'function') {
      toast.add({
        title: translate('errors.title.warning'),
        description: message,
        color: 'warning',
        duration: 4000,
        icon: 'i-ph-warning'
      });
    }
  }

  return { handleError, handleSuccess, handleWarning }
}


export type { ErrorContext }
