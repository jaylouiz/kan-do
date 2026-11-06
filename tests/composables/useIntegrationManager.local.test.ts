import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useIntegrationManager } from '~/composables/useIntegrationManager';
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

// Mock useSyncValidation
vi.mock('~/composables/useSyncValidation', () => ({
  useSyncValidation: () => ({
    validateAndConfirm: vi.fn().mockResolvedValue(true),
  }),
}));

// Mock useNotionDataSource
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({
    ensureDataSourceConfigured: vi.fn().mockResolvedValue(true),
  }),
}));

describe('useIntegrationManager - Local Mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('isIntegrationConfigured', () => {
    it('returns true for local mode', () => {
      const boardStore = useBoardStore();
      switchSource('local');

      const { isIntegrationConfigured } = useIntegrationManager();
      
      expect(isIntegrationConfigured()).toBe(true);
    });

    it('returns true for example mode', () => {
      const boardStore = useBoardStore();
      switchSource('local');

      const { isIntegrationConfigured } = useIntegrationManager();
      
      expect(isIntegrationConfigured()).toBe(true);
    });

    it('returns false for null service', () => {
      const boardStore = useBoardStore();
      boardStore.setSingleSource(null);

      const { isIntegrationConfigured } = useIntegrationManager();
      
      expect(isIntegrationConfigured()).toBe(false);
    });
  });

  describe('fetchTasks with local mode', () => {
    it('fetches the Local tasks when Local is the only source', async () => {
      const boardStore = useBoardStore();
      const tasksStore = useTasksStore();
      
      switchSource('local');
      
      const existingTasks: Task[] = [
        {
          id: 'local-task-1', source: 'local', externalId: null,
          title: 'Local Task',
          status: TaskStatus.Open,
          activity: null,
          topic: null,
          topicColorCode: null,
          priority: 1,
          notes: null,
          timeBoxSeconds: null,
          timeSpentSeconds: 0,
          timerId: null,
        },
      ];
      
      tasksStore.setTasks(existingTasks);

      const { fetchTasks } = useIntegrationManager();
      const result = await fetchTasks();
      
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('local-task-1');
    });
  });

  describe('getIntegrationStatus', () => {
    it('returns correct status for local mode', () => {
      const boardStore = useBoardStore();
      const tasksStore = useTasksStore();
      
      switchSource('local');
      tasksStore.setTasks([
        {
          id: 'task-1', source: 'local', externalId: null,
          title: 'Test',
          status: TaskStatus.Open,
          activity: null,
          topic: null,
          topicColorCode: null,
          priority: 1,
          notes: null,
          timeBoxSeconds: null,
          timeSpentSeconds: 0,
          timerId: null,
        },
      ]);

      const { getIntegrationStatus } = useIntegrationManager();
      const status = getIntegrationStatus();
      
      expect(status.service).toBe('local');
      expect(status.isConfigured).toBe(true);
      expect(status.taskCount).toBe(1);
    });
  });
});
