<!--
@component WelcomePage
@description Willkommensseite: eine Frage („Wo sind deine Aufgaben heute?“) mit zwei gleichwertigen Antworten (#324)
@usage Einstiegspunkt für neue Nutzer unter /welcome
@responsibility
- „Noch nirgends“ zeigt das lokale Setup auf dieser Seite (kein Dialog, #43) und endet mit Lokal als einziger Verbindung und Standard
- „In Notion“ zeigt das Notion-Setup auf dieser Seite (Schienen-Führung, Schritte des WizardController) und endet mit Notion als verbundener Verbindung und Standard
- Startansicht und Setup tauschen als ein Block (eine Transition, Höhe per WAAPI, Breite per CSS); reduzierte Bewegung: sofort
- Fokus: nach dem Tausch auf die Überschrift des Setups, beim Zurück auf die Antwortzeile, von der man kam
- Keine gefüllte Schaltfläche: beide Antworten sind ganze Zeilen (Button, min. 64px), keine hervorgehoben
- Todoist wird nicht angeboten; weitere Verbindungen kommen später in den Einstellungen dazu
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
    <div
      class="welcome-sheet relative mt-40 w-full rounded-t-2xl bg-default px-6 pt-6 shadow-(--shadow-task) transition-[max-width] duration-(--duration-slow) ease-out motion-reduce:transition-none sm:mt-0 sm:rounded-2xl sm:px-10 sm:pt-10"
      :class="flow === 'notion' ? 'sm:max-w-3xl' : 'sm:max-w-lg'"
    >
      <header class="mb-8">
        <p class="font-display tracking-display text-4xl leading-(--lh-tight) text-highlighted sm:text-5xl">{{ t('nav.brand') }}</p>
        <p class="mt-2 text-base text-default">{{ t('onboarding.page.tagline') }}</p>
      </header>
      <!-- One Transition for the whole content: start screen and setup swap as a single block and the block's height
           follows (setup-body), so nothing animates element by element (#43) -->
      <div ref="body" class="setup-body">
        <Transition name="swap" mode="out-in" @before-leave="onBeforeLeave" @enter="onEnter" @after-enter="onAfterEnter">
          <div :key="flow ?? 'start'" class="swap-block">
            <LocalSetupFlow
              v-if="flow === 'local'"
              ref="localFlow"
              @back="leaveFlow"
              @complete="handleLocalSetupComplete"
            />
            <NotionSetupFlow
              v-else-if="flow === 'notion'"
              @back="leaveFlow"
              @complete="handleNotionSetupComplete"
            />
            <template v-else>
        <h1 class="font-display tracking-display text-3xl leading-(--lh-tight) text-balance text-highlighted sm:text-4xl">
          {{ t('onboarding.page.title') }}
        </h1>
        <div class="mt-8 flex flex-col gap-3">
          <!-- Raw button on purpose (#71, ui-kit audit): a two-line choice card with a go-on arrow is not a button look; #72/#76 decide whether it joins a choice or list-row primitive. -->
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
            <UIcon :name="ICONS.goOn" class="size-5 shrink-0 text-muted" aria-hidden="true" />
          </button>
        </div>
        <p class="mt-6 text-sm text-muted">{{ t('onboarding.page.later') }}</p>
        <p class="mt-8 text-xs text-muted">
          {{ t('onboarding.page.version') }} {{ $config.public.clientVersion }}
        </p>

            </template>
          </div>
        </Transition>
      </div>
    </div>
  </main>
  </div>
</template>

<script setup lang="ts">
import { ICONS } from '~/lib/icons'
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import LocalSetupFlow from '~/components/setup/LocalSetupFlow.vue';
import NotionSetupFlow from '~/components/setup/NotionSetupFlow.vue';
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
/** Which setup is shown in place of the start screen (#43) */
const flow = ref<'local' | 'notion' | null>(null);
const lastFlow = ref<'local' | 'notion'>('local');
const body = ref<HTMLElement | null>(null);
const reducedMotion = () => import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pin the container at its current height so the leave does not collapse it */
function onBeforeLeave() {
  const el = body.value;
  if (el && !reducedMotion()) el.style.height = `${el.offsetHeight}px`;
}
/** The new block is in (still transparent, no enter delay): ease the container to its height, then drop the pin */
function onEnter(el: Element, done: () => void) {
  const container = body.value;
  if (!container || reducedMotion()) {
    if (container) container.style.height = '';
    return done();
  }
  const from = container.offsetHeight;
  container.style.height = '';
  const to = (el as HTMLElement).offsetHeight;
  const anim = container.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 300, easing: 'cubic-bezier(.3,.8,.3,1)' });
  anim.finished.then(done, done);
}
/**
 * Focus follows the swap: into the setup's heading, or back onto the row the user came from. It runs when the height
 * animation ends (300 ms, later on a slow machine), so only while focus is still lost (the removed block's button left
 * it on the body): a user who already tabbed or clicked into the new block keeps their place (#100).
 */
function onAfterEnter(el: Element) {
  const active = document.activeElement;
  if (active && active !== document.body) return;
  if (flow.value) el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  else el.querySelector<HTMLElement>(`[data-testid="welcome-choice-${lastFlow.value}"]`)?.focus({ preventScroll: true });
}
function openFlow(key: 'local' | 'notion') {
  lastFlow.value = key;
  flow.value = key;
}
function leaveFlow() {
  flow.value = null;
}

/** Two equal answers, neither primary: where are the tasks today? */
const choices = computed(() => [
  { key: 'local', icon: 'i-ph-desktop', label: t('onboarding.page.nowhere'), open: () => openFlow('local') },
  { key: 'notion', icon: 'i-simple-icons-notion', label: t('onboarding.page.inNotion'), open: () => openFlow('notion') },
]);

/**
 * Wird nach erfolgreichem Local-Setup aufgerufen: Service setzen und navigieren.
 */
const handleLocalSetupComplete = async () => {
  try {
    boardStore.setSingleSource('local');
    tasksStore.adoptAsLocal();
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

    await navigateTo('/tasks');
  } catch (error) {
    handleError(error as Error, 'notion_setup');
    
    // Navigate regardless - the service is configured
    // Navigate to tasks page even if there was an error
    await navigateTo('/tasks');
  }
};
</script>

<style>
/* 12px clip margin: the Back button sits 4px outside the body and its focus ring reaches 4px beyond it (2px offset + 2px width) */
.setup-body { position: relative; overflow: clip; overflow-clip-margin: 12px; }
/* Leave 140 ms, enter 240 ms straight after it (no delay: a delay shows an empty sheet for a beat) */
.swap-enter-active { transition: opacity 0.24s cubic-bezier(0.3, 0.8, 0.3, 1), transform 0.24s cubic-bezier(0.3, 0.8, 0.3, 1); }
.swap-leave-active { transition: opacity 0.14s ease-in, transform 0.14s ease-in; }
/* Both ends rest at .12, not 0: out-in has one frame between leave and enter, and at 0 the sheet shows an empty block for a beat */
.swap-enter-from { opacity: 0.12; transform: translateY(8px); }
.swap-leave-to { opacity: 0.12; transform: translateY(-4px); }
@media (prefers-reduced-motion: reduce) {
  .swap-enter-active, .swap-leave-active { transition: none; }
  .swap-enter-from, .swap-leave-to { opacity: 1; transform: none; }
}
</style>
