<!--
@component TaskDetailModal
@kind block
@category overlay
@description Modal displaying detailed task information
@usage Reusable modal for showing task details
@avoid Only the task detail modal; new code opens tasks in TaskSheet.
@responsibility
- Display task properties, notes, and custom fields via TaskDetailContent
- Handle modal open/close state
- Provide delete action with undo capability
-->

<template>
  <AppDialog
    v-model:open="isOpen"
    :close="{ color: 'neutral', variant: 'ghost' }"
    size="lg"
    :ui="{ header: 'flex justify-end px-4 pt-3 pb-0 border-0', body: 'p-0 overflow-y-auto max-h-[80vh]' }"
  >
    <template #body>
      <TaskDetailContent :task-id="taskId" @delete="handleDelete" />
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
import AppDialog from '~/components/ui/AppDialog.vue';
import { toRef, computed } from 'vue';
import { useTaskDetail } from '~/composables/useTaskDetail';
import { useTaskDeletion } from '~/composables/useTaskDeletion';
import TaskDetailContent from '~/components/task/TaskDetailContent.vue';

defineOptions({ name: 'TaskDetailModal' });

/**
 * @property modelValue - Controls the visibility of the modal (v-model)
 * @property taskId - Task ID to display
 */
const props = defineProps<{
  /** Controls the visibility of the modal (v-model) */
  modelValue: boolean;
  /** Task ID to display */
  taskId: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** Emitted when task is deleted */
  'deleted': [taskId: string];
}>();

const { deleteTaskWithUndo } = useTaskDeletion();

// Modal state
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

// Get task data for delete handler
const taskIdRef = toRef(props, 'taskId');
const { task } = useTaskDetail(taskIdRef);

/**
 * Deletes through the shared upstream-aware delete (undo toast, deferred upstream commit).
 */
const handleDelete = () => {
  if (!task.value || !props.taskId) return;
  const taskId = props.taskId;
  isOpen.value = false;
  deleteTaskWithUndo(taskId, (id) => emit('deleted', id));
};
</script>
