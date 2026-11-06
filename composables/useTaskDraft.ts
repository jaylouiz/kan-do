/**
 * @composable useTaskDraft
 * @description Shared draft of the task being added in the sheet at /tasks/add (#110)
 * @responsibility
 * - Holds the in-progress task so the board can show a representative draft card
 * - The draft's status names the column it lands in: Offen, or Jetzt for add-and-start (#125)
 * - Singleton, module-level state like `useTaskSheet`; never written to the tasks store or synced
 * - Started and cleared by `pages/tasks/add.vue`, fed live by `TaskForm`
 */

import { ref, computed, readonly } from 'vue';
import type { Task } from '~/types/task';
import { TaskStatus } from '~/types/taskStatus';
import { DEFAULT_PRIORITY } from '~/lib/priority';

export const DRAFT_TASK_ID = 'draft';

const draft = ref<Task | null>(null);
/** True when the last draft ended in a save: the saved card replaces it, so it leaves without a fade. */
const draftSaved = ref(false);
/** True while the sheet's save request runs: the saved task can land on the board before the draft clears. */
const draftSaving = ref(false);

const emptyDraft = (status: TaskStatus): Task => ({
  id: DRAFT_TASK_ID,
  source: 'local',
  externalId: null,
  status,
  title: '',
  activity: null,
  topic: null,
  topicColorCode: null,
  priority: DEFAULT_PRIORITY,
  notes: null,
  timeBoxSeconds: null,
  timeSpentSeconds: 0,
  timerId: null,
  createdAt: new Date(),
});

/** Begins an empty draft in the column of `status` (Offen by default). */
const startDraft = (status: TaskStatus = TaskStatus.Open) => {
  draftSaved.value = false;
  draftSaving.value = false;
  draft.value = emptyDraft(status);
};

/** Merges live form values into the active draft; no-op without one. The status stays fixed. */
const updateDraft = (patch: Partial<Task>) => {
  if (!draft.value) return;
  draft.value = { ...draft.value, ...patch, id: DRAFT_TASK_ID, status: draft.value.status };
};

/** Marks the start (true) or failure (false) of the save request; `clearDraft` ends it too. */
const setDraftSaving = (saving: boolean) => {
  draftSaving.value = saving;
};

/** Removes the draft (cancel, close or successful save). */
const clearDraft = (options: { saved?: boolean } = {}) => {
  draftSaved.value = options.saved ?? false;
  draftSaving.value = false;
  draft.value = null;
};

export function useTaskDraft() {
  return {
    draftTask: computed(() => draft.value),
    draftSaved: readonly(draftSaved),
    draftSaving: readonly(draftSaving),
    startDraft,
    setDraftSaving,
    updateDraft,
    clearDraft,
  };
}
