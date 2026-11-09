<!--
@component TasksPage
@description Hauptseite mit dem Kanban-Board, Synchronisationssteuerung und Modalen
@usage Erreichbar unter /tasks, zeigt Board, Setup- und Statistik-Modal
@responsibility
- Lädt und aktualisiert Aufgaben periodisch
- Öffnet Modale (Aufgabe, Statistik auf Anfrage der App-Leiste oder der Palette) und führt die Palette zur Seite „Einstellungen“
- Sync, Ansicht und Tag abschließen laufen über die App-Leiste (Mehr-Panel, #470), nicht über das Board
-->
<template>
  <main data-task-sheet-return :inert="recap.isOpen.value || undefined" :aria-hidden="recap.isOpen.value ? 'true' : undefined">
    <h1 class="sr-only">{{ t('board.pageHeading') }}</h1>
    <DataStorageNotice class="relative z-10 mx-auto mt-3 w-auto max-w-3xl" />

    <Board />

    <TaskSheet
      :open="isSheetOpen"
      :title="modalTitle"
      :hide-title="route.name !== 'tasks-add'"
      :flush-body="route.name !== 'tasks-add'"
      @update:open="handleSheetOpenChange"
      @after-leave="handleSheetAfterLeave"
    >
      <NuxtPage />

      <template v-if="hasFooterActions" #footer>
        <div class="flex w-full flex-col gap-3">
        <!-- Quiet line above the button row, registered by the route (the add form's "Speichern in", #321) -->
        <component :is="modalFooter.footerConfig.value.lead" v-if="modalFooter.footerConfig.value.lead" />
        <div class="flex w-full items-center justify-between">
          <!-- Secondary actions (left-aligned, e.g., cancel) -->
          <div class="flex items-center gap-2">
            <UButton
              v-for="action in modalFooter.footerConfig.value.secondary"
              :key="action.key"
              :color="action.color ?? 'neutral'"
              :variant="action.variant ?? 'soft'"
              :icon="action.icon"
              :loading="action.loading"
              :disabled="action.disabled"
              @click="action.onClick"
            >
              {{ action.label }}
            </UButton>
          </div>
          <!-- Tertiary + Primary actions (right-aligned) -->
          <div class="flex items-center gap-2">
            <UButton
              v-for="action in modalFooter.footerConfig.value.tertiary"
              :key="action.key"
              :color="action.color ?? 'error'"
              :variant="action.variant ?? 'soft'"
              :icon="action.icon"
              :loading="action.loading"
              :disabled="action.disabled"
              @click="action.onClick"
            >
              {{ action.label }}
            </UButton>
            <UButton
              size="lg"
              v-for="action in modalFooter.footerConfig.value.primary"
              :key="action.key"
              :color="action.color ?? 'primary'"
              :variant="action.variant ?? 'solid'"
              :icon="action.icon"
              :loading="action.loading"
              :disabled="action.disabled"
              @click="action.onClick"
            >
              {{ action.label }}
            </UButton>
          </div>
        </div>
        </div>
      </template>
    </TaskSheet>
    <DayCloseDialog />
    <NewDayRecap />
    <FeedbackDialog v-if="isDesktopApp" />
    <ElementPickerBar v-if="isDesktopApp" />
    <CommandPalette @open-statistics="handleOpenStatistics" @open-settings="handleOpenSettings" />

    <!-- Sync Warning Modal -->
    <SyncWarningModal
      :open="syncValidation.showWarningModal.value && !recap.isOpen.value"
      :source="syncValidation.warning.value?.source ?? null"
      :reason="syncValidation.warning.value?.reason ?? null"
      :current-task-count="syncValidation.warning.value?.currentTaskCount ?? 0"
      :fetched-count="syncValidation.warning.value?.fetchedCount ?? 0"
      :last-sync-timestamp="syncValidation.warning.value?.lastSync ? new Date(syncValidation.warning.value.lastSync) : null"
      @action="(action) => (action === 'confirm' ? syncValidation.handleConfirm() : syncValidation.handleCancel())"
    />
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useTasksStore } from "~/store/tasks";
import { useIntegrationManager } from "~/composables/useIntegrationManager";
import { useKeychainStatus } from "~/composables/useKeychainStatus";
import DataStorageNotice from "~/components/settings/DataStorageNotice.vue";
import { useRoute, navigateTo } from "nuxt/app";
import { useSyncValidation, resetSyncValidation } from "~/composables/useSyncValidation";
import { useModalFooter } from "~/composables/useModalFooter";
import { useTaskSheet } from "~/composables/useTaskSheet";
import { useCarryOverTracking } from "~/composables/useCarryOver";
import { useDayEndTracking } from "~/composables/useDayEndTracking";
import { useTaskDeletion } from "~/composables/useTaskDeletion";
import { useUndoDeleteShortcut } from "~/composables/useUndoDeleteShortcut";
import { useTaskMove } from "~/composables/useTaskMove";
import { usePropertyOptionsSync } from "~/composables/usePropertyOptionsSync";
import SyncWarningModal from "~/components/sync/SyncWarningModal.vue";
import TaskSheet from "~/components/task/TaskSheet.vue";
import CommandPalette from "~/components/CommandPalette.vue";
import DayCloseDialog from "~/components/board/DayCloseDialog.vue";
import NewDayRecap from "~/components/recap/NewDayRecap.vue";
import { useNewDayRecap } from "~/composables/useNewDayRecap";
import FeedbackDialog from "~/components/feedback/FeedbackDialog.vue";
import ElementPickerBar from "~/components/feedback/ElementPickerBar.vue";
import { isTauri } from "~/utils/isTauri";

const { t } = useI18n();
const route = useRoute();
/** Feedback (#227) is desktop only: no entry, dialog or picker on web. */
const isDesktopApp = isTauri();
const tasksStore = useTasksStore();
const { fetchTasks, isIntegrationConfigured } = useIntegrationManager();
const { unavailable: keychainUnavailable } = useKeychainStatus();

// Carried-over cue (#99): count board days on load, after merges and when the tab returns
useCarryOverTracking();
// Tasks in flight at the last look of each day, for the Statistik page (#537)
useDayEndTracking();

// Deletes left over from a closed app or queued while offline commit on start and on reconnect (#99)
const { resumePendingDeletes, undoLatestDelete } = useTaskDeletion();
// ⌘Z / Ctrl+Z undoes the newest delete still inside its window (kd#27); a text field keeps its own undo
useUndoDeleteShortcut(undoLatestDelete);
// Moves left over from a closed app or queued while the target was unreachable continue the same way (#322)
const { resumePendingMoves } = useTaskMove();
// Back online: queued deletes go out, and a fetch of every source also pushes the tasks waiting behind a
// `pendingSync` marker (#319)
const handleOnline = () => {
  void resumePendingDeletes();
  void resumePendingMoves();
  void fetchTasks();
};
const { ensureOptionsAvailable } = usePropertyOptionsSync();
const syncValidation = useSyncValidation();
const recap = useNewDayRecap();
const modalFooter = useModalFooter();

const refreshInterval = ref<NodeJS.Timeout>();
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const lastTaskUpdateTime = ref<number>(0);
const REFRESH_DEBOUNCE_TIME = 2000; // 2 seconds

/**
 * Ermittelt, ob die aktuelle Route eine verschachtelte Route unter /tasks ist.
 */
const computeIsNestedRoute = (): boolean => route.matched.length > 1;
const isNestedRoute = computed(computeIsNestedRoute);

/**
 * Liefert die aktuell geöffnete Aufgabe, falls eine Unterseite aktiv ist.
 */
const computeTask = () => {
  if (!isNestedRoute.value) return null;
  return tasksStore.task(route.params.id as string);
};
const _task = computed(computeTask);

/**
 * Computes the modal title based on the current route
 */
const modalTitle = computed(() => {
  if (route.name === 'tasks-add') {
    const isAdHocMode = route.query.mode === 'adhoc';
    return isAdHocMode ? t('task.createAdHoc') : t('task.createNew');
  }
  return _task.value?.title || t('task.fallbackTitle');
});

/**
 * Checks if modal footer has any actions to display
 */
const hasFooterActions = computed(() => {
  const config = modalFooter.footerConfig.value;
  return config.secondary.length > 0 || config.tertiary.length > 0 || config.primary.length > 0;
});

/**
 * Startet das periodische Aktualisieren der Aufgaben.
 */
const startAutoRefresh = () => {
  if (refreshInterval.value) return;
  refreshInterval.value = setInterval(() => {
    fetchTasks();
  }, REFRESH_INTERVAL);
};

/**
 * Stoppt das periodische Aktualisieren der Aufgaben.
 */
const stopAutoRefresh = () => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
    refreshInterval.value = undefined;
  }
};

