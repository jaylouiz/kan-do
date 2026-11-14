import { computed, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ContextMenuItem } from "@nuxt/ui";
import type { Task } from "~/types/task";
import { TaskStatus } from "~/types/taskStatus";
import { useTasksStore } from "~/store/tasks";
import { deleteLabelKey, sourceTaskUrl } from "~/lib/taskSources";
import { getPriorityLabel } from "~/utils/taskStatusMappings";
import { normalizePriority } from "~/lib/priority";
import { useTaskOperations } from "~/composables/useTaskOperations";
import { navigateTo } from "nuxt/app";
import { useToast } from "#imports";
import { duplicateDraft } from "~/lib/duplicateDraft";
import { SOURCE_META } from "~/utils/sourceMeta";
import { openExternal } from "~/utils/openExternal";
import { useTaskSync } from "~/composables/useTaskSync";
import { useErrorHandler } from "~/composables/useErrorHandler";
import { useTaskDeletion } from "~/composables/useTaskDeletion";
import { useTaskMoveTargets } from "~/composables/useTaskMoveTargets";
import { PRIORITY_OPTIONS, STATUS_OPTIONS, TIMEBOX_PRESETS } from "~/utils/taskMenuOptions";

export interface UseTaskContextMenuOptions {
  /** Callback when custom timebox is requested */
  onCustomTimebox?: (taskId: string) => void;
  /** Callback after task is deleted */
  onDeleted?: (taskId: string) => void;
}

/**
 * Composable for generating task card context menu items
 * Provides dynamic menu items based on task state with localized labels
 */
