<!--
@component TaskSheetDetail
@kind block
@category overlay
@description The detail route's body inside the task sheet: one task's detail with the delete flow (kd#179)
@usage The page of every detail child route: `pages/tasks/[id].vue` (`/tasks/:id`) and `pages/statistics/[id].vue` (`/statistics/:id`). Reads the task id from the route.
@avoid Not the add form (TaskForm), and not for use outside a task sheet route.
@responsibility
- Show the task of the route's `:id` through TaskDetailContent (the error state when it does not exist)
- Delete through the shared upstream-aware delete (undo toast, deferred upstream commit); the sheet closes first so it slides out with its content
- `?smaller=1` opens the carry-over "smaller step" edit
-->
<template>
  <TaskDetailContent :task-id="taskId" :start-smaller="route.query.smaller === '1'" @delete="handleDelete" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'nuxt/app';
import { useTasksStore } from '~/store/tasks';
import TaskDetailContent from '~/components/task/TaskDetailContent.vue';
import { useTaskSheet } from '~/composables/useTaskSheet';
import { useTaskDeletion } from '~/composables/useTaskDeletion';

defineOptions({ name: 'TaskSheetDetail' });

const route = useRoute();
const tasksStore = useTasksStore();
const { deleteTaskWithUndo } = useTaskDeletion();
const { closeTaskSheet } = useTaskSheet();

/** Task ID from route params */
const taskId = computed(() => route.params.id as string);

/** Current task from store */
const task = computed(() => tasksStore.task(taskId.value));

/**
 * Deletes through the shared upstream-aware delete (undo toast, deferred upstream commit).
 * The sheet closes first so it slides out with its content.
 */
async function handleDelete() {
  if (!task.value) return;
  const id = task.value.id;
  await closeTaskSheet();
  deleteTaskWithUndo(id);
}
</script>
