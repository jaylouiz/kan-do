<!--
@component TasksPage
@description Hauptseite mit dem Kanban-Board, Synchronisationssteuerung und Modalen
@usage Erreichbar unter /tasks, zeigt Board, Setup- und Statistik-Modal
@responsibility
- Lädt und aktualisiert Aufgaben periodisch
- Hosts the task sheet (`TaskSheetHost`, kd#179) for /tasks/:id and /tasks/add; the command palette (mounted in app.vue since #224) opens its dialogs from here
- Sync, Ansicht und Tag abschließen laufen über die App-Leiste (Mehr-Panel, #470), nicht über das Board
-->
<template>
  <main data-task-sheet-return :inert="recap.isOpen.value || undefined">
    <h1 class="sr-only">{{ t('board.pageHeading') }}</h1>
    <DataStorageNotice class="relative z-10 mx-auto mt-3 w-auto max-w-3xl" />

    <Board />

    <TaskSheetHost>
      <NuxtPage />
    </TaskSheetHost>
    <!-- Closed at start: each loads on its first open (#288) and stays mounted after -->
    <DayCloseDialog v-if="dayCloseOpened" />
    <NewDayRecap v-if="recapOpened" />
    <FeedbackDialog v-if="feedbackOpened" />
    <ElementPickerBar v-if="pickerOpened" />

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
import { ref, onMounted, onBeforeUnmount, onUnmounted, watch, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import { useTasksStore } from "~/store/tasks";
import { useIntegrationManager } from "~/composables/useIntegrationManager";
import { useKeychainStatus } from "~/composables/useKeychainStatus";
import DataStorageNotice from "~/components/settings/DataStorageNotice.vue";
import { useRoute, navigateTo } from "nuxt/app";
import { useSyncValidation, resetSyncValidation } from "~/composables/useSyncValidation";
import { useCarryOverTracking } from "~/composables/useCarryOver";
import { useDayEndTracking } from "~/composables/useDayEndTracking";
import { useTaskDeletion } from "~/composables/useTaskDeletion";
import { useUndoDeleteShortcut } from "~/composables/useUndoDeleteShortcut";
import { useTaskMove } from "~/composables/useTaskMove";
import { usePropertyOptionsSync } from "~/composables/usePropertyOptionsSync";
import SyncWarningModal from "~/components/sync/SyncWarningModal.vue";
import TaskSheetHost from "~/components/task/TaskSheetHost.vue";
import { useNewDayRecap } from "~/composables/useNewDayRecap";
import { useDayClose } from "~/composables/useDayClose";
import { useFeedback } from "~/composables/useFeedback";
import { useElementPicker } from "~/composables/useElementPicker";
import { useOpenedOnce } from "~/composables/useOpenedOnce";

const DayCloseDialog = defineAsyncComponent(() => import("~/components/board/DayCloseDialog.vue"));
const NewDayRecap = defineAsyncComponent(() => import("~/components/recap/NewDayRecap.vue"));
const FeedbackDialog = defineAsyncComponent(() => import("~/components/feedback/FeedbackDialog.vue"));
const ElementPickerBar = defineAsyncComponent(() => import("~/components/feedback/ElementPickerBar.vue"));

const { t } = useI18n();
const route = useRoute();
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
const dayCloseOpened = useOpenedOnce(useDayClose().isOpen);
const recapOpened = useOpenedOnce(recap.isOpen);
const feedback = useFeedback();
const picker = useElementPicker();
const feedbackOpened = useOpenedOnce(feedback.isOpen);
// The picker starts from the feedback dialog: load its bar with the dialog, so the pick never waits on a chunk
const pickerOpened = useOpenedOnce(() => feedback.isOpen.value || picker.active.value);

const refreshInterval = ref<NodeJS.Timeout>();
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const lastTaskUpdateTime = ref<number>(0);
const REFRESH_DEBOUNCE_TIME = 2000; // 2 seconds

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
  stopRecapReturn = recap.listenForReturn(() => route.name);
});
let stopRecapReturn = () => {};
// A task sheet open overnight swallows the return check (route is not `tasks`): closing it must run it (#242)
watch(() => route.name, name => recap.check(name));

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
  stopRecapReturn();
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
