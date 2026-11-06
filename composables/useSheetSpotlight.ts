/**
 * @composable useSheetSpotlight
 * @description Id of the task whose details sheet is open (/tasks/:id), or null
 * @responsibility
 * - Drives the "fade other cards" spotlight on the board (#96)
 * - On /tasks/add it is the draft card (#110); null on /tasks and for unknown ids, so nothing fades there
 * - Turns null as soon as the close starts, so cards fade back in while the sheet leaves
 */

import { computed } from 'vue';
import { useTasksStore } from '~/store/tasks';
import { useTaskSheet } from '~/composables/useTaskSheet';
import { useTaskDraft, DRAFT_TASK_ID } from '~/composables/useTaskDraft';

export function useSheetSpotlight() {
  const route = useRoute();
  const tasksStore = useTasksStore();
  const { isDismissed } = useTaskSheet();
  const { draftTask } = useTaskDraft();

  const spotlightTaskId = computed<string | null>(() => {
    // Adding a task (#110): the draft card is the spotlighted one
    if (route.name === 'tasks-add') return draftTask.value && !isDismissed.value ? DRAFT_TASK_ID : null;
    if (route.name !== 'tasks-id' || isDismissed.value) return null;
    const id = route.params.id;
    return typeof id === 'string' && tasksStore.task(id) ? id : null;
  });

  return { spotlightTaskId };
}
