<!--
@component ErrorHandlerTestPage
@description Testseite für die Fehlermeldungs- und Hinweisfunktionen
@usage Manuell unter /error-test aufrufen, um Toasts/Trigger zu testen
@responsibility
- Löst Fehler in verschiedenen Kontexten aus
- Zeigt Erfolgs- und Warnmeldungen
-->
<template>
  <div class="space-y-4 p-4">
    <h1 class="mb-4 text-2xl font-bold">Error Handler Test</h1>
    
    <div class="space-y-2">
      <UButton color="error" @click="triggerError('notion_setup')">
        Trigger Notion Setup Error
      </UButton>
      
      <UButton color="warning" @click="triggerError('task_sync')">
        Trigger Task Sync Error
      </UButton>
      
      <UButton color="success" @click="showSuccess">
        Show Success Message
      </UButton>
      
      <UButton color="warning" @click="showWarning">
        Show Warning
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ErrorContext } from '~/composables/useErrorHandler'

// No app bar here (#470): first run, developer pages and the empty redirect page
definePageMeta({ appNav: false })
type ErrorContextKey = ErrorContext

const { handleError, handleSuccess, handleWarning } = useErrorHandler()

/**
 * Löst einen Testfehler für den angegebenen Kontext aus.
 */
const triggerError = (errContext: ErrorContextKey) => {
  const error = new Error(`Test error for ${errContext}`)
  handleError(error, errContext)
}

/**
 * Zeigt eine Beispiel-Erfolgsmeldung.
 */
const showSuccess = () => {
  handleSuccess('Dies ist eine Erfolgsmeldung!')
}

/**
 * Zeigt eine Beispiel-Warnung.
 */
const showWarning = () => {
  handleWarning('Dies ist eine Warnung!')
}
</script>
