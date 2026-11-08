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
- Ein ruhiges Foto (Jalousie-Schatten, gebündelt in public/welcome, Quelle in CREDITS.md) füllt die Seite; es ist nur
  Stimmung: Text steht nie direkt darauf. Mittig ein heller Bogen (Oberfläche und Schatten wie ein Dialog) trägt
  Wortmarke, Zeile, Frage, Antworten, Hinweis und Version. Am Telefon füllt der Bogen die Breite, darüber bleibt ein Foto-Streifen.
- Das Foto blendet beim Laden ein (ohne Layoutsprung); lädt es nicht, bleibt die Seite auf Papierfarbe, der Bogen unverändert
-->
<template>
  <div class="px-safe bg-page">
  <main class="relative flex min-h-dvh flex-col justify-end overflow-hidden bg-page sm:items-center sm:justify-center sm:p-6">
    <!-- Atmosphere only (alt=""): fades in once loaded, a failed load leaves the paper colour -->
    <img
      ref="photo"
      src="/welcome/blinds-2000.webp"
      srcset="/welcome/blinds-800.webp 800w, /welcome/blinds-2000.webp 2000w"
      sizes="100vw"
      alt=""
      aria-hidden="true"
      decoding="async"
      data-testid="welcome-photo"
      class="pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-700 motion-reduce:transition-none"
      :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
      @load="photoLoaded = true"
    >
    <!-- A launch with an unreachable data folder lands here with empty stores: say so (#224). On desktop it starts
         below the bar row: the window drag strip (app.vue, #614) and the traffic lights occupy that row. -->
    <div class="top-safe-3 absolute inset-x-4 z-10 mx-auto max-w-3xl in-data-[shell=desktop]:pt-(--app-bar-offset-top)">
      <DataStorageNotice />
    </div>
    <div class="welcome-sheet relative mt-40 w-full rounded-t-2xl bg-default p-6 shadow-lg sm:mt-0 sm:max-w-lg sm:rounded-2xl sm:p-10">
      <header class="mb-8">
        <p class="font-display tracking-display text-4xl leading-(--lh-tight) text-highlighted sm:text-5xl">{{ t('nav.brand') }}</p>
        <p class="mt-2 text-base text-default">{{ t('onboarding.page.tagline') }}</p>
      </header>
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
      <p class="mt-8 text-xs text-muted">
        {{ t('onboarding.page.version') }} {{ $config.public.clientVersion }}
      </p>

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
  </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue';
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
const photo = ref<HTMLImageElement | null>(null);
const photoLoaded = ref(false);
// A cached or early-loaded photo can finish before hydration: its load event is gone, so check once on mount
onMounted(() => {
  if (photo.value?.complete && photo.value.naturalWidth > 0) photoLoaded.value = true;
});
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
