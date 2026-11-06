<!--
@component TaskAddPage
@description Seite zum Erstellen einer neuen Aufgabe im Modal unter /tasks/add
@usage Unterseite der TasksPage, wird in einem Modal angezeigt
@responsibility
- Renders the form and creates the task through `useTaskSync().createTask` in the chosen source (#321): the default
  source for the ad-hoc add, the footer switch's target otherwise
- Registers the "Speichern in" switch as the sheet footer's lead
- Keeps the board's draft card in step (#110): Offen, or Jetzt with the running time for add-and-start (#125)
- Returns to the task list after a save and hands focus to the saved card
-->
<template>
  <task-form 
    ref="taskFormRef"
    :submit-label="submitLabel"
    :auto-focus="true"
    :is-unplanned="isAdHocMode"
    :source="saveSource"
    @success="handleSave"
    @draft="updateDraft"
  />
</template>

<script setup lang="ts">
import { useTasksStore } from "~/store/tasks";
import { useBoardStore } from "~/store/board";
import { useTaskSync } from "~/composables/useTaskSync";
import { useAddTarget } from "~/composables/useAddTarget";
import AddTargetSwitch from "~/components/task/AddTargetSwitch.vue";
import { useErrorHandler } from "~/composables/useErrorHandler";
import { useTaskOperations } from "~/composables/useTaskOperations";
import { useModalFooter } from "~/composables/useModalFooter";
import { useTaskSheet } from "~/composables/useTaskSheet";
import { useTaskDraft } from "~/composables/useTaskDraft";
import { TaskStatus } from "~/types/taskStatus";
import { checkWipMove } from "~/utils/wipGuard";
import type { Task } from "~/types/task";
import { ref, computed, markRaw, onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "nuxt/app";
import { useI18n } from "vue-i18n";

const tasksStore = useTasksStore();
const boardStore = useBoardStore();
const { createTask } = useTaskSync();
const { defaultSource, targetSource, resetTarget } = useAddTarget();
const { handleError } = useErrorHandler();
const { moveTaskToStatus, notifyWipRefused } = useTaskOperations();
const { setFooter, clearFooter, updateAction } = useModalFooter();
const { closeTaskSheet, isDismissed } = useTaskSheet();
const { draftTask, startDraft, updateDraft, clearDraft, setDraftSaving } = useTaskDraft();
const { t } = useI18n();
const route = useRoute();

// Form ref for resetting state and external submission
const taskFormRef = ref<{ 
  resetSubmitting: () => void;
  submitFormExternal: () => void;
  isSubmitting: boolean;
} | null>(null);

// Ad-hoc mode ("Neue Aufgabe sofort starten"): the task starts in Jetzt with the time spent so far
const isAdHocMode = computed(() => route.query.mode === 'adhoc');

// The ad-hoc add always goes to the default source and offers no switch; every other add starts on the default
// and saves to the footer switch's target (reset each time the sheet opens)
resetTarget();
const saveSource = computed(() => (isAdHocMode.value ? defaultSource.value : targetSource.value));

// Board draft card (#110): starts before TaskForm mounts, ends on every close path.
// Add-and-start drafts sit in Jetzt (#125).
startDraft(isAdHocMode.value ? TaskStatus.Progress : TaskStatus.Open);
watch(isDismissed, (dismissed) => {
  if (dismissed) clearDraft();
});

// Submit button label based on mode
const submitLabel = computed(() => isAdHocMode.value ? t('task.form.start') : t('task.form.submit'));

// Local timer for tracking elapsed time before task creation
const elapsedSeconds = ref(0);
let localTimerInterval: ReturnType<typeof setInterval> | null = null;

const startLocalTimer = () => {
  localTimerInterval = setInterval(() => {
    elapsedSeconds.value++;
  }, 1000);
};

const stopLocalTimer = () => {
  if (!localTimerInterval) return;
  clearInterval(localTimerInterval);
  localTimerInterval = null;
};

// The Jetzt draft shows the time that is already running
watch(elapsedSeconds, (seconds) => updateDraft({ timeSpentSeconds: seconds }));

// The page stays mounted when only the query changes (/tasks/add ↔ ?mode=adhoc): the draft moves to the
// other column with what was typed so far, and the add-and-start time starts from zero, as on a fresh open.
// Only while the draft is open: leaving ?mode=adhoc after a save or cancel must not start a new draft.
watch(isAdHocMode, (adHoc) => {
  resetTarget();
  const typed = draftTask.value;
  if (!typed || isDismissed.value) return;
  stopLocalTimer();
  elapsedSeconds.value = 0;
  startDraft(adHoc ? TaskStatus.Progress : TaskStatus.Open);
  updateDraft({ ...typed, timeSpentSeconds: 0 });
  if (adHoc) startLocalTimer();
});

/**
 * Triggers form submission from the modal footer
 */
function handleSubmit() {
  taskFormRef.value?.submitFormExternal?.();
}

// Start local timer when in ad-hoc mode and set up footer actions
onMounted(() => {
  if (isAdHocMode.value) {
    startLocalTimer();
    
    if (import.meta.dev) {
      console.log('[TaskAdd] Started local timer for ad-hoc task');
    }
  }
  
  // Set up modal footer actions
  setFooter({
    secondary: [
      {
        key: 'cancel',
        label: t('common.cancel'),
        color: 'neutral',
        variant: 'soft',
        onClick: () => void closeTaskSheet(),
      },
    ],
    tertiary: [],
    lead: markRaw(AddTargetSwitch),
    primary: [
      {
        key: 'submit',
        label: submitLabel.value,
        color: 'primary',
        variant: 'solid',
        loading: false,
        onClick: handleSubmit,
      },
    ],
  });
});

// Watch form submitting state and update footer action
watch(
  () => taskFormRef.value?.isSubmitting,
  (isSubmitting) => {
    updateAction('submit', { loading: isSubmitting ?? false });
  }
);

// Watch for submit label changes (shouldn't happen, but for completeness)
watch(submitLabel, (label) => {
  updateAction('submit', { label });
});

// Cleanup local timer and footer on unmount
onUnmounted(() => {
  stopLocalTimer();
  clearFooter();
  clearDraft();
});

/** The shared WIP rule: may a new task start in Jetzt? `ignoreTaskId` leaves that task out of the count. */
function jetztHasRoom(ignoreTaskId?: string): boolean {
  return checkWipMove({
    currentStatus: TaskStatus.Open,
    targetStatus: TaskStatus.Progress,
    progressCount: tasksStore.tasksProgress.filter((task) => task.id !== ignoreTaskId).length,
  }).allowed;
}

/**
 * Handles task creation and saves to the appropriate integration
 */
async function handleSave(taskData: Partial<Task>) {
  // Stop local timer before saving
  stopLocalTimer();
  setDraftSaving(true);
  
  // Jetzt may have filled up while the form was open (e.g. a sync): the shared WIP rule decides,
  // and a refused start keeps the task (and its time) in Offen
  let startsNow = isAdHocMode.value && jetztHasRoom();

  const saveStartedAt = Date.now();
  let createdTaskId: string | null = null;
  try {
    // For ad-hoc mode: set status to Progress and apply elapsed time
    if (isAdHocMode.value) {
      taskData.status = startsNow ? TaskStatus.Progress : TaskStatus.Open;
      taskData.timeSpentSeconds = elapsedSeconds.value;
      taskData.isUnplanned = true; // Explicitly ensure it's set
      
      if (import.meta.dev) {
        console.log(`[TaskAdd] Ad-hoc task with ${elapsedSeconds.value}s elapsed time, isUnplanned:`, taskData.isUnplanned);
      }
    }
    
    if (import.meta.dev) {
      console.log('[TaskAdd] Task data before save:', { 
        title: taskData.title, 
        status: taskData.status, 
        isUnplanned: taskData.isUnplanned 
      });
    }
    
    createdTaskId = (await createTask(taskData, saveSource.value)).id;
  } catch (error) {
    handleError(error as Error, "task_create");

    // Reset form loading state on error; the draft stays and its time keeps running,
    // including the time the failed save took
    taskFormRef.value?.resetSubmitting();
    setDraftSaving(false);
    if (isAdHocMode.value) {
      elapsedSeconds.value += Math.round((Date.now() - saveStartedAt) / 1000);
      if (!localTimerInterval) startLocalTimer();
    }
    return;
  }

  // The task exists from here on: nothing below may re-enable the form (no second task, no second timer)
  clearDraft({ saved: true });
  try {
    // The save is async (Notion), so Jetzt may have filled while it ran: ask the WIP rule again
    // and send a refused start back to Offen, with its time
    if (startsNow && createdTaskId && !jetztHasRoom(createdTaskId)) {
      startsNow = false;
      moveTaskToStatus(createdTaskId, TaskStatus.Open).catch((error: unknown) => handleError(error as Error, "task_operation"));
    }

    // No timer to start here: a task that lands in Jetzt is timed by the app-level driver (#352), and one
    // sent back to Offen above is disarmed by it. A failing toast cannot skip anything.
    if (isAdHocMode.value && !startsNow) notifyWipRefused();
  } catch (error) {
    handleError(error as Error, "task_operation");
  }

  await closeTaskSheet(createdTaskId ? { focusTaskId: createdTaskId } : {});

  // Add-and-start without a timebox asks for one on the new Jetzt card (#389), once the sheet is gone
  if (startsNow && createdTaskId) boardStore.startTimeboxNudge(createdTaskId);
}

</script>
