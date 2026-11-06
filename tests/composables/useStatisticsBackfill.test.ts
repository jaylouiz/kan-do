import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useStatisticsBackfill } from '~/composables/useStatisticsBackfill';
import { useNotionConfigStore } from '~/store/notionConfig';
import { useTaskStatisticsStore } from '~/store/taskStatistics';
import { useBoardStore } from '~/store/board';
import { NotionIntegration } from '~/integrations/NotionIntegration';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '~/types/task';

// Mock the NotionIntegration
vi.mock('~/integrations/NotionIntegration', () => ({
  NotionIntegration: vi.fn(),
}));

// Mock the error handler
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
    handleSuccess: vi.fn(),
  }),
}));

describe('useStatisticsBackfill', () => {
  let backfillComposable: ReturnType<typeof useStatisticsBackfill>;
  let notionConfigStore: ReturnType<typeof useNotionConfigStore>;
  let statisticsStore: ReturnType<typeof useTaskStatisticsStore>;
  let boardStore: ReturnType<typeof useBoardStore>;
  let mockNotionIntegration: { getArchivedTasks: ReturnType<typeof vi.fn> };

  const mockArchivedTasks: Task[] = [
    {
      id: 'archived-task-1', source: 'local', externalId: null,
      title: 'Archived Task 1',
      status: TaskStatus.Done,
      completedAt: new Date('2024-01-15T10:00:00Z'),
      timeSpentSeconds: 3600,
      timeBoxSeconds: 1800,
      topic: 'Backend',
      topicColorCode: '#3b82f6',
      activity: null,
      isUnplanned: false,
      priority: 2,
      notes: null,
      timerId: null,
      archivedAt: null,
      custom: {},
    },
    {
      id: 'archived-task-2', source: 'local', externalId: null,
      title: 'Archived Task 2',
      status: TaskStatus.Done,
      completedAt: new Date('2024-01-16T14:30:00Z'),
      timeSpentSeconds: 7200,
      timeBoxSeconds: 3600,
      topic: 'Frontend',
      topicColorCode: '#10b981',
      activity: null,
      isUnplanned: true,
      priority: 3,
      notes: null,
      timerId: null,
      archivedAt: null,
      custom: {},
    },
  ];

  beforeEach(() => {
    setActivePinia(createPinia());
    
    // Clear localStorage to prevent state interference between tests
    if (import.meta.client) {
      localStorage.clear();
    }
    
    backfillComposable = useStatisticsBackfill();
    notionConfigStore = useNotionConfigStore();
    statisticsStore = useTaskStatisticsStore();
    boardStore = useBoardStore();

    // Setup board store with Notion service
    boardStore.boardConfig = {
      sources: { connected: ['notion'], default: 'notion' },
      todoistApiToken: undefined,
    };

    // Mock NotionIntegration instance
    mockNotionIntegration = {
      getArchivedTasks: vi.fn().mockResolvedValue(mockArchivedTasks),
    };
    vi.mocked(NotionIntegration).mockImplementation(function () { return mockNotionIntegration as unknown as NotionIntegration });

    // Setup Notion config with archive status
    notionConfigStore.setConfig({
      token: 'test-token',
      databaseId: 'test-db-id',
      dataSourceId: 'test-ds-id',
      propertyMapping: {
        title: 'Name',
        status: 'Status',
      },
      statusMapping: {
        today: 'Today',
        doing: 'Doing',
        done: 'Done',
        waiting: null,
        archive: 'Archived', // Archive status configured
      },
    });

    // Clear localStorage
    if (import.meta.client) {
      localStorage.clear();
    }
  });

  describe('hasArchiveStatus', () => {
    it('should return true when archive status is configured', () => {
      expect(backfillComposable.hasArchiveStatus()).toBe(true);
    });

    it('should return false when archive status is not configured', () => {
      notionConfigStore.setConfig({
        ...notionConfigStore.config!,
        statusMapping: {
          today: 'Today',
          doing: 'Doing',
          done: 'Done',
          waiting: null,
          archive: null, // No archive status
        },
      });

      expect(backfillComposable.hasArchiveStatus()).toBe(false);
    });

    it('should return false when Notion is not configured', () => {
      notionConfigStore.clearConfig();
      expect(backfillComposable.hasArchiveStatus()).toBe(false);
    });
  });

  describe('shouldRunDailyBackfill', () => {
    it('should return true when no previous daily run', () => {
      expect(backfillComposable.shouldRunDailyBackfill()).toBe(true);
    });

    it('should return false when daily run was less than 24 hours ago', () => {
      const recentDate = new Date();
      recentDate.setHours(recentDate.getHours() - 12); // 12 hours ago
      
      // Use the same composable instance - set on .value since it's a ref
      backfillComposable.backfillState.value.lastDailyRun = recentDate;
      
      expect(backfillComposable.shouldRunDailyBackfill()).toBe(false);
    });

    it('should return true when daily run was more than 24 hours ago', () => {
      const oldDate = new Date();
      oldDate.setHours(oldDate.getHours() - 25); // 25 hours ago
      
      backfillComposable.backfillState.value.lastDailyRun = oldDate;
      expect(backfillComposable.shouldRunDailyBackfill()).toBe(true);
    });
  });

  describe('executeBackfill', () => {
    beforeEach(() => {
      // Clear statistics store before each test
      statisticsStore.clearAllRecords();
    });

    it('should skip backfill when no archive status is configured', async () => {
      notionConfigStore.setConfig({
        ...notionConfigStore.config!,
        statusMapping: {
          today: 'Today',
          doing: 'Doing',
          done: 'Done',
          waiting: null,
          archive: null,
        },
      });

      await backfillComposable.executeBackfill('daily');

      expect(mockNotionIntegration.getArchivedTasks).not.toHaveBeenCalled();
      expect(statisticsStore.completionRecords).toHaveLength(0);
    });

    it('should fetch archived tasks and add them to statistics', async () => {
      await backfillComposable.executeBackfill('daily');

      expect(mockNotionIntegration.getArchivedTasks).toHaveBeenCalled();
      expect(statisticsStore.completionRecords).toHaveLength(2);
      
      // Check that tasks were added correctly
      const record1 = statisticsStore.completionRecords.find(r => r.taskId === 'archived-task-1');
      expect(record1).toBeDefined();
      expect(record1?.title).toBe('Archived Task 1');
      expect(record1?.completedAt).toEqual(new Date('2024-01-15T10:00:00Z'));
      expect(record1?.isUnplanned).toBe(false);

      const record2 = statisticsStore.completionRecords.find(r => r.taskId === 'archived-task-2');
      expect(record2).toBeDefined();
      expect(record2?.title).toBe('Archived Task 2');
      expect(record2?.isUnplanned).toBe(true);
    });

    it('should prevent duplicate entries on subsequent runs', async () => {
      // First run
      await backfillComposable.executeBackfill('daily');
      expect(statisticsStore.completionRecords).toHaveLength(2);

      // Second run (should skip duplicates)
      await backfillComposable.executeBackfill('daily');
      expect(statisticsStore.completionRecords).toHaveLength(2); // Still 2, no duplicates
    });

    it('should update timestamps for different trigger types', async () => {
      await backfillComposable.executeBackfill('daily');
      expect(backfillComposable.backfillState.value.lastDailyRun).toBeDefined();
      expect(backfillComposable.backfillState.value.lastNotionConfigChange).toBeUndefined();

      const configChangeTime = new Date();
      await backfillComposable.executeBackfill('config_change');
      expect(backfillComposable.backfillState.value.lastNotionConfigChange).toBeDefined();
      expect(backfillComposable.backfillState.value.lastNotionConfigChange?.getTime()).toBeGreaterThanOrEqual(configChangeTime.getTime());
    });

    it('should handle errors gracefully', async () => {
      const mockError = new Error('Notion API error');
      mockNotionIntegration.getArchivedTasks.mockRejectedValue(mockError);

      await backfillComposable.executeBackfill('daily');

      // Failed jobs should be in job history, not active jobs
      const jobHistory = backfillComposable.getJobHistory();
      expect(jobHistory).toHaveLength(1);
      expect(jobHistory[0]?.status).toBe('failed');
      expect(jobHistory[0]?.errorMessage).toBe('Notion API error');
    });

    it('should filter tasks without completion timestamps', async () => {
      const tasksWithoutTimestamp = [
        ...mockArchivedTasks,
        {
          ...mockArchivedTasks[0]!,
          id: 'no-timestamp-task',
          completedAt: null, // No timestamp
        },
      ];

      mockNotionIntegration.getArchivedTasks.mockResolvedValue(tasksWithoutTimestamp);

      await backfillComposable.executeBackfill('daily');

      // Should only add 2 tasks (skip the one without timestamp)
      expect(statisticsStore.completionRecords).toHaveLength(2);
      expect(statisticsStore.completionRecords.some(r => r.taskId === 'no-timestamp-task')).toBe(false);
    });
  });

  describe('job management', () => {
    it('should track active jobs correctly', async () => {
      const promise = backfillComposable.executeBackfill('daily');
      
      // Should have one running job
      const activeJobs = backfillComposable.getActiveJobs();
      expect(activeJobs).toHaveLength(1);
      expect(activeJobs[0]!.status).toBe('running');

      await promise;

      // Job should be completed after execution
      const completedJobs = backfillComposable.getActiveJobs();
      expect(completedJobs).toHaveLength(0); // No active jobs

      // But should be in history
      const history = backfillComposable.getJobHistory();
      expect(history).toHaveLength(1);
      expect(history[0]?.status).toBe('completed');
    });
  });

  describe('localStorage persistence', () => {
    it('should persist and restore state from localStorage', () => {
      if (!import.meta.client) {
        return; // Skip test on server
      }

      // Set some state
      backfillComposable.backfillState.value.lastDailyRun = new Date('2024-01-01T00:00:00Z');
      backfillComposable.backfillState.value.activeJobs.push({
        id: 'test-job',
        status: 'completed',
        completedAt: new Date('2024-01-01T01:00:00Z'),
        tasksProcessed: 5,
        tasksAdded: 3,
      });

      // Simulate component recreation by creating new instance
      const newBackfillComposable = useStatisticsBackfill();

      // State should be restored
      expect(newBackfillComposable.backfillState.value.lastDailyRun).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(newBackfillComposable.backfillState.value.activeJobs).toHaveLength(1);
      expect(newBackfillComposable.backfillState.value.activeJobs[0]?.id).toBe('test-job');
    });
  });
});
