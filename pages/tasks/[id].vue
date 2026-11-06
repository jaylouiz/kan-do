<!--
@component TaskDetailPage
@description Detailansicht einer Aufgabe unter /tasks/:id, angezeigt im Modal
@usage Unterseite der TasksPage, nutzt Store-Getter, um Task zu laden
@responsibility
- Zeigt Aufgabendetails (Priorität, Notiz, Zeiten)
- Behandelt Fehlerzustand, wenn Aufgabe nicht gefunden
- Delegiert Lösch-Aktion an TaskDetailContent
-->
<template>
  <TaskDetailContent :task-id="taskId" :start-smaller="route.query.smaller === '1'" @delete="handleDelete" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTasksStore } from '~/store/tasks';
import TaskDetailContent from '~/components/task/TaskDetailContent.vue';
import { useTaskSheet } from '~/composables/useTaskSheet';
import { useTaskDeletion } from '~/composables/useTaskDeletion';

definePageMeta({
  // Prevent scroll to top when opening task detail modal
  scrollToTop: false,
});

const route = useRoute();
const tasksStore = useTasksStore();
const { deleteTaskWithUndo } = useTaskDeletion();
const { closeTaskSheet } = useTaskSheet();

/**
 * Task ID from route params
 */
const taskId = computed(() => route.params.id as string);

/**
 * Current task from store
 */
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