/**
 * Aktualisiert das Verhalten beim Wechsel der Sichtbarkeit (Tabwechsel/Zurückkehren).
 */
const handleVisibilityChange = () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    // Check if a task update happened recently to avoid race conditions
    const timeSinceLastUpdate = Date.now() - lastTaskUpdateTime.value;
    if (timeSinceLastUpdate > REFRESH_DEBOUNCE_TIME) {
      fetchTasks();
    }
    startAutoRefresh();
  }
};

/**
 * The sheet stays mounted; it is open while a nested route is active.
 * Every close (Escape, overlay, swipe, in-sheet actions) goes through
 * useTaskSheet: the sheet animates out first, then the route changes to /tasks.
 */
const taskSheet = useTaskSheet();
const isSheetOpen = computed(() => isNestedRoute.value && !taskSheet.isDismissed.value);

const handleSheetOpenChange = (open: boolean) => {
  if (!open) void taskSheet.closeTaskSheet();
};

const handleSheetAfterLeave = () => void taskSheet.finishClose();

watch(() => route.fullPath, () => taskSheet.resetTaskSheet());

/** The command palette's "Statistik öffnen" goes to the statistics page (`/statistics`). */
const handleOpenStatistics = () => {
  void navigateTo('/statistics');
};

/**
 * The command palette's "Einstellungen" opens the Einstellungen page (`/settings`, #324, #394); the bar's Mehr panel has its own row.
 */
