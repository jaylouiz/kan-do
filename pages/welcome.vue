<!--
@component WelcomePage
@description Willkommensseite (#294): ein Start mit einer gefüllten Schaltfläche („Loslegen“) und dem Ausprobieren mit Beispielaufgaben als leiser zweiter Weg (#236); Schritt 2 sagt „lokal ist immer dabei“ und bietet Notion (und Todoist, später) als Checkliste an
@usage Einstiegspunkt für neue Nutzer unter /welcome
@responsibility
- Startansicht: Überschrift, eine Zeile („Standardmäßig lokal, externe Dienste jetzt oder später“), „Loslegen“ (die einzige gefüllte Schaltfläche, The One Lamp Rule) und „Mit Beispielaufgaben starten“ (ghost); bewusst niedrig, damit am Telefon mehr Foto und das Grün der Schaltfläche sichtbar sind
- „Loslegen“ öffnet Schritt 2 (LocalSetupFlow, kein Dialog, #43): Notion als Checkbox, Todoist deaktiviert „(kommt später)“; ohne Haken endet er mit Lokal als einziger Verbindung und Standard, mit Haken startet er das Notion-Setup auf dieser Seite (Schienen-Führung, Schritte des WizardController), das mit Notion als verbundener Verbindung und Standard endet; Zurück aus dem Notion-Setup führt zu Schritt 2, der Haken bleibt
- „Mit Beispielaufgaben starten“ öffnet einen eigenen Schritt 2: er sagt, dass ein Zurücksetzen unter Einstellungen › Daten & Speicher Beispiele und Statistik entfernt; „Board ansehen“ endet wie das lokale Setup
- Der Weg zum Board blendet die Seite (Foto und Bogen) über dem schon fertigen Board aus (`.welcome-root`, transitions.css): das Board liegt in seinem Endlayout darunter, nichts springt danach; reduzierte Bewegung: sofort
- Startansicht und Setup tauschen als ein Block (eine Transition, Höhe per WAAPI, Breite per CSS); der Tausch gleitet seitwärts (vor: alt nach links hinaus, neu von rechts herein; zurück gespiegelt, 260 ms, #236); reduzierte Bewegung: sofort
- Fokus: nach dem Tausch auf die Überschrift des Setups, beim Zurück auf die Schaltfläche, von der man kam
- Ein ruhiges Foto (Schreibtisch mit Tasse, Notizbuch und Pflanze im Fensterlicht, kd#226; gebündelt in public/welcome,
  Quelle in CREDITS.md) füllt die Seite; es ist nur Stimmung: Text steht nie direkt darauf. Mittig ein heller Bogen
  (Oberfläche und Schatten wie ein Dialog) trägt Wortmarke, Zeile, Frage, Antworten, Hinweis und Version. Am Telefon
  füllt der Bogen die Breite, darüber bleibt ein Foto-Streifen: das Foto ist dort eigens beschnitten (rechts unten,
  vergrößert), damit Tasse, Tischkante und Notizbuch im Streifen liegen statt nur die Wand.
- Das Foto blendet beim Laden ein (ohne Layoutsprung); lädt es nicht, bleibt die Seite auf Papierfarbe, der Bogen unverändert
-->
<template>
  <div class="welcome-root px-safe bg-page">
  <main class="relative flex min-h-dvh flex-col justify-end overflow-hidden bg-page sm:items-center sm:justify-center sm:p-6">
    <!-- Atmosphere only (alt=""): fades in once loaded, a failed load leaves the paper colour -->
    <img
      ref="photo"
      src="/welcome/desk-1672.webp"
      srcset="/welcome/desk-800.webp 800w, /welcome/desk-1672.webp 1672w"
      sizes="(min-width: 40rem) 100vw, 270vw"
      alt=""
      aria-hidden="true"
      decoding="async"
      data-testid="welcome-photo"
      class="welcome-photo pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-700 motion-reduce:transition-none"
      :class="photoLoaded ? 'opacity-100' : 'opacity-0'"
      @load="photoLoaded = true"
    >
    <!-- A launch with an unreachable data folder lands here with empty stores: say so (#224). On desktop it starts
         below the bar row: the window drag strip (app.vue, #614) and the traffic lights occupy that row. -->
    <div class="top-safe-3 absolute inset-x-4 z-10 mx-auto max-w-3xl in-data-[shell=desktop]:pt-(--app-bar-offset-top)">
      <DataStorageNotice />
    </div>
    <div
      class="welcome-sheet relative mt-40 w-full rounded-t-lg bg-default px-6 pt-6 shadow-(--shadow-task) transition-[max-width] duration-(--duration-slow) ease-out motion-reduce:transition-none sm:mt-0 sm:rounded-lg sm:px-8 sm:pt-8"
      :class="flow === 'notion' ? 'sm:max-w-3xl' : 'sm:max-w-lg'"
    >
      <header class="mb-8">
        <SectionHeader tag="p" size="hero">{{ t('nav.brand') }}</SectionHeader>
        <p class="mt-2 text-body text-default">{{ t('onboarding.page.tagline') }}</p>
      </header>
      <!-- One Transition for the whole content: start screen and setup swap as a single block and the block's height
           follows (setup-body), so nothing animates element by element (#43) -->
      <div ref="body" class="setup-body">
        <Transition :name="`slide-${direction}`" mode="out-in" @before-leave="onBeforeLeave" @enter="onEnter" @after-enter="onAfterEnter">
          <div :key="flow ?? 'start'" class="swap-block">
            <LocalSetupFlow
              v-if="flow === 'local'"
              v-model:notion="wantNotion"
              @back="leaveFlow"
              @connect-notion="openFlow('notion')"
              @complete="handleLocalSetupComplete"
            />
            <SamplesSetupFlow
              v-else-if="flow === 'samples'"
              @back="leaveFlow"
              @complete="handleLocalSetupComplete"
            />
            <NotionSetupFlow
              v-else-if="flow === 'notion'"
              @back="leaveFlow"
              @complete="handleNotionSetupComplete"
            />
            <template v-else>
        <SectionHeader tag="h1" size="display" class="text-balance">
          {{ t('onboarding.page.title') }}
        </SectionHeader>
        <p class="mt-3 text-body text-default">{{ t('onboarding.page.intro') }}</p>
        <!-- One filled action: the sheet's only solid green (The One Lamp Rule); the trial is a quiet second way in (#294) -->
        <div class="mt-6 flex flex-col gap-3">
          <UButton color="primary" size="lg" block data-testid="welcome-choice-local" @click="openFlow('local')">
            {{ t('onboarding.page.start') }}
          </UButton>
          <UButton color="neutral" variant="ghost" size="lg" block data-testid="welcome-choice-samples" @click="openFlow('samples')">
            {{ t('onboarding.page.samples') }}
          </UButton>
        </div>
        <p class="mt-6 text-xs text-muted">
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
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import LocalSetupFlow from '~/components/setup/LocalSetupFlow.vue';
import SamplesSetupFlow from '~/components/setup/SamplesSetupFlow.vue';
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
type FlowKey = 'local' | 'notion' | 'samples';
const flow = ref<FlowKey | null>(null);
const lastFlow = ref<FlowKey>('local');
/** Step 2's Notion checkbox; it survives the trip into the Notion setup and back (#294) */
const wantNotion = ref(false);
/** Which way the step swap slides: forward into a flow, back out of it (#236) */
const direction = ref<'fwd' | 'back'>('fwd');
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
function openFlow(key: FlowKey) {
  direction.value = 'fwd';
  lastFlow.value = key;
  flow.value = key;
}
function leaveFlow() {
  direction.value = 'back';
  // Back from the Notion setup lands on step 2 (its checkbox still set), every other step on the start view
  if (flow.value === 'notion') {
    lastFlow.value = 'local';
    flow.value = 'local';
    return;
  }
  flow.value = null;
}

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
/* Phone (below `sm`, where the sheet fills the width, kd#226): a full-page cover crop would show only the wall in the
   strip above the sheet. The photo is sized by the viewport height instead, anchored right and pulled up, so the mug,
   the table edge and the notebook lie in the strip; the sheet covers what is below. Viewport units keep the crop in
   proportion on short and tall phones. */
.welcome-photo {
  inset: 0 0 auto auto;
  width: auto;
  max-width: none;
  /* Tall enough that its lower edge (55 % of the height, after the pull) stays below the strip: the sheet is at least
     about 22rem high, so the strip is at most 100dvh - 22rem */
  height: max(80dvh, calc((100dvh - 22rem) / 0.55));
  aspect-ratio: 1672 / 941;
  translate: 0 -45%; /* the strip starts just above the mug; so mug, table edge and notebook fall into it */
}

/* From `sm` the photo covers the page again (the `inset-0 size-full object-cover` of the element) */
@media (--sm) {
  .welcome-photo {
    inset: 0;
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    translate: none;
  }
}

/* 12px clip margin: the Back button sits 4px outside the body and its focus ring reaches 4px beyond it (2px offset + 2px width) */
.setup-body { position: relative; overflow: clip; overflow-clip-margin: 12px; }
/* Steps read as steps in a row (#236): forward leaves to the left and the next enters from the right, back mirrors it.
   Leave 140 ms, enter 260 ms straight after it (no delay: a delay shows an empty sheet for a beat). Both ends rest at
   .12, not 0: out-in has one frame between leave and enter, and at 0 the sheet shows an empty block for a beat */
.slide-fwd-enter-active, .slide-back-enter-active { transition: opacity 0.26s cubic-bezier(0.3, 0.8, 0.3, 1), transform 0.26s cubic-bezier(0.3, 0.8, 0.3, 1); }
.slide-fwd-leave-active, .slide-back-leave-active { transition: opacity 0.14s ease-in, transform 0.14s ease-in; }
.slide-fwd-enter-from, .slide-back-leave-to { opacity: 0.12; transform: translateX(32px); }
.slide-fwd-leave-to, .slide-back-enter-from { opacity: 0.12; transform: translateX(-32px); }
@media (prefers-reduced-motion: reduce) {
  .slide-fwd-enter-active, .slide-fwd-leave-active, .slide-back-enter-active, .slide-back-leave-active { transition: none; }
  .slide-fwd-enter-from, .slide-fwd-leave-to, .slide-back-enter-from, .slide-back-leave-to { opacity: 1; transform: none; }
}
</style>
