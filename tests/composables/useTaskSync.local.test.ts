import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTaskSync } from '~/composables/useTaskSync';
import { useBoardStore } from '~/store/board';
import { useTasksStore } from '~/store/tasks';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '~/types/task';
import { switchSource } from '../helpers/taskSource'

// Mock the error handler
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
    handleSuccess: vi.fn(),
  }),
}));

// Mock NotionIntegration to ensure it's not called in local mode
vi.mock('~/integrations/NotionIntegration', () => ({
  NotionIntegration: vi.fn().mockImplementation(function () {
    return {
    updateTask: vi.fn(),
    }
  }),
}));

// Mock TodoistIntegration
vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () {
    return {
    completeTask: vi.fn(),
    reopenTask: vi.fn(),
    }
  }),
}));

describe('useTaskSync - Local Mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('updateTaskStatus in local mode', () => {
    it('updates task status locally without external sync', async () => {
      const boardStore = useBoardStore();
      const tasksStore = useTasksStore();
      
      switchSource('local');
      
      const task: Task = {
        id: 'local-task-1', source: 'local', externalId: null,
        title: 'Test Task',
        status: TaskStatus.Open,
        activity: null,
        topic: null,
        topicColorCode: null,
        priority: 1,
        notes: null,
        timeBoxSeconds: null,
        timeSpentSeconds: 0,
        timerId: null,
      };
      
      tasksStore.addTask(task);

      const { updateTaskStatus } = useTaskSync();
      
      await updateTaskStatus({
        taskId: 'local-task-1',
        status: TaskStatus.Progress,
      });
      
      const updatedTask = tasksStore.task('local-task-1');
      expect(updatedTask?.status).toBe(TaskStatus.Progress);
    });

    it('sets completedAt when moving to Done', async () => {
      const boardStore = useBoardStore();
      const tasksStore = useTasksStore();
      
      switchSource('local');
      
      const task: Task = {
        id: 'local-task-2', source: 'local', externalId: null,
        title: 'Test Task',
        status: TaskStatus.Progress,
        activity: null,
        topic: null,
        topicColorCode: null,
        priority: 1,
        notes: null,
        timeBoxSeconds: null,
        timeSpentSeconds: 0,
        timerId: null,
      };
      
      tasksStore.addTask(task);

      const { updateTaskStatus } = useTaskSync();
      
      await updateTaskStatus({
        taskId: 'local-task-2',
        status: TaskStatus.Done,
      });
      
      const updatedTask = tasksStore.task('local-task-2');
      expect(updatedTask?.status).toBe(TaskStatus.Done);
      expect(updatedTask?.completedAt).toBeDefined();
    });

    it('clears completedAt when moving out of Done', async () => {
      const boardStore = useBoardStore();
      const tasksStore = useTasksStore();
      
      switchSource('local');
      
      const task: Task = {
        id: 'local-task-3', source: 'local', externalId: null,
        title: 'Test Task',
        status: TaskStatus.Done,
        activity: null,
        topic: null,
        topicColorCode: null,
        priority: 1,
        notes: null,
        timeBoxSeconds: null,
        timeSpentSeconds: 0,
        timerId: null,
        completedAt: new Date(),
      };
      
      tasksStore.addTask(task);

      const { updateTaskStatus } = useTaskSync();
      
      await updateTaskStatus({
        taskId: 'local-task-3',
        status: TaskStatus.Open,
      });
      
      const updatedTask = tasksStore.task('local-task-3');
      expect(updatedTask?.status).toBe(TaskStatus.Open);
      expect(updatedTask?.completedAt).toBeNull();
    });
  });

  describe('syncPendingChanges in local mode', () => {
    it('does nothing in local mode (early return)', async () => {
      const boardStore = useBoardStore();
      const tasksStore = useTasksStore();
      
      switchSource('local');
      
      // Add a task with pending time update
      const task: Task = {
        id: 'local-task-4', source: 'local', externalId: null,
        title: 'Test Task',
        status: TaskStatus.Progress,
        activity: null,
        topic: null,
        topicColorCode: null,
        priority: 1,
        notes: null,
        timeBoxSeconds: null,
        timeSpentSeconds: 100,
        timerId: null,
      };
      
      tasksStore.addTask(task);
      tasksStore.addPendingTimeUpdate('local-task-4', 100);

      const { syncPendingChanges } = useTaskSync();
      
      // Should not throw and should return early
      await expect(syncPendingChanges()).resolves.toBeUndefined();
    });
  });
});