const handleOpenSettings = () => {
  void navigateTo('/settings');
};

definePageMeta({});

/**
 * Initialisiert die Seite, prüft Integration und startet Auto-Refresh.
 */
async function initializeTasksPageOnMount() {
  // Initialize if not already initialized
  if (!isIntegrationConfigured()) {
    // A token that is only unreachable (Keychain locked or denied) is not a missing setup: stay on the
    // cached board instead of sending the user through the welcome flow.
    if (keychainUnavailable.value.length > 0) return;
    if (import.meta.dev) {
      console.log("No integration configured, redirecting to welcome page");
    }
    await navigateTo("/welcome");
    return;
  }

  // Fetch tasks on mount (non-blocking - let it run in background)
  // Page will render with persisted data, then update when fetch completes
  fetchTasks().catch(error => {
    // Error already handled by fetchTasks/handleError, just prevent unhandled rejection
    if (import.meta.dev) {
      console.log('[TasksPage] Initial fetch failed, using cached data:', error.message);
    }
  });

  // Start auto-refresh
  startAutoRefresh();

  // Listen for visibility changes to refresh when user returns
  document.addEventListener("visibilitychange", handleVisibilityChange);

  void resumePendingDeletes();
  void resumePendingMoves();
  window.addEventListener("online", handleOnline);
  
  // Ensure property options are available (non-blocking background fetch)
  ensureOptionsAvailable();
}

onMounted(() => {
  // The page init starts its fetch before the first await, so the recap opens over a board that is already loading (#385)
  void initializeTasksPageOnMount();
  recap.check(route.name);
});

// Watch for task updates to track when they happen
/** Source accessor for tasks array to drive the watcher. */
const getTasksArray = () => tasksStore.tasks;
/**
 * Updates lastTaskUpdateTime when a status change is detected, to debounce refresh.
 */
const onTasksArrayChange = (newTasks: typeof tasksStore.tasks, oldTasks: typeof tasksStore.tasks) => {
  // Only update timestamp if tasks actually changed (not just initial load)
  if (oldTasks && newTasks && newTasks.length > 0) {
    // Check if any task status changed (indicating a drag-and-drop update)
    const hasStatusChange = newTasks.some((newTask, index) => {
      const oldTask = oldTasks[index];
      return oldTask && newTask.status !== oldTask.status;
    });
    if (hasStatusChange) {
      lastTaskUpdateTime.value = Date.now();
    }
  }
};

watch(getTasksArray, onTasksArrayChange, { deep: true });

/**
 * Bereinigt Event Listener und Timer beim Verlassen der Seite.
 */
function cleanupTasksPageOnUnmount() {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("online", handleOnline);
  stopAutoRefresh();
}

onUnmounted(cleanupTasksPageOnUnmount);
// A warning still waiting would hold its fetch (and a manual refresh awaiting it) until the next one
onBeforeUnmount(resetSyncValidation);
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--duration-base) ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>

<style></style>
