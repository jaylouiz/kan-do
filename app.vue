<!--
@component AppRoot
@description Root application shell that wraps all pages in Nuxt UI's UApp and performs global lifecycle tasks
@usage Always rendered as the top-level component; contains <NuxtPage /> to display the current route
@responsibility
- Mount the global app bar once (#470, ADR 017), before the page
- Mount the command palette once, while the app bar shows (#224), and the update and what's-new dialogs once on desktop (#225, #226)
- Provide Nuxt UI app context and the window drag strip for Tauri (#614): the title bar is an overlay, so the
  app bar row doubles as the window's grab area (`.titlebar`, desktop shell only; under a full-screen layer
  `plugins/desktop-shell.client.ts` takes over)
- Keep <html lang> in sync with the active i18n locale (Nuxt UI >= 4.12 follows the
  @nuxtjs/i18n locale for its built-in strings automatically)
- Trigger sync of pending changes (#319) on app unload
- Start the Jetzt timer driver once (#352)
- Install the macOS menu bar once on desktop (#614)
-->

<template>
  <UApp>
    <div class="titlebar absolute h-10" :data-tauri-drag-region="isTauri() || undefined" />
    <!-- The global app bar (#470): beside the layout, so it survives page transitions; the nav comes before <main> in reading order -->
    <AppNav />
    <!-- No default layout exists, so this renders only the page; sub-pages opt into
         layouts/sub-page.vue themselves (layout: false + <NuxtLayout name="sub-page">). -->
    <NuxtLayout>
      <NuxtPage
        :transition="{
          name: 'page',
          mode: 'default',
          onBeforeEnter: handleTransitionStart,
          onAfterEnter: handleTransitionEnd,
          onBeforeLeave: handleTransitionStart,
          onAfterLeave: handleTransitionEnd
        }"
      />
    </NuxtLayout>
    <component :is="CopyEditorHost" v-if="CopyEditorHost" />
    <!-- The command palette on every page with an app bar (#224); `useCommandPalette` holds the state, so one instance only -->
    <CommandPalette v-if="showsBar && paletteOpened" />
    <!-- Where the new-day recap stage lands (NewDayRecap.vue, #262): inside the app's stacking context, so the bar (z-bar)
         paints above the photo, yet outside the inert <main> -->
    <div id="recap-stage-host" />
    <UpdateDialog v-if="updaterAvailable && updateDialogOpened" />
    <WhatsNewDialog v-if="updaterAvailable && whatsNewOpened" />
  </UApp>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import AppNav from "~/components/nav/AppNav.vue";
import { useAppNav } from "~/composables/useAppNav";
import { useCommandPalette } from "~/composables/useCommandPalette";
import { useOpenedOnce } from "~/composables/useOpenedOnce";
import { useWhatsNew } from "~/composables/useWhatsNew";
import { useAppUpdater } from "~/composables/useAppUpdater";
import { useTaskSync } from "~/composables/useTaskSync";
import { useTaskTimerDriver } from "~/composables/useTaskTimerDriver";
import { useNativeMenu } from "~/composables/useNativeMenu";
import { isTauri } from "~/utils/isTauri";
import { useTasksStore } from "~/store/tasks";
import { useTaskStatisticsStore } from "~/store/taskStatistics";
import { TaskStatus } from "~/types/taskStatus";

// Closed-at-start dialogs load their code on first open (#288); state lives in module-level composables, so a flag set
// before the chunk arrives still shows the dialog once it mounts, and focus capture happens at open time.
const loadPalette = () => import("~/components/CommandPalette.vue");
const CommandPalette = defineAsyncComponent(loadPalette);
const UpdateDialog = defineAsyncComponent(() => import("~/components/updates/UpdateDialog.vue"));
const WhatsNewDialog = defineAsyncComponent(() => import("~/components/updates/WhatsNewDialog.vue"));

// Live copy editor (#59): present only when the bundle is built with it (dev, E2E build); `false` drops the import.
const CopyEditorHost = __COPY_EDITOR__ ? defineAsyncComponent(() => import("~/dev-tools/copy-editor/CopyEditorHost.vue")) : null;

const { syncPendingChanges } = useTaskSync();
// The palette (and its Cmd/Ctrl+K) goes with the app bar: no bar on /welcome, nothing to command there
const { showsBar } = useAppNav();
const timerDriver = useTaskTimerDriver();
// Desktop only: the macOS menu bar (#614); a no-op on the web.
useNativeMenu();
// Desktop only: the update dialog is mounted once and opened from the toast, the palette or the page.
const updater = useAppUpdater();
const updaterAvailable = updater.available;
const { isOpen: paletteOpen, open: openPalette } = useCommandPalette();
const paletteOpened = useOpenedOnce(paletteOpen);
const updateDialogOpened = useOpenedOnce(() => updater.state.dialogOpen);
const whatsNew = useWhatsNew();
const whatsNewOpened = useOpenedOnce(() => whatsNew.state.open);
// Cmd/Ctrl+K lives here, not in the lazy palette, so the first press works before its chunk is loaded. Not usingInput:
// silent while typing in fields. Nuxt UI maps `meta_k` to Ctrl+K off macOS; the explicit `ctrl_k` gives macOS Ctrl+K (kd#23).
// The palette goes with the app bar: no bar, no shortcut.
const openPaletteIfBar = () => {
  if (!showsBar.value) return;
  void loadPalette(); // already in flight from the idle warm-up below in the normal case
  openPalette();
};
defineShortcuts({ meta_k: openPaletteIfBar, ctrl_k: openPaletteIfBar });
const tasksStore = useTasksStore();
const statisticsStore = useTaskStatisticsStore();

const { locale } = useI18n();
useHead({ htmlAttrs: { lang: locale } });

// Transition handlers to prevent scrollbar flickering
const handleTransitionStart = () => {
  // Lock the body overflow during transition to prevent scrollbar flicker
  document.documentElement.style.overflow = 'hidden';
};

const handleTransitionEnd = () => {
  // Restore overflow after transition completes
  // Use a small delay to ensure the transition is fully complete
  setTimeout(() => {
    document.documentElement.style.overflow = '';
  }, 50);
};

// Run periodic sync of pending changes (#319) every 5 minutes (client-only)
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  // The palette is typed into right after Cmd/Ctrl+K, so its chunk is fetched once the board has settled: keys typed
  // before a lazy mount would be lost. Off the critical path (idle), unlike the static import it replaces (#288).
  const warmPalette = () => { void loadPalette(); };
  if ("requestIdleCallback" in window) window.requestIdleCallback(warmPalette, { timeout: 1500 });
  else setTimeout(warmPalette, 1000);

  // Jetzt timers (#352): the task's status decides, whichever page is open
  timerDriver.start();

  // Backfill statistics from existing done tasks
  const doneTasks = tasksStore.tasks.filter(t => t.status === TaskStatus.Done);
  statisticsStore.syncExistingDoneTasks(doneTasks, tasksStore.archivedTaskIds);
  
  if (import.meta.dev) {
    console.log("[App] Starting periodic pending sync (every 5 minutes)");
  }
  syncIntervalId = setInterval(() => {
    if (import.meta.dev) {
      console.log("[App] Periodic sync: syncing pending changes");
    }
    syncPendingChanges();
  }, SYNC_INTERVAL_MS);
});

// Sync pending updates when window is closed
onBeforeUnmount(() => {
  syncPendingChanges();
});

onUnmounted(() => {
  timerDriver.stop();
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    if (import.meta.dev) {
      console.log("[App] Cleared periodic pending sync interval");
    }
  }
});
</script>

<style>
.titlebar {
  /* Full width, minus the scrollbar an overlay lock removes (#580, assets/css/utilities.css) */
  width: calc(100% - var(--scrollbar-width, 0px));
}

/* Desktop app (#614): no native title bar (tauri.conf.json `titleBarStyle: Overlay`), the traffic lights sit in the
   app bar row. The strip is the window's drag area (`data-tauri-drag-region`, capability core:window:allow-start-dragging;
   double click zoom is in core:default): fixed so it stays after the page scrolled, the height of the app bar row, below the bar
   (z-40) so the pills stay clickable, also on routes without the bar (welcome, whose notice therefore starts below the row). Full-screen layers cover it (overlay scrims, custom layers with `data-window-drag-layer`):
   `plugins/desktop-shell.client.ts` starts the drag from a press in the row (lib/windowDrag.ts). */
html[data-shell="desktop"] .titlebar {
  position: fixed;
  top: 0;
  left: 0;
  height: var(--app-bar-offset-top);
  z-index: var(--z-titlebar);
}
</style>