export const useTaskContextMenu = (
  task: Ref<Task>,
  menuOptions: UseTaskContextMenuOptions = {}
) => {
  const tasksStore = useTasksStore();
  const { moveOrSwapToStatus, canMoveOrSwapToStatus } = useTaskOperations();
  const { deleteTaskWithUndo } = useTaskDeletion();
  const { targets: moveTargets, move: moveToSource } = useTaskMoveTargets(task);
  const { t } = useI18n();
  const { createTask } = useTaskSync();
  const { handleError } = useErrorHandler();
  const toast = useToast();

  /**
   * Opens task details page
   */
  const openDetails = () => {
    navigateTo(`/tasks/${task.value.id}`);
  };

  /**
   * Toggles the unplanned flag on the task
   */
  const toggleUnplanned = () => {
    tasksStore.updateTask(task.value.id, {
      isUnplanned: !task.value.isUnplanned,
    });
  };

  /**
   * Changes task status
   */
  const changeStatus = async (newStatus: TaskStatus) => {
    if (task.value.status !== newStatus) {
      await moveOrSwapToStatus(task.value.id, newStatus);
    }
  };

  /**
   * Sets timebox on task
   */
  const setTimebox = (seconds: number | null) => {
    tasksStore.updateTask(task.value.id, {
      timeBoxSeconds: seconds,
    });
  };

  /**
   * Changes task priority
   */
  const changePriority = (priority: number) => {
    tasksStore.updateTask(task.value.id, {
      priority,
    });
  };

  /**
   * Deletes the task with undo capability
   */
  const deleteTask = () => {
    deleteTaskWithUndo(task.value.id, menuOptions.onDeleted);
  };

  /**
   * Requests custom timebox input
   */
  const requestCustomTimebox = () => {
    menuOptions.onCustomTimebox?.(task.value.id);
  };

  /**
   * Copies the title as plain text (#296); a failure is reported, a success confirmed with a short toast
   */
  const copyTitle = async () => {
    try {
      await navigator.clipboard.writeText(task.value.title);
    } catch (error) {
      handleError(error instanceof Error ? error : String(error), 'clipboard');
      return;
    }
    toast.add({ title: t('task.contextMenu.titleCopied'), duration: 2500 });
  };

  /**
   * Adds a copy of the task to Offen in the same source (#296); the toast opens the copy's details
   */
  const duplicateTask = async () => {
    let created: Task;
    try {
      created = await createTask(duplicateDraft(task.value), task.value.source);
    } catch (error) {
      handleError(error instanceof Error ? error : String(error), 'task_create');
      return;
    }
    toast.add({
      title: t('task.contextMenu.duplicated'),
      orientation: 'horizontal',
      duration: 5000,
      actions: [{
        label: t('board.quickAdd.details'),
        color: 'neutral',
        variant: 'soft',
        onClick: () => void navigateTo(`/tasks/${created.id}`),
      }],
    });
  };

  /**
   * Generates context menu items based on current task state
   */
  const menuItems = computed<ContextMenuItem[][]>(() => {
    const currentTask = task.value;

    // Group 0 (#296): quick status. Start now is the "Jetzt" entry of Change status, so it follows the same
    // swap and limit rules (disabled with the reason when Jetzt is full and no swap applies).
    const startRefused = !canMoveOrSwapToStatus(currentTask.id, TaskStatus.Progress).allowed;
    const startLabel = t('task.contextMenu.startNow');
    const quickGroup: ContextMenuItem[] = [
      {
        label: startRefused ? t('task.contextMenu.maxReached', { label: startLabel }) : startLabel,
        disabled: currentTask.status === TaskStatus.Progress || startRefused,
        onSelect: () => changeStatus(TaskStatus.Progress),
      },
      {
        label: t('task.contextMenu.markDone'),
        disabled: currentTask.status === TaskStatus.Done,
        onSelect: () => changeStatus(TaskStatus.Done),
      },
    ];

    // Group 1: Open details
    const detailsGroup: ContextMenuItem[] = [
      {
        label: t('task.contextMenu.openDetails'),
        onSelect: openDetails,
      },
    ];

    // Group 2: Unplanned toggle (checkbox)
    const unplannedGroup: ContextMenuItem[] = [
      {
        label: currentTask.isUnplanned
          ? t('task.contextMenu.markPlanned')
          : t('task.contextMenu.markUnplanned'),
        type: "checkbox" as const,
        checked: currentTask.isUnplanned ?? false,
        onUpdateChecked: () => toggleUnplanned(),
        onSelect: (e: Event) => e.preventDefault(),
      },
    ];

    // Group 3: Status change submenu

    const statusChildren: ContextMenuItem[] = STATUS_OPTIONS.map((opt) => {
      // Disable if: already in this status OR trying to move to Progress when at limit and no swap applies (#241)
      const isDisabledByWip = !canMoveOrSwapToStatus(currentTask.id, opt.status).allowed;

      return {
        label: isDisabledByWip 
          ? t('task.contextMenu.maxReached', { label: t(opt.labelKey) })
          : t(opt.labelKey),
        disabled: currentTask.status === opt.status || isDisabledByWip,
        onSelect: () => changeStatus(opt.status),
      };
    });

    const statusGroup: ContextMenuItem[] = [
      {
        label: t('task.contextMenu.changeStatus'),
        children: statusChildren,
      },
    ];

    // Group 4: Priority change submenu
    const priorityChildren: ContextMenuItem[] = PRIORITY_OPTIONS.map((opt) => ({
      label: getPriorityLabel(opt.priority),
      type: "checkbox" as const,
      checked: normalizePriority(currentTask.priority) === opt.priority,
      onSelect: () => changePriority(opt.priority),
    }));

    const priorityGroup: ContextMenuItem[] = [
      {
        label: t('task.contextMenu.changePriority'),
        children: priorityChildren,
      },
    ];

    // Group 5: Timebox submenu
    const timeboxPresetItems: ContextMenuItem[] = TIMEBOX_PRESETS.map(
      (preset) => ({
        label: t('task.contextMenu.presetMinutes', preset.minutes),
        type: "checkbox" as const,
        checked: currentTask.timeBoxSeconds === preset.seconds,
        onSelect: () => setTimebox(preset.seconds),
      })
    );

    const timeboxChildren: ContextMenuItem[] = [
      ...timeboxPresetItems,
      { type: "separator" as const },
      {
        label: t('task.contextMenu.customTime'),
        onSelect: requestCustomTimebox,
      },
      ...(currentTask.timeBoxSeconds
        ? [
            {
              label: t('task.contextMenu.removeTimebox'),
              onSelect: () => setTimebox(null),
            },
          ]
        : []),
    ];

    const timeboxGroup: ContextMenuItem[] = [
      {
        label: t('task.contextMenu.setTimebox'),
        children: timeboxChildren,
      },
    ];

    // Group 6: Move to another source (#322): one child per other connected source, none with a single source.
    // The hint is the child's second line, so a screen reader reads it with the item.
    const sourceGroup: ContextMenuItem[] = moveTargets.value.length === 0 ? [] : [
      {
        label: t('task.contextMenu.moveToSource'),
        children: moveTargets.value.map((target): ContextMenuItem => ({
          label: target.name,
          ...(target.hint ? { description: target.hint } : {}),
          disabled: target.disabled,
          onSelect: () => { moveToSource(target.source); },
        })),
      },
    ];

    // Group 6b (#296): copy title, duplicate and, for a task its source holds, open it there
    const url = sourceTaskUrl(currentTask);
    const copyGroup: ContextMenuItem[] = [
      { label: t('task.contextMenu.copyTitle'), onSelect: copyTitle },
      { label: t('task.contextMenu.duplicate'), onSelect: duplicateTask },
      ...(url
        ? [{
            label: t('task.detail.openIn', { source: t(SOURCE_META[currentTask.source].nameKey) }),
            onSelect: () => { void openExternal(url); },
          }]
        : []),
    ];

    // Group 7: Delete (danger zone)
    const deleteGroup: ContextMenuItem[] = [
      {
        label: t(deleteLabelKey(currentTask.source)),
        color: "error" as const,
        onSelect: deleteTask,
      },
    ];

    return [
      quickGroup,
      detailsGroup,
      unplannedGroup,
      statusGroup,
      priorityGroup,
      timeboxGroup,
      ...(sourceGroup.length ? [sourceGroup] : []),
      copyGroup,
      deleteGroup,
    ];
  });

  return {
    menuItems,
    openDetails,
    toggleUnplanned,
    changeStatus,
    changePriority,
    setTimebox,
    deleteTask,
    requestCustomTimebox,
    copyTitle,
    duplicateTask,
  };
};
