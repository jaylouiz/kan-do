import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useTaskStatisticsStore } from '~/store/taskStatistics';
import { TaskStatus } from '~/types/taskStatus';
import type { Task } from '~/types/task';
import { buildDemoBoard } from '~/lib/demo-board';

describe('taskStatistics store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('syncExistingDoneTasks', () => {
    it('does not turn the demo board\'s done tasks into permanent records (#527)', () => {
      const statisticsStore = useTaskStatisticsStore();
      const demoDone = buildDemoBoard().tasks.filter(t => t.status === TaskStatus.Done);
      expect(demoDone.length).toBeGreaterThan(0);

      statisticsStore.syncExistingDoneTasks(demoDone, []);

      expect(statisticsStore.completionRecords).toHaveLength(0);
    });

    it('should backfill statistics from existing done tasks', () => {
      const statisticsStore = useTaskStatisticsStore();
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(14, 30, 0, 0);
      
      const doneTasks: Task[] = [
        {
          id: 'task-1', source: 'local', externalId: null,
          title: 'Completed yesterday',
          notes: null,
          status: TaskStatus.Done,
          priority: 1,
          timeBoxSeconds: 3600,
          timeSpentSeconds: 3300,
          topic: 'Work',
          topicColorCode: '#3b82f6',
          activity: null,
          timerId: null,
          completedAt: yesterday,
          isUnplanned: false,
        },
        {
          id: 'task-2', source: 'local', externalId: null,
          title: 'Completed today',
          notes: null,
          status: TaskStatus.Done,
          priority: 2,
          timeBoxSeconds: 1800,
          timeSpentSeconds: 2100,
          topic: 'Personal',
          topicColorCode: '#10b981',
          activity: null,
          timerId: null,
          completedAt: new Date(),
          isUnplanned: true,
        },
      ];
      
      statisticsStore.syncExistingDoneTasks(doneTasks, []);
      
      expect(statisticsStore.completionRecords).toHaveLength(2);
      
      const record1 = statisticsStore.completionRecords.find(r => r.taskId === 'task-1');
      expect(record1).toBeDefined();
      expect(record1?.title).toBe('Completed yesterday');
      expect(record1?.completedAt).toEqual(yesterday);
      expect(record1?.estimationAccuracy).toBeCloseTo(91.67, 1);
      expect(record1?.isUnplanned).toBe(false);
      
      const record2 = statisticsStore.completionRecords.find(r => r.taskId === 'task-2');
      expect(record2).toBeDefined();
      expect(record2?.title).toBe('Completed today');
      expect(record2?.estimationAccuracy).toBeCloseTo(116.67, 1);
      expect(record2?.isUnplanned).toBe(true);
    });

    it('should skip archived tasks', () => {
      const statisticsStore = useTaskStatisticsStore();
      
      const doneTasks: Task[] = [
        {
          id: 'task-archived', source: 'local', externalId: null,
          title: 'Archived task',
          notes: null,
          status: TaskStatus.Done,
          priority: 1,
          timeBoxSeconds: 3600,
          timeSpentSeconds: 3300,
          topic: null,
          topicColorCode: null,
          activity: null,
          timerId: null,
          completedAt: new Date(),
        },
      ];
      
      statisticsStore.syncExistingDoneTasks(doneTasks, ['task-archived']);
      
      expect(statisticsStore.completionRecords).toHaveLength(0);
    });

    it('should skip tasks without completedAt timestamp', () => {
      const statisticsStore = useTaskStatisticsStore();
      
      const doneTasks: Task[] = [
        {
          id: 'task-no-timestamp', source: 'local', externalId: null,
          title: 'Task without timestamp',
          notes: null,
          status: TaskStatus.Done,
          priority: 1,
          timeBoxSeconds: 3600,
          timeSpentSeconds: 3300,
          topic: null,
          topicColorCode: null,
          activity: null,
          timerId: null,
          completedAt: null,
        },
      ];
      
      statisticsStore.syncExistingDoneTasks(doneTasks, []);
      
      expect(statisticsStore.completionRecords).toHaveLength(0);
    });

    it('should skip tasks already in statistics', () => {
      const statisticsStore = useTaskStatisticsStore();
      
      const completedAt = new Date();
      
      // Add a task manually first
      statisticsStore.completionRecords.push({
        taskId: 'task-existing',
        title: 'Existing task',
        completedAt,
        timeBoxSeconds: 3600,
        actualTimeSpentSeconds: 3300,
        estimationAccuracy: 91.67,
        topic: null,
        topicColorCode: null,
        activity: null,
        isUnplanned: false,
      });
      
      const doneTasks: Task[] = [
        {
          id: 'task-existing', source: 'local', externalId: null,
          title: 'Existing task (updated title)',
          notes: null,
          status: TaskStatus.Done,
          priority: 1,
          timeBoxSeconds: 3600,
          timeSpentSeconds: 3300,
          topic: null,
          topicColorCode: null,
          activity: null,
          timerId: null,
          completedAt,
        },
      ];
      
      statisticsStore.syncExistingDoneTasks(doneTasks, []);
      
      // Should still be 1 record, not duplicated
      expect(statisticsStore.completionRecords).toHaveLength(1);
      // Title should not be updated (original record preserved)
      expect(statisticsStore.completionRecords[0]!.title).toBe('Existing task');
    });

    it('should calculate estimation accuracy correctly', () => {
      const statisticsStore = useTaskStatisticsStore();
      
      const doneTasks: Task[] = [
        {
          id: 'task-with-timebox', source: 'local', externalId: null,
          title: 'Task with timebox',
          notes: null,
          status: TaskStatus.Done,
          priority: 1,
          timeBoxSeconds: 3600,
          timeSpentSeconds: 4500, // 125% of estimate
          topic: null,
          topicColorCode: null,
          activity: null,
          timerId: null,
          completedAt: new Date(),
        },
        {
          id: 'task-without-timebox', source: 'local', externalId: null,
          title: 'Task without timebox',
          notes: null,
          status: TaskStatus.Done,
          priority: 1,
          timeBoxSeconds: null,
          timeSpentSeconds: 1800,
          topic: null,
          topicColorCode: null,
          activity: null,
          timerId: null,
          completedAt: new Date(),
        },
      ];
      
      statisticsStore.syncExistingDoneTasks(doneTasks, []);
      
      const withTimebox = statisticsStore.completionRecords.find(r => r.taskId === 'task-with-timebox');
      expect(withTimebox?.estimationAccuracy).toBe(125);
      
      const withoutTimebox = statisticsStore.completionRecords.find(r => r.taskId === 'task-without-timebox');
      expect(withoutTimebox?.estimationAccuracy).toBeNull();
    });
  });
  describe('day-end in-flight count (#537)', () => {
    it('keeps the last count of a day and one key per day', () => {
      const store = useTaskStatisticsStore();
      store.recordDayEnd('2026-11-03', 5);
      store.recordDayEnd('2026-11-03', 3);
      store.recordDayEnd('2026-11-04', 0);
      expect(store.dayEndInFlight).toEqual({ '2026-11-03': 3, '2026-11-04': 0 });
    });

    it('ignores a malformed day key or count', () => {
      const store = useTaskStatisticsStore();
      store.recordDayEnd('yesterday', 2);
      store.recordDayEnd('2026-11-03', -1);
      store.recordDayEnd('2026-11-03', Number.NaN);
      expect(store.dayEndInFlight).toEqual({});
    });

    it('prunes days older than 120 days, relative to the newest key', () => {
      const store = useTaskStatisticsStore();
      store.recordDayEnd('2026-01-01', 4);
      store.recordDayEnd('2026-04-30', 4); // 119 days later: both stay
      expect(Object.keys(store.dayEndInFlight)).toHaveLength(2);
      store.recordDayEnd('2026-05-02', 4); // 121 days after 2026-01-01
      expect(store.dayEndInFlight['2026-01-01']).toBeUndefined();
      expect(store.dayEndInFlight['2026-04-30']).toBe(4);
    });
  });

  describe('discarded time (#537)', () => {
    const task = (over: Partial<Task> = {}): Task => ({
      id: 'gone-1', source: 'local', externalId: null, title: 'Deleted', notes: null, status: TaskStatus.Open, priority: 1,
      timeBoxSeconds: null, timeSpentSeconds: 600, topic: null, topicColorCode: null, activity: null, timerId: null, ...over,
    } as Task);

    it('records a deleted task with tracked time once and replaces a re-delete', () => {
      const store = useTaskStatisticsStore();
      store.recordDiscardedTime(task(), 1_000);
      store.recordDiscardedTime(task({ timeSpentSeconds: 900 }), 2_000);
      expect(store.discardedTime).toEqual([{ taskId: 'gone-1', deletedAt: 2_000, seconds: 900 }]);
    });

    it('records nothing for a Done task, a task without time or a demo task', () => {
      const store = useTaskStatisticsStore();
      store.recordDiscardedTime(task({ status: TaskStatus.Done }), 1_000);
      store.recordDiscardedTime(task({ timeSpentSeconds: 0 }), 1_000);
      store.recordDiscardedTime(task({ id: buildDemoBoard().tasks[0]!.id }), 1_000);
      expect(store.discardedTime).toEqual([]);
    });

    it('removes an entry on restore and prunes entries older than 120 days', () => {
      const store = useTaskStatisticsStore();
      const day = 86_400_000;
      store.recordDiscardedTime(task({ id: 'old' }), 1_000);
      store.recordDiscardedTime(task({ id: 'new' }), 1_000 + 121 * day);
      expect(store.discardedTime.map(r => r.taskId)).toEqual(['new']);
      store.removeDiscardedTime('new');
      expect(store.discardedTime).toEqual([]);
    });
  });

  it('clearAllRecords also clears the day-end counts and discarded time (#537)', () => {
    const store = useTaskStatisticsStore();
    store.recordDayEnd('2026-11-03', 2);
    store.recordDiscardedTime({ id: 'x', status: TaskStatus.Open, timeSpentSeconds: 60 } as Task, 1);
    store.clearAllRecords();
    expect(store.dayEndInFlight).toEqual({});
    expect(store.discardedTime).toEqual([]);
  });
});
