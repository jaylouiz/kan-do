import type { Task } from "@/types/task";
import { TaskStatus } from "~/types/taskStatus";
import { finishedFasterThanPlan } from "~/lib/completionPace";
import { useTasksStore } from "~/store/tasks";
import { useBoardStore } from "~/store/board";
import { useTaskSync } from "~/composables/useTaskSync";
import { useErrorHandler } from '~/composables/useErrorHandler';
import { translate } from '~/lib/i18n';
import { useCompletionUndo } from '~/composables/useCompletionUndo';
import { useTaskDeletion } from '~/composables/useTaskDeletion';
import { useTaskSwap } from '~/composables/useTaskSwap';
import { stopTaskTimer } from '~/composables/useTaskTimerDriver';
import { checkWipMove, type WipVerdict } from '~/utils/wipGuard';
import { useToast } from '#imports';

/**
 * Composable for complex task operations and business logic
 */
export const useTaskOperations = () => {
  // Move store calls inside function to prevent module-level circular dependencies
  const tasksStore = useTasksStore();
  const boardStore = useBoardStore();
  const { updateTaskStatus, syncPendingChanges } = useTaskSync();
  const { handleError } = useErrorHandler();
  const { captureCompletionSnapshot, notifyCompleted } = useCompletionUndo();
  const { deleteTaskWithUndo } = useTaskDeletion();
  const { swapIntoProgress, swapPartnerOf } = useTaskSwap();
  const toast = useToast();

  /**
   * Stops the running timer of a task and flushes its queued time once. The timer itself is started and
   * stopped by the status (`useTaskTimerDriver`, #352); this is the explicit stop for a task that stays in
   * Jetzt a moment longer (day close stops, then moves).
   */
  const stopTimer = (taskId: string): void => {
    if (!tasksStore.task(taskId)) {
      handleError(`Task with id ${taskId} not found`, 'task_operation');
      return;
    }

    if (stopTaskTimer(taskId)) syncPendingChanges();
  };

  /**
   * Toggles a task's completion status
   */
  const toggleTaskCompletion = async (taskId: string): Promise<void> => {
    const task = tasksStore.task(taskId);
    if (!task) {
      handleError(`Task with id ${taskId} not found`, 'task_operation');
      return;
    }

    const newStatus = task.status === TaskStatus.Done ? TaskStatus.Open : TaskStatus.Done;
    await moveTaskToStatus(taskId, newStatus);
  };

  /**
   * Asks the shared WIP rule whether a task may move to `newStatus` (no side effects).
   * Menus use it to disable entries; `moveTaskToStatus` uses it to refuse.
   */
  const canMoveToStatus = (taskId: string, newStatus: TaskStatus): WipVerdict => {
    const task = tasksStore.task(taskId);
    if (!task) return { allowed: true };
    return checkWipMove({
      currentStatus: task.status,
      targetStatus: newStatus,
      progressCount: tasksStore.tasksProgress.length,
    });
  };

  /** Tells the user that "Jetzt" is full (the shared WIP refusal toast). */
  const notifyWipRefused = (): void => {
    toast.add({
      id: 'wip-limit',
      title: translate('board.wip.refusedTitle'),
      description: translate('board.wip.refusedReason'),
      icon: 'i-ph-prohibit',
      color: 'neutral',
      duration: 5000,
    });
  };

  /**
   * Moves a task to a specific status/column. The single guarded move path for context menu,
   * detail sheet and command palette. Returns false when refused (WIP limit) or the task is missing.
   */
  const moveTaskToStatus = async (taskId: string, newStatus: TaskStatus): Promise<boolean> => {
    const task = tasksStore.task(taskId);
    if (!task) {
      handleError(`Task with id ${taskId} not found`, 'task_operation');
      return false;
    }

    const oldStatus = task.status;
    if (oldStatus === newStatus) return false;

    const verdict = canMoveToStatus(taskId, newStatus);
    if (!verdict.allowed) {
      notifyWipRefused();
      return false;
    }

    // Completion into Erledigt offers an undo toast (captured before the card leaves its column)
    const completion = newStatus === TaskStatus.Done ? captureCompletionSnapshot(taskId) : null;

    // Update the board first
    boardStore.updateTaskPosition(taskId, newStatus, oldStatus);

    // Then, sync the status change
    const sync = updateTaskStatus({ taskId, status: newStatus });
    // A card without a timebox that arrives in Jetzt asks for one (#389); the status is set synchronously above
    if (newStatus === TaskStatus.Progress) boardStore.startTimeboxNudge(taskId);
    // Same in-card confirmation and check spring as a drop into Erledigt (#124, #611)
    if (newStatus === TaskStatus.Done) boardStore.startConfirmation(taskId, finishedFasterThanPlan(tasksStore.task(taskId)));
    notifyCompleted(completion);
    await sync;
    return true;
  };

  /**
   * Like `canMoveToStatus`, but a full Jetzt that the task may take over by swap (#162, #241) counts as allowed.
   * Context menu, palette and sheet use it to enable the "Jetzt" entry; the add flow, bulk moves and day close
   * keep asking `canMoveToStatus` (a full Jetzt refuses there on purpose).
   */
  const canMoveOrSwapToStatus = (taskId: string, newStatus: TaskStatus): WipVerdict => {
    if (newStatus === TaskStatus.Progress && swapPartnerOf(taskId) !== null) return { allowed: true };
    return canMoveToStatus(taskId, newStatus);
  };

  /**
   * The path for "put this task in Jetzt" from the context menu, the palette and the task sheet (#241): when
   * Jetzt holds one task and this one may take it over, `useTaskSwap` swaps (one undo toast); otherwise exactly
   * `moveTaskToStatus` (guarded move, refusal toast). The decision is read from the store now, never from what the
   * caller showed, so a stale menu falls through to the refusal. The WIP rule itself stays in `utils/wipGuard.ts`.
   * Returns false when nothing moved.
   */
  const moveOrSwapToStatus = async (taskId: string, newStatus: TaskStatus): Promise<boolean> => {
    if (newStatus === TaskStatus.Progress && swapPartnerOf(taskId) !== null && swapIntoProgress(taskId)) return true;
    return moveTaskToStatus(taskId, newStatus);
  };

  /**
   * Bulk updates multiple tasks
   */
  const bulkUpdateTasks = async (taskIds: string[], updates: Partial<Task>): Promise<void> => {
    const promises = taskIds.map(taskId => {
      const task = tasksStore.task(taskId);
      if (task) {
        tasksStore.updateTask(taskId, updates);
        return Promise.resolve();
      }
      return Promise.reject(new Error(`Task ${taskId} not found`));
    });

    try {
      await Promise.all(promises);
    } catch (error) {
      handleError(error as Error, 'task_operation');
    }
  };

  /**
   * Deletes a task through the shared upstream-aware delete (undo toast, deferred upstream commit).
   * @param taskId The ID of the task to delete
   */
  const deleteTask = (taskId: string): void => {
    if (!tasksStore.task(taskId)) {
      handleError(`Task with id ${taskId} not found`, 'task_operation');
      return;
    }
    deleteTaskWithUndo(taskId);
  };

  /**
   * Archives completed tasks older than specified days
   */
  const archiveOldCompletedTasks = (daysOld: number = 30): void => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const tasksToArchive = tasksStore.tasksDone.filter((_task: Task) => {
      // This would need a completedAt timestamp on tasks
      // For now, we'll skip this functionality
      return false;
    });

    tasksToArchive.forEach((task: Task) => {
      if (task.id) {
        tasksStore.removeTask(task.id);
      }
    });
  };

  /**
   * Validates task data before operations
   */
  const validateTask = (task: Partial<Task>): string[] => {
    const errors: string[] = [];

    if (!task.title || task.title.trim().length === 0) {
      errors.push(translate('errors.validation.titleRequired'));
    }

    if (task.timeBoxSeconds && task.timeBoxSeconds < 0) {
      errors.push(translate('errors.validation.timeboxNegative'));
    }

    if (task.timeSpentSeconds && task.timeSpentSeconds < 0) {
      errors.push(translate('errors.validation.timeSpentNegative'));
    }

    return errors;
  };

  return {
    stopTimer,
    toggleTaskCompletion,
    moveTaskToStatus,
    canMoveToStatus,
    moveOrSwapToStatus,
    canMoveOrSwapToStatus,
    notifyWipRefused,
    bulkUpdateTasks,
    deleteTask,
    archiveOldCompletedTasks,
    validateTask,
  };
};
