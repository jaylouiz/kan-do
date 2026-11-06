<!--
@component WelcomePage
@description Willkommensseite: eine Frage („Wo sind deine Aufgaben heute?“) mit zwei gleichwertigen Antworten (#324)
@usage Einstiegspunkt für neue Nutzer unter /welcome
@responsibility
- „Noch nirgends“ öffnet das lokale Setup und endet mit Lokal als einziger Verbindung und Standard
- „In Notion“ öffnet das Notion-Setup und endet mit Notion als verbundener Verbindung und Standard
- Keine gefüllte Schaltfläche: beide Antworten sind ganze Zeilen (Button, min. 64px), keine hervorgehoben
- Todoist wird nicht angeboten; weitere Verbindungen kommen später in den Einstellungen dazu
- Reagiert auf globalen Notion-Setup-Trigger (Fehlerbehandlung)
-->
<template>
  <div class="px-safe bg-page">
  <main class="relative flex min-h-screen items-center justify-center bg-page px-4 py-16 sm:px-6">
    <!-- A launch with an unreachable data folder lands here with empty stores: say so (#224). On desktop it starts
         below the bar row: the window drag strip (app.vue, #614) and the traffic lights occupy that row. -->
    <div class="top-safe-3 absolute inset-x-4 z-10 mx-auto max-w-3xl in-data-[shell=desktop]:pt-(--app-bar-offset-top)">
      <DataStorageNotice />
    </div>
    <div class="mx-auto w-full max-w-lg">
      <h1 class="font-display tracking-display text-3xl leading-(--lh-tight) text-balance text-highlighted sm:text-4xl">
        {{ t('onboarding.page.title') }}
      </h1>
      <div class="mt-8 flex flex-col gap-3">
        <button
          v-for="choice in choices"
          :key="choice.key"
          type="button"
          class="flex min-h-16 w-full items-center gap-4 rounded-xl border border-default bg-elevated p-4 text-left hover:border-accented focus-ring"
          :data-testid="`welcome-choice-${choice.key}`"
          @click="choice.open()"
        >
          <UIcon :name="choice.icon" class="size-6 shrink-0 text-toned" aria-hidden="true" />
          <span class="min-w-0 flex-1 text-lg font-medium text-highlighted">{{ choice.label }}</span>
          <UIcon name="i-ph-arrow-right" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        </button>
      </div>
      <p class="mt-6 text-sm text-muted">{{ t('onboarding.page.later') }}</p>

      <NotionSetupModal
        v-model:open="isNotionSetupModalOpen"
        force-setup
        @complete="handleNotionSetupComplete"
      />
      <LocalSetupModal
        v-model:open="isLocalSetupModalOpen"
        @complete="handleLocalSetupComplete"
      />
    </div>
    <p class="absolute right-2 bottom-2 text-xs text-muted">
      {{ t('onboarding.page.version') }} {{ $config.public.clientVersion }}
    </p>
  </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import DataStorageNotice from '~/components/settings/DataStorageNotice.vue';
import { useBoardStore } from '~/store/board';
import { useTasksStore } from '~/store/tasks';
import { useIntegrationManager } from '~/composables/useIntegrationManager';
import { useErrorHandler } from '~/composables/useErrorHandler';

// No app bar here (#470): first run, developer pages and the empty redirect page
definePageMeta({ appNav: false })

const { t } = useI18n();
const boardStore = useBoardStore();
const tasksStore = useTasksStore();
const { fetchTasks } = useIntegrationManager();
const { handleError } = useErrorHandler();
const isNotionSetupModalOpen = ref(false); // State for modal visibility
const isLocalSetupModalOpen = ref(false); // State for local setup modal

/** Two equal answers, neither primary: where are the tasks today? */
const choices = computed(() => [
  { key: 'local', icon: 'i-ph-desktop', label: t('onboarding.page.nowhere'), open: () => { isLocalSetupModalOpen.value = true; } },
  { key: 'notion', icon: 'i-simple-icons-notion', label: t('onboarding.page.inNotion'), open: () => { isNotionSetupModalOpen.value = true; } },
]);

/**
 * Wird nach erfolgreichem Local-Setup aufgerufen: Service setzen und navigieren.
 */
const handleLocalSetupComplete = async () => {
  try {
    boardStore.setSingleSource('local');
    tasksStore.adoptAsLocal();
    isLocalSetupModalOpen.value = false;
    await navigateTo('/tasks');
  } catch (error) {
    handleError(error as Error, 'setup');
  }
};

/**
 * Wird nach erfolgreichem Notion-Setup aufgerufen: Service setzen, laden und navigieren.
 */
const handleNotionSetupComplete = async () => {
  try {
    tasksStore.beginSourceSwitch('notion');
    
    // Try to fetch initial tasks, but don't block navigation if it fails
    try {
      await fetchTasks();
    } catch (fetchError) {
      // Log but continue - user can retry from tasks page
      if (import.meta.dev) {
        console.log('[WelcomePage] Initial fetch after setup failed, continuing to tasks page:', fetchError);
      }
    }

    // Close modal first to prevent state conflicts
    isNotionSetupModalOpen.value = false;
    
    // Use nextTick to ensure DOM updates are complete
    await nextTick();
    
    await navigateTo('/tasks');
  } catch (error) {
    handleError(error as Error, 'notion_setup');
    
    // Close modal and navigate regardless - the service is configured
    isNotionSetupModalOpen.value = false;
    await nextTick();
    
    // Navigate to tasks page even if there was an error
    await navigateTo('/tasks');
  }
};
</script>

<style></style>
