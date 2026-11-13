/**
 * @composable useTaskStatusActions
 * @description Provides status change actions and menu items for a task
 */
import { computed } from 'vue';
import type { Ref } from 'vue';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '~/types/task';
import { TASK_STATUS_CONFIG, getStatusLabel } from '~/utils/taskStatusMappings';
import { useTaskOperations } from '~/composables/useTaskOperations';

export function useTaskStatusActions(task: Ref<Task | null>) {
  const { moveOrSwapToStatus } = useTaskOperations();

  /**
   * Changes the status of the current task
   */
  async function changeStatus(newStatus: TaskStatus) {
    if (!task.value?.id) return;
    
    try {
      // Same path as the context menu and the palette: swaps into a full Jetzt (#162, #241), keeps board order
      // consistent and offers undo on completion
      await moveOrSwapToStatus(task.value.id, newStatus);
    } catch (err) {
      console.error('Failed to update task status:', err);
    }
  }

  /**
   * Computed menu items for status dropdowns
   * Returns a 2D array compatible with UDropdownMenu (sections/items)
   */
  const statusMenuItems = computed(() => {
    const currentStatus = task.value?.status ?? TaskStatus.Open;
    
    return [
      [
        {
          label: getStatusLabel(TaskStatus.Open),
          icon: TASK_STATUS_CONFIG[TaskStatus.Open].icon,
          disabled: currentStatus === TaskStatus.Open,
          onSelect: () => changeStatus(TaskStatus.Open),
        },
        {
          label: getStatusLabel(TaskStatus.Progress),
          icon: TASK_STATUS_CONFIG[TaskStatus.Progress].icon,
          disabled: currentStatus === TaskStatus.Progress,
          onSelect: () => changeStatus(TaskStatus.Progress),
        },
        {
          label: getStatusLabel(TaskStatus.Waiting),
          icon: TASK_STATUS_CONFIG[TaskStatus.Waiting].icon,
          disabled: currentStatus === TaskStatus.Waiting,
          onSelect: () => changeStatus(TaskStatus.Waiting),
        },
        {
          label: getStatusLabel(TaskStatus.Done),
          icon: TASK_STATUS_CONFIG[TaskStatus.Done].icon,
          disabled: currentStatus === TaskStatus.Done,
          onSelect: () => changeStatus(TaskStatus.Done),
        },
      ],
    ];
  });

  return {
    changeStatus,
    statusMenuItems,
  };
}
