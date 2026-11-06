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

describe('Statistics Backfill Integration', () => {
  let backfillComposable: ReturnType<typeof useStatisticsBackfill>;
  let notionConfigStore: ReturnType<typeof useNotionConfigStore>;
  let statisticsStore: ReturnType<typeof useTaskStatisticsStore>;
  let boardStore: ReturnType<typeof useBoardStore>;

  const mockArchivedTasks: Task[] = [
    {
      id: 'integration-task-1', source: 'local', externalId: null,
      title: 'Integration Task 1',
      status: TaskStatus.Done,
      completedAt: new Date('2024-01-10T09:00:00Z'),
      timeSpentSeconds: 1800,
      timeBoxSeconds: 900,
      topic: 'Testing',
      topicColorCode: '#8b5cf6',
      activity: null,
      isUnplanned: false,
      priority: 1,
      notes: null,
      timerId: null,
      archivedAt: null,
      custom: {},
    },
  ];

  beforeEach(() => {
    setActivePinia(createPinia());
    
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
    const mockNotionIntegration: { getArchivedTasks: ReturnType<typeof vi.fn> } = {
      getArchivedTasks: vi.fn().mockResolvedValue(mockArchivedTasks),
    };
    vi.mocked(NotionIntegration).mockImplementation(function () { return mockNotionIntegration as unknown as NotionIntegration });

    // Clear statistics store and localStorage
    statisticsStore.clearAllRecords();
    if (import.meta.client) {
      localStorage.clear();
    }
  });

  it('should complete full backfill workflow', async () => {
    // 1. Verify initial state
    expect(notionConfigStore.isConfigured).toBe(false);
    expect(backfillComposable.hasArchiveStatus()).toBe(false);
    expect(statisticsStore.completionRecords).toHaveLength(0);

    // 2. Configure Notion with archive status
    notionConfigStore.setConfig({
      token: 'integration-test-token',
      databaseId: 'integration-test-db',
      dataSourceId: 'integration-test-ds',
      propertyMapping: {
        title: 'Name',
        status: 'Status',
        completedDate: 'Completed Date',
        timeSpent: 'Time Spent',
        timeBox: 'Time Box',
      },
      statusMapping: {
        today: 'Today',
        doing: 'Doing',
        done: 'Done',
        waiting: null,
        archive: 'Archived',
      },
    });

    // 3. Verify configuration is detected
    expect(notionConfigStore.isConfigured).toBe(true);
    expect(backfillComposable.hasArchiveStatus()).toBe(true);

    // 4. Run backfill
    await backfillComposable.runConfigChangeBackfill();

    // 5. Verify results
    expect(statisticsStore.completionRecords).toHaveLength(1);
    const record = statisticsStore.completionRecords[0]!;
    expect(record.taskId).toBe('integration-task-1');
    expect(record.title).toBe('Integration Task 1');
    expect(record.completedAt).toEqual(new Date('2024-01-10T09:00:00Z'));
    expect(record.actualTimeSpentSeconds).toBe(1800);
    expect(record.timeBoxSeconds).toBe(900);
    expect(record.topic).toBe('Testing');
    expect(record.topicColorCode).toBe('#8b5cf6');
    expect(record.isUnplanned).toBe(false);

    // 6. Verify job tracking
    const history = backfillComposable.getJobHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe('completed');
    expect(history[0]!.tasksProcessed).toBe(1);
    expect(history[0]!.tasksAdded).toBe(1);

    // 7. Verify duplicate prevention
    // getJobHistory() sorts by completedAt (ms resolution); ensure the second job gets a later timestamp
    await new Promise(resolve => setTimeout(resolve, 5));
    await backfillComposable.runConfigChangeBackfill();
    expect(statisticsStore.completionRecords).toHaveLength(1); // Still 1, no duplicates

    const duplicateHistory = backfillComposable.getJobHistory();
    expect(duplicateHistory).toHaveLength(2);
    // The second run should process 0 new tasks (all duplicates)
    expect(duplicateHistory[0]!.tasksAdded).toBe(0); // Second run added 0 due to duplicates
    expect(duplicateHistory[0]!.tasksProcessed).toBe(1); // But still processed the existing task
  });

  it('should handle tasks without completion timestamps', async () => {
    // Configure Notion
    notionConfigStore.setConfig({
      token: 'test-token',
      databaseId: 'test-db',
      dataSourceId: 'test-ds',
      propertyMapping: { title: 'Name', status: 'Status' },
      statusMapping: {
        today: 'Today',
        doing: 'Doing',
        done: 'Done',
        waiting: null,
        archive: 'Archived',
      },
    });

    // Mock tasks without completion timestamps
    const tasksWithoutTimestamp = [
      {
        ...mockArchivedTasks[0]!,
        id: 'no-timestamp-task',
        completedAt: null,
      },
    ];

    const mockNotionIntegration: { getArchivedTasks: ReturnType<typeof vi.fn> } = {
      getArchivedTasks: vi.fn().mockResolvedValue(tasksWithoutTimestamp),
    };
    vi.mocked(NotionIntegration).mockImplementation(function () { return mockNotionIntegration as unknown as NotionIntegration });

    // Run backfill
    await backfillComposable.runConfigChangeBackfill();

    // Should not add any tasks
    expect(statisticsStore.completionRecords).toHaveLength(0);
  });

  it('should calculate estimation accuracy correctly', async () => {
    // Configure Notion
    notionConfigStore.setConfig({
      token: 'test-token',
      databaseId: 'test-db',
      dataSourceId: 'test-ds',
      propertyMapping: { title: 'Name', status: 'Status' },
      statusMapping: {
        today: 'Today',
        doing: 'Doing',
        done: 'Done',
        waiting: null,
        archive: 'Archived',
      },
    });

    // Mock task with timebox and time spent
    const taskWithTimebox: Task = {
      ...mockArchivedTasks[0]!,
      timeSpentSeconds: 2700, // 45 minutes
      timeBoxSeconds: 3600, // 60 minutes
    };

    const mockNotionIntegration: { getArchivedTasks: ReturnType<typeof vi.fn> } = {
      getArchivedTasks: vi.fn().mockResolvedValue([taskWithTimebox]),
    };
    vi.mocked(NotionIntegration).mockImplementation(function () { return mockNotionIntegration as unknown as NotionIntegration });

    // Run backfill
    await backfillComposable.runConfigChangeBackfill();

    // Verify estimation accuracy calculation
    expect(statisticsStore.completionRecords).toHaveLength(1);
    const record = statisticsStore.completionRecords[0]!;
    expect(record.estimationAccuracy).toBe(75); // (2700 / 3600) * 100 = 75%
  });
});
